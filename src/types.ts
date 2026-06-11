import type { LucideIcon } from "lucide-react";

export type RunStatus = "idle" | "success" | "warning" | "error";

export type AppPage = "home" | "automations" | "setup" | "activity" | "support";

export type ReadinessStatus =
  | "ready"
  | "warning"
  | "missingConfiguration"
  | "missingScript"
  | "missingFolder"
  | "permissionProblem"
  | "notChecked";

export type WorkflowStatus = ReadinessStatus;

export type ModuleReadinessStatus =
  | "ready"
  | "needs_attention"
  | "not_configured"
  | "blocked"
  | "not_checked";

export type ModuleReadinessId =
  | "invoices"
  | "gmailDrafts"
  | "scanCopy"
  | "ocr"
  | "contracts"
  | "support";

export type ModuleReadiness = {
  id: ModuleReadinessId;
  title: string;
  status: ModuleReadinessStatus;
  shortReason: string;
  nextAction: string;
  relatedWorkflowCommandNames: string[];
  blockingProblems: string[];
  warnings: string[];
};

export type RunStep = {
  name: string;
  exit_code: number;
};

export type StepResult = RunStep;

export type RunSummary = {
  automation_name: string;
  command_name: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  exit_code: number;
  status: Exclude<RunStatus, "idle">;
  steps: RunStep[];
  last_output_lines: string[];
};

export type CommandEvent = {
  command_name: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
  timestamp: string;
};

export type LatestLog = {
  key: string;
  label: string;
  path?: string | null;
  modified?: string | null;
};

export type LogInfo = LatestLog;

export type HubConfig = {
  schemaVersion: number;
  client: {
    displayName: string;
  };
  automation: {
    automationConfigPath: string;
    pythonExecutable: string;
  };
  scripts: {
    invoiceWorkflowScript: string;
    gmailDraftScript: string;
    copyScansioniScript: string;
    ocrPreprocessingScript: string;
    contractProcessingScript: string;
  };
  folders: {
    invoiceInputFolder: string;
    invoiceOutputFolder: string;
    invoiceArchiveFolder: string;
    invoiceLogFolder: string;
    scansioniNetworkShare: string;
    scansioniLocalCacheFolder: string;
    ocrTextOutputFolder: string;
    contractsOutputFolder: string;
    contractLogFolder: string;
  };
  gmail: {
    tokenPath: string;
  };
  safety: {
    dryRunDefault: boolean;
    requireConfirmationForFileMoves: boolean;
    redactLogs: boolean;
  };
};

export type PreflightItem = {
  key: string;
  label: string;
  path?: string | null;
  itemType: string;
  status: ReadinessStatus;
  message: string;
  readable?: boolean | null;
  writable?: boolean | null;
};

export type WorkflowPreflight = {
  key: string;
  label: string;
  commandName?: string | null;
  status: ReadinessStatus;
  canRun: boolean;
  message: string;
  checkKeys: string[];
};

export type PreflightReport = {
  checkedAt: string;
  items: PreflightItem[];
  workflows: WorkflowPreflight[];
  dependencies: PreflightItem[];
};

export type AppConfigStatus = {
  configPath: string;
  config: HubConfig;
  preflight: PreflightReport;
};

export type AutomationAction = {
  label: string;
  commandName: string;
  workflowKey: string;
  icon: LucideIcon;
  requiresConfirmation?: boolean;
  confirmationTitle: string;
  confirmationMessage: string;
};

export type SetupFolderPlanItem = {
  label: string;
  path: string;
  status: string;
  message: string;
};

export type SetupPreview = {
  workspaceBase: string;
  folderPlan: SetupFolderPlanItem[];
  appConfigPreview: HubConfig;
  automationConfigPreview: unknown;
  warnings: string[];
};

export type SetupFolderActionResult = {
  label: string;
  path: string;
  action: string;
  message: string;
};

export type WorkspaceInitResult = {
  folders: SetupFolderActionResult[];
  warnings: string[];
};

export type SaveSetupResult = {
  appConfigPath: string;
  automationConfigPath: string;
  backups: string[];
  validation: PreflightReport;
};
