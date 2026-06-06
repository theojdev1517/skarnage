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
  /** If provided, the initial/pre-start buy-in is locked to this exact value (e.g. 10000 for $100).
   *  Stack field will be shown grayed/disabled and onSubmit will use this value.
   */
  fixedStackCents?: number;
  /** Optional range for post-start variable buy-ins (direct, within table limits).
   *  Enables slider + text input with validation. Button only enables for valid amount in range.
   */
  minStackCents?: number;
  maxStackCents?: number;
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
  fixedStackCents,
  minStackCents,
  maxStackCents,
  onClose,
  onSubmit,
}: JoinSeatModalProps) {
  const isFixed = typeof fixedStackCents === 'number' && fixedStackCents > 0;
  const fixedStackDisplay = isFixed ? (fixedStackCents! / 100).toFixed(2) : '';
  const hasRange = typeof minStackCents === 'number' && typeof maxStackCents === 'number' && !isFixed;
  const rangeMin = hasRange ? minStackCents! : 10000;
  const rangeMax = hasRange ? maxStackCents! : 10000;

  const [name, setName] = useState(defaultName);
  const [stack, setStack] = useState(isFixed ? fixedStackDisplay : (hasRange ? (rangeMin / 100).toFixed(2) : defaultStack));
  const [sliderValue, setSliderValue] = useState(hasRange ? rangeMin : 10000);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      const initialStack = isFixed ? fixedStackDisplay : (hasRange ? (rangeMin / 100).toFixed(2) : defaultStack);
      setStack(initialStack);
      if (hasRange) {
        setSliderValue(rangeMin);
      }
    }
  }, [open, defaultName, defaultStack, isFixed, fixedStackDisplay, hasRange, rangeMin]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const getCurrentCents = (): number | null => {
    if (isFixed) return fixedStackCents!;
    return dollarsToCents(stack);
  };

  const isStackValid = (): boolean => {
    const cents = getCurrentCents();
    if (cents === null || cents <= 0) return false;
    if (hasRange) {
      return cents >= rangeMin && cents <= rangeMax;
    }
    return true;
  };

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hasRange) return;
    const v = Number(e.target.value);
    setSliderValue(v);
    setStack((v / 100).toFixed(2));
    if (formError) setFormError(null);
  };

  const handleStackChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setStack(val);
    if (hasRange) {
      const parsed = dollarsToCents(val);
      if (parsed !== null && parsed >= rangeMin && parsed <= rangeMax) {
        setSliderValue(parsed);
      }
    }
    if (formError) setFormError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Enter a display name.');
      return;
    }
    const cents = getCurrentCents();
    if (cents === null || cents <= 0) {
      setFormError('Enter a valid starting stack greater than zero.');
      return;
    }
    if (hasRange && (cents < rangeMin || cents > rangeMax)) {
      setFormError(`Stack must be between ${(rangeMin/100).toFixed(2)} and ${(rangeMax/100).toFixed(2)}.`);
      return;
    }
    setFormError(null);
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
              onChange={(e) => {
                setName(e.target.value);
                if (formError) setFormError(null);
              }}
              autoFocus
              maxLength={24}
              placeholder="Your name at the table"
              className="mt-1.5 w-full rounded-lg bg-zinc-950 border border-zinc-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 px-3 py-2.5 text-white outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">
              Starting stack {hasRange ? `(min ${(rangeMin/100).toFixed(2)} — max ${(rangeMax/100).toFixed(2)})` : ''}
            </span>
            {isFixed ? (
              <div className="mt-1.5 flex items-center rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2.5 text-zinc-400">
                <span className="flex-1 tabular-nums">{fixedStackDisplay}</span>
                <span className="pr-3 text-zinc-500 text-sm">chips (fixed for initial buy-in)</span>
              </div>
            ) : hasRange ? (
              <>
                <input
                  type="range"
                  min={rangeMin}
                  max={rangeMax}
                  step={100}
                  value={sliderValue}
                  onChange={handleSlider}
                  disabled={busy}
                  className="w-full accent-emerald-500 mt-1"
                />
                <div className="mt-1.5 flex items-center rounded-lg bg-zinc-950 border border-zinc-700 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 overflow-hidden">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={stack}
                    onChange={handleStackChange}
                    placeholder={(rangeMin/100).toFixed(2)}
                    disabled={busy}
                    className="flex-1 bg-transparent px-3 py-2.5 text-white outline-none"
                  />
                  <span className="pr-3 text-zinc-500 text-sm">chips</span>
                </div>
              </>
            ) : (
              <div className="mt-1.5 flex items-center rounded-lg bg-zinc-950 border border-zinc-700 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 overflow-hidden">
                <input
                  type="text"
                  inputMode="decimal"
                  value={stack}
                  onChange={handleStackChange}
                  placeholder="100"
                  className="flex-1 bg-transparent px-3 py-2.5 text-white outline-none"
                />
                <span className="pr-3 text-zinc-500 text-sm">chips</span>
              </div>
            )}
          </label>

          {(formError || error) && (
            <p className="text-red-400 text-sm bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2">
              {formError || error}
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
              disabled={busy || !name.trim() || !isStackValid()}
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