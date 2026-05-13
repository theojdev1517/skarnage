'use client';

import { useParams } from 'next/navigation';
import { useGameState } from '@/hooks/useGameState';
import type { Player } from '@/types/game';

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { game, loading } = useGameState(gameId || '');

  const joinSeat = async (seat: number) => {
    const name = prompt('Enter your display name:') || 'Player';
    try {
      const { joinSeat: joinAction } = await import('./actions');
      await joinAction(gameId, seat, name);
    } catch (e) {
      console.error(e);
      alert('Join failed');
    }
  };

  const handleAction = async (betAction: "fold" | "check" | "call" | "raise", amount: number = 0) => {
    if (!game) return alert("No game");

    const currentPlayer = game.players?.find(p => p.seat === game.current_player_seat);
    if (!currentPlayer) return alert("No current player to act");

    try {
      const res = await fetch(`/api/game/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bet',
          seat: currentPlayer.seat,
          betAction,
          amount,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Action failed');
      }
      // Supabase realtime will update the UI
    } catch (e) {
      console.error(e);
      alert('Failed to send action');
    }
  };

  const handleStartHand = async () => {
    if (!game) return;
    try {
      const res = await fetch(`/api/game/${gameId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'startHand' }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Failed to start hand');
    } catch (e) {
      console.error(e);
      alert('Failed to start hand');
    }
  };

  if (loading) return <div className="p-8 text-center">Loading table...</div>;
  if (!game) return <div className="p-8 text-center">Game not found</div>;

  const currentPlayer = game.players?.find(p => p.seat === game.current_player_seat);

  return (
    <div className="min-h-screen bg-[#0a1f0a] p-4 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl text-emerald-400">Skarney • Table {gameId}</h1>
          <div className="flex gap-4">
            <button 
              onClick={() => window.location.href = '/'}
              className="bg-zinc-700 hover:bg-zinc-600 px-6 py-2 rounded text-sm"
            >
              ← New Game
            </button>
            <button 
              onClick={handleStartHand}
              className="bg-emerald-600 hover:bg-emerald-500 px-6 py-2 rounded text-sm font-medium"
            >
              Start New Hand
            </button>
          </div>
          <div>Pot: ${(game.pot / 100).toFixed(2)} | Status: {game.status}</div>
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

        {/* Seats */}
        <div className="relative w-full max-w-5xl mx-auto h-[460px] bg-emerald-950 rounded-full border-8 border-emerald-800 mb-12">
          {[1,2,3,4,5,6,7,8].map((seat) => {
            const player = game.players?.find(p => p.seat === seat);
            const angle = (seat - 1) * (360 / 8) - 90;
            const radiusX = 42;
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
                    <div>${(player.stack / 100).toFixed(2)}</div>
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

        {/* Action Bar */}
        <div className="bg-zinc-900 p-6 rounded-xl">
          <p className="text-center text-emerald-400 mb-4 font-medium">
            {currentPlayer 
              ? `Seat ${currentPlayer.seat} (${currentPlayer.display_name}) to act` 
              : 'Waiting for players...'}
          </p>

          {currentPlayer && (
            <div className="flex flex-wrap gap-3 justify-center">
              <button 
                onClick={() => handleAction('fold')} 
                className="bg-red-600 hover:bg-red-700 px-8 py-3 rounded font-medium"
              >
                Fold
              </button>
              <button 
                onClick={() => handleAction('check')} 
                className="bg-zinc-600 hover:bg-zinc-500 px-8 py-3 rounded font-medium"
              >
                Check
              </button>
              <button 
                onClick={() => handleAction('call')} 
                className="bg-emerald-600 hover:bg-emerald-500 px-8 py-3 rounded font-medium"
              >
                Call
              </button>
              <button 
                onClick={() => handleAction('raise', (game.current_wager || game.blinds.big) * 2)} 
                className="bg-amber-600 hover:bg-amber-500 px-8 py-3 rounded font-medium"
              >
                Raise
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}