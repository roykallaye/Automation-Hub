import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  XCircle,
} from "lucide-react";

import { readinessLabel } from "../messages";
import type { ReadinessStatus, RunStatus } from "../types";

export function ReadinessBadge({ status }: { status: ReadinessStatus }) {
  const styles =
    status === "ready"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : status === "warning"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
      : status === "permissionProblem"
        ? "bg-rose-50 text-rose-800 ring-rose-200"
        : status === "notChecked"
          ? "bg-slate-50 text-slate-700 ring-slate-200"
          : "bg-amber-50 text-amber-800 ring-amber-200";

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[11px] font-bold ring-1",
        styles,
      ].join(" ")}
    >
      {readinessLabel(status)}
    </span>
  );
}

export function StatusPill({
  status,
  label,
  compact = false,
}: {
  status: RunStatus;
  label: string;
  compact?: boolean;
}) {
  const Icon =
    status === "success"
      ? CheckCircle2
      : status === "error"
        ? XCircle
        : status === "warning"
          ? AlertTriangle
          : Clock3;
  const styles =
    status === "success"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : status === "error"
        ? "bg-rose-50 text-rose-800 ring-rose-200"
        : status === "warning"
          ? "bg-amber-50 text-amber-800 ring-amber-200"
          : "bg-white/70 text-slate-700 ring-white";

  return (
    <div
      className={[
        "inline-flex items-center gap-2 rounded-md px-3 font-semibold ring-1",
        compact ? "mt-2 py-1.5 text-xs" : "py-2 text-sm shadow-sm",
        styles,
      ].join(" ")}
    >
      <Icon className="h-4 w-4" />
      {label}
    </div>
  );
}
