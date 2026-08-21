/*
  Synthetic fixtures for the visual preview harness.

  Deliberately fictional: a made-up hotel, made-up folders under a fake drive,
  and invented identifiers. Nothing here touches a real installation, and the
  harness is never bundled into the desktop app (see preview.html, which is
  excluded from the Tauri build).
*/

import type {
  ActivityRecord,
  AppConfigStatus,
  DiscoveryManagerView,
  LifeDeskConnectionStatus,
  LocalAgentConnectionStatus,
  ModuleReadiness,
} from "../src/types";
import type { OnboardingSnapshot, OnboardingState } from "../src/onboarding";

export const HOTEL = "Hotel Esempio";

export const configStatus: AppConfigStatus = {
  configPath: "D:\\ExampleHotel\\innpilot\\config.json",
  config: {
    schemaVersion: 3,
    language: "en",
    client: {
      displayName: HOTEL,
      branding: {
        palette: "innpilotDefault",
        logoPath: "",
        primaryColor: "",
        accentColor: "",
        backgroundStyle: "soft",
        watermarkEnabled: true,
        watermarkOpacity: 6,
      },
    },
    invoiceDeliveryMode: "gmailDrafts",
    invoiceFileSelectionMode: "allPdfs",
    automation: {
      automationRootFolder: "D:\\ExampleHotel\\automation",
      automationConfigPath: "D:\\ExampleHotel\\automation\\config.json",
      pythonExecutable: "D:\\ExampleHotel\\innpilot-worker.exe",
    },
    scripts: {
      invoiceWorkflowScript: "invoices.py",
      gmailDraftScript: "drafts.py",
      copyScansioniScript: "scans.py",
      ocrPreprocessingScript: "ocr.py",
      contractProcessingScript: "contracts.py",
    },
    folders: {
      invoiceInputFolder: "D:\\ExampleHotel\\Amministrazione\\Fatture\\In arrivo",
      invoiceOutputFolder: "D:\\ExampleHotel\\Amministrazione\\Fatture\\Pronte",
      invoiceArchiveFolder: "D:\\ExampleHotel\\Amministrazione\\Fatture\\Archivio",
      invoiceLogFolder: "D:\\ExampleHotel\\Amministrazione\\Fatture\\Registro",
      scansioniNetworkShare: "\\\\example-nas\\Scansioni",
      scansioniLocalCacheFolder: "D:\\ExampleHotel\\Scansioni",
      ocrTextOutputFolder: "D:\\ExampleHotel\\Scansioni\\Testo",
      contractsOutputFolder: "D:\\ExampleHotel\\Contratti\\Firmati",
      contractLogFolder: "D:\\ExampleHotel\\Contratti\\Registro",
    },
    gmail: { tokenPath: "D:\\ExampleHotel\\innpilot\\gmail.json" },
    safety: { dryRunDefault: true, requireConfirmationForFileMoves: true, redactLogs: true },
    templates: { gmailDraftSubject: "", gmailDraftBody: "", emailSignature: "" },
  },
  preflight: {
    checkedAt: "2026-08-20T09:14:00Z",
    items: [
      {
        key: "invoiceInputFolder",
        label: "Incoming invoices",
        path: "D:\\ExampleHotel\\Amministrazione\\Fatture\\In arrivo",
        itemType: "folder",
        status: "ready",
        message: "Folder is available.",
      },
      {
        key: "gmailTokenPath",
        label: "Gmail sign-in",
        path: "D:\\ExampleHotel\\innpilot\\gmail.json",
        itemType: "file",
        status: "warning",
        message: "Gmail needs to be reconnected before drafts can be created.",
      },
    ],
    workflows: [
      {
        key: "invoices",
        label: "Invoices",
        commandName: "run_invoice_workflow",
        status: "ready",
        canRun: true,
        message: "Ready",
        checkKeys: ["invoiceInputFolder"],
      },
    ],
    dependencies: [],
  },
};

export const modulesReady: ModuleReadiness[] = [
  {
    id: "invoices",
    title: "Invoices",
    status: "ready",
    shortReason: "",
    nextAction: "",
    relatedWorkflowCommandNames: ["run_invoice_workflow"],
    blockingProblems: [],
    warnings: [],
  },
  {
    id: "contracts",
    title: "Signed documents",
    status: "ready",
    shortReason: "",
    nextAction: "",
    relatedWorkflowCommandNames: ["run_contract_workflow"],
    blockingProblems: [],
    warnings: [],
  },
];

