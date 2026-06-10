import { AlertTriangle, X } from "lucide-react";

import type { AutomationAction } from "../types";

export function ConfirmationModal({
  action,
  onCancel,
  onConfirm,
}: {
  action: AutomationAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-6 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-lg border border-white/70 bg-white/90 p-5 shadow-glass">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-slate-950">{action.confirmationTitle}</h2>
          </div>
          <button className="rounded-md p-2 hover:bg-slate-100" onClick={onCancel}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm font-medium text-slate-700">{action.confirmationMessage}</p>
        <p className="mt-3 text-sm font-medium text-slate-600">Continue?</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={onConfirm}
          >
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}
