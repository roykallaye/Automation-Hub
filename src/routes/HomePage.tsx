import { FolderOpen, Sparkles } from "lucide-react";

import { contractAction, gmailReconnectAction, invoiceAction } from "../actions";
import { ModuleReadinessGrid } from "../components/ModuleReadinessCards";
import { StatusPill } from "../components/StatusBadges";
import { AutomationCard, GmailAccessPanel } from "../components/WorkflowCard";
import type {
  AppConfigStatus,
  AutomationAction,
  ModuleReadiness,
  RunSummary,
  WorkflowPreflight,
} from "../types";

export function HomePage({
  configStatus,
  modules,
  loading,
  lastSummary,
  runningCommand,
  workflowFor,
  actionDisabledReason,
  onRun,
  onOpenPath,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  loading: boolean;
  lastSummary: RunSummary | null;
  runningCommand: string | null;
  workflowFor: (action: AutomationAction) => WorkflowPreflight | undefined;
  actionDisabledReason: (action: AutomationAction) => string | null;
  onRun: (action: AutomationAction) => void;
  onOpenPath: (path?: string | null) => void;
}) {
  const folders = configStatus?.config.folders;
  const primaryModules = modules.filter((module) =>
    ["invoices", "gmailDrafts"].includes(module.id),
  );
  const hasMainSetupIssue =
    loading ||
    !configStatus ||
    primaryModules.some((module) => module.status !== "ready");

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-white/65 bg-white/55 p-6 shadow-glass backdrop-blur-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-800 ring-1 ring-teal-100">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-teal-800">Daily overview</p>
              <h2 className="mt-1 text-3xl font-semibold text-slate-950">
                {hasMainSetupIssue ? "Main setup needs attention" : "Ready for today&apos;s office work"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                Prepare drafts, organize signed contracts, and keep scan folders tidy.
              </p>
            </div>
          </div>
          <div className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm">
            Gmail drafts only
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          <AttentionBanner modules={modules} configStatus={configStatus} loading={loading} />
          <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Setup by area</h2>
                <p className="mt-1 text-sm font-medium text-slate-600">
                  Ready areas can be used even if another area needs setup.
                </p>
              </div>
            </div>
            <ModuleReadinessGrid modules={modules.slice(0, 5)} compact />
          </section>
          <div className="grid gap-5 xl:grid-cols-2">
            <AutomationCard
              title="Invoices"
              action={invoiceAction}
              description="Prepare PDFs and Gmail drafts for review."
              buttonLabel="Prepare invoice drafts"
              moduleReadiness={modules.find((module) => module.id === "invoices")}
              workflow={workflowFor(invoiceAction)}
              runningCommand={runningCommand}
              disabledReason={actionDisabledReason(invoiceAction)}
              onRun={onRun}
              secondaryActions={[
                {
                  label: "Input folder",
                  icon: FolderOpen,
                  path: folders?.invoiceInputFolder,
                },
                {
                  label: "Ready invoices",
                  icon: FolderOpen,
                  path: folders?.invoiceOutputFolder,
                },
              ]}
              onOpenPath={onOpenPath}
            />
            <AutomationCard
              title="Signed contracts"
              action={contractAction}
              description="Organize signed contract documents."
              buttonLabel="Process signed contracts"
              moduleReadiness={modules.find((module) => module.id === "contracts")}
              workflow={workflowFor(contractAction)}
              runningCommand={runningCommand}
              disabledReason={actionDisabledReason(contractAction)}
              onRun={onRun}
              secondaryActions={[
                {
                  label: "Shared scan folder",
                  icon: FolderOpen,
                  path: folders?.scansioniNetworkShare,
                },
                {
                  label: "Signed contracts",
                  icon: FolderOpen,
                  path: folders?.contractsOutputFolder,
                },
              ]}
              onOpenPath={onOpenPath}
            />
          </div>

          <GmailAccessPanel
            action={gmailReconnectAction}
            workflow={workflowFor(gmailReconnectAction)}
            disabledReason={actionDisabledReason(gmailReconnectAction)}
            disabled={Boolean(runningCommand)}
            isRunning={runningCommand === gmailReconnectAction.commandName}
            buttonLabel="Check Gmail sign-in"
            moduleReadiness={modules.find((module) => module.id === "gmailDrafts")}
            onRun={() => onRun(gmailReconnectAction)}
          />
        </section>

        <LastRunCard summary={lastSummary} />
      </div>
    </div>
  );
}

function AttentionBanner({
  modules,
  configStatus,
  loading,
}: {
  modules: ModuleReadiness[];
  configStatus: AppConfigStatus | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="rounded-xl border border-white/60 bg-white/55 p-4 shadow-glass">
        <p className="text-sm font-semibold text-slate-800">Checking setup...</p>
      </section>
    );
  }

  if (!configStatus) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-glass">
        <p className="text-sm font-semibold text-rose-900">
          FlowHost setup could not be loaded.
        </p>
      </section>
    );
  }

  const primaryIssue = modules.find(
    (module) => ["invoices", "gmailDrafts"].includes(module.id) && module.status !== "ready",
  );
  const secondaryIssue = modules.find(
    (module) => !["invoices", "gmailDrafts"].includes(module.id) && module.status !== "ready",
  );

  if (!primaryIssue && !secondaryIssue) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-glass">
        <p className="text-sm font-semibold text-emerald-900">Everything is ready.</p>
      </section>
    );
  }

  if (!primaryIssue && secondaryIssue) {
    return (
      <section className="rounded-xl border border-white/65 bg-white/60 p-4 shadow-glass">
        <p className="text-sm font-semibold text-slate-900">Main work is ready</p>
        <p className="mt-1 text-sm font-medium text-slate-600">
          {secondaryIssue.title} can be set up later: {secondaryIssue.nextAction}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-glass">
      <p className="text-sm font-semibold text-amber-950">Main setup needs attention</p>
      <p className="mt-1 text-sm font-medium text-amber-800">
        {primaryIssue ? primaryIssue.nextAction : "Ask setup support to check FlowHost."}
      </p>
    </section>
  );
}

function LastRunCard({ summary }: { summary: RunSummary | null }) {
  return (
    <aside className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="text-xl font-semibold text-slate-950">Last result</h2>
      {summary ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-teal-800">{summary.automation_name}</p>
            <StatusPill status={summary.status} label={resultLabel(summary.status)} compact />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Finished" value={formatDate(summary.end_time)} />
            <Metric label="Duration" value={formatDuration(summary.duration_ms)} />
          </div>
          <p className="text-sm font-medium leading-6 text-slate-600">
            Open Activity for details if anything needs review.
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg bg-white/60 p-4 text-sm font-medium leading-6 text-slate-700">
          No run yet. Start with invoice drafts or signed contracts when setup is ready.
        </div>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/55 p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function resultLabel(status: RunSummary["status"]) {
  if (status === "success") return "Completed";
  if (status === "warning") return "Needs review";
  return "Needs attention";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
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