export const modulesScans: ModuleReadiness[] = [
  {
    id: "scanCopy",
    title: "Reception scans",
    status: "ready",
    shortReason: "",
    nextAction: "",
    relatedWorkflowCommandNames: ["copy_scansioni"],
    blockingProblems: [],
    warnings: [],
  },
  {
    id: "ocr",
    title: "Document reading",
    status: "ready",
    shortReason: "",
    nextAction: "",
    relatedWorkflowCommandNames: ["run_ocr_preprocessing"],
    blockingProblems: [],
    warnings: [],
  },
];

export const modulesAttention: ModuleReadiness[] = [
  ...modulesScans,
  ...modulesReady,
  {
    id: "gmailDrafts",
    title: "Gmail drafts",
    status: "needs_attention",
    shortReason: "Gmail needs reconnection",
    nextAction: "Reconnect Gmail so drafts can be prepared again.",
    relatedWorkflowCommandNames: ["reconnect_gmail"],
    blockingProblems: [],
    warnings: ["Token expired"],
  },
];

export const activity: ActivityRecord[] = [
  {
    id: "a1",
    workflowCommandName: "run_invoice_workflow",
    workflowTitle: "Invoices",
    startedAt: "2026-08-19T07:02:00Z",
    finishedAt: "2026-08-19T07:03:12Z",
    status: "success",
    mode: "dry_run",
    summary: { processed: 14 },
    warningsCount: 0,
    errorsCount: 0,
    warnings: [],
    errors: [],
    reportPath: "D:\\ExampleHotel\\reports\\2026-08-19.html",
    logPath: null,
    createdAt: "2026-08-19T07:03:12Z",
    technicalSnippet: ["exit=0"],
  },
  {
    id: "a2",
    workflowCommandName: "run_contract_workflow",
    workflowTitle: "Signed documents",
    startedAt: "2026-08-20T06:40:00Z",
    finishedAt: "2026-08-20T06:41:30Z",
    status: "needs_attention",
    mode: "execute",
    summary: { found: 3 },
    warningsCount: 2,
    errorsCount: 0,
    warnings: ["2 scans could not be recognised"],
    errors: [],
    reportPath: null,
    logPath: null,
    createdAt: "2026-08-20T06:41:30Z",
    technicalSnippet: [],
  },
];

export const agentConnected: LocalAgentConnectionStatus = {
  state: "connected",
  profileId: "example-profile",
  scopes: ["setup.read", "discovery.read", "proposal.write"],
  createdAt: "2026-08-18T10:00:00Z",
  expiresAt: "2026-09-18T10:00:00Z",
  lastActivityAt: "2026-08-20T08:55:00Z",
  lastTool: "innpilot_prepare_setup_proposal",
  lastClientName: "Codex",
  lastProtocolVersion: "2025-06-18",
  helperAvailable: true,
  codexAddCommand: 'codex mcp add innpilot -- "D:\\ExampleHotel\\innpilot-mcp.exe" --profile example-profile',
  codexConfigToml: null,
  connectionIsReadOnly: true,
};

export const agentNotConnected: LocalAgentConnectionStatus = {
  ...agentConnected,
  state: "notConnected",
  profileId: null,
  createdAt: null,
  expiresAt: null,
  lastActivityAt: null,
  lastTool: null,
  lastClientName: null,
  lastProtocolVersion: null,
  codexAddCommand: null,
};

export const agentPrepared: LocalAgentConnectionStatus = {
  ...agentConnected,
  lastActivityAt: null,
  lastTool: null,
  lastClientName: null,
  lastProtocolVersion: null,
};

/**
 * The state a manager actually sits in after pasting the Codex command: the
 * grant exists, but nothing has reached InnPilot yet, so every audit field is
 * still empty.
 */
export const agentPreparedNotReached: LocalAgentConnectionStatus = {
  ...agentConnected,
  lastActivityAt: null,
  lastTool: null,
  lastClientName: null,
  lastProtocolVersion: null,
};

export const lifedeskConnected: LifeDeskConnectionStatus = {
  state: "connected",
  installationLabel: "Reception PC",
  keyFingerprintShort: "b41f9c2e",
  pairedAt: "2026-07-02T12:00:00Z",
  lastSyncAt: "2026-08-20T08:30:00Z",
  protocolVersion: 1,
  privateKeyProtection: "windowsCurrentUser",
};

