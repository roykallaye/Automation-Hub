import type {
  ActivityRecord,
  AppConfigStatus,
  AppPage,
  ModuleReadiness,
  ModuleReadinessId,
  RunSummary,
} from "./types";
import type { TranslationKey } from "./i18n";

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

export type NextActionTone = "success" | "attention" | "blocked" | "neutral";

export type NextAction = {
  id: string;
  title: string;
  shortMessage: string;
  targetPage: AppPage;
  buttonLabel: string;
  priority: number;
  tone: NextActionTone;
  relatedModuleId?: ModuleReadinessId;
};

export function deriveNextAction({
  loading,
  configStatus,
  modules,
  lastSummary,
  activityHistory,
  runningCommand,
  t = fallbackT,
}: {
  loading: boolean;
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  lastSummary: RunSummary | null;
  activityHistory: ActivityRecord[];
  runningCommand: string | null;
  t?: T;
}): NextAction {
  if (runningCommand) {
    return {
      id: "run-in-progress",
      title: t("next.runningTitle"),
      shortMessage: t("next.runningMessage"),
      targetPage: "activity",
      buttonLabel: t("next.openActivity"),
      priority: 100,
      tone: "neutral",
    };
  }

  const latestActivity = activityHistory[activityHistory.length - 1];
  if (lastSummary?.status === "error" || latestActivity?.status === "failed") {
    return {
      id: "review-failed-run",
      title: t("next.reviewFailedTitle"),
      shortMessage: t("next.reviewFailedMessage"),
      targetPage: "activity",
      buttonLabel: t("next.reviewActivity"),
      priority: 95,
      tone: "blocked",
    };
  }

  if (lastSummary?.status === "warning" || latestActivity?.status === "needs_attention") {
    return {
      id: "review-warning-run",
      title: t("next.reviewWarningTitle"),
      shortMessage: t("next.reviewWarningMessage"),
      targetPage: "activity",
      buttonLabel: t("next.openActivity"),
      priority: 90,
      tone: "attention",
    };
  }

  if (loading) {
    return {
      id: "checking-setup",
      title: t("next.checkingSetupTitle"),
      shortMessage: t("next.checkingSetupMessage"),
      targetPage: "setup",
      buttonLabel: t("next.openSetup"),
      priority: 80,
      tone: "neutral",
    };
  }

  if (!configStatus) {
    return {
      id: "setup-unavailable",
      title: t("next.setupUnavailableTitle"),
      shortMessage: t("next.setupUnavailableMessage"),
      targetPage: "setup",
      buttonLabel: t("next.goToSetup"),
      priority: 85,
      tone: "blocked",
    };
  }

  const invoices = moduleById(modules, "invoices");
  const gmail = moduleById(modules, "gmailDrafts");
  const contracts = moduleById(modules, "contracts");
  const ocr = moduleById(modules, "ocr");

  // In "Prepare files only" mode Gmail is skipped, so it must not block the hotel.
  const gmailIsPrimary = configStatus.config.invoiceDeliveryMode !== "prepareOnly";
  const primaryModules = gmailIsPrimary ? [invoices, gmail] : [invoices];
  const primaryIssue = primaryModules.find((module) => module && module.status !== "ready");
  if (primaryIssue) {
    return {
      id: `finish-${primaryIssue.id}`,
      title: t("next.finishSetupTitle"),
      shortMessage: primaryIssue.nextAction,
      targetPage: "setup",
      buttonLabel: t("next.finishSetup"),
      priority: 75,
      tone: primaryIssue.status === "blocked" ? "blocked" : "attention",
      relatedModuleId: primaryIssue.id,
    };
  }

  const blockingWorkflow = configStatus.preflight.workflows.find(
    (workflow) => workflow.commandName && !workflow.canRun,
  );
  if (blockingWorkflow && invoices?.status !== "ready") {
    return {
      id: "workflow-blocked",
      title: t("next.oneMoreStepTitle"),
      shortMessage: t("next.oneMoreStepMessage"),
      targetPage: "setup",
      buttonLabel: t("next.openSetup"),
      priority: 70,
      tone: "attention",
    };
  }

  if (lastSummary?.status === "success" || latestActivity?.status === "success") {
    return {
      id: "view-latest-success",
      title: t("next.lastRunCompletedTitle"),
      shortMessage: t("next.lastRunCompletedMessage"),
      targetPage: "activity",
      buttonLabel: t("next.viewActivity"),
      priority: 65,
      tone: "success",
    };
  }

  if (contracts?.status === "ready") {
    return {
      id: "daily-work-ready",
      title: t("next.dailyReadyTitle"),
      shortMessage: t("next.dailyReadyMessage"),
      targetPage: "automations",
      buttonLabel: t("next.openAutomations"),
      priority: 60,
      tone: "success",
    };
  }

  if (ocr && ocr.status !== "ready") {
    return {
      id: "invoices-ready-ocr-later",
      title: t("next.invoicesReadyTitle"),
      shortMessage: t("next.invoicesReadyMessage"),
      targetPage: "automations",
      buttonLabel: t("next.prepareDrafts"),
      priority: 55,
      tone: "success",
      relatedModuleId: "invoices",
    };
  }

  return {
    id: "ready-for-work",
    title: t("next.readyTitle"),
    shortMessage: t("next.readyMessage"),
    targetPage: "automations",
    buttonLabel: t("next.openAutomations"),
    priority: 50,
    tone: "success",
  };
}

function fallbackT(key: TranslationKey) {
  return key;
}

function moduleById(modules: ModuleReadiness[], id: ModuleReadinessId) {
  return modules.find((module) => module.id === id);
}
