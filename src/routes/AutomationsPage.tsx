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
import { useI18n } from "../i18n";
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
  consistent shape â€” what it does, whether it is ready, what happened last,
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
  const { t } = useI18n();
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
    return t("automations.lastRun", {
      time: formatDate(record.finishedAt),
      status: shortStatus(record, t),
    });
  }

  function fixFor(action: AutomationAction) {
    const module = moduleForCommand(modules, action.commandName);
    const needsSupport = module?.blockingProblems.some((problem) =>
      /python|support|script|tool/i.test(problem),
    );
    return {
      label: needsSupport ? t("workflow.blockedOpenSupport") : t("workflow.blockedFixSetup"),
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
      <PageHeader title={t("automations.title")} eyebrow={t("automations.eyebrow")} />

      <div className="stagger-children grid gap-5 xl:grid-cols-2">
        {galleryCard({
          action: invoiceAction,
          title: t("automations.invoiceTitle"),
          whatItDoes: invoiceWorkflowPromise(deliveryModePromise(deliveryMode, t), invoiceSelectionMode, t),
          tint: "sky",
          modeChip: deliveryModeLabel(deliveryMode, t),
          primaryLabel: t("automations.invoicePrimary"),
          safety: deliveryModeReassurance(deliveryMode, t),
          links: [
            { label: t("automations.folderInput"), path: folders?.invoiceInputFolder },
            { label: t("automations.folderReadyInvoices"), path: folders?.invoiceOutputFolder },
          ],
        })}

        {galleryCard({
          action: contractAction,
          title: t("automations.contractsTitle"),
          whatItDoes: t("automations.contractsDescription"),
          tint: "violet",
          primaryLabel: t("automations.contractsPrimary"),
          safety: t("automations.contractsSafety"),
          links: [
            { label: t("automations.folderSharedScans"), path: folders?.scansioniNetworkShare },
            { label: t("automations.folderSignedContracts"), path: folders?.contractsOutputFolder },
          ],
        })}

        {galleryCard({
          action: copyScansAction,
          title: t("automations.scansTitle"),
          whatItDoes: t("automations.scansDescription"),
          tint: "amber",
          primaryLabel: t("automations.scansPrimary"),
          safety: t("automations.scansSafety"),
          links: [
            { label: t("automations.folderSharedScans"), path: folders?.scansioniNetworkShare },
            { label: t("automations.folderLocalScans"), path: folders?.scansioniLocalCacheFolder },
          ],
        })}

        {galleryCard({
          action: ocrAction,
          title: t("automations.ocrTitle"),
          whatItDoes: t("automations.ocrDescription"),
          tint: "emerald",
          primaryLabel: t("automations.ocrPrimary"),
          safety: t("automations.ocrSafety"),
          links: [
            { label: t("automations.folderLocalScans"), path: folders?.scansioniLocalCacheFolder },
            { label: t("automations.folderTextOutput"), path: folders?.ocrTextOutputFolder },
          ],
        })}

        {deliveryMode !== "prepareOnly" &&
          galleryCard({
            action: gmailReconnectAction,
            title: t("automations.gmailTitle"),
            whatItDoes: t("automations.gmailDescription"),
            tint: "rose",
            primaryLabel: t("automations.gmailPrimary"),
            safety: t("delivery.draftsOnlyReassurance"),
          })}

        <FutureWorkflowCard
          icon={Bot}
          title={t("automations.futureAiTitle")}
          whatItWillDo={t("automations.futureAiDescription")}
          tint="violet"
          chip={t("common.comingSoon")}
          actionLabel={t("automations.futureAiAction")}
          onAction={() => onNavigate("assistant")}
        />

        <FutureWorkflowCard
          icon={Send}
          title={t("automations.futureSendTitle")}
          whatItWillDo={t("automations.futureSendDescription")}
          tint="sky"
          chip={t("common.locked")}
          footnote={t("automations.futureSendFootnote")}
        />
      </div>
    </div>
  );
}

function invoiceWorkflowPromise(
  deliveryPromise: string,
  selectionMode: string | null | undefined,
  t: ReturnType<typeof useI18n>["t"],
) {
  const selection =
    selectionMode === "filenamePatterns"
      ? ` ${t("invoiceSelection.filenamePatternsFact")}`
      : ` ${t("invoiceSelection.allPdfsFact")}`;
  return `${deliveryPromise}${selection}`;
}

function shortStatus(record: ActivityRecord, t: ReturnType<typeof useI18n>["t"]) {
  if (record.status === "success") return t("status.completed").toLowerCase();
  if (record.status === "needs_attention") return t("status.needsReview").toLowerCase();
  if (record.status === "failed") return t("status.needsAttention").toLowerCase();
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