export const discoveryWithProposal: DiscoveryManagerView = {
  discovery: {
    scope: {
      scopeId: "scope_7f21",
      revision: 2,
      state: "active",
      createdAt: "2026-08-20T08:40:00Z",
      expiresAt: "2026-08-20T10:40:00Z",
      roots: [
        {
          rootId: "r1",
          displayLabel: "Amministrazione",
          localPath: "D:\\ExampleHotel\\Amministrazione",
        },
        { rootId: "r2", displayLabel: "Scansioni", localPath: "D:\\ExampleHotel\\Scansioni" },
      ],
    },
    lastSnapshot: {
      snapshotId: "snap_31ac",
      createdAt: "2026-08-20T08:44:00Z",
      expiresAt: "2026-08-20T09:44:00Z",
      digest: "sha256:9d1c…c07f",
      truncated: false,
    },
    privacySummary: "Folder structure only. No file names or contents were read.",
  },
  proposal: {
    proposalId: "prop_5c8e",
    revision: 1,
    status: "ready_for_review",
    targetConfigurationRevision: "cfg_18",
    changedFields: [
      "invoiceInputFolder",
      "invoiceArchiveFolder",
      "invoiceFileSelectionMode",
      "sharedScanFolder",
      "invoiceDeliveryMode",
    ],
    warnings: ["Gmail is not connected yet, so drafts will be prepared but not created."],
    unresolvedQuestions: [],
    agentConfidence: 0.92,
    proposalDigest: "sha256:4a7b19e0…5f2d",
    createdAt: "2026-08-20T08:46:00Z",
    invalidationReason: null,
    localPaths: [
      {
        field: "invoiceInputFolder",
        localPath: "D:\\ExampleHotel\\Amministrazione\\Fatture\\In arrivo",
        evidenceRef: "ev_11",
      },
    ],
    reviewOnly: true,
    mutationPerformed: false,
  },
  review: {
    fields: [
      {
        field: "invoiceInputFolder",
        currentValue: "—",
        proposedValue: "D:\\ExampleHotel\\Amministrazione\\Fatture\\In arrivo",
        evidence: "Structural snapshot · ev_11",
        validation: "valid",
      },
      {
        field: "invoiceArchiveFolder",
        currentValue: "—",
        proposedValue: "D:\\ExampleHotel\\Amministrazione\\Fatture\\Archivio",
        evidence: "Structural snapshot · ev_12",
        validation: "valid",
      },
      {
        field: "invoiceFileSelectionMode",
        currentValue: "filenamePatterns",
        proposedValue: "allPdfs",
        evidence: "Validated configuration field",
        validation: "valid",
      },
      {
        field: "sharedScanFolder",
        currentValue: "—",
        proposedValue: "\\\\example-nas\\Scansioni",
        evidence: "Structural snapshot · ev_20",
        validation: "valid",
      },
      {
        field: "invoiceDeliveryMode",
        currentValue: "prepareOnly",
        proposedValue: "gmailDrafts",
        evidence: "Validated configuration field",
        validation: "valid",
      },
    ],
    willNotChange: [
      "unrelatedConfigurationPreserved",
      "existingFilesUntouched",
      "scriptsNotExecuted",
      "documentsNotMovedOrDeleted",
      "gmailCredentialsUntouched",
    ],
    approvalEligible: true,
  },
  application: null,
};

export const discoveryChecking: DiscoveryManagerView = {
  discovery: { ...discoveryWithProposal.discovery, lastSnapshot: null },
  proposal: null,
  review: null,
  application: null,
};

export function snapshot(state: OnboardingState, deferredItems: string[] = []): OnboardingSnapshot {
  // A finished installation has no active session — that pairing is what
  // isOnboardingReady() checks, so the fixture has to honour it.
  const active = !["ready", "readyLegacy", "readyWithDeferredItems"].includes(state);
  return {
    schema: "innpilot.onboarding.v1",
    schemaVersion: 1,
    revision: 7,
    state,
    installation: {
      id: "inst_1",
      readiness: active ? "notStarted" : "ready",
      createdAt: "2026-08-18T09:00:00Z",
      updatedAt: "2026-08-20T08:46:00Z",
      migratedLegacyInstallation: false,
      legacyStorageMigration: "alreadyAuthoritative",
      lastCompletedSession: null,
    },
    activeSession: !active
      ? null
      : {
      id: "sess_1",
      state,
      mode: "agentAssisted",
      origin: "freshInstall",
      createdAt: "2026-08-20T08:30:00Z",
      updatedAt: "2026-08-20T08:46:00Z",
      baseConfigRevision: "cfg_17",
      manualProgress: null,
      createdFolders: [],
      failureCode: state === "failedRecoverable" ? "validation_failed" : null,
      deferredItems,
      verifiedConfigRevision: null,
      applyIntent: null,
    },
    events: [],
    recoveredFromBackup: false,
    etag: "etag_1",
  };
}
