'use client';

import { useEffect, useState } from 'react';
import { dollarsToCents, formatStack } from '@/lib/formatStack';

type RebuyStackModalProps = {
  open: boolean;
  minCents: number;
  maxCents: number;
  busy?: boolean;
  error?: string | null;
  secondsLeft?: number;
  onConfirm: (stackCents: number) => void;
  onLeaveTable: () => void;
  onCancel: () => void;
  onInteraction?: () => void;  // call when user starts editing (to pause countdown)
};

export function RebuyStackModal({
  open,
  minCents,
  maxCents,
  busy = false,
  error = null,
  secondsLeft,
  onConfirm,
  onLeaveTable,
  onCancel,
  onInteraction,
}: RebuyStackModalProps) {
  const [amountText, setAmountText] = useState('');
  const [sliderValue, setSliderValue] = useState(minCents);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset on open: slider at min (100), text BLANK (no prepopulate to avoid misclick OK)
  useEffect(() => {
    if (open) {
      setSliderValue(Math.max(minCents, 10000));
      setAmountText('');
      setFormError(null);
    }
  }, [open, minCents]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setSliderValue(v);
    // Populate the box when slider moves (user intent)
    setAmountText((v / 100).toFixed(2));
    if (formError) setFormError(null);
    onInteraction?.();
  };

  const handleText = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setAmountText(val);
    if (formError) setFormError(null);
    const parsed = dollarsToCents(val);
    if (parsed !== null && parsed >= minCents && parsed <= maxCents) {
      setSliderValue(parsed);
    }
    onInteraction?.();
  };

  const handleConfirm = () => {
    const cents = dollarsToCents(amountText);
    if (cents === null) {
      setFormError('Enter a valid amount.');
      return;
    }
    if (cents < minCents || cents > maxCents) {
      setFormError(`Amount must be between ${formatStack(minCents)} and ${formatStack(maxCents)}.`);
      return;
    }
    setFormError(null);
    onConfirm(cents);
  };

  const currentDisplayMin = formatStack(minCents);
  const currentDisplayMax = formatStack(maxCents);

  const okDisabled = busy || !amountText.trim();

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-emerald-800/80 bg-gradient-to-b from-zinc-900 to-[#0a1f0a] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rebuy-modal-title"
      >
        <div className="px-6 pt-6 pb-4 border-b border-emerald-900/60">
          <h2 id="rebuy-modal-title" className="text-xl font-semibold text-emerald-300">
            Rebuy?
          </h2>
          <p className="text-zinc-400 text-sm mt-1">
            Choose your new stack size. Min {currentDisplayMin} — Max {currentDisplayMax}.
          </p>
          {secondsLeft != null && secondsLeft > 0 && (
            <p className="text-amber-400 text-sm font-medium">⏱ {secondsLeft}s left to decide</p>
          )}
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Slider (starts at 100, moves to populate the box) */}
          <div>
            <div className="flex justify-between text-xs uppercase tracking-wide text-zinc-500 mb-1">
              <span>Min {currentDisplayMin}</span>
              <span>Max {currentDisplayMax}</span>
            </div>
            <input
              type="range"
              min={minCents}
              max={maxCents}
              step={100}
              value={sliderValue}
              onChange={handleSlider}
              disabled={busy}
              className="w-full accent-emerald-500"
            />
          </div>

          {/* Text box — intentionally blank on open until user interacts */}
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Amount</span>
            <div className="mt-1.5 flex items-center rounded-lg bg-zinc-950 border border-zinc-700 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 overflow-hidden">
              <input
                type="text"
                inputMode="decimal"
                value={amountText}
                onChange={handleText}
                placeholder="Enter or slide"
                disabled={busy}
                className="flex-1 bg-transparent px-3 py-2.5 text-white outline-none"
              />
              <span className="pr-3 text-zinc-500 text-sm">chips</span>
            </div>
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
              onClick={onLeaveTable}
              className="flex-1 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Leave Table
            </button>
            <button
              type="button"
              disabled={okDisabled}
              onClick={handleConfirm}
              className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-medium disabled:opacity-50"
            >
              {busy ? 'Please wait…' : 'OK'}
            </button>
          </div>
          <p className="text-[10px] text-center text-zinc-500 -mt-1">Leave Table will stand you up (no rebuy).</p>
        </div>
      </div>
    </div>
  );
}
