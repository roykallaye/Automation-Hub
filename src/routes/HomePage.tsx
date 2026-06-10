import { FolderOpen } from "lucide-react";

import { contractAction, gmailReconnectAction, invoiceAction } from "../actions";
import { PageHeader } from "../components/PageHeader";
import { StatusPill } from "../components/StatusBadges";
import { AutomationCard, GmailAccessPanel } from "../components/WorkflowCard";
import { staffMessage } from "../messages";
import type {
  AppConfigStatus,
  AutomationAction,
  RunSummary,
  WorkflowPreflight,
} from "../types";

export function HomePage({
  configStatus,
  loading,
  lastSummary,
  runningCommand,
  workflowFor,
  actionDisabledReason,
  onRun,
  onOpenPath,
}: {
  configStatus: AppConfigStatus | null;
  loading: boolean;
  lastSummary: RunSummary | null;
  runningCommand: string | null;
  workflowFor: (action: AutomationAction) => WorkflowPreflight | undefined;
  actionDisabledReason: (action: AutomationAction) => string | null;
  onRun: (action: AutomationAction) => void;
  onOpenPath: (path?: string | null) => void;
}) {
  const folders = configStatus?.config.folders;

  return (
    <div className="space-y-5">
      <PageHeader title="Today at a glance" eyebrow="Daily overview" />

      <AttentionBanner configStatus={configStatus} loading={loading} />

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <AutomationCard
              title="Invoices"
              action={invoiceAction}
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
            onRun={() => onRun(gmailReconnectAction)}
          />
        </section>

        <LastRunCard summary={lastSummary} />
      </div>
    </div>
  );
}

function AttentionBanner({
  configStatus,
  loading,
}: {
  configStatus: AppConfigStatus | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="rounded-lg border border-white/60 bg-white/55 p-4 shadow-glass">
        <p className="text-sm font-semibold text-slate-800">Checking FlowHost setup...</p>
      </section>
    );
  }

  if (!configStatus) {
    return (
      <section className="rounded-lg border border-rose-200 bg-rose-50 p-4 shadow-glass">
        <p className="text-sm font-semibold text-rose-900">
          FlowHost setup could not be loaded.
        </p>
      </section>
    );
  }

  const warning = configStatus.preflight.items.find((item) => item.status === "warning");
  const blockedWorkflow = configStatus.preflight.workflows.find(
    (workflow) => workflow.commandName && !workflow.canRun,
  );

  if (!warning && !blockedWorkflow) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-glass">
        <p className="text-sm font-semibold text-emerald-900">
          FlowHost is ready for today&apos;s work.
        </p>
      </section>
    );
  }

  const source = warning ?? blockedWorkflow;
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-glass">
      <p className="text-sm font-semibold text-amber-950">Setup needs attention</p>
      <p className="mt-1 text-sm font-medium text-amber-800">
        {source
          ? staffMessage(source.message, source.status, source.key)
          : "Ask setup support to check FlowHost."}
      </p>
    </section>
  );
}

function LastRunCard({ summary }: { summary: RunSummary | null }) {
  return (
    <aside className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
      <h2 className="text-xl font-semibold text-slate-950">Last result</h2>
      {summary ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-teal-800">{summary.automation_name}</p>
            <StatusPill status={summary.status} label={resultLabel(summary.status)} compact />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Finished" value={formatDate(summary.end_time)} />
            <Metric label="Duration" value={formatDuration(summary.duration_ms)} />
          </div>
          <p className="text-sm font-medium leading-6 text-slate-600">
            Open Activity to review progress and support details.
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-md bg-white/55 p-4 text-sm font-medium text-slate-700">
          No automation has run yet.
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
