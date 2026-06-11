import { Clock3, FolderOpen } from "lucide-react";

import {
  contractAction,
  gmailReconnectAction,
  invoiceAction,
  maintenanceActions,
} from "../actions";
import { ModuleReadinessGrid } from "../components/ModuleReadinessCards";
import { PageHeader } from "../components/PageHeader";
import {
  ActionButton,
  AutomationCard,
  GmailAccessPanel,
} from "../components/WorkflowCard";
import type {
  AppPage,
  AppConfigStatus,
  AutomationAction,
  ModuleReadiness,
  WorkflowPreflight,
} from "../types";
import type { NextAction } from "../nextAction";

export function AutomationsPage({
  configStatus,
  modules,
  nextAction,
  runningCommand,
  workflowFor,
  actionDisabledReason,
  onRun,
  onOpenPath,
  onNavigate,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  nextAction: NextAction;
  runningCommand: string | null;
  workflowFor: (action: AutomationAction) => WorkflowPreflight | undefined;
  actionDisabledReason: (action: AutomationAction) => string | null;
  onRun: (action: AutomationAction) => void;
  onOpenPath: (path?: string | null) => void;
  onNavigate: (page: AppPage) => void;
}) {
  const folders = configStatus?.config.folders;
  const primaryActions = [invoiceAction, contractAction];
  const readyPrimaryActions = primaryActions.filter((action) => !actionDisabledReason(action));
  const blockedPrimaryActions = primaryActions.filter((action) => Boolean(actionDisabledReason(action)));

  return (
    <div className="space-y-5">
      <PageHeader title="Automations" eyebrow="Run hotel workflows" />

      <section className="rounded-xl border border-teal-100 bg-teal-50/80 p-5 shadow-glass backdrop-blur-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold text-teal-800">Recommended next</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-950">{nextAction.title}</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
              {nextAction.shortMessage}
            </p>
          </div>
          <button
            className="shrink-0 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
            onClick={() => onNavigate(nextAction.targetPage)}
          >
            {nextAction.buttonLabel}
          </button>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        {readyPrimaryActions.includes(invoiceAction) && (
          <AutomationCard
            title="Invoices"
            action={invoiceAction}
            description="Prepare PDFs and create Gmail drafts for review."
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
        )}
        {readyPrimaryActions.includes(contractAction) && (
          <AutomationCard
            title="Signed contracts"
            action={contractAction}
            description="Read, sort, and organize signed contract documents."
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
        )}
      </section>

      {blockedPrimaryActions.length > 0 && (
        <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <h2 className="text-xl font-semibold text-slate-950">Needs setup</h2>
          <div className="mt-3 space-y-2">
            {blockedPrimaryActions.map((action) => (
              <BlockedWorkflow
                key={action.commandName}
                action={action}
                reason={actionDisabledReason(action)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </section>
      )}

      <details className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          Gmail sign-in and scanned documents
        </summary>
        <div className="mt-4 space-y-4">
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

          <div className="rounded-xl border border-white/65 bg-white/45 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Scanned documents</h2>
                <p className="mt-1 text-sm font-medium text-slate-600">
                  Copy and read scanned files when contracts need attention.
                </p>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-50 text-teal-800 ring-1 ring-teal-100">
                <Clock3 className="h-5 w-5" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {maintenanceActions.map((action) => (
                <ActionButton
                  key={action.commandName}
                  action={action}
                  workflow={workflowFor(action)}
                  isRunning={runningCommand === action.commandName}
                  disabled={Boolean(runningCommand) || Boolean(actionDisabledReason(action))}
                  disabledReason={actionDisabledReason(action)}
                  onClick={() => onRun(action)}
                  label={
                    action.commandName === "copy_scansioni"
                      ? "Copy scanned documents"
                      : "Read scanned documents"
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </details>

      <details className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          Show readiness by area
        </summary>
        <div className="mt-4">
          <ModuleReadinessGrid modules={modules} compact />
        </div>
      </details>
    </div>
  );
}

function BlockedWorkflow({
  action,
  reason,
  onNavigate,
}: {
  action: AutomationAction;
  reason: string | null;
  onNavigate: (page: AppPage) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-white/60 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-slate-900">{action.label}</p>
        <p className="mt-1 text-xs font-semibold text-amber-800">
          {reason ?? "Setup needs attention."}
        </p>
      </div>
      <button
        className="rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        onClick={() => onNavigate("setup")}
      >
        Fix in Setup
      </button>
    </div>
  );
}
