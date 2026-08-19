import { invoke } from "@tauri-apps/api/core";

import type { AppPage } from "./types";
import type { SetupDraft } from "./components/SetupWizard/setupDraft";

export const LEGACY_ONBOARDING_STORAGE_KEY = "innpilot.setup-session.v1";

export type OnboardingState =
  | "notStarted"
  | "bootstrapCreated"
  | "waitingForAgent"
  | "agentConnected"
  | "scopeApprovalRequired"
  | "discoveryRunning"
  | "needsUserInput"
  | "proposalReady"
  | "waitingForApproval"
  | "applying"
  | "verifying"
  | "ready"
  | "readyWithDeferredItems"
  | "failedRecoverable"
  | "rolledBack"
  | "readyLegacy";

export type InstallationReadiness =
  | "notStarted"
  | "ready"
  | "readyWithDeferredItems"
  | "readyLegacy";

export type OnboardingMode = "manual" | "agentAssisted";

export type OnboardingOrigin =
  | "freshInstall"
  | "legacyReadyMigration"
  | "legacyIncompleteMigration"
  | "legacyDraftImport"
  | "manualReview"
  | "manualRestart";

export type LegacyStorageMigration =
  | "notSeen"
  | "imported"
  | "discardedStale"
  | "discardedInvalid"
  | "alreadyAuthoritative";

export type OnboardingCompletedAction =
  | "preview"
  | "initialize"
  | "save"
  | "validate";

export type ManualSetupCheckpoint = {
  draft: SetupDraft;
  stepKey: string;
  showAdvancedWorkflows: boolean;
  completedActions: OnboardingCompletedAction[];
};

export type CreatedFolderEvidence = {
  path: string;
  workspaceBase: string;
  recordedAt: string;
};

export type ApplyIntent = {
  operationId: string;
  payloadDigest: string;
  baseConfigRevision: string;
  targetConfigRevision: string;
  recoveryPointId: string | null;
  workspaceInitialized: boolean;
};

export type OnboardingSession = {
  id: string;
  state: OnboardingState;
  mode: OnboardingMode;
  origin: OnboardingOrigin;
  createdAt: string;
  updatedAt: string;
  baseConfigRevision: string;
  manualProgress: ManualSetupCheckpoint | null;
  createdFolders: CreatedFolderEvidence[];
  failureCode: string | null;
  deferredItems: string[];
  verifiedConfigRevision: string | null;
  applyIntent: ApplyIntent | null;
};

export type CompletedOnboardingSession = {
  id: string;
  completedAt: string;
  resultingConfigRevision: string;
  state: OnboardingState;
  operationId: string | null;
  payloadDigest: string | null;
};

export type InstallationOnboarding = {
  id: string;
  readiness: InstallationReadiness;
  createdAt: string;
  updatedAt: string;
  migratedLegacyInstallation: boolean;
  legacyStorageMigration: LegacyStorageMigration;
  lastCompletedSession: CompletedOnboardingSession | null;
};

export type OnboardingEvent = {
  revision: number;
  at: string;
  code: string;
  fromState: OnboardingState | null;
  toState: OnboardingState;
  source: string;
};

export type OnboardingSnapshot = {
  schema: "innpilot.onboarding.v1";
  schemaVersion: 1;
  revision: number;
  state: OnboardingState;
  installation: InstallationOnboarding;
  activeSession: OnboardingSession | null;
  events: OnboardingEvent[];
  recoveredFromBackup: boolean;
  etag: string;
};

export type OnboardingFailureCode =
  | "manual_apply_failed"
  | "folder_initialization_failed"
  | "validation_failed"
  | "interrupted_apply"
  | "persistence_failed";

export type OnboardingErrorShape = {
  code: string;
  message: string;
  recoverable: boolean;
  currentRevision: number | null;
};

export type WorkspaceErrorShape = {
  code: string;
  category: string;
  summary: string;
  retry: "never" | "retry" | "refresh" | "userAction" | "recovery";
  refreshRequired: boolean;
  details: unknown;
};

