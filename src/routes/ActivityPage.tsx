import { DetailsPanel } from "../components/DetailsPanel";
import { LiveOutputPanel } from "../components/LiveOutputPanel";
import { PageHeader } from "../components/PageHeader";
import type { ActivityRecord, ActivityStatus, AppConfigStatus, LatestLog, RunSummary } from "../types";

export function ActivityPage({
  configStatus,
  latestLogs,
  activityHistory,
  liveOutput,
  lastSummary,
  onOpenPath,
  onOpenActivityReport,
  onRefresh,
}: {
  configStatus: AppConfigStatus | null;
  latestLogs: LatestLog[];
  activityHistory: ActivityRecord[];
  liveOutput: string[];
  lastSummary: RunSummary | null;
  onOpenPath: (path?: string | null) => void;
  onOpenActivityReport: (path?: string | null) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-5">
      <PageHeader title="Activity" eyebrow="Runs and results">
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[1fr_390px]">
        <section className="space-y-5">
          <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Recent runs</h2>
                <p className="mt-1 text-sm font-medium text-slate-600">
                  Safe summaries from completed automations.
                </p>
              </div>
            </div>

            {activityHistory.length ? (
              <div className="space-y-3">
                {[...activityHistory].reverse().map((record) => (
                  <ActivityCard
                    key={record.id}
                    record={record}
                    onOpenPath={onOpenPath}
                    onOpenActivityReport={onOpenActivityReport}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/70 bg-white/60 p-5">
                <h3 className="text-lg font-semibold text-slate-950">No activity yet</h3>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                  Run an automation to see results here.
                </p>
              </div>
            )}
          </section>

          <details className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              Run progress
            </summary>
            <div className="mt-4">
              <LiveOutputPanel liveOutput={liveOutput} />
            </div>
          </details>
        </section>
        <DetailsPanel
          summary={lastSummary}
          latestLogs={latestLogs}
          configStatus={configStatus}
          showDeveloperDetails={false}
          onOpenPath={onOpenPath}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}

function ActivityCard({
  record,
  onOpenPath,
  onOpenActivityReport,
}: {
  record: ActivityRecord;
  onOpenPath: (path?: string | null) => void;
  onOpenActivityReport: (path?: string | null) => void;
}) {
  const summary = record.summary;
  return (
    <article className="rounded-lg border border-white/70 bg-white/60 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-teal-800">{modeLabel(record.mode)}</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">{record.workflowTitle}</h3>
          <p className="mt-1 text-sm font-medium text-slate-600">
            Finished {formatDate(record.finishedAt)}
          </p>
        </div>
        <ActivityBadge status={record.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Metric label="Found" value={summary.found ?? 0} />
        <Metric label="Processed" value={summary.processed ?? 0} />
        <Metric label="Planned" value={summary.planned ?? 0} />
        <Metric label="Created" value={summary.created ?? 0} />
        <Metric label="Issues" value={(summary.failed ?? 0) + (summary.warnings ?? 0)} />
      </div>

      {(record.warnings.length > 0 || record.errors.length > 0 || record.reportPath || record.logPath) && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Details
          </summary>
          <div className="mt-3 space-y-3 text-sm">
            {record.warnings.length > 0 && (
              <DetailList title="Needs review" items={record.warnings} tone="amber" />
            )}
            {record.errors.length > 0 && (
              <DetailList title="Errors" items={record.errors} tone="rose" />
            )}
            <div className="flex flex-wrap gap-2">
              {record.reportPath && (
                <button
                  className="rounded-md border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                  onClick={() => onOpenActivityReport(record.reportPath)}
                >
                  Open report
                </button>
              )}
              {record.logPath && (
                <button
                  className="rounded-md border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                  onClick={() => onOpenPath(record.logPath)}
                >
                  Open log
                </button>
              )}
            </div>
          </div>
        </details>
      )}
    </article>
  );
}

function ActivityBadge({ status }: { status: ActivityStatus }) {
  const styles =
    status === "success"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : status === "failed"
        ? "bg-rose-50 text-rose-800 ring-rose-200"
        : status === "unknown" || status === "cancelled"
          ? "bg-slate-50 text-slate-700 ring-slate-200"
          : "bg-amber-50 text-amber-800 ring-amber-200";
  return (
    <span className={`inline-flex rounded-md px-3 py-1.5 text-xs font-bold ring-1 ${styles}`}>
      {statusLabel(status)}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-white/55 p-3">
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function DetailList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "amber" | "rose";
}) {
  const color = tone === "amber" ? "text-amber-900 bg-amber-50" : "text-rose-900 bg-rose-50";
  return (
    <div className={`rounded-md p-3 ${color}`}>
      <p className="font-semibold">{title}</p>
      <ul className="mt-2 space-y-1">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function modeLabel(mode: ActivityRecord["mode"]) {
  if (mode === "dry_run") return "Safe mode";
  if (mode === "execute") return "Real run";
  return "Run";
}

function statusLabel(status: ActivityStatus) {
  if (status === "success") return "Completed";
  if (status === "needs_attention") return "Needs review";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return "Unknown";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
