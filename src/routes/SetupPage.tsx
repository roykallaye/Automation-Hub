import { Sparkles } from "lucide-react";
import { useState } from "react";

import { FocusFlow } from "../components/FocusFlow";
import { PageHeader } from "../components/PageHeader";
import { ModuleReadinessGrid } from "../components/ModuleReadinessCards";
import { SetupWizard } from "../components/SetupWizard/SetupWizard";
import { useI18n } from "../i18n";
import { staffMessage } from "../messages";
import type {
  AppConfigStatus,
  ModuleReadiness,
  PreflightItem,
  WorkflowPreflight,
} from "../types";

export function SetupPage({
  configStatus,
  modules,
  loading,
  onRefresh,
  onGoToAutomations,
  onGoToSupport,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  loading: boolean;
  onRefresh: () => void;
  onGoToAutomations: () => void;
  onGoToSupport: () => void;
}) {
  const { t } = useI18n();
  const [showWizard, setShowWizard] = useState(false);
  const guidance = setupGuidance(configStatus, loading, t);
  const setupIncomplete =
    !loading &&
    (!configStatus ||
      configStatus.preflight.items.some((item) =>
        ["missingConfiguration", "missingScript", "missingFolder", "permissionProblem", "warning"].includes(
          item.status,
        ),
      ) ||
      configStatus.preflight.workflows.some((workflow) => workflow.commandName && !workflow.canRun));
  const nextIssue = configStatus?.preflight.workflows.find(
    (workflow) => workflow.commandName && !workflow.canRun,
  );
  const setupReady =
    !loading &&
    Boolean(configStatus) &&
    !configStatus?.preflight.workflows.some((workflow) => workflow.commandName && !workflow.canRun);
  const nextBlockingItem =
    configStatus && nextIssue ? firstBlockingItem(configStatus, nextIssue) : null;
  const scriptsNeedSupport =
    nextBlockingItem?.itemType === "script" ||
    nextBlockingItem?.key === "automationRootFolder" ||
    nextBlockingItem?.key === "pythonExecutable" ||
    nextBlockingItem?.key === "pythonPackages";

  // Focus mode: the wizard replaces the whole page so the user sees one
  // task at a time, with a permanent way back. No Escape shortcut here —
  // progress is saved locally as the user moves through the guided flow.
  if (showWizard) {
    return (
      <FocusFlow
        eyebrow={t("setup.guidedEyebrow")}
        title={t("setup.guidedTitle")}
        exitLabel={t("setup.leave")}
        onExit={() => setShowWizard(false)}
      >
        <SetupWizard
          config={configStatus?.config}
          onClose={() => setShowWizard(false)}
          onSetupSaved={onRefresh}
        />
      </FocusFlow>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("setup.title")}>
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          {t("common.refresh")}
        </button>
      </PageHeader>

      <section
        className={[
          "rounded-xl border p-6 shadow-glass backdrop-blur-xl",
          setupIncomplete ? "border-amber-200 bg-amber-50" : "border-white/65 bg-white/55",
        ].join(" ")}
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-800 ring-1 ring-brand-100">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-slate-950">{guidance.title}</h2>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                {guidance.detail}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            {setupReady && (
              <button
                className="rounded-md border border-white/80 bg-white/70 px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-white"
                onClick={onGoToAutomations}
              >
                {t("setup.goAutomations")}
              </button>
            )}
            {scriptsNeedSupport && (
              <button
                className="rounded-md border border-white/80 bg-white/70 px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-white"
                onClick={onGoToSupport}
              >
                {t("setup.openSupport")}
              </button>
            )}
            <button
              className="rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-ink-soft"
              onClick={() => setShowWizard(true)}
            >
              {setupReady ? t("setup.reviewSetup") : t("setup.continueSetup")}
            </button>
          </div>
        </div>
      </section>


      <details className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          {t("setup.showReadiness")}
        </summary>
        <div className="mt-4">
          <ModuleReadinessGrid modules={modules} />
        </div>
      </details>

    </div>
  );
}

type SetupGuidance = {
  tone: "ready" | "attention";
  title: string;
  summary: string;
  detail: string;
};

