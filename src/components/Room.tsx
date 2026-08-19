import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Monitor,
  MonitorOff,
  Mic,
  MicOff,
  PhoneOff,
  Copy,
  Check,
  Users,
  Wifi,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Loader2,
  Signal,
  ScreenShare,
  ScreenShareOff,
} from 'lucide-react';
import {
  ScreenShareSession,
  type ConnectionStatus,
  type RemotePeer,
  type StreamQuality,
} from '@/lib/webrtc';

type RoomProps = {
  roomId: string;
  displayName: string;
  onLeave: () => void;
};

export default function Room({ roomId, displayName, onLeave }: RoomProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<ScreenShareSession | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const shareLockRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const isWatchingRef = useRef(false);

  const [isSharing, setIsSharing] = useState(false);
  const [isStartingShare, setIsStartingShare] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volumeOn, setVolumeOn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [peerCount, setPeerCount] = useState(1);
  const [remotePeer, setRemotePeer] = useState<RemotePeer | null>(null);
  const [hasRemoteStream, setHasRemoteStream] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [streamQuality, setStreamQuality] = useState<StreamQuality>('medium');
  const [error, setError] = useState<string | null>(null);

  // Initialize session
  useEffect(() => {
    const peerId = crypto.randomUUID();
    const session = new ScreenShareSession(roomId, peerId, displayName, {
      onRemoteStream: (stream) => {
        pendingStreamRef.current = stream;
        setHasRemoteStream(!!stream);
        if (!stream && videoRef.current) {
          videoRef.current.srcObject = null;
        } else if (stream && isWatchingRef.current && videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {
            isWatchingRef.current = false;
            setIsWatching(false);
          });
        }
      },
      onRemotePeerUpdate: (peer) => {
        setRemotePeer(peer);
        if (!peer || !peer.isSharing) {
          isWatchingRef.current = false;
          setIsWatching(false);
          setHasRemoteStream(false);
          pendingStreamRef.current = null;
          if (videoRef.current) videoRef.current.srcObject = null;
        }
      },
      onLocalSharingChange: (sharing) => setIsSharing(sharing),
      onQualityChange: (quality) => setStreamQuality(quality),
      onStatusChange: (s) => {
        setStatus(s);
        if (s === 'connected') {
          reconnectAttemptsRef.current = 0;
          setError(null);
        }
      },
      onPeerCountChange: (c) => setPeerCount(c),
    });

    sessionRef.current = session;
    void session.connect().catch((connectError: unknown) => {
      console.error('[ScreenShare] Failed to connect session:', connectError);
      setStatus('failed');
      const message = connectError instanceof Error ? connectError.message : String(connectError);
      setError(`Connection failed. ${message}`);
    });

    return () => {
      void session.destroy();
      sessionRef.current = null;
    };
  }, [roomId, displayName]);

  // Recover a peer-to-peer negotiation that gets stuck. We keep the same
  // session/peer id so Presence does not flap and interrupt an active share.
  useEffect(() => {
    const hasPeer = remotePeer !== null || peerCount > 1;

    if (!hasPeer || status === 'connected' || status === 'idle') {
      if (status === 'connected') reconnectAttemptsRef.current = 0;
      return;
    }

    if (status !== 'connecting' && status !== 'failed' && status !== 'disconnected') return;

    if (reconnectAttemptsRef.current >= 5) {
      setError(
        'Could not establish the peer-to-peer connection. Check the Supabase key and configure a TURN server for restricted networks.',
      );
      return;
    }

    // `disconnected` is often a short Wi-Fi transition that WebRTC can heal
    // without destroying the current connection. Give it a grace period.
    const delay = status === 'connecting' ? 20_000 : status === 'disconnected' ? 7_500 : 2_000;
    const timer = window.setTimeout(() => {
      const session = sessionRef.current;
      if (!session) return;

      reconnectAttemptsRef.current += 1;
      setError(`Connection interrupted. Reconnecting (${reconnectAttemptsRef.current}/5)…`);

      void session.reconnect().catch((reconnectError: unknown) => {
        console.error('[ScreenShare] Reconnect failed:', reconnectError);
        setStatus('failed');
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [status, remotePeer, peerCount]);

  // Fullscreen detection
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleStartShare = useCallback(async () => {
    if (shareLockRef.current || isStartingShare || isSharing) return;

    const session = sessionRef.current;
    if (!session) {
      setError('The connection is not ready yet. Please try again.');
      return;
    }

    shareLockRef.current = true;
    setError(null);
    setIsStartingShare(true);

    try {
      await session.startSharing();
      setIsSharing(true);
    } catch (shareError: unknown) {
      console.error('[ScreenShare] Failed to start screen sharing:', shareError);
      const message = shareError instanceof Error ? shareError.message : String(shareError);
      setError(`Could not start screen sharing. ${message}`);
      setIsSharing(false);
    } finally {
      shareLockRef.current = false;
      setIsStartingShare(false);
    }
  }, [isSharing, isStartingShare]);

  const handleStopShare = useCallback(() => {
    sessionRef.current?.stopSharing();
    setIsSharing(false);
  }, []);

  const handleJoinStream = useCallback(async () => {
    const stream = pendingStreamRef.current;
    const video = videoRef.current;
    if (!stream || !video) return;

    setError(null);
    video.srcObject = stream;
    isWatchingRef.current = true;
    setIsWatching(true);

    try {
      await video.play();
    } catch (playError) {
      // Some browsers still reject playback when the shared screen contains
      // audio. Enter muted first; the viewer can enable audio afterwards.
      try {
        video.muted = true;
        await video.play();
        setIsMuted(true);
        setVolumeOn(false);
      } catch (mutedPlayError) {
        console.error('[ScreenShare] Could not enter transmission:', mutedPlayError, playError);
        isWatchingRef.current = false;
        setIsWatching(false);
        setError('O navegador bloqueou a transmissão. Clique novamente para entrar.');
      }
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const handleToggleVolume = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = volumeOn;
      setVolumeOn(!volumeOn);
      setIsMuted(!volumeOn);
    }
  }, [volumeOn]);

  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const handleCopyRoom = useCallback(() => {
    void navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomId]);

  const handleLeave = useCallback(() => {
    void sessionRef.current?.destroy();
    onLeave();
  }, [onLeave]);

  const statusInfo = getStatusInfo(status, hasRemoteStream, isSharing);
  const remoteName = remotePeer?.displayName ?? 'Waiting for peer...';
  const qualityLabel = isSharing
    ? {
        high: 'Alta · 60 FPS',
        medium: 'Média · 30 FPS',
        low: 'Baixa · 15 FPS',
      }[streamQuality]
    : 'Automática';

  return (
    <div className="h-screen flex flex-col bg-ink-950 overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-ink-800 bg-ink-900/60 backdrop-blur-md flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Monitor className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">ScreenShare</div>
            <div className="text-xs text-ink-400 leading-tight">Room</div>
          </div>
        </div>

        {/* Room code */}
        <button
          onClick={handleCopyRoom}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ink-850 border border-ink-700 hover:border-brand-500/50 transition-colors group"
        >
          <span className="text-xs text-ink-400">Code:</span>
          <span className="text-sm font-mono font-semibold text-brand-300">{roomId}</span>
          {copied ? (
            <Check className="w-3.5 h-3.5 text-accent-green" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-ink-400 group-hover:text-ink-200 transition-colors" />
          )}
        </button>

        {/* Status */}
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${statusInfo.bg}`}>
            <span className={`w-2 h-2 rounded-full ${statusInfo.dot} ${status === 'connecting' ? 'animate-pulse' : ''}`} />
            {statusInfo.label}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 flex-shrink-0 bg-ink-900 border-r border-ink-800 flex flex-col">
          <div className="px-4 py-3 border-b border-ink-800 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-400">Participants</span>
            <span className="flex items-center gap-1 text-xs text-ink-300">
              <Users className="w-3.5 h-3.5" />
              {peerCount}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1">
            {/* You */}
            <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg bg-ink-850/60">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-sm font-bold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent-green border-2 border-ink-850" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{displayName}</div>
                <div className="text-xs text-ink-400 flex items-center gap-1">
                  {isSharing ? (
                    <>
                      <ScreenShare className="w-3 h-3 text-brand-400" />
                      Sharing
                    </>
                  ) : (
                    'You'
                  )}
                </div>
              </div>
            </div>

            {/* Remote peer */}
            {remotePeer ? (
              <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg bg-ink-850/60 animate-fade-in">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-ink-600 to-ink-700 flex items-center justify-center text-sm font-bold text-white">
                    {remotePeer.displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-ink-850 ${status === 'connected' ? 'bg-accent-green' : 'bg-accent-amber'}`} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{remotePeer.displayName}</div>
                  <div className="text-xs text-ink-400 flex items-center gap-1">
                    {remotePeer.isSharing ? (
                      <>
                        <ScreenShare className="w-3 h-3 text-brand-400" />
                        Sharing
                      </>
                    ) : status === 'connecting' ? (
                      'Connecting...'
                    ) : (
                      'Connected'
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg border border-dashed border-ink-700">
                <div className="w-9 h-9 rounded-full bg-ink-800 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-ink-400 animate-spin" />
                </div>
                <div>
                  <div className="text-sm font-medium text-ink-300">Waiting...</div>
                  <div className="text-xs text-ink-500">Share the room code</div>
                </div>
              </div>
            )}
          </div>

          {/* Connection info */}
          <div className="p-3 border-t border-ink-800 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-400 flex items-center gap-1.5">
                <Signal className="w-3.5 h-3.5" />
                Quality
              </span>
              <span className="text-brand-300 font-medium">{qualityLabel}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-400 flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5" />
                Connection
              </span>
              <span className="text-ink-200 font-medium">P2P</span>
            </div>
          </div>
        </aside>

        {/* Main stage */}
        <main className="flex-1 flex flex-col bg-ink-950 overflow-hidden">
          {/* Stage */}
          <div
            ref={containerRef}
            className="flex-1 flex items-center justify-center p-4 relative"
          >
            {/* Video element is always mounted so the ref is available when the stream arrives */}
            <div className="relative w-full h-full rounded-2xl overflow-hidden bg-black shadow-2xl ring-1 ring-ink-700 group">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
              {isWatching && hasRemoteStream ? (
                <>
                  {/* Overlay info */}
                  <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-md text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="w-2 h-2 rounded-full bg-accent-red animate-pulse" />
                    Assistindo à transmissão de {remoteName}
                  </div>
                  {/* Fullscreen button */}
                  <button
                    onClick={handleFullscreen}
                    className="absolute top-4 right-4 w-9 h-9 rounded-lg bg-black/60 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    {isFullscreen ? <Minimize2 className="w-4.5 h-4.5" /> : <Maximize2 className="w-4.5 h-4.5" />}
                  </button>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center max-w-md mx-auto animate-fade-in">
                  <div className="relative mb-8">
                    <div className="absolute inset-0 bg-brand-500/20 rounded-full blur-3xl animate-pulse" />
                    <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-ink-800 to-ink-850 border border-ink-700 flex items-center justify-center">
                      {remotePeer?.isSharing || isSharing ? (
                        <Monitor className="w-12 h-12 text-brand-400" strokeWidth={1.5} />
                      ) : (
                        <MonitorOff className="w-12 h-12 text-ink-400" strokeWidth={1.5} />
                      )}
                    </div>
                    {(remotePeer?.isSharing || isSharing) && (
                      <span className="absolute inset-0 rounded-3xl border-2 border-brand-500 animate-pulse-ring" />
                    )}
                  </div>

                  <h2 className="text-2xl font-bold mb-2">
                    {remotePeer?.isSharing
                      ? `${remoteName} está compartilhando a tela`
                      : isSharing
                        ? 'Você está compartilhando sua tela'
                        : 'Ninguém está compartilhando ainda'}
                  </h2>
                  <p className="text-ink-400 mb-1">
                    {remotePeer?.isSharing
                      ? hasRemoteStream
                        ? 'A transmissão está pronta. Entre quando quiser.'
                        : status === 'failed' || status === 'disconnected'
                          ? 'Reconectando à transmissão em qualidade reduzida...'
                          : 'Preparando a transmissão...'
                      : isSharing
                        ? 'Aguardando a outra pessoa entrar na transmissão...'
                      : remotePeer
                        ? 'Click "Share Screen" to start streaming in 4K'
                        : 'Share the room code with someone to get started'}
                  </p>

                  {remotePeer?.isSharing && (
                    <button
                      type="button"
                      onClick={() => void handleJoinStream()}
                      disabled={!hasRemoteStream}
                      className="mt-6 flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-lg hover:shadow-glow transition-all disabled:opacity-50 disabled:cursor-wait"
                    >
                      {hasRemoteStream ? (
                        <ScreenShare className="w-5 h-5" />
                      ) : (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      )}
                      {hasRemoteStream ? 'Entrar na transmissão' : 'Preparando transmissão...'}
                    </button>
                  )}

                  {error && (
                    <div className="mt-4 px-4 py-2.5 rounded-lg bg-accent-red/10 border border-accent-red/30 text-accent-red text-sm">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Controls bar */}
          <div className="flex items-center justify-center gap-3 px-4 py-4 border-t border-ink-800 bg-ink-900/60 backdrop-blur-md flex-shrink-0">
            {/* Share screen */}
            <button
              onClick={isSharing ? handleStopShare : handleStartShare}
              disabled={isStartingShare}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all ${
                isSharing
                  ? 'bg-accent-red/20 border border-accent-red/40 text-accent-red hover:bg-accent-red/30'
                  : 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg hover:shadow-glow'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isStartingShare ? (
                <Loader2 className="w-4.5 h-4.5 animate-spin" />
              ) : isSharing ? (
                <ScreenShareOff className="w-4.5 h-4.5" />
              ) : (
                <ScreenShare className="w-4.5 h-4.5" />
              )}
              {isStartingShare ? 'Starting...' : isSharing ? 'Stop Sharing' : 'Share Screen'}
            </button>

            {/* Mute */}
            {isWatching && hasRemoteStream && (
              <button
                onClick={handleToggleMute}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                  isMuted
                    ? 'bg-accent-red/20 border border-accent-red/40 text-accent-red hover:bg-accent-red/30'
                    : 'bg-ink-800 border border-ink-700 text-ink-200 hover:bg-ink-750'
                }`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            )}

            {/* Volume */}
            {isWatching && hasRemoteStream && (
              <button
                onClick={handleToggleVolume}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                  volumeOn
                    ? 'bg-ink-800 border border-ink-700 text-ink-200 hover:bg-ink-750'
                    : 'bg-ink-800 border border-ink-700 text-ink-400 hover:bg-ink-750'
                }`}
                title={volumeOn ? 'Mute audio' : 'Unmute audio'}
              >
                {volumeOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </button>
            )}

            {/* Divider */}
            <div className="w-px h-8 bg-ink-700 mx-1" />

            {/* Leave */}
            <button
              onClick={handleLeave}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-accent-red hover:bg-red-600 text-white font-semibold text-sm transition-all shadow-lg"
            >
              <PhoneOff className="w-4.5 h-4.5" />
              Leave
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

function getStatusInfo(status: ConnectionStatus, hasRemote: boolean, isSharing: boolean) {
  if (status === 'connected' || hasRemote) {
    return { label: 'Connected', bg: 'bg-accent-green/10 text-accent-green', dot: 'bg-accent-green' };
  }
  if (status === 'connecting') {
    return { label: 'Connecting...', bg: 'bg-accent-amber/10 text-accent-amber', dot: 'bg-accent-amber' };
  }
  if (status === 'failed') {
    return { label: 'Failed', bg: 'bg-accent-red/10 text-accent-red', dot: 'bg-accent-red' };
  }
  if (status === 'disconnected') {
    return { label: 'Disconnected', bg: 'bg-ink-800 text-ink-300', dot: 'bg-ink-500' };
  }
  if (isSharing) {
    return { label: 'Sharing', bg: 'bg-brand-500/10 text-brand-300', dot: 'bg-brand-500' };
  }
  return { label: 'Ready', bg: 'bg-ink-800 text-ink-300', dot: 'bg-ink-500' };
}