export class OnboardingCommandError extends Error implements OnboardingErrorShape {
  readonly code: string;
  readonly recoverable: boolean;
  readonly currentRevision: number | null;

  constructor(error: OnboardingErrorShape) {
    super(error.message);
    this.name = "OnboardingCommandError";
    this.code = error.code;
    this.recoverable = error.recoverable;
    this.currentRevision = error.currentRevision;
  }
}

const READY_STATES = new Set<OnboardingState>([
  "ready",
  "readyLegacy",
  "readyWithDeferredItems",
]);

const STATE_INTEGRITY_ERROR_CODES = new Set([
  "corrupt_state",
  "future_schema",
  "missing_primary",
  "state_missing",
  "state_oversized",
]);

let initialStatePromise: Promise<OnboardingSnapshot> | null = null;

/** Dedupe the React StrictMode startup probe without caching later refreshes. */
export function getInitialOnboardingState() {
  initialStatePromise ??= loadInitialOnboardingState().finally(() => {
    initialStatePromise = null;
  });
  return initialStatePromise;
}

export function getOnboardingState() {
  return invokeSnapshot("get_onboarding_state");
}

export function beginOrResumeOnboarding(
  mode: OnboardingMode,
  expectedRevision: number,
  requestId = createOnboardingRequestId("begin"),
) {
  return invokeSnapshot("begin_or_resume_onboarding", {
    mode,
    expectedRevision,
    requestId,
  });
}

export function recordOnboardingProgress(
  checkpoint: ManualSetupCheckpoint,
  expectedRevision: number,
  requestId = createOnboardingRequestId("progress"),
) {
  return invokeSnapshot("record_onboarding_progress", {
    checkpoint,
    expectedRevision,
    requestId,
  });
}

export function markOnboardingFailed(
  expectedRevision: number,
  failureCode: OnboardingFailureCode,
  requestId = createOnboardingRequestId("failed"),
) {
  return invokeSnapshot("mark_onboarding_failed", {
    expectedRevision,
    failureCode,
    requestId,
  });
}

export function restartOnboarding(
  mode: OnboardingMode,
  expectedRevision: number,
  requestId = createOnboardingRequestId("restart"),
) {
  return invokeSnapshot("restart_onboarding", {
    mode,
    expectedRevision,
    requestId,
  });
}

export function importLegacyOnboardingProgress(
  rawJson: string,
  expectedRevision: number,
  requestId = createOnboardingRequestId("legacy"),
) {
  return invokeSnapshot("import_legacy_onboarding_progress", {
    rawJson,
    expectedRevision,
    requestId,
  });
}

export function recoverOnboardingState() {
  return invokeSnapshot("recover_onboarding_state");
}

export function initialPageForOnboarding(snapshot: OnboardingSnapshot): AppPage {
  return isOnboardingReady(snapshot) ? "home" : "setup";
}

export function isOnboardingReady(snapshot: OnboardingSnapshot) {
  return READY_STATES.has(snapshot.state) && snapshot.activeSession === null;
}

export function onboardingErrorNeedsSupport(error: unknown) {
  const normalized = normalizeOnboardingError(error);
  return (
    STATE_INTEGRITY_ERROR_CODES.has(normalized.code) ||
    normalized.code.includes("schema") ||
    normalized.code.includes("corrupt") ||
    normalized.code.includes("future")
  );
}

export function normalizeOnboardingError(error: unknown): OnboardingCommandError {
  if (error instanceof OnboardingCommandError) return error;

  const candidate = parseUnknownError(error);
  if (isOnboardingErrorShape(candidate)) {
    return new OnboardingCommandError(candidate);
  }
  if (isWorkspaceErrorShape(candidate)) {
    return new OnboardingCommandError({
      code: candidate.code,
      message: candidate.summary,
      recoverable: candidate.retry !== "never",
      currentRevision: onboardingRevisionFromDetails(candidate.details),
    });
  }

  if (error instanceof Error) {
    return new OnboardingCommandError({
      code: "bridge_error",
      message: error.message,
      recoverable: true,
      currentRevision: null,
    });
  }

  return new OnboardingCommandError({
    code: "bridge_error",
    message: typeof error === "string" ? error : "InnPilot could not read onboarding state.",
    recoverable: true,
    currentRevision: null,
  });
}

