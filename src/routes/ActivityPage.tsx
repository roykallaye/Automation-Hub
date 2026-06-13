import { CheckCircle2, Clipboard, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { DetailsPanel } from "../components/DetailsPanel";
import { EmptyState } from "../components/EmptyState";
import { LiveOutputPanel } from "../components/LiveOutputPanel";
import { PageHeader } from "../components/PageHeader";
import { StatusOrb, type StatusTone } from "../components/StatusOrb";
import { useI18n, type TranslationKey } from "../i18n";
import type {
  ActivityRecord,
  ActivityStatus,
  AppConfigStatus,
  AppPage,
  InvoiceDeliveryMode,
  LatestLog,
  RunSummary,
} from "../types";

/*
  Activity is an operations journal: a day-grouped timeline telling the story
  of each run in plain words. Technical material stays behind "Details".
*/
export function ActivityPage({
  configStatus,
  latestLogs,
  activityHistory,
  liveOutput,
  lastSummary,
  onOpenPath,
  onOpenActivityReport,
  onRefresh,
  onNavigate,
}: {
  configStatus: AppConfigStatus | null;
  latestLogs: LatestLog[];
  activityHistory: ActivityRecord[];
  liveOutput: string[];
  lastSummary: RunSummary | null;
  onOpenPath: (path?: string | null) => void;
  onOpenActivityReport: (path?: string | null) => void;
  onRefresh: () => void;
  onNavigate: (page: AppPage) => void;
}) {
  const { t, language } = useI18n();
  const ordered = [...activityHistory].reverse();
  const groups = groupByDay(ordered, t, language);
  const allClear =
    ordered.length > 0 && ordered.every((record) => record.status === "success");

  return (
    <div className="space-y-5">
      <PageHeader title={t("activity.title")} eyebrow={t("activity.eyebrow")}>
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          {t("common.refresh")}
        </button>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="space-y-5">
          {allClear && (
            <div className="animate-pop flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/85 p-4 shadow-glass">
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-700" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-emerald-950">{t("activity.allClear")}</p>
                <p className="text-sm font-medium text-emerald-800">
                  {t("activity.allClearMessage")}
                </p>
              </div>
            </div>
          )}

          <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            {ordered.length ? (
              <div className="space-y-6">
                {groups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                      {group.label}
                    </p>
                    <ol className="relative ml-1.5 space-y-4 border-l-2 border-brand-100 pl-5">
                      {group.records.map((record) => (
                        <JournalEntry
                          key={record.id}
                          record={record}
                          deliveryMode={configStatus?.config.invoiceDeliveryMode}
                          language={language}
                          onOpenPath={onOpenPath}
                          onOpenActivityReport={onOpenActivityReport}
                        />
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("activity.noRunsTitle")}
                message={t("activity.noRunsMessage")}
                actionLabel={t("activity.startDryRun")}
                onAction={() => onNavigate("automations")}
              />
            )}
          </section>

          <details className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              {t("activity.runProgress")}
            </summary>
            <div className="mt-4">
              <LiveOutputPanel liveOutput={liveOutput} />
            </div>
          </details>
        </section>

        <div className="h-fit">
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
    </div>
  );
}

function JournalEntry({
  record,
  deliveryMode,
  language,
  onOpenPath,
  onOpenActivityReport,
}: {
  record: ActivityRecord;
  deliveryMode?: InvoiceDeliveryMode;
  language: string;
  onOpenPath: (path?: string | null) => void;
  onOpenActivityReport: (path?: string | null) => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const summary = record.summary;
  const isInvoiceRun = record.workflowCommandName === "process_invoices_and_drafts";
  const touchesGmail = isInvoiceRun || record.workflowCommandName === "reconnect_gmail";
  const hasDetails =
    record.warnings.length > 0 ||
    record.errors.length > 0 ||
    Boolean(record.reportPath) ||
    Boolean(record.logPath) ||
    record.technicalSnippet.length > 0;

  const metrics: [string, number][] = [
    [t("activity.found"), summary.found ?? 0],
    [t("activity.processed"), summary.processed ?? 0],
    [t("activity.planned"), summary.planned ?? 0],
    [t("activity.created"), summary.created ?? 0],
    [t("activity.issues"), (summary.failed ?? 0) + (summary.warnings ?? 0)],
  ];

  return (
    <li className="relative">
      <span className="absolute -left-[1.69rem] top-1.5">
        <StatusOrb tone={activityTone(record.status)} />
      </span>
      <article className="rounded-lg border border-white/70 bg-white/60 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">{record.workflowTitle}</h3>
            <p className="mt-0.5 text-sm font-medium text-slate-600">
              {formatTime(record.finishedAt, language)}
              {formatRunDuration(record.startedAt, record.finishedAt, t)}
              {record.mode === "dry_run" && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  {t("activity.safeMode")}
                </span>
              )}
              {record.mode === "execute" && (
                <span className="ml-2 inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">
                  {t("activity.realRun")}
                </span>
              )}
            </p>
          </div>
          <ActivityBadge status={record.status} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-md bg-white/60 px-2.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {label}
              </p>
              <p className="mt-0.5 text-base font-semibold text-slate-950">{value}</p>
            </div>
          ))}
        </div>

        {touchesGmail && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            {isInvoiceRun && deliveryMode === "prepareOnly"
              ? t("activity.gmailSkipped")
              : t("activity.noEmails")}
          </p>
        )}

        {hasDetails && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              {t("activity.details")}
            </summary>
            <div className="mt-3 space-y-3 text-sm">
              {record.warnings.length > 0 && (
                <DetailList title={t("activity.needsReview")} items={record.warnings} tone="amber" />
              )}
              {record.errors.length > 0 && (
                <DetailList title={t("activity.errors")} items={record.errors} tone="rose" />
              )}
              <div className="flex flex-wrap gap-2">
                {record.reportPath && (
                  <button
                    className="rounded-md border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                    onClick={() => onOpenActivityReport(record.reportPath)}
                  >
                    {t("activity.openReport")}
                  </button>
                )}
                {record.logPath && (
                  <button
                    className="rounded-md border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                    onClick={() => onOpenPath(record.logPath)}
                  >
                    {t("activity.openLog")}
                  </button>
                )}
                {record.technicalSnippet.length > 0 && (
                  <button
                    className="inline-flex items-center gap-1.5 rounded-md border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          record.technicalSnippet.join("\n"),
                        );
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    <Clipboard className="h-3.5 w-3.5 text-brand-700" aria-hidden="true" />
                    {copied ? t("common.copied") : t("activity.copyTechnical")}
                  </button>
                )}
              </div>
            </div>
          </details>
        )}
      </article>
    </li>
  );
}

