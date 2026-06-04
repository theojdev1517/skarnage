'use client';

import { useEffect, useState } from 'react';
import { GAME_CONFIG } from '@/lib/game/config';

type TurnTimerProps = {
  deadline: string | null;
  isMyTurn: boolean;
  seat: number;
  onTimeout: (seat: number) => void;
};

export function TurnTimer({ deadline, isMyTurn, seat, onTimeout }: TurnTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!GAME_CONFIG.TURN_TIMER_ENABLED || !deadline || !isMyTurn) {
      setSecondsLeft(null);
      return;
    }

    const tick = () => {
      const ms = new Date(deadline).getTime() - Date.now();
      const sec = Math.max(0, Math.ceil(ms / 1000));
      setSecondsLeft(sec);
      if (sec <= 0) {
        onTimeout(seat);
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadline, isMyTurn, seat, onTimeout]);

  if (!GAME_CONFIG.TURN_TIMER_ENABLED || secondsLeft === null) return null;

  return (
    <p className="text-center text-amber-400 text-xs font-mono tabular-nums">
      Timer: {secondsLeft}s
    </p>
  );
}