export function commandErrorMessage(
  error: unknown,
  fallback = "InnPilot could not complete the request.",
) {
  const message = normalizeOnboardingError(error).message.trim();
  return message || fallback;
}

export function createOnboardingRequestId(operation: string) {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `ui-${operation}-${randomPart}`;
}

/** Read the retired value verbatim; parsing and trust decisions belong to Rust. */
export function readRawLegacyOnboardingProgress() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LEGACY_ONBOARDING_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Retire only the known setup key, and only after a confirmed backend response. */
export function retireRawLegacyOnboardingProgress() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
  } catch {
    // The backend remains authoritative if WebView storage is unavailable.
  }
}

async function loadInitialOnboardingState() {
  let snapshot = await getOnboardingState();
  const rawLegacyProgress = readRawLegacyOnboardingProgress();
  if (rawLegacyProgress === null) return snapshot;
  if (snapshot.installation.legacyStorageMigration !== "notSeen") {
    retireRawLegacyOnboardingProgress();
    return snapshot;
  }

  try {
    snapshot = await importLegacyOnboardingProgress(
      rawLegacyProgress,
      snapshot.revision,
      createOnboardingRequestId("legacy-startup"),
    );
  } catch (error) {
    const normalized = normalizeOnboardingError(error);
    if (normalized.code !== "stale_revision") throw normalized;
    snapshot = await getOnboardingState();
    if (snapshot.installation.legacyStorageMigration === "notSeen") {
      snapshot = await importLegacyOnboardingProgress(
        rawLegacyProgress,
        snapshot.revision,
        createOnboardingRequestId("legacy-startup-retry"),
      );
    }
  }

  // Imported, stale, already-authoritative, and invalid legacy outcomes are
  // all terminal snapshots. A thrown error leaves the key for safe retry.
  retireRawLegacyOnboardingProgress();
  return snapshot;
}

async function invokeSnapshot(
  command: string,
  args?: Record<string, unknown>,
): Promise<OnboardingSnapshot> {
  try {
    const value = await invoke<unknown>(command, args);
    if (!isOnboardingSnapshot(value)) {
      throw new OnboardingCommandError({
        code: "invalid_response",
        message: "InnPilot returned an invalid onboarding response.",
        recoverable: true,
        currentRevision: null,
      });
    }
    return value;
  } catch (error) {
    throw normalizeOnboardingError(error);
  }
}

function isOnboardingSnapshot(value: unknown): value is OnboardingSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.schema === "innpilot.onboarding.v1" &&
    value.schemaVersion === 1 &&
    typeof value.revision === "number" &&
    typeof value.state === "string" &&
    isRecord(value.installation) &&
    (value.activeSession === null || isRecord(value.activeSession)) &&
    Array.isArray(value.events) &&
    typeof value.recoveredFromBackup === "boolean" &&
    typeof value.etag === "string"
  );
}

function parseUnknownError(error: unknown): unknown {
  if (isRecord(error)) return error;
  if (typeof error !== "string") return null;
  try {
    return JSON.parse(error) as unknown;
  } catch {
    return null;
  }
}

function isOnboardingErrorShape(value: unknown): value is OnboardingErrorShape {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.recoverable === "boolean" &&
    (value.currentRevision === null || typeof value.currentRevision === "number")
  );
}

function isWorkspaceErrorShape(value: unknown): value is WorkspaceErrorShape {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "string" &&
    typeof value.category === "string" &&
    typeof value.summary === "string" &&
    typeof value.retry === "string" &&
    typeof value.refreshRequired === "boolean"
  );
}

function onboardingRevisionFromDetails(value: unknown) {
  if (
    !isRecord(value) ||
    value.kind !== "revision" ||
    value.resource !== "onboarding" ||
    typeof value.current !== "string"
  ) {
    return null;
  }
  const revision = Number(value.current);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
