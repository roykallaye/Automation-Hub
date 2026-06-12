import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { deliveryModePromise, deliveryModeReassurance } from "../messages";
import type { AutomationAction, InvoiceDeliveryMode } from "../types";

export function ConfirmationModal({
  action,
  deliveryMode,
  safeModeOn,
  onCancel,
  onConfirm,
}: {
  action: AutomationAction;
  deliveryMode?: InvoiceDeliveryMode | null;
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

  const isInvoiceRun = action.commandName === "process_invoices_and_drafts";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        className="w-full max-w-md animate-rise rounded-lg border border-white/70 bg-white/95 p-5 shadow-glass"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
            <h2 id="confirmation-title" className="text-lg font-semibold text-slate-950">
              {action.confirmationTitle}
            </h2>
          </div>
          <button
            className="rounded-md p-2 hover:bg-slate-100"
            aria-label="Cancel and close"
            onClick={onCancel}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {isInvoiceRun && deliveryMode ? (
          <div className="space-y-2">
            <WhatWillHappenRow text={deliveryModePromise(deliveryMode)} />
            <WhatWillHappenRow text={deliveryModeReassurance(deliveryMode)} muted />
            {safeModeOn && (
              <WhatWillHappenRow text="Safe mode is on — files are not changed." muted />
            )}
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
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}

function WhatWillHappenRow({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <p
      className={[
        "flex items-start gap-2 rounded-md px-3 py-2 text-sm font-medium leading-6",
        muted ? "bg-slate-50 text-slate-600" : "bg-brand-50 text-brand-900",
      ].join(" ")}
    >
      <Check className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}
