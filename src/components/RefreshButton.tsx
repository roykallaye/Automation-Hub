import { RefreshCw } from "lucide-react";

export function RefreshButton({
  disabled = false,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white/85 text-zinc-600 shadow-sm transition hover:bg-white hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <RefreshCw aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
