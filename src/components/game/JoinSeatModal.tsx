'use client';

import { useEffect, useState } from 'react';
import { dollarsToCents } from '@/lib/formatStack';

type JoinSeatModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  seat?: number;
  defaultName?: string;
  defaultStack?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (displayName: string, stackCents: number) => void;
};

export function JoinSeatModal({
  open,
  title,
  subtitle,
  seat,
  defaultName = '',
  defaultStack = '100',
  submitLabel = 'Take seat',
  busy = false,
  error = null,
  onClose,
  onSubmit,
}: JoinSeatModalProps) {
  const [name, setName] = useState(defaultName);
  const [stack, setStack] = useState(defaultStack);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setStack(defaultStack);
    }
  }, [open, defaultName, defaultStack]);

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
    const trimmed = name.trim();
    if (!trimmed) return;
    const cents = dollarsToCents(stack);
    if (cents === null || cents <= 0) return;
    onSubmit(trimmed, cents);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-emerald-800/80 bg-gradient-to-b from-zinc-900 to-[#0a1f0a] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-modal-title"
      >
        <div className="px-6 pt-6 pb-4 border-b border-emerald-900/60">
          <h2 id="join-modal-title" className="text-xl font-semibold text-emerald-300">
            {title}
          </h2>
          {subtitle && <p className="text-zinc-400 text-sm mt-1">{subtitle}</p>}
          {seat !== undefined && (
            <p className="text-amber-400/90 text-sm mt-2 font-medium">Seat {seat}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Display name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={24}
              placeholder="Your name at the table"
              className="mt-1.5 w-full rounded-lg bg-zinc-950 border border-zinc-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 px-3 py-2.5 text-white outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              Starting stack
            </span>
            <div className="mt-1.5 flex items-center rounded-lg bg-zinc-950 border border-zinc-700 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 overflow-hidden">
              <input
                type="text"
                inputMode="decimal"
                value={stack}
                onChange={(e) => setStack(e.target.value)}
                placeholder="100"
                className="flex-1 bg-transparent px-3 py-2.5 text-white outline-none"
              />
              <span className="pr-3 text-zinc-500 text-sm">chips</span>
            </div>
          </label>

          {error && (
            <p className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium disabled:opacity-50"
            >
              {busy ? 'Please wait…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}