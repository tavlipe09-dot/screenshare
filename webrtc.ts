import { supabase } from './supabase';

export type SignalPayload =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'leave' }
  | { type: 'hello'; displayName: string; isSharing?: boolean }
  | { type: 'reconnect-request'; isSharing: boolean }
  | { type: 'restart'; isSharing: boolean }
  | { type: 'sharing'; active: boolean };

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed';

export type RemotePeer = {
  id: string;
  displayName: string;
  isSharing: boolean;
};

type SessionEvents = {
  onRemoteStream: (stream: MediaStream | null) => void;
  onRemotePeerUpdate: (peer: RemotePeer | null) => void;
  onLocalSharingChange: (isSharing: boolean) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onPeerCountChange: (count: number) => void;
};

type WireSignal = SignalPayload & {
  from: string;
  to?: string;
};

type PresenceData = {
  displayName?: string;
  isSharing?: boolean;
};

const MAX_BITRATE = 8_000_000;
const MAX_FPS = 60;
const SIGNAL_SUBSCRIBE_TIMEOUT_MS = 15_000;

function log(...args: unknown[]) {
  console.log('[ScreenShare]', ...args);
}

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.google.com:19302' },
  ];

  const turnUrls = (import.meta.env.VITE_TURN_URL as string | undefined)
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const turnUsername = (import.meta.env.VITE_TURN_USERNAME as string | undefined)?.trim();
  const turnCredential = (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined)?.trim();

  if (turnUrls?.length && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

export class ScreenShareSession {
  private roomId: string;
  private peerId: string;
  private displayName: string;
  private channel: ReturnType<typeof supabase.channel> | null = null;
  private pc: RTCPeerConnection | null = null;
  private videoTransceiver: RTCRtpTransceiver | null = null;
  private audioTransceiver: RTCRtpTransceiver | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream = new MediaStream();
  private remotePeerId: string | null = null;
  private remotePeerName = 'Guest';
  private remoteIsSharing = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private events: SessionEvents;
  private status: ConnectionStatus = 'idle';
  private destroyed = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private signalingReady = false;
  private signalQueue: Promise<void> = Promise.resolve();
  private restartPromise: Promise<void> | null = null;
  private lastRestartAt = 0;

  constructor(roomId: string, peerId: string, displayName: string, events: SessionEvents) {
    this.roomId = roomId;
    this.peerId = peerId;
    this.displayName = displayName;
    this.events = events;
  }

  async connect() {
    if (this.destroyed) return;
    if (this.channel) return;

    log('Connecting to room:', this.roomId, 'as peer:', this.peerId);

    this.channel = supabase.channel(`room:${this.roomId}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: this.peerId },
      },
    });

    this.channel
      .on('presence', { event: 'sync' }, () => {
        if (!this.channel || this.destroyed) return;

        const state = this.channel.presenceState() as Record<string, PresenceData[]>;
        const keys = Object.keys(state);
        this.events.onPeerCountChange(keys.length);

        const remoteKey = keys.find((key) => key !== this.peerId);
        if (!remoteKey) {
          if (this.remotePeerId) this.handleRemoteLeave();
          return;
        }

        const presences = state[remoteKey] ?? [];
        const name = presences[0]?.displayName ?? 'Guest';
        this.registerRemotePeer(remoteKey, name, presences[0]?.isSharing);
        void this.maybeStartPeerConnection();
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key === this.peerId || this.destroyed) return;

        const name = (newPresences[0] as PresenceData | undefined)?.displayName ?? 'Guest';
        const isSharing = (newPresences[0] as PresenceData | undefined)?.isSharing;
        log('Peer joined:', key, name);
        this.registerRemotePeer(key, name, isSharing);
        void this.maybeStartPeerConnection();
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key !== this.remotePeerId) return;
        log('Peer left:', key);
        this.handleRemoteLeave();
      })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        this.signalQueue = this.signalQueue
          .then(() => this.handleSignal(payload as WireSignal))
          .catch((signalError: unknown) => {
            console.error('[ScreenShare] Failed to process signal:', signalError);
          });
      });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled || this.destroyed) return;
        settled = true;
        this.setStatus('failed');
        reject(new Error('Supabase Realtime subscription timed out.'));
      }, SIGNAL_SUBSCRIBE_TIMEOUT_MS);

      this.channel!.subscribe(async (status, error) => {
        if (this.destroyed) return;

        if (status === 'SUBSCRIBED') {
          log('Realtime channel subscribed');
          try {
            await this.channel!.track(this.getPresenceData());
            this.signalingReady = true;
            log('Presence tracked, announcing hello');
            this.setStatus(this.remotePeerId ? 'connecting' : 'idle');
            this.broadcastSignal(this.getHelloSignal());

            if (!settled) {
              settled = true;
              window.clearTimeout(timeout);
              resolve();
            }
          } catch (trackError) {
            if (!settled) {
              settled = true;
              window.clearTimeout(timeout);
              this.setStatus('failed');
              reject(trackError);
            }
          }
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[ScreenShare] Supabase channel error:', status, error);
          this.signalingReady = false;
          this.events.onRemoteStream(null);
          this.cleanupPeer();
          this.setStatus('failed');

          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            reject(error ?? new Error(`Supabase Realtime status: ${status}`));
          }
          return;
        }

        if (status === 'CLOSED' && !this.destroyed) {
          this.signalingReady = false;
          this.setStatus('disconnected');
        }
      });
    });
  }

  async reconnect() {
    if (this.destroyed) return;

    if (!this.signalingReady || !this.channel) {
      await this.reconnectSignaling();
      return;
    }

    if (!this.remotePeerId) {
      this.setStatus('idle');
      this.broadcastSignal(this.getHelloSignal());
      return;
    }

    log('Reconnecting to peer:', this.remotePeerId);
    const remotePeerId = this.remotePeerId;
    const shouldOffer = this.peerId.localeCompare(remotePeerId) < 0;

    this.setStatus('connecting');

    if (shouldOffer) {
      await this.restartAsOfferer();
      return;
    }

    // Only the deterministic offerer rebuilds the connection. This prevents
    // both browsers from sending competing offers when they notice the same
    // network interruption at roughly the same time.
    this.events.onRemoteStream(null);
    this.cleanupPeer();
    await this.sendSignal(remotePeerId, {
      type: 'reconnect-request',
      isSharing: this.isLocalSharing(),
    });
  }

  private async reconnectSignaling() {
    this.events.onRemoteStream(null);
    this.cleanupPeer();

    if (this.channel) {
      try {
        await supabase.removeChannel(this.channel);
      } catch (error) {
        console.warn('[ScreenShare] Failed to remove stale Supabase channel:', error);
      }
      this.channel = null;
    }

    this.signalingReady = false;
    await this.connect();
  }

  private registerRemotePeer(id: string, displayName: string, isSharing?: boolean) {
    if (id === this.peerId) return;

    if (this.remotePeerId && this.remotePeerId !== id) return;

    this.remotePeerId = id;
    this.remotePeerName = displayName || 'Guest';
    if (typeof isSharing === 'boolean') {
      this.remoteIsSharing = isSharing;
    }
    log('Registered remote peer:', id, this.remotePeerName);
    this.events.onRemotePeerUpdate({
      id,
      displayName: this.remotePeerName,
      isSharing: this.remoteIsSharing,
    });

    this.publishRemoteStreamIfReady();
  }

  private async handleSignal(payload: WireSignal) {
    if (this.destroyed) return;
    if (!payload || payload.from === this.peerId) return;
    if (payload.to && payload.to !== this.peerId) return;
    if (this.remotePeerId && payload.from !== this.remotePeerId) return;

    log('Signal received:', payload.type, 'from:', payload.from);

    switch (payload.type) {
      case 'hello': {
        const firstTimeSeeingPeer = this.remotePeerId !== payload.from;
        this.registerRemotePeer(payload.from, payload.displayName, payload.isSharing);

        if (!payload.to) {
          void this.sendSignal(payload.from, this.getHelloSignal());
        }

        if (firstTimeSeeingPeer || !this.pc) {
          await this.maybeStartPeerConnection();
        }
        break;
      }

      case 'reconnect-request': {
        this.registerRemotePeer(payload.from, this.remotePeerName, payload.isSharing);

        if (this.peerId.localeCompare(payload.from) < 0) {
          await this.restartAsOfferer();
        }
        break;
      }

      case 'restart': {
        this.registerRemotePeer(payload.from, this.remotePeerName, payload.isSharing);

        // A restart is always coordinated by the deterministic offerer. The
        // answerer clears its stale connection before the new offer arrives.
        if (this.peerId.localeCompare(payload.from) > 0) {
          this.events.onRemoteStream(null);
          this.cleanupPeer();
          this.setStatus('connecting');
          await this.ensurePeer();
        }
        break;
      }

      case 'offer': {
        this.registerRemotePeer(payload.from, this.remotePeerName);
        await this.ensurePeer();
        if (!this.pc) return;

        const polite = this.peerId.localeCompare(payload.from) > 0;
        const offerCollision = this.makingOffer || this.pc.signalingState !== 'stable';
        this.ignoreOffer = !polite && offerCollision;

        if (this.ignoreOffer) {
          log('Ignoring offer (glare resolution)');
          return;
        }

        try {
          if (offerCollision && this.pc.signalingState !== 'stable') {
            await this.pc.setLocalDescription({ type: 'rollback' });
          }

          await this.pc.setRemoteDescription(payload.sdp);
          await this.flushPendingCandidates();

          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          log('Sending answer');
          await this.sendSignal(payload.from, {
            type: 'answer',
            sdp: this.pc.localDescription ?? answer,
          });
          this.setStatus('connecting');
        } catch (error) {
          console.error('[ScreenShare] Failed to handle offer:', error);
          this.setStatus('failed');
        }
        break;
      }

      case 'answer': {
        if (!this.pc) return;

        try {
          await this.pc.setRemoteDescription(payload.sdp);
          await this.flushPendingCandidates();
          this.ignoreOffer = false;
          log('Answer processed, ICE gathering should complete');
        } catch (error) {
          console.error('[ScreenShare] Failed to handle answer:', error);
          this.setStatus('failed');
        }
        break;
      }

      case 'candidate': {
        if (this.ignoreOffer) return;

        if (!this.pc || !this.pc.remoteDescription) {
          this.pendingCandidates.push(payload.candidate);
          return;
        }

        try {
          await this.pc.addIceCandidate(payload.candidate);
        } catch (error) {
          console.error('[ScreenShare] Error adding ICE candidate:', error);
        }
        break;
      }

      case 'sharing': {
        this.registerRemotePeer(payload.from, this.remotePeerName, payload.active);
        break;
      }

      case 'leave': {
        if (!this.remotePeerId || payload.from === this.remotePeerId) {
          this.handleRemoteLeave();
        }
        break;
      }
    }
  }

  private async maybeStartPeerConnection() {
    if (!this.remotePeerId || this.destroyed) return;

    await this.ensurePeer();
    if (!this.pc) return;

    this.setStatus('connecting');

    const shouldOffer = this.peerId.localeCompare(this.remotePeerId) < 0;
    if (shouldOffer) {
      log('Creating offer as deterministic offerer');
      await this.createOffer();
    } else {
      log('Waiting for remote offer (we are the answerer)');
    }
  }

  private async ensurePeer() {
    if (this.pc || this.destroyed) return;

    log('Creating RTCPeerConnection');
    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(),
      iceCandidatePoolSize: 4,
    });

    this.pc = pc;

    this.videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
    this.audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });

    this.remoteStream = new MediaStream();

    pc.ontrack = (event) => {
      const track = event.track;
      log('Remote track received:', track.kind, track.id);
      if (!this.remoteStream.getTracks().some((existing) => existing.id === track.id)) {
        this.remoteStream.addTrack(track);
      }

      track.addEventListener('ended', () => {
        this.remoteStream.removeTrack(track);
        if (track.kind === 'video') {
          this.events.onRemoteStream(null);
        }
      });

      track.addEventListener('unmute', () => this.publishRemoteStreamIfReady());

      this.publishRemoteStreamIfReady();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.remotePeerId) {
        this.sendSignal(this.remotePeerId, {
          type: 'candidate',
          candidate: event.candidate.toJSON(),
        });
      } else if (!event.candidate) {
        log('ICE gathering complete');
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.pc !== pc || this.destroyed) return;

      log('Connection state:', pc.connectionState);
      switch (pc.connectionState) {
        case 'connected':
          this.setStatus('connected');
          break;
        case 'connecting':
          this.setStatus('connecting');
          break;
        case 'disconnected':
          this.setStatus('disconnected');
          break;
        case 'failed':
          this.setStatus('failed');
          break;
        case 'closed':
          if (!this.destroyed) this.setStatus('disconnected');
          break;
        default:
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc || this.destroyed) return;

      log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'checking') {
        this.setStatus('connecting');
      } else if (pc.iceConnectionState === 'failed') {
        this.setStatus('failed');
      }
    };

    pc.onicecandidateerror = (event) => {
      console.warn('[ScreenShare] ICE candidate error:', event);
    };

    if (this.localStream) {
      await this.attachLocalStreamToReservedSenders();
    }
  }

  private async createOffer() {
    if (!this.pc || !this.remotePeerId || this.destroyed) return;
    if (this.makingOffer || this.pc.signalingState !== 'stable') return;

    this.makingOffer = true;
    this.setStatus('connecting');

    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      log('Offer created and set as local description, sending to peer');

      await this.sendSignal(this.remotePeerId, {
        type: 'offer',
        sdp: this.pc.localDescription ?? offer,
      });
    } catch (error) {
      console.error('[ScreenShare] Error creating offer:', error);
      this.setStatus('failed');
      throw error;
    } finally {
      this.makingOffer = false;
    }
  }

  private async flushPendingCandidates() {
    if (!this.pc?.remoteDescription) return;

    const candidates = this.pendingCandidates;
    this.pendingCandidates = [];

    for (const candidate of candidates) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('[ScreenShare] Error flushing ICE candidate:', error);
      }
    }
  }

  private broadcastSignal(payload: SignalPayload) {
    if (!this.channel) return;

    void this.channel
      .send({
        type: 'broadcast',
        event: 'signal',
        payload: { ...payload, from: this.peerId },
      })
      .then((result) => {
        if (result !== 'ok') {
          console.warn('[ScreenShare] Broadcast signal result:', result, payload.type);
        }
      });
  }

  private async sendSignal(to: string, payload: SignalPayload) {
    if (!this.channel) return;

    const result = await this.channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: { ...payload, from: this.peerId, to },
      });

    if (result !== 'ok') {
      console.warn('[ScreenShare] Signal result:', result, payload.type);
    }
  }

  async startSharing() {
    if (this.destroyed) throw new Error('Session has already been closed.');
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing is not supported by this browser.');
    }

    log('Starting screen sharing');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: MAX_FPS, max: MAX_FPS },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: true,
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
    }

    this.localStream = stream;

    try {
      if (this.remotePeerId) {
        await this.ensurePeer();
        await this.attachLocalStreamToReservedSenders();
        await this.maybeStartPeerConnection();
        await this.sendSignal(this.remotePeerId, { type: 'sharing', active: true });
      }

      this.events.onLocalSharingChange(true);
      void this.updatePresence();

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener(
        'ended',
        () => {
          this.stopSharing();
        },
        { once: true },
      );

      return stream;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      if (this.localStream === stream) this.localStream = null;
      throw error;
    }
  }

  private async attachLocalStreamToReservedSenders() {
    if (!this.pc || !this.videoTransceiver || !this.audioTransceiver) return;

    const videoTrack = this.localStream?.getVideoTracks()[0] ?? null;
    const audioTrack = this.localStream?.getAudioTracks()[0] ?? null;

    await this.videoTransceiver.sender.replaceTrack(videoTrack);
    await this.audioTransceiver.sender.replaceTrack(audioTrack);

    if (videoTrack) {
      try {
        const params = this.videoTransceiver.sender.getParameters();
        if (params.encodings?.length) {
          params.encodings[0].maxBitrate = MAX_BITRATE;
          await this.videoTransceiver.sender.setParameters(params);
        }
      } catch (error) {
        console.warn('[ScreenShare] Could not apply video bitrate cap:', error);
      }
    }
  }

  stopSharing() {
    log('Stopping screen sharing');
    const stream = this.localStream;
    this.localStream = null;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    this.events.onLocalSharingChange(false);
    void this.updatePresence();

    if (this.videoTransceiver) {
      void this.videoTransceiver.sender.replaceTrack(null).catch((error) => {
        console.warn('[ScreenShare] Failed to clear video sender:', error);
      });
    }

    if (this.audioTransceiver) {
      void this.audioTransceiver.sender.replaceTrack(null).catch((error) => {
        console.warn('[ScreenShare] Failed to clear audio sender:', error);
      });
    }

    if (this.remotePeerId) {
      void this.sendSignal(this.remotePeerId, { type: 'sharing', active: false });
    }
  }

  private getPresenceData(): PresenceData {
    return {
      displayName: this.displayName,
      isSharing: this.isLocalSharing(),
    };
  }

  private getHelloSignal(): Extract<SignalPayload, { type: 'hello' }> {
    return {
      type: 'hello',
      displayName: this.displayName,
      isSharing: this.isLocalSharing(),
    };
  }

  private isLocalSharing() {
    return this.localStream?.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
  }

  private async updatePresence() {
    if (!this.channel || !this.signalingReady || this.destroyed) return;

    try {
      await this.channel.track(this.getPresenceData());
    } catch (error) {
      console.warn('[ScreenShare] Failed to update sharing presence:', error);
    }
  }

  private publishRemoteStreamIfReady() {
    if (!this.remoteIsSharing) {
      this.events.onRemoteStream(null);
      return;
    }

    const hasVideoTrack = this.remoteStream
      .getVideoTracks()
      .some((track) => track.readyState === 'live');

    if (hasVideoTrack) {
      this.events.onRemoteStream(this.remoteStream);
    }
  }

  private async restartAsOfferer() {
    if (!this.remotePeerId || this.destroyed) return;
    if (this.restartPromise) return this.restartPromise;

    // A request from the answerer can cross an already-started local retry.
    // Ignore that duplicate briefly so a healthy new offer is not torn down.
    if (Date.now() - this.lastRestartAt < 3_000 && this.pc) return;

    const remotePeerId = this.remotePeerId;
    this.lastRestartAt = Date.now();
    this.restartPromise = (async () => {
      this.events.onRemoteStream(null);
      this.cleanupPeer();
      this.setStatus('connecting');

      await this.sendSignal(remotePeerId, {
        type: 'restart',
        isSharing: this.isLocalSharing(),
      });

      await this.ensurePeer();
      await this.createOffer();
    })().finally(() => {
      this.restartPromise = null;
    });

    return this.restartPromise;
  }

  private handleRemoteLeave() {
    log('Remote peer left');
    this.events.onRemotePeerUpdate(null);
    this.events.onRemoteStream(null);
    this.cleanupPeer();
    this.remotePeerId = null;
    this.remotePeerName = 'Guest';
    this.remoteIsSharing = false;
    this.setStatus('idle');
  }

  private cleanupPeer() {
    const pc = this.pc;
    this.pc = null;

    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onicecandidateerror = null;
      pc.close();
    }

    this.videoTransceiver = null;
    this.audioTransceiver = null;
    this.pendingCandidates = [];
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.remoteStream = new MediaStream();
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status || this.destroyed) return;
    this.status = status;
    log('Status:', status);
    this.events.onStatusChange(status);
  }

  async destroy() {
    if (this.destroyed) return;

    log('Destroying session');
    if (this.remotePeerId) {
      this.sendSignal(this.remotePeerId, { type: 'leave' });
    }

    this.stopSharing();
    this.cleanupPeer();
    this.destroyed = true;

    if (this.channel) {
      await supabase.removeChannel(this.channel);
      this.channel = null;
    }

    this.signalingReady = false;
  }
}
