'use client';

import type { GameState } from '@/types/game';
import { formatStack } from '@/lib/formatStack';

type HostRebuyApprovalsProps = {
  game: GameState;
  busy?: boolean;
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
};

export function HostRebuyApprovals({
  game,
  busy = false,
  onApprove,
  onDeny,
}: HostRebuyApprovalsProps) {
  if (!game.pending_rebuys?.length) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75">
      <div
        className="w-full max-w-md rounded-2xl border border-amber-700/60 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-amber-300 mb-1">Rebuy requests</h2>
        <p className="text-zinc-400 text-sm mb-4">
          Approve rebuys for broke players (within the rebuy window).
        </p>
        <ul className="space-y-3 max-h-64 overflow-y-auto">
          {game.pending_rebuys.map((req) => (
            <li
              key={req.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"
            >
              <div className="text-sm">
                <span className="font-medium text-white">{req.display_name}</span>
                <span className="text-zinc-500">
                  {' '}
                  · seat {req.seat} · {formatStack(req.starting_stack_cents)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDeny(req.id)}
                  className="px-3 py-1 rounded text-xs border border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
                >
                  Deny
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onApprove(req.id)}
                  className="px-3 py-1 rounded text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
                >
                  Approve
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