function setupGuidance(
  configStatus: AppConfigStatus | null,
  loading: boolean,
  t: ReturnType<typeof useI18n>["t"],
): SetupGuidance {
  if (loading) {
    return {
      tone: "attention",
      title: t("setup.checkingTitle"),
      summary: t("setup.checkingSummary"),
      detail: t("setup.checkingDetail"),
    };
  }

  if (!configStatus) {
    return {
      tone: "attention",
      title: t("setup.loadFailedTitle"),
      summary: t("setup.loadFailedSummary"),
      detail: t("setup.loadFailedDetail"),
    };
  }

  const blockingWorkflow = configStatus.preflight.workflows.find(
    (workflow) => workflow.commandName && !workflow.canRun,
  );
  if (!blockingWorkflow) {
    return {
      tone: "ready",
      title: t("setup.readyTitle"),
      summary: t("setup.readyTitle"),
      detail: t("setup.readyDetail"),
    };
  }

  const item = firstBlockingItem(configStatus, blockingWorkflow);
  if (!item) {
    return {
      tone: "attention",
      title: t("setup.oneMoreTitle"),
      summary: t("setup.oneMoreSummary"),
      detail: staffMessage(blockingWorkflow.message, blockingWorkflow.status, blockingWorkflow.key),
    };
  }

  if (item.key === "automationConfigPath") {
    return {
      tone: "attention",
      title: t("setup.saveToFinishTitle"),
      summary: t("setup.saveToFinishSummary"),
      detail: t("setup.saveToFinishDetail"),
    };
  }

  if (item.key === "automationRootFolder") {
    return {
      tone: "attention",
      title: t("setup.scriptsNeedInstallTitle"),
      summary: t("setup.scriptsNeedInstallSummary"),
      detail: t("setup.scriptsNeedInstallDetail"),
    };
  }

  if (item.key === "automationConfigAlignment" || item.key === "configAlignment") {
    return {
      tone: "attention",
      title: t("setup.filesReviewTitle"),
      summary: t("setup.filesReviewSummary"),
      detail: t("setup.filesReviewDetail"),
    };
  }

  if (item.key === "gmailTokenAlignment") {
    return {
      tone: "attention",
      title: t("setup.gmailReviewTitle"),
      summary: t("setup.gmailReviewSummary"),
      detail: t("setup.gmailReviewDetail"),
    };
  }

  if (item.key === "gmailTokenFolder") {
    return {
      tone: "attention",
      title: t("setup.gmailFolderTitle"),
      summary: t("setup.gmailFolderSummary"),
      detail: t("setup.gmailFolderDetail"),
    };
  }

  if (item.key === "gmailTokenPath") {
    return {
      tone: "attention",
      title: t("setup.gmailLaterTitle"),
      summary: t("setup.gmailLaterSummary"),
      detail: t("setup.gmailLaterDetail"),
    };
  }

  if (item.key === "gmailCredentialsFile") {
    return {
      tone: "attention",
      title: t("setup.gmailCredentialsTitle"),
      summary: t("setup.gmailCredentialsSummary"),
      detail: t("setup.gmailCredentialsDetail"),
    };
  }

  if (item.itemType === "folder") {
    return {
      tone: "attention",
      title: t("setup.foldersNeedTitle"),
      summary: t("setup.foldersNeedSummary"),
      detail: folderGuidance(item),
    };
  }

  if (item.itemType === "script") {
    return {
      tone: "attention",
      title: t("setup.toolsNeedTitle"),
      summary: scriptSummary(item),
      detail: scriptGuidance(item),
    };
  }

  if (item.key === "pythonExecutable") {
    return {
      tone: "attention",
      title: t("setup.pythonNeedTitle"),
      summary: t("setup.pythonNeedSummary"),
      detail: t("setup.pythonNeedDetail"),
    };
  }

  if (item.key === "pythonPackages") {
    return {
      tone: "attention",
      title: t("setup.pythonPackagesTitle"),
      summary: t("setup.pythonPackagesSummary"),
      detail: t("setup.pythonPackagesDetail"),
    };
  }

  return {
    tone: "attention",
    title: t("setup.oneMoreTitle"),
    summary: t("setup.oneMoreSummary"),
    detail: staffMessage(blockingWorkflow.message, blockingWorkflow.status, blockingWorkflow.key),
  };
}

function firstBlockingItem(
  configStatus: AppConfigStatus,
  workflow: WorkflowPreflight,
): PreflightItem | null {
  return (
    workflow.checkKeys
      .map((key) => configStatus.preflight.items.find((item) => item.key === key))
      .find(isBlockingPreflightItem) ?? null
  );
}

function isBlockingPreflightItem(item: PreflightItem | undefined): item is PreflightItem {
  if (!item) return false;
  return ["missingConfiguration", "missingScript", "missingFolder", "permissionProblem"].includes(
    item.status,
  );
}

function folderGuidance(item: PreflightItem) {
  switch (item.key) {
    case "scansioniNetworkShare":
      return "The shared scan folder is not reachable. Choose the correct scan folder in guided setup.";
    case "scansioniLocalCacheFolder":
    case "ocrTextOutputFolder":
    case "contractsOutputFolder":
    case "contractLogFolder":
    case "invoiceInputFolder":
    case "invoiceOutputFolder":
    case "invoiceArchiveFolder":
    case "invoiceLogFolder":
      return "Create folders from guided setup, then run Check setup.";
    default:
      return staffMessage(item.message, item.status, item.key);
  }
}

function scriptSummary(item: PreflightItem) {
  switch (item.key) {
    case "copyScansioniScript":
    case "ocrPreprocessingScript":
      return "Setup saved. Some scan/OCR tools are not configured yet.";
    case "invoiceWorkflowScript":
    case "gmailDraftScript":
      return "Setup saved. Invoice draft tools are not configured yet.";
    case "contractProcessingScript":
      return "Setup saved. Contract tools are not configured yet.";
    default:
      return "Setup saved. Some automation tools are not configured yet.";
  }
}

function scriptGuidance(item: PreflightItem) {
  switch (item.key) {
    case "copyScansioniScript":
    case "ocrPreprocessingScript":
      return "Collect or configure the scan-copy and document-reading scripts, then run Check setup.";
    case "invoiceWorkflowScript":
    case "gmailDraftScript":
      return "Open Support and install InnPilot automation scripts, then run Check setup.";
    case "contractProcessingScript":
      return "Open Support and install InnPilot automation scripts, then run Check setup.";
    default:
      return staffMessage(item.message, item.status, item.key);
  }
}
