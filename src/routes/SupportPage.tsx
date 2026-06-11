import { FileText, FolderOpen, ShieldCheck } from "lucide-react";

import { DeveloperDetails } from "../components/DeveloperDetails";
import { PageHeader } from "../components/PageHeader";
import { ReadinessBadge } from "../components/StatusBadges";
import type { AppConfigStatus, LatestLog, RunSummary } from "../types";

export function SupportPage({
  configStatus,
  latestLogs,
  lastSummary,
  onOpenPath,
  onRefresh,
}: {
  configStatus: AppConfigStatus | null;
  latestLogs: LatestLog[];
  lastSummary: RunSummary | null;
  onOpenPath: (path?: string | null) => void;
  onRefresh: () => void;
}) {
  const config = configStatus?.config;
  const paths = config
    ? [
        ["Automation setup file", config.automation.automationConfigPath],
        ["Python", config.automation.pythonExecutable],
        ["Invoice script", config.scripts.invoiceWorkflowScript],
        ["Gmail draft script", config.scripts.gmailDraftScript],
        ["Copy scanned documents script", config.scripts.copyScansioniScript],
        ["Document reading script", config.scripts.ocrPreprocessingScript],
        ["Contracts script", config.scripts.contractProcessingScript],
        ["Invoice input folder", config.folders.invoiceInputFolder],
        ["Invoice output folder", config.folders.invoiceOutputFolder],
        ["Invoice archive folder", config.folders.invoiceArchiveFolder],
        ["Invoice log folder", config.folders.invoiceLogFolder],
        ["Shared scan folder", config.folders.scansioniNetworkShare],
        ["Local scan cache", config.folders.scansioniLocalCacheFolder],
        ["Document text output", config.folders.ocrTextOutputFolder],
        ["Contracts output folder", config.folders.contractsOutputFolder],
        ["Contract log folder", config.folders.contractLogFolder],
        ["Gmail sign-in file", config.gmail.tokenPath],
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Support" eyebrow="Advanced details">
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
          <h2 className="text-xl font-semibold text-slate-950">Configured paths</h2>
          <p className="mt-1 text-sm font-medium text-slate-600">
            Technical locations for setup support. Token contents are never shown.
          </p>
          <div className="mt-4 space-y-2">
            {paths.map(([label, value]) => (
              <div key={label} className="rounded-md bg-white/55 px-3 py-2">
                <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
                <p className="mt-1 break-words font-mono text-xs leading-5 text-slate-700">
                  {value || "Not configured"}
                </p>
              </div>
            ))}
            {!paths.length && (
              <div className="rounded-md bg-white/55 p-4 text-sm font-medium text-slate-700">
                Setup details are unavailable.
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-lg border border-teal-100 bg-teal-50/80 p-5 shadow-glass backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/70 text-teal-800 ring-1 ring-teal-100">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Safe local rehearsal</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  Use a fake workspace and Safe mode for runtime smoke tests. FlowHost creates Gmail drafts only and never sends emails automatically.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-md border border-teal-100 bg-white/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
                Rehearsal guide
              </p>
              <p className="mt-1 font-mono text-xs text-slate-700">
                docs\FAKE_WORKSPACE_REHEARSAL.md
              </p>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                Follow this checklist for exact fake setup values, fake credentials, expected statuses, and result notes.
              </p>
            </div>
            <div className="mt-4 rounded-md bg-white/60 p-3 text-sm font-semibold text-slate-800">
              Safe mode is {config?.safety.dryRunDefault ? "on" : "off"}
            </div>
            <ol className="mt-4 space-y-2 text-sm font-medium leading-6 text-slate-700">
              <li>1. Open Setup and choose a fake workspace folder.</li>
              <li>2. Create folders, save setup, then check setup.</li>
              <li>3. Use fake files only and keep Gmail credentials unset unless testing validation.</li>
              <li>4. Run only dry-run automations and confirm Activity receives a summary.</li>
            </ol>
          </section>

          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-950">Preflight checks</h2>
            <div className="mt-4 space-y-2">
              {configStatus?.preflight.items.slice(0, 8).map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2"
                >
                  <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                  <ReadinessBadge status={item.status} />
                </div>
              ))}
              {!configStatus && (
                <div className="rounded-md bg-white/55 p-4 text-sm font-medium text-slate-700">
                  No setup check is available.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-950">Support logs</h2>
            <div className="mt-4 space-y-2">
              {latestLogs.map((log) => (
                <button
                  key={log.key}
                  className="flex w-full items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2 text-left text-xs transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!log.path}
                  onClick={() => onOpenPath(log.path)}
                >
                  <span className="font-semibold text-slate-700">{log.label}</span>
                  <FileText className="h-4 w-4 shrink-0 text-teal-700" />
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-950">Last technical code</h2>
            <p className="mt-2 text-sm font-medium text-slate-600">
              {lastSummary ? String(lastSummary.exit_code) : "No run yet."}
            </p>
          </section>

          {config?.folders.invoiceLogFolder && (
            <button
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-white/70 bg-white/65 px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
              onClick={() => onOpenPath(config.folders.invoiceLogFolder)}
            >
              <FolderOpen className="h-5 w-5 text-teal-700" />
              Open support log folder
            </button>
          )}
        </aside>
      </div>

      <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
        <DeveloperDetails configStatus={configStatus} />
      </section>
    </div>
  );
}
