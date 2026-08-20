import type { LucideIcon } from "lucide-react";

export type RunStatus = "idle" | "success" | "warning" | "error";
export type ActivityStatus =
  | "success"
  | "needs_attention"
  | "failed"
  | "cancelled"
  | "unknown";
export type ActivityMode = "dry_run" | "execute" | "unknown";

export type AppPage =
  | "home"
  | "automations"
  | "activity"
  | "assistant"
  /** Formerly "Setup". After onboarding its job is reporting status, not configuring. */
  | "system"
  | "settings"
  | "support"
  /** "How InnPilot works" — the plain-language explanation of the whole flow. */
  | "guide";

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

export type InvoiceDeliveryMode =
  | "prepareOnly"
  | "gmailDrafts"
  | "sendAutomatically";

export type InvoiceFileSelectionMode =
  | "allPdfs"
  | "filenamePatterns";

export type AppLanguage = "en" | "it";

export type SetupMode = "newWorkspace" | "existingFolders";

export type ExistingFolderRole =
  | "invoiceInputFolder"
  | "invoiceOutputFolder"
  | "invoiceArchiveFolder"
  | "invoiceLogFolder"
  | "gmailCredentialsFolder"
  | "gmailTokenFolder"
  | "scansioniNetworkShare"
  | "scansioniLocalCacheFolder"
  | "ocrTextOutputFolder"
  | "contractsOutputFolder"
  | "contractLogFolder";

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

export type ActivityRecord = {
  id: string;
  workflowCommandName: string;
  workflowTitle: string;
  startedAt: string;
  finishedAt: string;
  status: ActivityStatus;
  mode: ActivityMode;
  summary: Record<string, number>;
  warningsCount: number;
  errorsCount: number;
  warnings: string[];
  errors: string[];
  reportPath?: string | null;
  logPath?: string | null;
  createdAt: string;
  technicalSnippet: string[];
};

/** Editable output templates, stored locally in config.json. */
export type OutputTemplates = {
  gmailDraftSubject: string;
  gmailDraftBody: string;
  emailSignature: string;
};

export type ClientBranding = {
  palette: string;
  logoPath: string;
  primaryColor: string;
  accentColor: string;
  backgroundStyle: string;
  watermarkEnabled: boolean;
  watermarkOpacity: number;
};

