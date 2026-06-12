import type {
  ActivityRecord,
  AppConfigStatus,
  AppPage,
  ModuleReadiness,
  ModuleReadinessId,
  RunSummary,
} from "./types";

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
}: {
  loading: boolean;
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  lastSummary: RunSummary | null;
  activityHistory: ActivityRecord[];
  runningCommand: string | null;
}): NextAction {
  if (runningCommand) {
    return {
      id: "run-in-progress",
      title: "Automation is running",
      shortMessage: "Follow progress and results in Activity.",
      targetPage: "activity",
      buttonLabel: "Open Activity",
      priority: 100,
      tone: "neutral",
    };
  }

  const latestActivity = activityHistory[activityHistory.length - 1];
  if (lastSummary?.status === "error" || latestActivity?.status === "failed") {
    return {
      id: "review-failed-run",
      title: "A run needs review",
      shortMessage: "Open Activity to see what needs attention.",
      targetPage: "activity",
      buttonLabel: "Review Activity",
      priority: 95,
      tone: "blocked",
    };
  }

  if (lastSummary?.status === "warning" || latestActivity?.status === "needs_attention") {
    return {
      id: "review-warning-run",
      title: "Review the last result",
      shortMessage: "Activity has the summary and next support details.",
      targetPage: "activity",
      buttonLabel: "Open Activity",
      priority: 90,
      tone: "attention",
    };
  }

  if (loading) {
    return {
      id: "checking-setup",
      title: "Checking setup",
      shortMessage: "InnPilot is checking folders and tools.",
      targetPage: "setup",
      buttonLabel: "Open Setup",
      priority: 80,
      tone: "neutral",
    };
  }

  if (!configStatus) {
    return {
      id: "setup-unavailable",
      title: "Setup needs attention",
      shortMessage: "InnPilot setup could not be loaded.",
      targetPage: "setup",
      buttonLabel: "Go to Setup",
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
      title: "Finish setup to start",
      shortMessage: primaryIssue.nextAction,
      targetPage: "setup",
      buttonLabel: "Finish Setup",
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
      title: "Setup needs one more step",
      shortMessage: "Fix the blocked workflow before running daily work.",
      targetPage: "setup",
      buttonLabel: "Open Setup",
      priority: 70,
      tone: "attention",
    };
  }

  if (lastSummary?.status === "success" || latestActivity?.status === "success") {
    return {
      id: "view-latest-success",
      title: "Last run completed",
      shortMessage: "Activity has the saved summary.",
      targetPage: "activity",
      buttonLabel: "View Activity",
      priority: 65,
      tone: "success",
    };
  }

  if (contracts?.status === "ready") {
    return {
      id: "daily-work-ready",
      title: "Daily automations are ready",
      shortMessage: "Prepare invoice files or process signed contracts.",
      targetPage: "automations",
      buttonLabel: "Open Automations",
      priority: 60,
      tone: "success",
    };
  }

  if (ocr && ocr.status !== "ready") {
    return {
      id: "invoices-ready-ocr-later",
      title: "Invoice drafts are ready",
      shortMessage: "You can prepare invoice files now. Document reading can be set up later.",
      targetPage: "automations",
      buttonLabel: "Prepare Drafts",
      priority: 55,
      tone: "success",
      relatedModuleId: "invoices",
    };
  }

  return {
    id: "ready-for-work",
    title: "Ready for office work",
    shortMessage: "Choose the automation you need today.",
    targetPage: "automations",
    buttonLabel: "Open Automations",
    priority: 50,
    tone: "success",
  };
}

function moduleById(modules: ModuleReadiness[], id: ModuleReadinessId) {
  return modules.find((module) => module.id === id);
}
