'use client';

import { useParams } from 'next/navigation';
import { useGameState } from '@/hooks/useGameState';
import type { Player } from '@/types/game';

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { game, loading } = useGameState(gameId || '');

  const joinSeat = (seat: number) => {
    const name = prompt('Enter your display name:') || 'Player';
    alert(`Joining seat ${seat} as ${name} - backend coming soon`);
  };

  if (loading) return <div className="p-8 text-center">Loading table...</div>;
  if (!game) return <div className="p-8 text-center">Game not found</div>;

  const currentPlayer = game.players?.find(p => p.seat === game.current_player_seat);

  

  return (
    <div className="min-h-screen bg-[#0a1f0a] p-4 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl text-emerald-400">Skarney • Table {gameId}</h1>
                  <div className="flex gap-4 mb-6">
          <button 
            onClick={() => window.location.href = '/'}
            className="bg-zinc-700 hover:bg-zinc-600 px-6 py-2 rounded text-sm"
          >
            ← New Game
          </button>
        </div>
          <div>Pot: ${game.pot} | Status: {game.status}</div>
        </div>

        {/* Dual Board */}
        <div className="bg-zinc-900 p-6 rounded-xl mb-8">
          <div className="flex justify-between mb-4">
            <div>
              <div className="text-emerald-400 text-sm">TOP BOARD (High)</div>
              <div className="font-mono text-2xl tracking-widest">
                {game.board?.top?.filter(Boolean).join(' ') || 'Waiting for flop...'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-red-400 text-sm">SHREDDER BOARD</div>
              <div className="font-mono text-2xl tracking-widest text-red-400">
                {game.board?.shredder?.filter(Boolean).join(' ') || '—'}
              </div>
            </div>
          </div>
        </div>

                {/* 8 Seats around oval table */}
        <div className="relative w-full max-w-5xl mx-auto h-[460px] bg-emerald-950 rounded-full border-8 border-emerald-800 mb-12">
          {[1,2,3,4,5,6,7,8].map((seat) => {
            const player = game.players.find(p => p.seat === seat);
            const angle = (seat - 1) * (360 / 8) - 90; // start at top
            const radiusX = 42; // % 
            const radiusY = 35;

            return (
              <div 
                key={seat}
                className="absolute w-28 h-20 bg-zinc-900 border-2 border-zinc-700 rounded-2xl flex items-center justify-center text-center cursor-pointer hover:border-amber-400 hover:scale-105 transition-all shadow-lg"
                style={{
                  left: `calc(50% + ${radiusX * Math.cos((angle * Math.PI) / 180)}%)`,
                  top: `calc(50% + ${radiusY * Math.sin((angle * Math.PI) / 180)}%)`,
                  transform: 'translate(-50%, -50%)',
                }}
                onClick={() => joinSeat(seat)}
              >
                {player ? (
                  <div className="text-xs p-1">
                    <div className="font-bold">{player.display_name}</div>
                    <div>${player.stack}</div>
                  </div>
                ) : (
                  <div className="text-zinc-400 text-xs leading-tight">
                    Seat {seat}<br/>Empty<br/>Click to Join
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Action Bar (placeholder) */}
        <div className="bg-zinc-900 p-6 rounded-xl">
          <p className="text-center text-zinc-400">
            {currentPlayer ? `Seat ${currentPlayer.seat} to act` : 'Waiting for players...'}
          </p>
          {<button 
  onClick={() => alert('Betting coming soon')}
  className="bg-blue-600 px-8 py-3 rounded"
>
  Test Action
</button>/* Betting / Discard buttons will go here in next chunk */}
        </div>
      </div>
    </div>
  );
}