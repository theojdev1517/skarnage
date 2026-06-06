'use client';

import { useEffect, useState } from 'react';
import { dollarsToCents, formatStack } from '@/lib/formatStack';

type AddChipsModalProps = {
  open: boolean;
  seat?: number;
  displayName?: string;
  busy?: boolean;
  error?: string | null;
  /** If provided, the add will be capped so current + add does not exceed the buy-in max. */
  maxAddCents?: number;
  currentStack?: number;
  onClose: () => void;
  onSubmit: (amountCents: number) => void;
};

export function AddChipsModal({
  open,
  seat,
  displayName,
  busy = false,
  error = null,
  maxAddCents,
  currentStack,
  onClose,
  onSubmit,
}: AddChipsModalProps) {
  const [amount, setAmount] = useState('25');
  const [formError, setFormError] = useState<string | null>(null);

  const maxDisplay = maxAddCents != null ? formatStack(maxAddCents) : null;
  const currentDisplay = currentStack != null ? formatStack(currentStack) : null;

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount('25');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let cents = dollarsToCents(amount);
    if (cents === null || cents <= 0) {
      setFormError('Enter a valid amount greater than zero.');
      return;
    }
    if (maxAddCents != null) {
      if (cents > maxAddCents) {
        cents = maxAddCents;
      }
      if (cents <= 0) {
        setFormError('You are at the maximum allowed stack and cannot add more.');
        return;
      }
    }
    setFormError(null);
    onSubmit(cents);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-emerald-800/80 bg-gradient-to-b from-zinc-900 to-[#0a1f0a] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-chips-title"
      >
        <div className="px-6 pt-6 pb-4 border-b border-emerald-900/60">
          <h2 id="add-chips-title" className="text-lg font-semibold text-emerald-300">
            Add chips
          </h2>
          {seat !== undefined && (
            <p className="text-amber-400/90 text-sm mt-1">Seat {seat}{displayName ? ` · ${displayName}` : ''}</p>
          )}
          <p className="text-zinc-400 text-sm mt-2">
            Add to your stack (direct, no host approval).
            {currentDisplay && ` Current: ${currentDisplay}.`}
            {maxDisplay && ` Max add: ${maxDisplay} (to reach table limit).`}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Amount to add</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (formError) setFormError(null);
              }}
              disabled={busy}
              className="mt-1 w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-white outline-none focus:border-emerald-500 disabled:opacity-50"
              placeholder="50.00"
              aria-label="Add amount in dollars"
            />
          </label>

          {(formError || error) && (
            <p className="text-red-400 text-xs">{formError || error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-medium disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add chips'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
