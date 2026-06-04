'use client';

import type { GameState, Player } from '@/types/game';

type TablePlayerControlsProps = {
  game: GameState;
  myPlayer: Player;
  busy?: boolean;
  onSetAway: () => void;
  onStandUp: () => void;
};

export function TablePlayerControls({
  game,
  myPlayer,
  busy = false,
  onSetAway,
  onStandUp,
}: TablePlayerControlsProps) {
  const pendingAway = myPlayer.seat_intent === 'pending_away';
  const pendingStand = myPlayer.seat_intent === 'pending_stand';
  const isAway = myPlayer.presence === 'away';

  return (
    <div className="flex flex-wrap gap-2 shrink-0">
      <button
        type="button"
        disabled={busy || isAway}
        onClick={onSetAway}
        className="px-3 py-1.5 rounded text-xs border border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
        title={pendingAway ? 'Will sit out after your actions this hand' : 'Sit out next hands'}
      >
        {pendingAway ? 'Away (pending)' : isAway ? 'Away' : 'Sit out'}
      </button>
      <button
        type="button"
        disabled={busy || pendingStand}
        onClick={onStandUp}
        className="px-3 py-1.5 rounded text-xs border border-red-900/60 text-red-300 hover:bg-red-950/40 disabled:opacity-50"
        title={pendingStand ? 'Will leave after this hand' : 'Leave seat'}
      >
        {pendingStand ? 'Leaving…' : 'Stand up'}
      </button>
      {!myPlayer.in_current_hand && game.status !== 'waiting' && (
        <span className="text-[10px] text-amber-400/90 self-center">
          Waiting for next hand
        </span>
      )}
      {myPlayer.waits_for_button && (
        <span className="text-[10px] text-zinc-500 self-center">Waiting for button</span>
      )}
    </div>
  );
}