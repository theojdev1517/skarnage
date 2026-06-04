'use client';

import { useEffect, useState } from 'react';
import type { GameState, Player } from '@/types/game';
import { dollarsToCents, formatStack } from '@/lib/formatStack';

type SeatHostMenuProps = {
  game: GameState;
  player: Player;
  x: number;
  y: number;
  onClose: () => void;
  onHostAction: (payload: Record<string, unknown>) => Promise<void>;
};

export function SeatHostMenu({
  game,
  player,
  x,
  y,
  onClose,
  onHostAction,
}: SeatHostMenuProps) {
  const [addAmount, setAddAmount] = useState('');
  const [removeAmount, setRemoveAmount] = useState('');
  const [setAmount, setSetAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      await onHostAction(payload);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Host action failed');
    } finally {
      setBusy(false);
    }
  };

  const isCurrentHost = player.user_id === game.host_id;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="fixed z-50 min-w-[200px] bg-zinc-900 border border-zinc-600 rounded-lg shadow-xl py-1 text-sm text-white"
        style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 320) }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-1.5 border-b border-zinc-700 text-xs text-zinc-400">
          {player.display_name} · seat {player.seat} · {formatStack(player.stack)}
        </div>

        <div className="px-2 py-2 space-y-2 border-b border-zinc-800">
          <div className="text-[10px] uppercase text-zinc-500 tracking-wide">Add to stack</div>
          <div className="flex gap-1">
            <input
              type="number"
              min="0"
              step="0.01"
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const cents = dollarsToCents(addAmount);
                if (cents === null || cents <= 0) return alert('Enter a valid amount');
                run({ action: 'hostAddStack', seat: player.seat, amountCents: cents });
              }}
              className="px-2 py-1 rounded bg-emerald-800 text-xs disabled:opacity-50"
            >
              Add
            </button>
          </div>

          <div className="text-[10px] uppercase text-zinc-500 tracking-wide">Remove</div>
          <div className="flex gap-1">
            <input
              type="number"
              min="0"
              step="0.01"
              value={removeAmount}
              onChange={(e) => setRemoveAmount(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const cents = dollarsToCents(removeAmount);
                if (cents === null || cents <= 0) return alert('Enter a valid amount');
                run({ action: 'hostRemoveStack', seat: player.seat, amountCents: cents });
              }}
              className="px-2 py-1 rounded bg-red-900/80 text-xs disabled:opacity-50"
            >
              Rem
            </button>
          </div>

          <div className="text-[10px] uppercase text-zinc-500 tracking-wide">Set stack to</div>
          <div className="flex gap-1">
            <input
              type="number"
              min="0"
              step="0.01"
              value={setAmount}
              onChange={(e) => setSetAmount(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const cents = dollarsToCents(setAmount);
                if (cents === null) return alert('Enter a valid amount');
                run({ action: 'hostSetStack', seat: player.seat, stackCents: cents });
              }}
              className="px-2 py-1 rounded bg-amber-800 text-xs disabled:opacity-50"
            >
              Set
            </button>
          </div>
        </div>

        <button
          type="button"
          disabled={busy || isCurrentHost}
          onClick={() => run({ action: 'hostTransfer', seat: player.seat })}
          className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-800 disabled:opacity-40"
        >
          Transfer host here
        </button>
      </div>
    </>
  );
}