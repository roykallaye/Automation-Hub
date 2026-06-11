import { staffMessage } from "./messages";
import type {
  AppConfigStatus,
  ModuleReadiness,
  ModuleReadinessId,
  ModuleReadinessStatus,
  PreflightItem,
} from "./types";

type ModuleDefinition = {
  id: ModuleReadinessId;
  title: string;
  itemKeys: string[];
  workflowKeys: string[];
  relatedWorkflowCommandNames: string[];
  readyReason: string;
  readyNextAction: string;
};

const definitions: ModuleDefinition[] = [
  {
    id: "invoices",
    title: "Invoices",
    itemKeys: [
      "invoiceWorkflowScript",
      "invoiceInputFolder",
      "invoiceOutputFolder",
      "invoiceArchiveFolder",
      "invoiceLogFolder",
      "automationConfigPath",
      "automationConfigAlignment",
      "configAlignment",
    ],
    workflowKeys: ["invoiceWorkflow"],
    relatedWorkflowCommandNames: ["process_invoices_and_drafts"],
    readyReason: "Invoice folders and processing are ready.",
    readyNextAction: "Prepare invoice drafts when needed.",
  },
  {
    id: "gmailDrafts",
    title: "Gmail drafts",
    itemKeys: [
      "gmailDraftScript",
      "gmailTokenFolder",
      "gmailTokenAlignment",
      "gmailTokenPath",
      "automationConfigPath",
      "automationConfigAlignment",
      "configAlignment",
    ],
    workflowKeys: ["gmailDraftsWorkflow"],
    relatedWorkflowCommandNames: ["process_invoices_and_drafts", "reconnect_gmail"],
    readyReason: "Gmail draft setup is ready.",
    readyNextAction: "Drafts can be created for review. No emails are sent automatically.",
  },
  {
    id: "scanCopy",
    title: "Scanned documents",
    itemKeys: ["copyScansioniScript", "scansioniNetworkShare", "scansioniLocalCacheFolder"],
    workflowKeys: ["scansioniNetwork"],
    relatedWorkflowCommandNames: ["copy_scansioni"],
    readyReason: "Scanned-document folders are ready.",
    readyNextAction: "Copy scanned documents when needed.",
  },
  {
    id: "ocr",
    title: "Document reading",
    itemKeys: ["ocrPreprocessingScript", "scansioniLocalCacheFolder", "ocrTextOutputFolder"],
    workflowKeys: ["ocrWorkflow"],
    relatedWorkflowCommandNames: ["ocr_preprocessing"],
    readyReason: "Document reading is ready.",
    readyNextAction: "Read scanned documents when contracts need review.",
  },
  {
    id: "contracts",
    title: "Signed contracts",
    itemKeys: [
      "contractProcessingScript",
      "copyScansioniScript",
      "ocrPreprocessingScript",
      "scansioniNetworkShare",
      "scansioniLocalCacheFolder",
      "ocrTextOutputFolder",
      "contractsOutputFolder",
      "contractLogFolder",
      "automationConfigPath",
      "automationConfigAlignment",
      "configAlignment",
    ],
    workflowKeys: ["contractsWorkflow"],
    relatedWorkflowCommandNames: ["process_signed_contracts"],
    readyReason: "Signed-contract processing is ready.",
    readyNextAction: "Process signed contracts when new scans are available.",
  },
  {
    id: "support",
    title: "Support",
    itemKeys: ["invoiceLogFolder", "contractLogFolder", "clientProfile"],
    workflowKeys: ["clientProfile"],
    relatedWorkflowCommandNames: [],
    readyReason: "Support folders and hotel profile are ready.",
    readyNextAction: "Open Support if setup details are needed.",
  },
];

export function deriveModuleReadiness(
  configStatus: AppConfigStatus | null,
): ModuleReadiness[] {
  return definitions.map((definition) => deriveModule(configStatus, definition));
}

export function moduleForCommand(
  modules: ModuleReadiness[],
  commandName: string,
) {
  return modules.find((module) =>
    module.relatedWorkflowCommandNames.includes(commandName),
  );
}

