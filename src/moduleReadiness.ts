import { staffMessage } from "./messages";
import type { TranslationKey } from "./i18n";
import type {
  AppConfigStatus,
  ModuleReadiness,
  ModuleReadinessId,
  ModuleReadinessStatus,
  PreflightItem,
} from "./types";

type ModuleDefinition = {
  id: ModuleReadinessId;
  titleKey: TranslationKey;
  itemKeys: string[];
  workflowKeys: string[];
  relatedWorkflowCommandNames: string[];
  readyReasonKey: TranslationKey;
  readyNextActionKey: TranslationKey;
};

type Translator = (key: TranslationKey) => string;

const fallbackT: Translator = (key) => key;

// These keys mirror backend PreflightItem.key values in src-tauri/src/preflight.rs.
// Keep this list in sync when backend readiness items are added or renamed.
const PREFLIGHT_KEYS = {
  automationConfigAlignment: "automationConfigAlignment",
  automationConfigPath: "automationConfigPath",
  clientProfile: "clientProfile",
  configAlignment: "configAlignment",
  contractLogFolder: "contractLogFolder",
  contractProcessingScript: "contractProcessingScript",
  contractsOutputFolder: "contractsOutputFolder",
  copyScansioniScript: "copyScansioniScript",
  gmailCredentialsFile: "gmailCredentialsFile",
  gmailDraftScript: "gmailDraftScript",
  gmailTokenAlignment: "gmailTokenAlignment",
  gmailTokenFolder: "gmailTokenFolder",
  gmailTokenPath: "gmailTokenPath",
  invoiceArchiveFolder: "invoiceArchiveFolder",
  invoiceInputFolder: "invoiceInputFolder",
  invoiceLogFolder: "invoiceLogFolder",
  invoiceOutputFolder: "invoiceOutputFolder",
  invoiceWorkflowScript: "invoiceWorkflowScript",
  ocrPreprocessingScript: "ocrPreprocessingScript",
  ocrTextOutputFolder: "ocrTextOutputFolder",
  pythonExecutable: "pythonExecutable",
  scansioniLocalCacheFolder: "scansioniLocalCacheFolder",
  scansioniNetworkShare: "scansioniNetworkShare",
} as const;

const definitions: ModuleDefinition[] = [
  {
    id: "invoices",
    titleKey: "module.invoices",
    itemKeys: [
      PREFLIGHT_KEYS.invoiceWorkflowScript,
      PREFLIGHT_KEYS.invoiceInputFolder,
      PREFLIGHT_KEYS.invoiceOutputFolder,
      PREFLIGHT_KEYS.invoiceArchiveFolder,
      PREFLIGHT_KEYS.invoiceLogFolder,
      PREFLIGHT_KEYS.automationConfigPath,
      PREFLIGHT_KEYS.automationConfigAlignment,
      PREFLIGHT_KEYS.configAlignment,
    ],
    workflowKeys: ["invoiceWorkflow"],
    relatedWorkflowCommandNames: ["process_invoices_and_drafts"],
    readyReasonKey: "module.invoiceReadyReason",
    readyNextActionKey: "module.invoiceReadyNext",
  },
  {
    id: "gmailDrafts",
    titleKey: "module.gmailDrafts",
    itemKeys: [
      PREFLIGHT_KEYS.gmailDraftScript,
      PREFLIGHT_KEYS.gmailCredentialsFile,
      PREFLIGHT_KEYS.gmailTokenFolder,
      PREFLIGHT_KEYS.gmailTokenAlignment,
      PREFLIGHT_KEYS.gmailTokenPath,
      PREFLIGHT_KEYS.automationConfigPath,
      PREFLIGHT_KEYS.automationConfigAlignment,
      PREFLIGHT_KEYS.configAlignment,
    ],
    workflowKeys: ["gmailDraftsWorkflow"],
    relatedWorkflowCommandNames: ["process_invoices_and_drafts", "reconnect_gmail"],
    readyReasonKey: "module.gmailReadyReason",
    readyNextActionKey: "module.gmailReadyNext",
  },
  {
    id: "scanCopy",
    titleKey: "module.scanCopy",
    itemKeys: [
      PREFLIGHT_KEYS.copyScansioniScript,
      PREFLIGHT_KEYS.scansioniNetworkShare,
      PREFLIGHT_KEYS.scansioniLocalCacheFolder,
    ],
    workflowKeys: ["scansioniNetwork"],
    relatedWorkflowCommandNames: ["copy_scansioni"],
    readyReasonKey: "module.scanReadyReason",
    readyNextActionKey: "module.scanReadyNext",
  },
  {
    id: "ocr",
    titleKey: "module.ocr",
    itemKeys: [
      PREFLIGHT_KEYS.ocrPreprocessingScript,
      PREFLIGHT_KEYS.scansioniLocalCacheFolder,
      PREFLIGHT_KEYS.ocrTextOutputFolder,
    ],
    workflowKeys: ["ocrWorkflow"],
    relatedWorkflowCommandNames: ["ocr_preprocessing"],
    readyReasonKey: "module.ocrReadyReason",
    readyNextActionKey: "module.ocrReadyNext",
  },
  {
    id: "contracts",
    titleKey: "module.contracts",
    itemKeys: [
      PREFLIGHT_KEYS.contractProcessingScript,
      PREFLIGHT_KEYS.copyScansioniScript,
      PREFLIGHT_KEYS.ocrPreprocessingScript,
      PREFLIGHT_KEYS.scansioniNetworkShare,
      PREFLIGHT_KEYS.scansioniLocalCacheFolder,
      PREFLIGHT_KEYS.ocrTextOutputFolder,
      PREFLIGHT_KEYS.contractsOutputFolder,
      PREFLIGHT_KEYS.contractLogFolder,
      PREFLIGHT_KEYS.automationConfigPath,
      PREFLIGHT_KEYS.automationConfigAlignment,
      PREFLIGHT_KEYS.configAlignment,
    ],
    workflowKeys: ["contractsWorkflow"],
    relatedWorkflowCommandNames: ["process_signed_contracts"],
    readyReasonKey: "module.contractsReadyReason",
    readyNextActionKey: "module.contractsReadyNext",
  },
  {
    id: "support",
    titleKey: "module.support",
    itemKeys: [
      PREFLIGHT_KEYS.invoiceLogFolder,
      PREFLIGHT_KEYS.contractLogFolder,
      PREFLIGHT_KEYS.clientProfile,
    ],
    workflowKeys: ["clientProfile"],
    relatedWorkflowCommandNames: [],
    readyReasonKey: "module.supportReadyReason",
    readyNextActionKey: "module.supportReadyNext",
  },
];

