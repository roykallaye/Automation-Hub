/*
  EmptyState: calm, hotel-flavored empty screens with one clear action.
  The illustration is decorative inline SVG drawn from brand tokens, so it
  follows each hotel's palette automatically.
*/
export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-white/70 bg-white/60 px-6 py-10 text-center">
      <ConciergeBellIllustration />
      <h3 className="mt-5 text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 max-w-md text-sm font-medium leading-6 text-slate-600">{message}</p>
      {actionLabel && onAction && (
        <button
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function ConciergeBellIllustration() {
  return (
    <svg
      aria-hidden="true"
      width="120"
      height="84"
      viewBox="0 0 120 84"
      fill="none"
      className="text-brand-700"
    >
      {/* counter */}
      <rect x="14" y="66" width="92" height="6" rx="3" fill="currentColor" opacity="0.25" />
      {/* bell dome */}
      <path
        d="M36 62c0-13.3 10.7-24 24-24s24 10.7 24 24"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.85"
      />
      {/* bell base */}
      <rect x="30" y="60" width="60" height="6" rx="3" fill="currentColor" opacity="0.85" />
      {/* button */}
      <rect x="57" y="28" width="6" height="8" rx="3" fill="currentColor" opacity="0.85" />
      {/* ding lines */}
      <path
        d="M83 22l6-6M60 16v-8M37 22l-6-6"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}