export type HubConfig = {
  schemaVersion: number;
  language: AppLanguage;
  client: {
    displayName: string;
    branding: ClientBranding;
  };
  invoiceDeliveryMode: InvoiceDeliveryMode;
  invoiceFileSelectionMode: InvoiceFileSelectionMode;
  automation: {
    automationRootFolder: string;
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
  templates: OutputTemplates;
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
  targetRevision: string;
  workspaceBase: string;
  folderPlan: SetupFolderPlanItem[];
  appConfigPreview: HubConfig;
  automationConfigPreview: unknown;
  warnings: string[];
};

export type SetupSnapshot = {
  draft: import("./components/SetupWizard/setupDraft").SetupDraft;
  revision: string;
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
  revision: string;
};

export type ManagedAutomationInstallResult = {
  sourceRoot: string;
  destinationRoot: string;
  copied: string[];
  skipped: string[];
  backedUp: string[];
  errors: string[];
  configPath?: string | null;
  preflight?: PreflightReport | null;
};

export type FolderCandidate = {
  path: string;
  name: string;
  suggestedRole?: ExistingFolderRole | string | null;
  confidence: number;
  reason: string;
};

export type FolderInspection = {
  selectedPath: string;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  parent?: string | null;
  parentName?: string | null;
  nearbyFolders: FolderCandidate[];
  childFolders: FolderCandidate[];
  fileCountsByExtension: Record<string, number>;
  pdfCount: number;
  txtCount: number;
  jsonCount: number;
  recentModifiedPreview: string[];
  warnings: string[];
  suggestedRole?: ExistingFolderRole | string | null;
  confidence?: number | null;
};

export type DiscoveryRequest = {
  id: string;
  description: string;
  suggestedSteps: string[];
  status: "open" | "in_progress" | "completed";
  createdAt: string;
  dataLocation: "local_app_data";
};

export type RecoveryPoint = {
  id: string;
  createdAt: string;
  appVersion: string;
  integrity: "ready" | "damaged";
  includesAppConfig: boolean;
  includesAutomationConfig: boolean;
  includesRunnerLedger: boolean;
};

export type RecoveryStatus = {
  points: RecoveryPoint[];
  retentionLimit: number;
  excludedData: string[];
};

export type RecoveryActionResult = {
  point: RecoveryPoint;
  preRestorePointId?: string | null;
  restoredConfiguration: boolean;
};

export type DesktopServiceStatus = {
  launchAtSignIn: boolean;
  keepsRunningWhenClosed: boolean;
  changesAvailable: boolean;
};

/* ---------------------------------------------------------------------------
   Local agent (MCP) and bounded discovery.

   These mirror the Rust views returned by get_local_agent_connection and
   get_environment_discovery_status. They are backend truth: the UI renders
   them and never recomputes eligibility, validity or readiness from them.
   --------------------------------------------------------------------------- */

export type LocalAgentConnectionState = "notConnected" | "connected" | "expired";

export type LocalAgentConnectionStatus = {
  state: LocalAgentConnectionState;
  profileId: string | null;
  scopes: string[];
  createdAt: string | null;
  expiresAt: string | null;
  lastActivityAt: string | null;
  lastTool: string | null;
  lastClientName: string | null;
  lastProtocolVersion: string | null;
  helperAvailable: boolean;
  codexAddCommand: string | null;
  codexConfigToml: string | null;
  connectionIsReadOnly: boolean;
};

export type DiscoveryScopeRoot = {
  rootId: string;
  displayLabel: string;
  localPath: string;
};

export type DiscoveryScope = {
  scopeId: string;
  revision: number;
  state: "active" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  roots: DiscoveryScopeRoot[];
};

export type DiscoverySnapshotInfo = {
  snapshotId: string;
  createdAt: string;
  expiresAt: string;
  digest: string;
  truncated: boolean;
};

export type ManagerSetupProposal = {
  proposalId: string;
  revision: number;
  status: string;
  targetConfigurationRevision: string;
  changedFields: string[];
  warnings: string[];
  unresolvedQuestions: string[];
  agentConfidence: number | null;
  proposalDigest: string;
  createdAt: string;
  invalidationReason: string | null;
  localPaths: Array<{ field: string; localPath: string; evidenceRef: string }>;
  reviewOnly: boolean;
  mutationPerformed: boolean;
};

export type ManagerProposalReviewField = {
  field: string;
  currentValue: string;
  proposedValue: string;
  evidence: string;
  validation: string;
};

export type ManagerProposalReview = {
  fields: ManagerProposalReviewField[];
  willNotChange: string[];
  /** Authoritative. The approve button is enabled only when the backend says so. */
  approvalEligible: boolean;
};

export type ManagerProposalApplySummary = {
  proposalId: string;
  operationId: string;
  status: string;
  approvedAt: string;
  completedAt: string | null;
  deferredItems: string[];
  blockerKeys: string[];
  safeFailureCode: string | null;
};

export type DiscoveryManagerView = {
  discovery: {
    scope: DiscoveryScope | null;
    lastSnapshot: DiscoverySnapshotInfo | null;
    privacySummary: string;
  };
  proposal: ManagerSetupProposal | null;
  review: ManagerProposalReview | null;
  application: ManagerProposalApplySummary | null;
};

export type ProposalApplyResult = {
  outcome: "ready" | "readyWithDeferredItems" | "rolledBack" | "failedRecoverable" | "replayed";
  proposalId: string;
  operationId: string;
  deferredItems: string[];
  blockerKeys: string[];
};

export type LifeDeskConnectionState = "notConnected" | "pairingIncomplete" | "connected";

export type LifeDeskConnectionStatus = {
  state: LifeDeskConnectionState;
  installationLabel?: string | null;
  keyFingerprintShort?: string | null;
  pairedAt?: string | null;
  lastSyncAt?: string | null;
  protocolVersion: number;
  privateKeyProtection: "windowsCurrentUser";
};
