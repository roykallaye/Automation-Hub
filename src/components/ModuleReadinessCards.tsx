import { moduleStatusLabel } from "../moduleReadiness";
import { useI18n } from "../i18n";
import type { ModuleReadiness } from "../types";

export function ModuleReadinessGrid({
  modules,
  compact = false,
}: {
  modules: ModuleReadiness[];
  compact?: boolean;
}) {
  return (
    <div className={["grid gap-3", compact ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-2 xl:grid-cols-3"].join(" ")}>
      {modules.map((module) => (
        <ModuleReadinessCard key={module.id} module={module} compact={compact} />
      ))}
    </div>
  );
}

export function ModuleReadinessCard({
  module,
  compact = false,
}: {
  module: ModuleReadiness;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <article className="rounded-xl border border-white/65 bg-white/60 p-4 shadow-glass backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{module.title}</h3>
          {!compact && (
            <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
              {module.shortReason}
            </p>
          )}
        </div>
        <span
          className={[
            "shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ring-1",
            statusClass(module.status),
          ].join(" ")}
        >
          {moduleStatusLabel(module.status, t)}
        </span>
      </div>
      {!compact && (
        <p className="mt-3 rounded-md bg-white/65 px-3 py-2 text-xs font-semibold leading-5 text-slate-700">
          {module.nextAction}
        </p>
      )}
    </article>
  );
}

function statusClass(status: ModuleReadiness["status"]) {
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "needs_attention":
    case "not_configured":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "blocked":
      return "bg-rose-50 text-rose-800 ring-rose-200";
    case "not_checked":
      return "bg-slate-50 text-slate-700 ring-slate-200";
  }
}
