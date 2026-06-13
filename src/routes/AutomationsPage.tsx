import { Bot, Send } from "lucide-react";

import {
  contractAction,
  gmailReconnectAction,
  invoiceAction,
  maintenanceActions,
} from "../actions";
import { PageHeader } from "../components/PageHeader";
import {
  FutureWorkflowCard,
  WorkflowGalleryCard,
} from "../components/WorkflowGalleryCard";
import type { CardTint } from "../components/tints";
import {
  deliveryModeLabel,
  deliveryModePromise,
  deliveryModeReassurance,
} from "../messages";
import { moduleForCommand } from "../moduleReadiness";
import type {
  ActivityRecord,
  AppConfigStatus,
  AppPage,
  AutomationAction,
  ModuleReadiness,
} from "../types";

/*
  Automations is a workflow gallery: each hotel task is one card with a
  consistent shape — what it does, whether it is ready, what happened last,
  one button, and a plain safety statement. The pre-run "what will happen"
  panel opens before anything starts (ConfirmationModal).
*/
export function AutomationsPage({
  configStatus,
  modules,
  activityHistory,
  runningCommand,
  actionDisabledReason,
  onRun,
  onOpenPath,
  onNavigate,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  activityHistory: ActivityRecord[];
  runningCommand: string | null;
  actionDisabledReason: (action: AutomationAction) => string | null;
  onRun: (action: AutomationAction) => void;
  onOpenPath: (path?: string | null) => void;
  onNavigate: (page: AppPage) => void;
}) {
  const folders = configStatus?.config.folders;
  const deliveryMode = configStatus?.config.invoiceDeliveryMode;
  const invoiceSelectionMode = configStatus?.config.invoiceFileSelectionMode;
  const anyRunning = Boolean(runningCommand);
  const [copyScansAction, ocrAction] = maintenanceActions;

  function lastRunLabelFor(commandName: string) {
    const record = [...activityHistory]
      .reverse()
      .find((entry) => entry.workflowCommandName === commandName);
    if (!record) return null;
    return `Last run ${formatDate(record.finishedAt)} · ${shortStatus(record)}`;
  }

  function fixFor(action: AutomationAction) {
    const module = moduleForCommand(modules, action.commandName);
    const needsSupport = module?.blockingProblems.some((problem) =>
      /python|support|script|tool/i.test(problem),
    );
    return {
      label: needsSupport ? "Open Support" : "Fix in Setup",
      onClick: () => onNavigate(needsSupport ? "support" : "setup"),
    };
  }

  function galleryCard(options: {
    action: AutomationAction;
    title: string;
    whatItDoes: string;
    tint?: CardTint;
    primaryLabel: string;
    safety: string;
    modeChip?: string;
    links?: { label: string; path?: string | null }[];
  }) {
    const { action } = options;
    const fix = fixFor(action);
    return (
      <WorkflowGalleryCard
        icon={action.icon}
        title={options.title}
        whatItDoes={options.whatItDoes}
        tint={options.tint}
        modeChip={options.modeChip}
        safety={options.safety}
        module={moduleForCommand(modules, action.commandName)}
        lastRunLabel={lastRunLabelFor(action.commandName)}
        isRunning={runningCommand === action.commandName}
        anyRunning={anyRunning}
        disabledReason={actionDisabledReason(action)}
        primaryLabel={options.primaryLabel}
        onRun={() => onRun(action)}
        fixLabel={fix.label}
        onFix={fix.onClick}
        links={options.links}
        onOpenPath={onOpenPath}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Automations" eyebrow="Today's hotel work" />

      <div className="stagger-children grid gap-5 xl:grid-cols-2">
        {galleryCard({
          action: invoiceAction,
          title: "Invoice files",
          whatItDoes: invoiceWorkflowPromise(deliveryModePromise(deliveryMode), invoiceSelectionMode),
          tint: "sky",
          modeChip: deliveryModeLabel(deliveryMode),
          primaryLabel: "Prepare invoice files",
          safety: deliveryModeReassurance(deliveryMode),
          links: [
            { label: "Input folder", path: folders?.invoiceInputFolder },
            { label: "Ready invoices", path: folders?.invoiceOutputFolder },
          ],
        })}

        {galleryCard({
          action: contractAction,
          title: "Signed contracts",
          whatItDoes: "Reads, sorts, and files signed contract documents.",
          tint: "violet",
          primaryLabel: "Process signed contracts",
          safety: "Gmail is not contacted. File moves ask first.",
          links: [
            { label: "Shared scan folder", path: folders?.scansioniNetworkShare },
            { label: "Signed contracts", path: folders?.contractsOutputFolder },
          ],
        })}

        {galleryCard({
          action: copyScansAction,
          title: "Scanned documents",
          whatItDoes: "Copies new scans from the shared folder to this computer.",
          tint: "amber",
          primaryLabel: "Copy scanned documents",
          safety: "Copies only — originals stay in place.",
          links: [
            { label: "Shared scan folder", path: folders?.scansioniNetworkShare },
            { label: "Local scans", path: folders?.scansioniLocalCacheFolder },
          ],
        })}

        {galleryCard({
          action: ocrAction,
          title: "Document reading",
          whatItDoes: "Reads scanned pages and writes searchable text files.",
          tint: "emerald",
          primaryLabel: "Read scanned documents",
          safety: "Scans are not changed. Gmail is not contacted.",
          links: [
            { label: "Local scans", path: folders?.scansioniLocalCacheFolder },
            { label: "Text output", path: folders?.ocrTextOutputFolder },
          ],
        })}

        {deliveryMode !== "prepareOnly" &&
          galleryCard({
            action: gmailReconnectAction,
            title: "Gmail sign-in",
            whatItDoes: "Keeps draft creation connected to the hotel's Gmail.",
            tint: "rose",
            primaryLabel: "Check Gmail sign-in",
            safety: "Drafts only — no emails are sent.",
          })}

        <FutureWorkflowCard
          icon={Bot}
          title="AI-created automations"
          whatItWillDo="Automations designed with the AI Assistant will appear here, ready to run with the same safety rules."
          tint="violet"
          chip="Coming soon"
          actionLabel="Explore the AI Assistant"
          onAction={() => onNavigate("assistant")}
        />

        <FutureWorkflowCard
          icon={Send}
          title="Send invoices automatically"
          whatItWillDo="Sending without review stays locked until stronger controls are ready. Today, nothing is ever sent automatically."
          tint="sky"
          chip="Locked"
          footnote="InnPilot never sends email on its own."
        />
      </div>
    </div>
  );
}

function invoiceWorkflowPromise(deliveryPromise: string, selectionMode?: string | null) {
  const selection =
    selectionMode === "filenamePatterns"
      ? " Only PDFs matching your filename filters are considered."
      : " Every PDF in the invoice folder is considered an invoice.";
  return `${deliveryPromise}${selection}`;
}

function shortStatus(record: ActivityRecord) {
  if (record.status === "success") return "completed";
  if (record.status === "needs_attention") return "needs review";
  if (record.status === "failed") return "needs attention";
  return record.status;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}