function deriveModule(
  configStatus: AppConfigStatus | null,
  definition: ModuleDefinition,
): ModuleReadiness {
  if (!configStatus) {
    return {
      id: definition.id,
      title: definition.title,
      status: "not_checked",
      shortReason: "Not checked yet.",
      nextAction: "Refresh setup to check this area.",
      relatedWorkflowCommandNames: definition.relatedWorkflowCommandNames,
      blockingProblems: [],
      warnings: [],
    };
  }

  const items = definition.itemKeys
    .map((key) => configStatus.preflight.items.find((item) => item.key === key))
    .filter((item): item is PreflightItem => Boolean(item));
  const workflows = definition.workflowKeys
    .map((key) => configStatus.preflight.workflows.find((workflow) => workflow.key === key))
    .filter(Boolean);

  const blockingItems = items.filter((item) =>
    ["missingConfiguration", "missingScript", "missingFolder", "permissionProblem"].includes(
      item.status,
    ),
  );
  const warningItems = items.filter((item) => item.status === "warning");
  const blockingWorkflow = workflows.find((workflow) => workflow && !workflow.canRun);

  if (!items.length && !workflows.length) {
    return {
      id: definition.id,
      title: definition.title,
      status: "not_checked",
      shortReason: "Not checked yet.",
      nextAction: "Refresh setup to check this area.",
      relatedWorkflowCommandNames: definition.relatedWorkflowCommandNames,
      blockingProblems: [],
      warnings: [],
    };
  }

  if (blockingItems.length) {
    const first = blockingItems[0];
    const status = moduleStatusForItem(first);
    return {
      id: definition.id,
      title: definition.title,
      status,
      shortReason: moduleReason(definition.id, first),
      nextAction: moduleNextAction(definition.id, first),
      relatedWorkflowCommandNames: definition.relatedWorkflowCommandNames,
      blockingProblems: blockingItems.map((item) =>
        staffMessage(item.message, item.status, item.key),
      ),
      warnings: warningItems.map((item) =>
        staffMessage(item.message, item.status, item.key),
      ),
    };
  }

  if (blockingWorkflow) {
    return {
      id: definition.id,
      title: definition.title,
      status: "needs_attention",
      shortReason: staffMessage(
        blockingWorkflow.message,
        blockingWorkflow.status,
        blockingWorkflow.key,
      ),
      nextAction: "Open Setup and check this area.",
      relatedWorkflowCommandNames: definition.relatedWorkflowCommandNames,
      blockingProblems: [
        staffMessage(blockingWorkflow.message, blockingWorkflow.status, blockingWorkflow.key),
      ],
      warnings: warningItems.map((item) =>
        staffMessage(item.message, item.status, item.key),
      ),
    };
  }

  if (warningItems.length) {
    return {
      id: definition.id,
      title: definition.title,
      status: "needs_attention",
      shortReason: staffMessage(
        warningItems[0].message,
        warningItems[0].status,
        warningItems[0].key,
      ),
      nextAction: "Review setup when convenient.",
      relatedWorkflowCommandNames: definition.relatedWorkflowCommandNames,
      blockingProblems: [],
      warnings: warningItems.map((item) =>
        staffMessage(item.message, item.status, item.key),
      ),
    };
  }

  return {
    id: definition.id,
    title: definition.title,
    status: "ready",
    shortReason: definition.readyReason,
    nextAction: definition.readyNextAction,
    relatedWorkflowCommandNames: definition.relatedWorkflowCommandNames,
    blockingProblems: [],
    warnings: [],
  };
}

function moduleStatusForItem(item: PreflightItem): ModuleReadinessStatus {
  if (item.status === "missingConfiguration" || item.status === "missingScript") {
    return "not_configured";
  }
  if (item.status === "missingFolder" || item.status === "permissionProblem") {
    return "blocked";
  }
  if (item.status === "notChecked") return "not_checked";
  return "needs_attention";
}

function moduleReason(moduleId: ModuleReadinessId, item: PreflightItem) {
  if (item.itemType === "script") {
    if (moduleId === "scanCopy" || moduleId === "ocr") {
      return "Scan/OCR tool is not configured yet.";
    }
    if (moduleId === "contracts") {
      return "Contract processing needs scan/OCR setup.";
    }
    return "Automation tool is not configured yet.";
  }

  if (item.itemType === "folder") {
    if (item.key === "scansioniNetworkShare") {
      return "Shared scan folder is not reachable.";
    }
    if (item.key === "gmailTokenFolder") {
      return "Gmail sign-in folder is not ready.";
    }
    return "A required folder is not ready.";
  }

  if (item.key === "automationConfigPath") {
    return "Setup has not been saved yet.";
  }
  if (item.key === "gmailTokenAlignment") {
    return "Gmail sign-in paths do not match.";
  }
  if (item.key === "pythonExecutable") {
    return "Python is not available.";
  }

  return staffMessage(item.message, item.status, item.key);
}

function moduleNextAction(moduleId: ModuleReadinessId, item: PreflightItem) {
  if (item.key === "automationConfigPath") {
    return "Save setup from the guided setup review step.";
  }
  if (item.key === "scansioniNetworkShare") {
    return "Choose the shared scan folder in guided setup.";
  }
  if (item.key === "gmailTokenFolder") {
    return "Create folders, then check setup again.";
  }
  if (item.key === "gmailTokenAlignment") {
    return "Check Gmail sign-in path and save setup again.";
  }
  if (item.itemType === "folder") {
    return "Create folders from guided setup, then check setup.";
  }
  if (item.itemType === "script") {
    if (moduleId === "scanCopy" || moduleId === "ocr" || moduleId === "contracts") {
      return "Configure the missing scan/OCR tool, then check setup.";
    }
    return "Configure the missing automation tool, then check setup.";
  }
  if (item.key === "pythonExecutable") {
    return "Install Python or update the Python setting.";
  }
  return "Open Setup and check this area.";
}

export function moduleStatusLabel(status: ModuleReadinessStatus) {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs_attention":
      return "Needs attention";
    case "not_configured":
      return "Not configured";
    case "blocked":
      return "Cannot run yet";
    case "not_checked":
      return "Not checked";
  }
}
