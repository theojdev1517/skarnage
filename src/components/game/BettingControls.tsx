'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GameState, Player } from '@/types/game';
import { getWagerBounds, validateWagerTo } from '@/lib/game/bettingLimits';
import { dollarsToCents, formatStack } from '@/lib/formatStack';

type BettingControlsProps = {
  game: GameState;
  player: Player;
  facingBet: boolean;
  busy?: boolean;
  onAction: (
    betAction: 'fold' | 'check' | 'call' | 'bet' | 'raise',
    amountCents?: number
  ) => void | Promise<void>;
};

export function BettingControls({
  game,
  player,
  facingBet,
  busy = false,
  onAction,
}: BettingControlsProps) {
  const wagerAction = facingBet ? 'raise' : 'bet';
  const bounds = useMemo(() => {
    try {
      return getWagerBounds(game, player.seat, wagerAction);
    } catch {
      return null;
    }
  }, [game, player.seat, wagerAction]);

  const defaultWagerTo = bounds?.minWagerTo ?? game.blinds.big;
  const [wagerInput, setWagerInput] = useState(() => (defaultWagerTo / 100).toString());
  const [wagerError, setWagerError] = useState<string | null>(null);

  useEffect(() => {
    if (bounds) setWagerInput((bounds.minWagerTo / 100).toString());
  }, [bounds?.minWagerTo, bounds?.maxWagerTo, game.current_player_seat, game.status]);

  const submitWager = async () => {
    if (busy) return;
    if (!bounds) {
      setWagerError('Cannot wager right now');
      return;
    }
    const cents = dollarsToCents(wagerInput);
    if (cents === null) {
      setWagerError('Enter a valid bet amount');
      return;
    }
    try {
      validateWagerTo(game, player.seat, wagerAction, cents);
    } catch (e) {
      setWagerError(e instanceof Error ? e.message : 'Invalid amount');
      return;
    }
    setWagerError(null);
    try {
      await onAction(wagerAction, cents);
    } catch (e) {
      setWagerError(e instanceof Error ? e.message : 'Action failed');
    }
  };

  const setWagerToCents = (cents: number) => {
    setWagerInput((cents / 100).toString());
  };

  return (
    <div className="space-y-2">
      {bounds && (
        <div className="text-[10px] text-zinc-500 text-center space-y-0.5">
          {bounds.toCall > 0 && (
            <p>
              To call: <span className="text-emerald-300">{formatStack(bounds.toCall)}</span>
            </p>
          )}
          <p>
            {facingBet ? 'Raise' : 'Bet'} to{' '}
            <span className="text-zinc-400">
              {formatStack(bounds.minWagerTo)} – {formatStack(bounds.maxWagerTo)}
            </span>{' '}
            <span className="text-zinc-600">(pot limit)</span>
          </p>
        </div>
      )}

      <div className="flex gap-1 items-center">
        <input
          type="text"
          inputMode="decimal"
          value={wagerInput}
          onChange={(e) => {
            setWagerInput(e.target.value);
            if (wagerError) setWagerError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submitWager();
            }
          }}
          disabled={busy}
          className="flex-1 min-w-0 rounded bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500 disabled:opacity-50"
          aria-label={facingBet ? 'Raise to amount' : 'Bet amount'}
        />
        {bounds && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setWagerToCents(bounds.minWagerTo)}
              className="px-2 py-1.5 rounded text-[10px] bg-zinc-800 border border-zinc-600 hover:bg-zinc-700 disabled:opacity-50"
              title="Minimum legal wager"
            >
              Min
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setWagerToCents(bounds.maxWagerTo)}
              className="px-2 py-1.5 rounded text-[10px] bg-zinc-800 border border-zinc-600 hover:bg-zinc-700 disabled:opacity-50"
              title="Pot-limit maximum"
            >
              Pot
            </button>
          </>
        )}
      </div>

      {wagerError && (
        <p className="text-red-400 text-[11px] text-center bg-red-950/40 border border-red-900/50 rounded px-2 py-1">
          {wagerError}
        </p>
      )}

      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction('fold')}
          className="py-2 rounded text-xs font-medium bg-red-700 hover:bg-red-600 disabled:opacity-50"
        >
          Fold
        </button>
        {facingBet ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('call')}
              className="py-2 rounded text-xs font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
            >
              Call{bounds && bounds.toCall > 0 ? ` ${formatStack(bounds.toCall)}` : ''}
            </button>
            <button
              type="button"
              disabled={busy || !bounds}
              onClick={() => void submitWager()}
              className="py-2 rounded text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
            >
              Raise
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('check')}
              className="py-2 rounded text-xs font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
            >
              Check
            </button>
            <button
              type="button"
              disabled={busy || !bounds}
              onClick={() => void submitWager()}
              className="py-2 rounded text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
            >
              Bet
            </button>
          </>
        )}
      </div>
    </div>
  );
}