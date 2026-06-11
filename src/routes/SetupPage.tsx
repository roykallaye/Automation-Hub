import { Sparkles } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { ModuleReadinessGrid } from "../components/ModuleReadinessCards";
import { SetupStatusPanel } from "../components/SetupStatusPanel";
import { SetupWizard } from "../components/SetupWizard/SetupWizard";
import { staffMessage } from "../messages";
import type {
  AppConfigStatus,
  ModuleReadiness,
  PreflightItem,
  WorkflowPreflight,
} from "../types";
import type { NextAction } from "../nextAction";

export function SetupPage({
  configStatus,
  modules,
  loading,
  nextAction,
  onRefresh,
  onGoToAutomations,
  onGoToSupport,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  loading: boolean;
  nextAction: NextAction;
  onRefresh: () => void;
  onGoToAutomations: () => void;
  onGoToSupport: () => void;
}) {
  const [showWizard, setShowWizard] = useState(false);
  const guidance = setupGuidance(configStatus, loading);
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

  return (
    <div className="space-y-5">
      <PageHeader title="Setup" eyebrow="Readiness check">
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </PageHeader>

      {showWizard ? (
        <SetupWizard
          config={configStatus?.config}
          onClose={() => setShowWizard(false)}
          onSetupSaved={onRefresh}
        />
      ) : (
        <section
          className={[
            "rounded-xl border p-6 shadow-glass backdrop-blur-xl",
            setupIncomplete
              ? "border-amber-200 bg-amber-50"
              : "border-white/65 bg-white/55",
          ].join(" ")}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-800 ring-1 ring-teal-100">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-slate-950">{guidance.title}</h2>
                <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                  {guidance.detail}
                </p>
                <p
                  className={[
                    "mt-3 text-sm font-semibold",
                    guidance.tone === "ready" ? "text-emerald-900" : "text-amber-900",
                  ].join(" ")}
                >
                  {guidance.summary}
                </p>
              </div>
            </div>
            <button
              className="shrink-0 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              onClick={() => setShowWizard(true)}
            >
              {nextAction.targetPage === "setup"
                ? nextAction.buttonLabel
                : setupReady
                  ? "Review setup"
                  : "Continue setup"}
            </button>
          </div>
        </section>
      )}

      {!showWizard && setupReady && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-glass">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-emerald-950">Setup is ready</h2>
              <p className="mt-1 text-sm font-medium text-emerald-800">
                FlowHost setup checks are passing. Workflows are still started manually.
              </p>
            </div>
            <button
              className="shrink-0 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={onGoToAutomations}
            >
              Go to Automations
            </button>
          </div>
        </section>
      )}

      {!showWizard && !setupReady && nextIssue && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-glass">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-950">{guidance.title}</p>
              <p className="mt-1 text-sm font-medium leading-6 text-amber-800">
                {guidance.detail}
              </p>
            </div>
            {scriptsNeedSupport && (
              <button
                className="shrink-0 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={onGoToSupport}
              >
                Open Support
              </button>
            )}
          </div>
        </section>
      )}

      {!showWizard && (
        <details className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">
            Show readiness by area
          </summary>
          <div className="mt-4">
            <ModuleReadinessGrid modules={modules} />
          </div>
        </details>
      )}

      <details className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          Advanced setup details
        </summary>
        <div className="mt-4">
          <SetupStatusPanel
            configStatus={configStatus}
            loading={loading}
            onRefresh={onRefresh}
          />
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
): SetupGuidance {
  if (loading) {
    return {
      tone: "attention",
      title: "Checking setup",
      summary: "Checking FlowHost setup...",
      detail: "FlowHost is checking folders and tools.",
    };
  }

  if (!configStatus) {
    return {
      tone: "attention",
      title: "Setup could not be loaded",
      summary: "FlowHost setup could not be loaded.",
      detail: "Refresh setup or ask setup support to check FlowHost.",
    };
  }

  const blockingWorkflow = configStatus.preflight.workflows.find(
    (workflow) => workflow.commandName && !workflow.canRun,
  );
  if (!blockingWorkflow) {
    return {
      tone: "ready",
      title: "Setup is ready",
      summary: "Setup is ready.",
      detail: "FlowHost setup checks are passing. Workflows are still started manually.",
    };
  }

  const item = firstBlockingItem(configStatus, blockingWorkflow);
  if (!item) {
    return {
      tone: "attention",
      title: "Setup needs one more step",
      summary: "Setup needs one more step.",
      detail: staffMessage(blockingWorkflow.message, blockingWorkflow.status, blockingWorkflow.key),
    };
  }

  if (item.key === "automationConfigPath") {
    return {
      tone: "attention",
      title: "Save setup to finish",
      summary: "Setup draft is not saved yet.",
      detail: "Create folders, then save setup from the guided setup review step.",
    };
  }

  if (item.key === "automationRootFolder") {
    return {
      tone: "attention",
      title: "Automation scripts need installing",
      summary: "Setup saved. FlowHost automation scripts are not installed yet.",
      detail: "Open Support and install FlowHost automation scripts, then run Check setup.",
    };
  }

  if (item.key === "automationConfigAlignment" || item.key === "configAlignment") {
    return {
      tone: "attention",
      title: "Setup files need review",
      summary: "Setup was saved, but the setup files do not fully match.",
      detail: "Open guided setup, save again, then run Check setup.",
    };
  }

  if (item.key === "gmailTokenAlignment") {
    return {
      tone: "attention",
      title: "Gmail sign-in setup needs review",
      summary: "Setup saved. Gmail sign-in paths do not match yet.",
      detail: "Check the Gmail sign-in file path in guided setup and save again.",
    };
  }

  if (item.key === "gmailTokenFolder") {
    return {
      tone: "attention",
      title: "Gmail folder needs attention",
      summary: "Setup saved. The Gmail sign-in folder is not ready yet.",
      detail: "Create folders from guided setup, then run Check setup.",
    };
  }

  if (item.key === "gmailTokenPath") {
    return {
      tone: "attention",
      title: "Gmail sign-in can be completed later",
      summary: "Setup saved. Gmail sign-in still needs to be completed.",
      detail: "Reconnect Gmail when ready. FlowHost creates drafts only and never sends emails automatically.",
    };
  }

  if (item.itemType === "folder") {
    return {
      tone: "attention",
      title: "Folders need attention",
      summary: "Setup saved. One folder is not ready yet.",
      detail: folderGuidance(item),
    };
  }

  if (item.itemType === "script") {
    return {
      tone: "attention",
      title: "Automation tools need attention",
      summary: scriptSummary(item),
      detail: scriptGuidance(item),
    };
  }

  if (item.key === "pythonExecutable") {
    return {
      tone: "attention",
      title: "Python needs attention",
      summary: "Setup saved. Python is not available yet.",
      detail: "Open Support to check the selected Python executable and installation steps.",
    };
  }

  if (item.key === "pythonPackages") {
    return {
      tone: "attention",
      title: "Python packages need installing",
      summary: "Setup saved. Python packages are not ready yet.",
      detail: "Open Support and install the Python packages needed by FlowHost automations.",
    };
  }

  return {
    tone: "attention",
    title: "Setup needs one more step",
    summary: "Setup needs one more step.",
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
      return "Open Support and install FlowHost automation scripts, then run Check setup.";
    case "contractProcessingScript":
      return "Open Support and install FlowHost automation scripts, then run Check setup.";
    default:
      return staffMessage(item.message, item.status, item.key);
  }
}
