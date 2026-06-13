import { Check, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { preRunFacts } from "../messages";
import type { AutomationAction, InvoiceDeliveryMode, InvoiceFileSelectionMode } from "../types";

/*
  Pre-run "what will happen" panel. Before any workflow starts, the user sees
  mode-aware facts: what the run does, whether files move, whether Gmail is
  contacted, and whether emails are sent.
*/
export function ConfirmationModal({
  action,
  deliveryMode,
  fileSelectionMode,
  safeModeOn,
  onCancel,
  onConfirm,
}: {
  action: AutomationAction;
  deliveryMode?: InvoiceDeliveryMode | null;
  fileSelectionMode?: InvoiceFileSelectionMode | null;
  safeModeOn?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const facts = preRunFacts(action.commandName, deliveryMode, fileSelectionMode, safeModeOn);
  const Icon = action.icon;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        className="w-full max-w-md animate-rise rounded-xl border border-white/70 bg-white/95 p-5 shadow-glass"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-800 ring-1 ring-brand-100">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-brand-800">
                Before this run
              </p>
              <h2 id="confirmation-title" className="text-lg font-semibold text-slate-950">
                {action.confirmationTitle}
              </h2>
            </div>
          </div>
          <button
            className="rounded-md p-2 hover:bg-slate-100"
            aria-label="Cancel and close"
            onClick={onCancel}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {facts.length ? (
          <div className="space-y-2">
            {facts.map((fact) => (
              <p
                key={fact.text}
                className={[
                  "flex items-start gap-2 rounded-md px-3 py-2 text-sm font-medium leading-6",
                  fact.kind === "does"
                    ? "bg-brand-50 text-brand-900"
                    : "bg-emerald-50 text-emerald-900",
                ].join(" ")}
              >
                {fact.kind === "does" ? (
                  <Check className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                {fact.text}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm font-medium leading-6 text-slate-700">
            {action.confirmationMessage}
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            className="rounded-md bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft"
            onClick={onConfirm}
          >
            Start run
          </button>
        </div>
      </section>
    </div>
  );
}
