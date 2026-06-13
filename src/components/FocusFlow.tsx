import { ArrowLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";

/*
  FocusFlow: an isolated, one-task-at-a-time surface.

  When a flow opens, surrounding page content is replaced by this container so
  the user sees only the current task, a clear heading, and one way back.
  Escape is opt-in: flows with unsaved work pass no onEscape so a stray key
  press never throws progress away.
*/
export function FocusFlow({
  eyebrow,
  title,
  exitLabel,
  onExit,
  onEscape,
  children,
}: {
  eyebrow?: string;
  title: string;
  exitLabel: string;
  onExit: () => void;
  onEscape?: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!onEscape) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onEscape?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onEscape]);

  return (
    <section aria-label={title} className="animate-rise space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/65 bg-white/55 px-4 py-3 shadow-glass backdrop-blur-xl">
        <div className="min-w-0">
          {eyebrow && <p className="text-xs font-bold uppercase tracking-wide text-brand-800">{eyebrow}</p>}
          <h2 className="truncate text-lg font-semibold text-slate-950">{title}</h2>
        </div>
        <button
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-white/70 bg-white/70 px-4 text-sm font-semibold text-slate-800 transition hover:bg-white"
          onClick={onExit}
        >
          <ArrowLeft className="h-4 w-4 text-brand-700" aria-hidden="true" />
          {exitLabel}
        </button>
      </div>
      {children}
    </section>
  );
}
