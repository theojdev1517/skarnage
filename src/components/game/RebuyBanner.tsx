'use client';

import { useEffect, useState } from 'react';
import type { GameState } from '@/types/game';
import { GAME_CONFIG } from '@/lib/game/config';
import { formatStack } from '@/lib/formatStack';

type RebuyBannerProps = {
  game: GameState;
  mySeat: number | null;
  busy?: boolean;
  onRebuy: (stackCents: number) => void;
};

export function RebuyBanner({ game, mySeat, busy = false, onRebuy }: RebuyBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const offered =
    mySeat != null && game.rebuy_offered_seats?.includes(mySeat) && game.rebuy_deadline_at;

  useEffect(() => {
    if (!game.rebuy_deadline_at) return;
    const tick = () => {
      const ms = new Date(game.rebuy_deadline_at!).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [game.rebuy_deadline_at]);

  if (!offered || secondsLeft <= 0) return null;

  const defaultStack = game.blinds.big * 200;

  return (
    <div className="bg-amber-950/80 border border-amber-600/50 rounded-lg p-2 text-xs shrink-0 space-y-2">
      <p className="text-amber-200">
        You are out of chips — rebuy within {secondsLeft}s ({GAME_CONFIG.REBUY_WINDOW_SECONDS}s
        window)
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => onRebuy(defaultStack)}
        className="w-full py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
      >
        Rebuy {formatStack(defaultStack)}
      </button>
    </div>
  );
}