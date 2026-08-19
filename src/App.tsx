import { useState, useCallback } from 'react';
import Landing from '@/components/Landing';
import Room from '@/components/Room';

type AppState = { mode: 'landing' } | { mode: 'room'; roomId: string; displayName: string };

export default function App() {
  const [state, setState] = useState<AppState>({ mode: 'landing' });

  const handleJoin = useCallback((roomId: string, displayName: string) => {
    setState({ mode: 'room', roomId, displayName });
  }, []);

  const handleLeave = useCallback(() => {
    setState({ mode: 'landing' });
  }, []);

  if (state.mode === 'landing') {
    return <Landing onJoin={handleJoin} />;
  }

  return (
    <Room
      roomId={state.roomId}
      displayName={state.displayName}
      onLeave={handleLeave}
    />
  );
}
