import { Clock3, FolderOpen } from "lucide-react";

import {
  contractAction,
  gmailReconnectAction,
  invoiceAction,
  maintenanceActions,
} from "../actions";
import { PageHeader } from "../components/PageHeader";
import {
  ActionButton,
  AutomationCard,
  GmailAccessPanel,
} from "../components/WorkflowCard";
import type {
  AppConfigStatus,
  AutomationAction,
  WorkflowPreflight,
} from "../types";

export function AutomationsPage({
  configStatus,
  runningCommand,
  workflowFor,
  actionDisabledReason,
  onRun,
  onOpenPath,
}: {
  configStatus: AppConfigStatus | null;
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

      <section className="rounded-lg border border-white/60 bg-white/48 p-5 shadow-glass backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-950">Scanned documents</h2>
          <Clock3 className="h-5 w-5 text-teal-700" />
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
            />
          ))}
        </div>
      </section>
    </div>
  );
}
