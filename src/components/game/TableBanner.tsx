'use client';

type TableBannerProps = {
  message: string;
  variant?: 'error' | 'info';
  onDismiss?: () => void;
};

export function TableBanner({
  message,
  variant = 'error',
  onDismiss,
}: TableBannerProps) {
  const styles =
    variant === 'error'
      ? 'bg-red-950/50 border-red-800/60 text-red-200'
      : 'bg-amber-950/40 border-amber-800/50 text-amber-200';

  return (
    <div
      className={`shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg border text-sm flex items-start justify-between gap-2 ${styles}`}
      role="alert"
    >
      <span className="leading-snug">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs opacity-70 hover:opacity-100 shrink-0"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}