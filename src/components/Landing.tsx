import { useState, useCallback } from 'react';
import { Monitor, ArrowRight, Sparkles, Shield, Zap, Users } from 'lucide-react';

type LandingProps = {
  onJoin: (roomId: string, displayName: string) => void;
};

function generateRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `${id.slice(0, 4)}-${id.slice(4)}`;
}

export default function Landing({ onJoin }: LandingProps) {
  const [roomId, setRoomId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const name = displayName.trim() || 'Guest';
      const room = mode === 'create' ? generateRoomId() : roomId.trim().toLowerCase();
      if (!room) return;
      onJoin(room, name);
    },
    [displayName, roomId, mode, onJoin]
  );

  return (
    <div className="min-h-screen flex flex-col bg-ink-950 relative overflow-hidden">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-brand-600/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[10%] w-[500px] h-[500px] bg-brand-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-ink-800/50">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-glow">
            <Monitor className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-bold tracking-tight">ScreenShare</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-300">
          <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
          Servers online
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Hero */}
          <div className="hidden lg:block animate-slide-up">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-medium mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              4K Ultra HD Screen Sharing
            </div>
            <h1 className="text-5xl font-extrabold leading-[1.1] tracking-tight text-balance mb-5">
              Share your screen in <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">crystal-clear 4K</span>
            </h1>
            <p className="text-ink-300 text-lg leading-relaxed mb-8 max-w-md">
              Create a room, share the link with one person, and stream your entire screen, a browser tab, or an application — at up to 60 FPS.
            </p>
            <div className="space-y-4">
              {[
                { icon: Zap, title: 'Ultra-low latency', desc: 'Direct peer-to-peer connection' },
                { icon: Shield, title: 'Private by design', desc: 'No servers store your video' },
                { icon: Users, title: 'Two-person rooms', desc: 'Perfect for 1-on-1 collaboration' },
              ].map((f) => (
                <div key={f.title} className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-ink-800 border border-ink-700 flex items-center justify-center flex-shrink-0">
                    <f.icon className="w-4.5 h-4.5 text-brand-400" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{f.title}</div>
                    <div className="text-sm text-ink-400">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Join card */}
          <div className="animate-scale-in">
            <div className="bg-ink-900/80 backdrop-blur-xl border border-ink-800 rounded-2xl p-8 shadow-2xl">
              {/* Toggle */}
              <div className="flex gap-1 p-1 bg-ink-850 rounded-xl mb-6">
                <button
                  type="button"
                  onClick={() => setMode('create')}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    mode === 'create' ? 'bg-brand-600 text-white shadow-lg' : 'text-ink-300 hover:text-ink-100'
                  }`}
                >
                  Create Room
                </button>
                <button
                  type="button"
                  onClick={() => setMode('join')}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                    mode === 'join' ? 'bg-brand-600 text-white shadow-lg' : 'text-ink-300 hover:text-ink-100'
                  }`}
                >
                  Join Room
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-ink-200 mb-2">Your name</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex"
                    maxLength={24}
                    className="w-full px-4 py-3 bg-ink-850 border border-ink-700 rounded-xl text-ink-100 placeholder-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
                  />
                </div>

                {mode === 'join' && (
                  <div className="animate-fade-in">
                    <label className="block text-sm font-medium text-ink-200 mb-2">Room code</label>
                    <input
                      type="text"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      placeholder="e.g. a1b2-c3d4"
                      className="w-full px-4 py-3 bg-ink-850 border border-ink-700 rounded-xl text-ink-100 placeholder-ink-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all font-mono lowercase"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-glow group"
                >
                  {mode === 'create' ? 'Create Room' : 'Join Room'}
                  <ArrowRight className="w-4.5 h-4.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </form>

              <p className="text-center text-xs text-ink-400 mt-5">
                {mode === 'create'
                  ? 'We\'ll generate a shareable room code for you'
                  : 'Enter the 8-character code from your friend'}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
