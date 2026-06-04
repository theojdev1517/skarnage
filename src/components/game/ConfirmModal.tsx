'use client';

import { useEffect } from 'react';

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === 'danger'
      ? 'bg-red-700 hover:bg-red-600'
      : 'bg-emerald-600 hover:bg-emerald-500';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-emerald-800/80 bg-gradient-to-b from-zinc-900 to-[#0a1f0a] shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-desc"
      >
        <div className="px-6 pt-6 pb-4 border-b border-emerald-900/60">
          <h2 id="confirm-modal-title" className="text-lg font-semibold text-emerald-300">
            {title}
          </h2>
          <p id="confirm-modal-desc" className="text-zinc-400 text-sm mt-2 leading-relaxed">
            {message}
          </p>
        </div>
        <div className="px-6 py-5 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-lg font-medium disabled:opacity-50 ${confirmClass}`}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}