export function deriveModuleReadiness(
  configStatus: AppConfigStatus | null,
  t: Translator = fallbackT,
): ModuleReadiness[] {
  return definitions.map((definition) => deriveModule(configStatus, definition, t));
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
  t: Translator,
): ModuleReadiness {
  if (!configStatus) {
    return {
      id: definition.id,
      title: t(definition.titleKey),
      status: "not_checked",
      shortReason: t("module.notCheckedReason"),
      nextAction: t("module.notCheckedNext"),
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
      title: t(definition.titleKey),
      status: "not_checked",
      shortReason: t("module.notCheckedReason"),
      nextAction: t("module.notCheckedNext"),
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
      title: t(definition.titleKey),
      status,
      shortReason: moduleReason(definition.id, first, t),
      nextAction: moduleNextAction(definition.id, first, t),
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
      title: t(definition.titleKey),
      status: "needs_attention",
      shortReason: staffMessage(
        blockingWorkflow.message,
        blockingWorkflow.status,
        blockingWorkflow.key,
      ),
      nextAction: t("module.openSetupArea"),
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
      title: t(definition.titleKey),
      status: "needs_attention",
      shortReason: staffMessage(
        warningItems[0].message,
        warningItems[0].status,
        warningItems[0].key,
      ),
      nextAction: t("module.reviewConvenient"),
      relatedWorkflowCommandNames: definition.relatedWorkflowCommandNames,
      blockingProblems: [],
      warnings: warningItems.map((item) =>
        staffMessage(item.message, item.status, item.key),
      ),
    };
  }

  return {
    id: definition.id,
    title: t(definition.titleKey),
    status: "ready",
    shortReason: t(definition.readyReasonKey),
    nextAction: t(definition.readyNextActionKey),
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

function moduleReason(moduleId: ModuleReadinessId, item: PreflightItem, t: Translator) {
  if (item.itemType === "script") {
    if (moduleId === "scanCopy" || moduleId === "ocr") {
      return t("module.scanToolMissing");
    }
    if (moduleId === "contracts") {
      return t("module.contractsNeedOcr");
    }
    return t("module.toolMissing");
  }

  if (item.itemType === "folder") {
    if (item.key === "scansioniNetworkShare") {
      return t("module.sharedScanMissing");
    }
    if (item.key === "gmailTokenFolder") {
      return t("module.gmailFolderMissing");
    }
    return t("module.folderMissing");
  }

  if (item.key === "automationConfigPath") {
    return t("module.setupUnsaved");
  }
  if (item.key === "gmailCredentialsFile") {
    return item.message.toLowerCase().includes("not found")
      ? t("module.gmailCredentialsMissing")
      : t("module.gmailCredentialsChoose");
  }
  if (item.key === "gmailTokenAlignment") {
    return t("module.gmailPathsMismatch");
  }
  if (item.key === "pythonExecutable") {
    return t("module.pythonUnavailable");
  }

  return staffMessage(item.message, item.status, item.key);
}

function moduleNextAction(moduleId: ModuleReadinessId, item: PreflightItem, t: Translator) {
  if (item.key === "automationConfigPath") {
    return t("module.saveSetup");
  }
  if (item.key === "scansioniNetworkShare") {
    return t("module.chooseSharedScan");
  }
  if (item.key === "gmailTokenFolder") {
    return t("module.createFoldersCheck");
  }
  if (item.key === "gmailCredentialsFile") {
    return t("module.chooseGmailOrPrepare");
  }
  if (item.key === "gmailTokenAlignment") {
    return t("module.checkGmailPath");
  }
  if (item.itemType === "folder") {
    return t("module.createFoldersFromSetup");
  }
  if (item.itemType === "script") {
    if (moduleId === "scanCopy" || moduleId === "ocr" || moduleId === "contracts") {
      return t("module.configureScanTool");
    }
    return t("module.configureTool");
  }
  if (item.key === "pythonExecutable") {
    return t("module.installPython");
  }
  return t("module.openSetupArea");
}

export function moduleStatusLabel(status: ModuleReadinessStatus, t: Translator = fallbackT) {
  switch (status) {
    case "ready":
      return t("common.ready");
    case "needs_attention":
      return t("common.needsAttention");
    case "not_configured":
      return t("common.notChecked");
    case "blocked":
      return t("common.cannotRunYet");
    case "not_checked":
      return t("common.notChecked");
  }
}
