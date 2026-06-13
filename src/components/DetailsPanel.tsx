import { FileText, History } from "lucide-react";

import { useI18n } from "../i18n";
import type { AppConfigStatus, LatestLog, RunSummary } from "../types";
import { DeveloperDetails } from "./DeveloperDetails";
import { StatusPill } from "./StatusBadges";

export function DetailsPanel({
  summary,
  latestLogs,
  configStatus,
  showDeveloperDetails = true,
  onOpenPath,
  onRefresh,
}: {
  summary: RunSummary | null;
  latestLogs: LatestLog[];
  configStatus: AppConfigStatus | null;
  showDeveloperDetails?: boolean;
  onOpenPath: (path?: string | null) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-800 ring-1 ring-brand-100">
            <History className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold text-slate-950">{t("details.lastRun")}</h2>
        </div>
        <button
          className="rounded-md border border-white/70 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          {t("common.refresh")}
        </button>
      </div>

      {summary ? (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-brand-800">{summary.automation_name}</p>
            <StatusPill status={summary.status} label={resultLabel(summary.status, t)} compact />
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Metric label={t("details.start")} value={formatDate(summary.start_time)} />
            <Metric label={t("details.end")} value={formatDate(summary.end_time)} />
            <Metric label={t("details.duration")} value={formatDuration(summary.duration_ms)} />
            {showDeveloperDetails && (
              <Metric label={t("details.technicalCode")} value={String(summary.exit_code)} />
            )}
          </dl>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">{t("details.steps")}</p>
            <div className="space-y-2">
              {summary.steps.map((step) => (
                <div
                  key={step.name}
                  className="flex items-center justify-between rounded-md bg-white/55 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-800">{step.name}</span>
                  {showDeveloperDetails && (
                    <span className="font-mono text-xs text-slate-600">{step.exit_code}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              {t("details.technicalLastRun")}
            </summary>
            <pre className="mt-3 h-52 overflow-auto rounded-md bg-ink p-3 font-mono text-xs leading-5 text-slate-100">
              {summary.last_output_lines.length
                ? summary.last_output_lines.join("\n")
                : t("details.noCapturedOutput")}
            </pre>
          </details>
        </div>
      ) : (
        <div className="rounded-lg border border-white/70 bg-white/60 p-5 text-sm font-medium leading-6 text-slate-700">
          {t("details.noRun")}
        </div>
      )}

      <details className="mt-5 border-t border-white/60 pt-5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          {t("support.logs")}
        </summary>
        <div className="mt-3 space-y-2">
          {latestLogs.map((log) => (
            <button
              key={log.key}
              className="flex w-full items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2 text-left text-xs transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!log.path}
              onClick={() => onOpenPath(log.path)}
            >
              <span className="font-semibold text-slate-700">{log.label}</span>
              <FileText className="h-4 w-4 shrink-0 text-brand-700" />
            </button>
          ))}
        </div>
      </details>

      {showDeveloperDetails && <DeveloperDetails configStatus={configStatus} />}
    </aside>
  );
}

function resultLabel(status: RunSummary["status"], t: ReturnType<typeof useI18n>["t"]) {
  if (status === "success") return t("status.completed");
  if (status === "warning") return t("status.needsAttention");
  return t("status.needsAttention");
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/55 p-3">
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${seconds}s`;
}
