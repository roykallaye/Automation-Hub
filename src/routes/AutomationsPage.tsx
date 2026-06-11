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
  AppConfigStatus,
  AutomationAction,
  ModuleReadiness,
  WorkflowPreflight,
} from "../types";

export function AutomationsPage({
  configStatus,
  modules,
  runningCommand,
  workflowFor,
  actionDisabledReason,
  onRun,
  onOpenPath,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  runningCommand: string | null;
  workflowFor: (action: AutomationAction) => WorkflowPreflight | undefined;
  actionDisabledReason: (action: AutomationAction) => string | null;
  onRun: (action: AutomationAction) => void;
  onOpenPath: (path?: string | null) => void;
}) {
  const folders = configStatus?.config.folders;

  return (
    <div className="space-y-5">
      <PageHeader title="Automations" eyebrow="Run hotel workflows" />

      <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-slate-950">Ready areas</h2>
          <p className="mt-1 text-sm font-medium text-slate-600">
            Use ready areas now. Setup missing areas when they are needed.
          </p>
        </div>
        <ModuleReadinessGrid modules={modules} compact />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
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

      <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
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
      </section>
    </div>
  );
}
