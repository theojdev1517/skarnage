'use client';

import { useParams } from 'next/navigation';
import { useGameState } from '@/hooks/useGameState';

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { game, loading } = useGameState(gameId || '');

  if (loading) return <div className="p-8 text-center text-white">Loading table...</div>;
  if (!game) return <div className="p-8 text-center text-white">Game not found</div>;

  return (
    <div className="min-h-screen bg-[#0a1f0a] p-4 text-white">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl mb-6 text-emerald-400">Skarney • Table {gameId}</h1>
        
        <pre className="bg-black/50 p-6 rounded text-sm overflow-auto max-h-[80vh]">
          {JSON.stringify(game, null, 2)}
        </pre>
      </div>
    </div>
  );
}