function groupByDay(
  records: ActivityRecord[],
  t: (key: TranslationKey) => string,
  language: string,
) {
  const groups: { label: string; records: ActivityRecord[] }[] = [];
  for (const record of records) {
    const label = dayLabel(record.finishedAt, t, language);
    const group = groups[groups.length - 1];
    if (group && group.label === label) {
      group.records.push(record);
    } else {
      groups.push({ label, records: [record] });
    }
  }
  return groups;
}

function dayLabel(
  value: string,
  t: (key: TranslationKey) => string,
  language: string,
) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return t("activity.today");
  if (sameDay(date, yesterday)) return t("activity.yesterday");
  return new Intl.DateTimeFormat(language === "it" ? "it-IT" : undefined, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function activityTone(status: ActivityStatus): StatusTone {
  if (status === "success") return "ready";
  if (status === "failed") return "blocked";
  if (status === "unknown" || status === "cancelled") return "neutral";
  return "attention";
}

function ActivityBadge({ status }: { status: ActivityStatus }) {
  const { t } = useI18n();
  const styles =
    status === "success"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : status === "failed"
        ? "bg-rose-50 text-rose-800 ring-rose-200"
        : status === "unknown" || status === "cancelled"
          ? "bg-slate-50 text-slate-700 ring-slate-200"
          : "bg-amber-50 text-amber-800 ring-amber-200";
  return (
    <span className={`inline-flex shrink-0 rounded-md px-3 py-1.5 text-xs font-bold ring-1 ${styles}`}>
      {statusLabel(status, t)}
    </span>
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
          <li key={`${item}-${index}`} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusLabel(status: ActivityStatus, t: (key: TranslationKey) => string) {
  if (status === "success") return t("status.completed");
  if (status === "needs_attention") return t("status.needsReview");
  if (status === "failed") return t("activity.failed");
  if (status === "cancelled") return t("activity.cancelled");
  return t("common.unknown");
}

function formatRunDuration(
  startedAt: string,
  finishedAt: string,
  t: (key: TranslationKey) => string,
) {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return ` · ${t("activity.underSecond")}`;
  if (seconds < 60) return ` · ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return ` · ${minutes}m ${seconds % 60}s`;
}

function formatTime(value: string, language: string) {
  return new Intl.DateTimeFormat(language === "it" ? "it-IT" : undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
