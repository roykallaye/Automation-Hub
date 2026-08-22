import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  FileCheck2,
  FolderTree,
  Mail,
  ReceiptText,
  ScanText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n, type TranslationKey } from "../../i18n";
import {
  beginOrResumeOnboarding,
  commandErrorMessage,
  createOnboardingRequestId,
  getOnboardingState,
  isOnboardingReady,
  normalizeOnboardingError,
  recordOnboardingProgress,
  type ManualSetupCheckpoint,
  type OnboardingSnapshot,
} from "../../onboarding";
import type {
  HubConfig,
  ExistingFolderRole,
  FolderInspection,
  ManagedAutomationInstallResult,
  PreflightReport,
  PreflightItem,
  SaveSetupResult,
  SetupSnapshot,
  WorkflowPreflight,
  WorkspaceInitResult,
} from "../../types";
import { InfoHint } from "../InfoHint";
import { staffMessage } from "../../messages";
import {
  createRuleId,
  createSetupDraft,
  defaultPathsForWorkspace,
  diffSetupDraft,
  managedPythonExecutable,
  repairConcatenatedAbsolutePath,
  type RecipientRuleDraft,
  type SetupDraft,
  workspaceFolders,
} from "./setupDraft";
import {
  FieldLabel,
  inputClassName,
  SetupStep,
  textareaClassName,
} from "./SetupStep";
import { StepProgress, type WizardStepMeta } from "./StepProgress";

const stepDefinitions: { key: string; titleKey: TranslationKey }[] = [
  { key: "welcome", titleKey: "wizard.stepWelcome" },
  { key: "mode", titleKey: "wizard.stepFolderMode" },
  { key: "profile", titleKey: "wizard.stepProfile" },
  { key: "workspace", titleKey: "wizard.stepWorkspace" },
  { key: "folders", titleKey: "wizard.stepFolders" },
  { key: "gmail", titleKey: "wizard.stepGmail" },
  { key: "invoices", titleKey: "wizard.stepInvoices" },
  { key: "contracts", titleKey: "wizard.stepContracts" },
  { key: "safety", titleKey: "wizard.stepSafety" },
  { key: "review", titleKey: "wizard.stepReview" },
  { key: "finish", titleKey: "wizard.stepFinish" },
];

type PathFieldKey =
  | "workspaceBase"
  | "invoiceInputFolder"
  | "invoiceOutputFolder"
  | "invoiceArchiveFolder"
  | "invoiceLogFolder"
  | "gmailCredentialsFile"
  | "gmailTokenFile"
  | "sharedScanFolder"
  | "scansLocalCacheFolder"
  | "ocrTextOutputFolder"
  | "signedContractsOutputFolder"
  | "contractLogFolder";

type ExistingFolderField = Exclude<PathFieldKey, "workspaceBase">;

type FolderInspectionState =
  | { kind: "loading" }
  | { kind: "success"; result: FolderInspection }
  | { kind: "error"; message: string };

type SetupAction = "preview" | "initialize" | "save" | "validate";

type SetupCleanupResult = {
  removed: string[];
  skipped: string[];
  failed: string[];
};

type CleanupCreatedFoldersCommandResult = {
  cleanup: SetupCleanupResult;
  onboarding: OnboardingSnapshot;
};

type ApplyApprovedSetupResult = {
  outcome: "completed" | "replayed" | "workspaceNeedsAttention";
  workspace: WorkspaceInitResult | null;
  save: SaveSetupResult | null;
  onboarding: OnboardingSnapshot;
};

type WizardBootstrapResult = {
  setupSnapshot: SetupSnapshot;
  onboardingSnapshot: OnboardingSnapshot;
};

export function SetupWizard({
  config,
  onboarding,
  onOnboardingChanged,
  onClose,
  onSetupSaved,
}: {
  config?: HubConfig | null;
  onboarding: OnboardingSnapshot;
  onOnboardingChanged: (snapshot: OnboardingSnapshot) => void;
  onClose: () => void;
  onSetupSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [currentStepKey, setCurrentStepKey] = useState("welcome");
  const [draft, setDraft] = useState<SetupDraft>(() => createSetupDraft(config));
  const [baseRevision, setBaseRevision] = useState<string | null>(null);
  const baseDraftRef = useRef<SetupDraft | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [backendSessionReady, setBackendSessionReady] = useState(false);
  const [showAdvancedWorkflows, setShowAdvancedWorkflows] = useState(false);
  const [setupResult, setSetupResult] = useState<SetupActionResult | null>(null);
  const [setupAction, setSetupAction] = useState<string | null>(null);
  const [inspections, setInspections] = useState<Record<string, FolderInspectionState>>({});
  const [completedActions, setCompletedActions] = useState<SetupAction[]>([]);
  const [createdFolderCount, setCreatedFolderCount] = useState(0);
  const onboardingRef = useRef(onboarding);
  const bootstrapPromiseRef = useRef<Promise<WizardBootstrapResult> | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const progressQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCheckpointRef = useRef<ManualSetupCheckpoint | null>(null);
  const lastScheduledCheckpointRef = useRef<string | null>(null);
  const backendSessionReadyRef = useRef(false);
  const progressPausedRef = useRef(false);
  const pendingApplyRequestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const steps = useMemo<WizardStepMeta[]>(
    () =>
      stepDefinitions
        .filter((step) => step.key !== "folders" || draft.setupMode === "existingFolders")
        .filter((step) => step.key !== "contracts" || showAdvancedWorkflows)
        .map((step) => ({ key: step.key, title: t(step.titleKey) })),
    [draft.setupMode, showAdvancedWorkflows, t],
  );
  const storedStepIndex = steps.findIndex((step) => step.key === currentStepKey);
  const stepIndex = storedStepIndex >= 0 ? storedStepIndex : 0;
  const currentStep = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  useEffect(() => {
    if (onboarding.revision >= onboardingRef.current.revision) {
      onboardingRef.current = onboarding;
    }
  }, [onboarding]);

  useEffect(() => {
    let cancelled = false;
    bootstrapPromiseRef.current ??= bootstrapWizard();
    void bootstrapPromiseRef.current
      .then(({ setupSnapshot, onboardingSnapshot }) => {
        if (cancelled) return;
        baseDraftRef.current = setupSnapshot.draft;
        setBaseRevision(setupSnapshot.revision);

        const session = onboardingSnapshot.activeSession;
        const sessionMatchesConfig =
          session?.baseConfigRevision === setupSnapshot.revision;
        const checkpoint = sessionMatchesConfig ? session?.manualProgress : null;
        if (checkpoint) {
          setDraft(checkpoint.draft);
          setCurrentStepKey(checkpoint.stepKey || "welcome");
          setShowAdvancedWorkflows(checkpoint.showAdvancedWorkflows);
        } else {
          setDraft(setupSnapshot.draft);
          setCurrentStepKey("welcome");
          setShowAdvancedWorkflows(false);
        }

        // Completion display is derived from durable readiness, never a
        // browser claim. Folder cleanup uses only server-recorded evidence.
        setCompletedActions([]);
        setCreatedFolderCount(
          sessionMatchesConfig
            ? session?.createdFolders.length ?? 0
            : 0,
        );
        backendSessionReadyRef.current = true;
        setBackendSessionReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setSetupResult({
          kind: "error",
          title: t("wizard.actionCouldNotFinish"),
          message: normalizeOnboardingError(error).message,
        });
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!steps.some((step) => step.key === currentStepKey)) {
      setCurrentStepKey(steps[0]?.key ?? "welcome");
    }
  }, [currentStepKey, steps]);

  useEffect(() => {
    if (!backendSessionReady) return;
    scheduleOnboardingProgress({
      draft,
      stepKey: currentStepKey,
      showAdvancedWorkflows,
      completedActions: [],
    });
  }, [backendSessionReady, currentStepKey, draft, showAdvancedWorkflows]);

  useEffect(
    () => () => {
      if (progressTimerRef.current !== null) {
        window.clearTimeout(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (backendSessionReadyRef.current) {
        void flushOnboardingProgress().catch(() => undefined);
      }
    },
    [],
  );

  async function moveStep(offset: number) {
    const nextIndex = Math.min(steps.length - 1, Math.max(0, stepIndex + offset));
    const nextStepKey = steps[nextIndex]?.key ?? "welcome";
    setCurrentStepKey(nextStepKey);
    if (!backendSessionReadyRef.current) return;
    scheduleOnboardingProgress(
      {
        draft,
        stepKey: nextStepKey,
        showAdvancedWorkflows,
        completedActions: [],
      },
      0,
    );
    try {
      await flushOnboardingProgress();
    } catch (error) {
      setSetupResult({
        kind: "error",
        title: t("wizard.actionCouldNotFinish"),
        message: normalizeOnboardingError(error).message,
      });
    }
  }

  async function bootstrapWizard(): Promise<WizardBootstrapResult> {
    let setupSnapshot = await invoke<SetupSnapshot>("get_setup_snapshot");
    const onboardingSnapshot = await beginOrAdoptOnboardingSession();
    if (onboardingSnapshot.activeSession?.baseConfigRevision !== setupSnapshot.revision) {
      setupSnapshot = await invoke<SetupSnapshot>("get_setup_snapshot");
      if (onboardingSnapshot.activeSession?.baseConfigRevision !== setupSnapshot.revision) {
        throw normalizeOnboardingError({
          code: "config_changed",
          message: "InnPilot configuration changed while setup was opening. Close and reopen setup.",
          recoverable: true,
          currentRevision: onboardingSnapshot.revision,
        });
      }
    }
    return { setupSnapshot, onboardingSnapshot };
  }

  function acceptOnboardingSnapshot(snapshot: OnboardingSnapshot) {
    onboardingRef.current = snapshot;
    onOnboardingChanged(snapshot);
  }

  async function beginOrAdoptOnboardingSession() {
    try {
      const next = await beginOrResumeOnboarding(
        "manual",
        onboardingRef.current.revision,
      );
      acceptOnboardingSnapshot(next);
      return next;
    } catch (error) {
      const normalized = normalizeOnboardingError(error);
      if (normalized.code !== "stale_revision") throw normalized;
      const latest = await getOnboardingState();
      acceptOnboardingSnapshot(latest);
      if (latest.activeSession) return latest;
      const next = await beginOrResumeOnboarding("manual", latest.revision);
      acceptOnboardingSnapshot(next);
      return next;
    }
  }

  async function runOnboardingMutation(
    operation: (snapshot: OnboardingSnapshot) => Promise<OnboardingSnapshot>,
  ) {
    try {
      const next = await operation(onboardingRef.current);
      acceptOnboardingSnapshot(next);
      return next;
    } catch (error) {
      const normalized = normalizeOnboardingError(error);
      if (normalized.code !== "stale_revision") throw normalized;
      // Refresh only. Never replay a stale semantic payload against the newer
      // revision: an older renderer/window must not overwrite durable state.
      acceptOnboardingSnapshot(await getOnboardingState());
      pendingCheckpointRef.current = null;
      lastScheduledCheckpointRef.current = null;
      progressPausedRef.current = true;
      backendSessionReadyRef.current = false;
      setBackendSessionReady(false);
      throw normalized;
    }
  }

  function scheduleOnboardingProgress(
    checkpoint: ManualSetupCheckpoint,
    delay = 500,
  ) {
    const fingerprint = JSON.stringify(checkpoint);
    if (lastScheduledCheckpointRef.current === fingerprint) return;
    lastScheduledCheckpointRef.current = fingerprint;
    pendingCheckpointRef.current = checkpoint;
    if (progressPausedRef.current) return;
    if (progressTimerRef.current !== null) {
      window.clearTimeout(progressTimerRef.current);
    }
    progressTimerRef.current = window.setTimeout(() => {
      progressTimerRef.current = null;
      void flushOnboardingProgress().catch((error) => {
        setSetupResult({
          kind: "error",
          title: t("wizard.actionCouldNotFinish"),
          message: normalizeOnboardingError(error).message,
        });
      });
    }, delay);
  }

  async function flushOnboardingProgress(): Promise<void> {
    if (progressTimerRef.current !== null) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (progressPausedRef.current) {
      await progressQueueRef.current;
      return;
    }

    const checkpoint = pendingCheckpointRef.current;
    if (checkpoint) {
      pendingCheckpointRef.current = null;
      const fingerprint = JSON.stringify(checkpoint);
      const write = progressQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await runOnboardingMutation(
              (snapshot) =>
                recordOnboardingProgress(
                  checkpoint,
                  snapshot.revision,
                  createOnboardingRequestId("progress"),
                ),
            );
          } catch (error) {
            if (lastScheduledCheckpointRef.current === fingerprint) {
              lastScheduledCheckpointRef.current = null;
            }
            throw error;
          }
        });
      progressQueueRef.current = write;
    }

    await progressQueueRef.current;
    if (pendingCheckpointRef.current && !progressPausedRef.current) {
      await flushOnboardingProgress();
    }
  }

  function update<K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setCompletedActions([]);
    setSetupResult(null);
  }

  function chooseSetupMode(mode: SetupDraft["setupMode"]) {
    setDraft((current) => {
      const defaults = defaultPathsForWorkspace(current.workspaceBase, current.contractYear);
      if (mode === "newWorkspace") {
        const fillIfEmpty = <K extends keyof ReturnType<typeof defaultPathsForWorkspace>>(field: K) =>
          current[field] || defaults[field];
        return {
          ...current,
          setupMode: mode,
          invoiceInputFolder: fillIfEmpty("invoiceInputFolder"),
          invoiceOutputFolder: fillIfEmpty("invoiceOutputFolder"),
          invoiceArchiveFolder: fillIfEmpty("invoiceArchiveFolder"),
          invoiceLogFolder: fillIfEmpty("invoiceLogFolder"),
          gmailCredentialsFile: fillIfEmpty("gmailCredentialsFile"),
          gmailTokenFile: fillIfEmpty("gmailTokenFile"),
          sharedScanFolder: fillIfEmpty("sharedScanFolder"),
          scansLocalCacheFolder: fillIfEmpty("scansLocalCacheFolder"),
          ocrTextOutputFolder: fillIfEmpty("ocrTextOutputFolder"),
          signedContractsOutputFolder: fillIfEmpty("signedContractsOutputFolder"),
          contractLogFolder: fillIfEmpty("contractLogFolder"),
        };
      }

      const clearDefault = <K extends keyof ReturnType<typeof defaultPathsForWorkspace>>(field: K) =>
        current[field] === defaults[field] ? "" : current[field];
      return {
        ...current,
        setupMode: mode,
        invoiceInputFolder: clearDefault("invoiceInputFolder"),
        invoiceOutputFolder: clearDefault("invoiceOutputFolder"),
        invoiceArchiveFolder: clearDefault("invoiceArchiveFolder"),
        invoiceLogFolder: clearDefault("invoiceLogFolder"),
        gmailCredentialsFile: clearDefault("gmailCredentialsFile"),
        gmailTokenFile: clearDefault("gmailTokenFile"),
        sharedScanFolder: clearDefault("sharedScanFolder"),
        scansLocalCacheFolder: clearDefault("scansLocalCacheFolder"),
        ocrTextOutputFolder: clearDefault("ocrTextOutputFolder"),
        signedContractsOutputFolder: clearDefault("signedContractsOutputFolder"),
        contractLogFolder: clearDefault("contractLogFolder"),
      };
    });
    setCompletedActions([]);
    setSetupResult(null);
    setInspections({});
  }

  function updateWorkspaceBase(nextWorkspace: string) {
    const repairedWorkspace = repairConcatenatedAbsolutePath(nextWorkspace);
    setDraft((current) => {
      const oldDefaults = defaultPathsForWorkspace(current.workspaceBase, current.contractYear);
      const nextDefaults = defaultPathsForWorkspace(repairedWorkspace, current.contractYear);
      const defaultManagedFields: (keyof ReturnType<typeof defaultPathsForWorkspace>)[] = [
        "invoiceInputFolder",
        "invoiceOutputFolder",
        "invoiceArchiveFolder",
        "invoiceLogFolder",
        "sharedScanFolder",
        "scansLocalCacheFolder",
        "gmailCredentialsFile",
        "gmailTokenFile",
        "ocrTextOutputFolder",
        "signedContractsOutputFolder",
        "contractLogFolder",
      ];
      const refreshedDefaults = Object.fromEntries(
        defaultManagedFields
          .filter((field) =>
            current.setupMode === "newWorkspace" &&
            (!current[field] || current[field] === oldDefaults[field])
          )
          .map((field) => [field, nextDefaults[field]]),
      ) as Partial<SetupDraft>;

      return {
        ...current,
        workspaceBase: repairedWorkspace,
        ...refreshedDefaults,
      };
    });
    setCompletedActions([]);
    setSetupResult(null);
  }

  async function chooseDirectory(field: PathFieldKey) {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: draft[field] || draft.workspaceBase,
    });
    const selectedPath = normalizeDialogSelection(selected);
    if (!selectedPath) return;
    if (field === "workspaceBase") {
      updateWorkspaceBase(selectedPath);
    } else {
      update(field, normalizePathInput(selectedPath) as SetupDraft[typeof field]);
    }
  }

  async function chooseFile(field: PathFieldKey) {
    const selected = await open({
      directory: false,
      multiple: false,
      defaultPath: draft[field] || draft.workspaceBase,
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    const selectedPath = normalizeDialogSelection(selected);
    if (selectedPath) update(field, normalizePathInput(selectedPath) as SetupDraft[typeof field]);
  }

  async function chooseTokenFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: draft.gmailTokenFile || draft.workspaceBase,
    });
    const selectedPath = normalizeDialogSelection(selected);
    if (selectedPath) update("gmailTokenFile", `${normalizePathInput(selectedPath).replace(/[\\/]+$/g, "")}\\gmail_token.json`);
  }

  async function chooseGmailCredentialsFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: draft.gmailCredentialsFile || draft.workspaceBase,
    });
    const selectedPath = normalizeDialogSelection(selected);
    if (selectedPath) {
      update("gmailCredentialsFile", `${normalizePathInput(selectedPath).replace(/[\\/]+$/g, "")}\\gmail_credentials.json`);
    }
  }

  async function inspectFolder(field: ExistingFolderField, value: string) {
    const path = folderPathForInspection(field, value);
    if (!path.trim()) {
      setInspections((current) => ({
        ...current,
        [field]: { kind: "error", message: t("wizard.discoveryChooseFolderFirst") },
      }));
      return;
    }

    setInspections((current) => ({ ...current, [field]: { kind: "loading" } }));
    try {
      const result = await invoke<FolderInspection>("inspect_existing_folder", { path });
      setInspections((current) => ({ ...current, [field]: { kind: "success", result } }));
    } catch (error) {
      setInspections((current) => ({
        ...current,
        [field]: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }

  function applySuggestedFolder(role: string | null | undefined, path: string) {
    if (!role) return;
    const field = roleToDraftField(role);
    if (!field) return;
    const normalized = normalizePathInput(path);
    if (field === "gmailCredentialsFile") {
      update(field, `${normalized.replace(/[\\/]+$/g, "")}\\gmail_credentials.json`);
    } else if (field === "gmailTokenFile") {
      update(field, `${normalized.replace(/[\\/]+$/g, "")}\\gmail_token.json`);
    } else {
      update(field, normalized as SetupDraft[typeof field]);
    }
  }

  function updateRule(id: string, patch: Partial<RecipientRuleDraft>) {
    setDraft((current) => ({
      ...current,
      recipientRules: current.recipientRules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule,
      ),
    }));
  }

  function addRule() {
    setDraft((current) => ({
      ...current,
      recipientRules: [
        ...current.recipientRules,
        { id: createRuleId(), matchText: "", email: "" },
      ],
    }));
  }

  function removeRule(id: string) {
    setDraft((current) => ({
      ...current,
      recipientRules:
        current.recipientRules.length === 1
          ? current.recipientRules
          : current.recipientRules.filter((rule) => rule.id !== id),
    }));
  }

  function updateList<K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    index: number,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      [key]: current[key].map((item, currentIndex) =>
        currentIndex === index ? value : item,
      ),
    }));
    setCompletedActions([]);
    setSetupResult(null);
  }

  function addListItem<K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    value = "",
  ) {
    setDraft((current) => ({ ...current, [key]: [...current[key], value] }));
    setCompletedActions([]);
    setSetupResult(null);
  }

  function removeListItem<K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    index: number,
  ) {
    setDraft((current) => ({
      ...current,
      [key]: current[key].length === 1
        ? current[key]
        : current[key].filter((_, currentIndex) => currentIndex !== index),
    }));
    setCompletedActions([]);
    setSetupResult(null);
  }

  async function finishSetup() {
    if (!window.confirm(t("wizard.confirmFinishSetup"))) return;

    if (!baseRevision || !baseDraftRef.current) {
      setSetupResult({
        kind: "error",
        title: t("wizard.actionCouldNotFinish"),
        message: "InnPilot has not finished loading the current configuration. Try again.",
      });
      return;
    }

    setSetupAction("finish");
    setSetupResult(null);
    try {
      scheduleOnboardingProgress(
        {
          draft,
          stepKey: currentStepKey,
          showAdvancedWorkflows,
          completedActions: [],
        },
        0,
      );
      await flushOnboardingProgress();
      progressPausedRef.current = true;

      const patch = diffSetupDraft(baseDraftRef.current, draft);
      const fingerprint = JSON.stringify({ patch, baseRevision });
      if (pendingApplyRequestRef.current?.fingerprint !== fingerprint) {
        pendingApplyRequestRef.current = {
          fingerprint,
          requestId: createOnboardingRequestId("apply"),
        };
      }
      /*
        Put the automation scripts on disk before applying.

        The configuration names five script paths under the InnPilot data
        folder, and preflight checks that they exist. Nothing in this wizard
        ever created them, so a manual setup would validate against files that
        could not be there and fail at the last step with a message about
        missing scripts — after the manager had done all the work. Installing
        them here is idempotent, and a failure is reported rather than swallowed
        because it would otherwise resurface as that same confusing error.
      */
      try {
        await invoke<ManagedAutomationInstallResult>("install_managed_automation_scripts", {
          confirmed: true,
        });
      } catch (error) {
        setSetupResult({
          kind: "error",
          title: t("wizard.actionCouldNotFinish"),
          message: normalizeOnboardingError(error).message,
        });
        return;
      }

      const applied = await invoke<ApplyApprovedSetupResult>("apply_approved_setup", {
        request: {
          patch,
          expectedConfigRevision: baseRevision,
          expectedOnboardingRevision: onboardingRef.current.revision,
          approval: "manualUi",
          requestId: pendingApplyRequestRef.current.requestId,
          confirmed: true,
        },
      });
      pendingApplyRequestRef.current = null;
      acceptOnboardingSnapshot(applied.onboarding);

      const workspaceResult = applied.workspace;
      const folders = workspaceResult?.folders ?? [];
      const created = folders.filter(
        (folder) => folder.action === "created",
      ).length;
      const alreadyExists = folders.filter(
        (folder) => folder.action === "alreadyExists",
      ).length;
      const failed = folders.filter(
        (folder) => folder.action === "failed",
      ).length;
      setCreatedFolderCount(
        onboardingRef.current.activeSession?.createdFolders.length ?? created,
      );

      if (applied.outcome === "workspaceNeedsAttention" || failed) {
        const invalidPathFailure = folders.some(
          (folder) =>
            folder.message.includes("os error 123") ||
            folder.message.toLowerCase().includes("invalid path"),
        );
        setCompletedActions(["preview"]);
        setSetupResult({
          kind: "warning",
          title: invalidPathFailure
            ? t("wizard.invalidFolderPath")
            : t("wizard.actionNeedsAttention"),
          message: invalidPathFailure
            ? t("wizard.invalidFolderMessage")
            : t("wizard.foldersNeedAttention", {
                failed,
                folderWord:
                  failed === 1 ? t("wizard.folderSingular") : t("wizard.folderPlural"),
                created,
                alreadyExists,
              }),
        });
        return;
      }

      const result = applied.save;
      const installedSnapshot = result
        ? null
        : await invoke<SetupSnapshot>("get_setup_snapshot");
      backendSessionReadyRef.current = false;
      setBackendSessionReady(false);
      pendingCheckpointRef.current = null;
      baseDraftRef.current = draft;
      setBaseRevision(result?.revision ?? installedSnapshot?.revision ?? baseRevision);
      const blocking = result?.validation.workflows.filter(
        (workflow) => workflow.commandName && !workflow.canRun,
      ).length ?? 0;
      const guidance = result ? validationGuidance(result.validation, t) : "";
      const backupCount = result?.backups.length ?? 0;
      setCompletedActions(
        blocking
          ? ["preview", "initialize", "save"]
          : ["preview", "initialize", "save", "validate"],
      );
      setSetupResult({
        kind: blocking ? "warning" : "success",
        title: blocking ? t("wizard.savedOneStep") : t("wizard.setupReady"),
        message: blocking
          ? `${guidance} ${t("wizard.backupsCreated", {
              count: backupCount,
              backupWord:
                backupCount === 1
                  ? t("wizard.backupSingular")
                  : t("wizard.backupPlural"),
            })}`
          : result
            ? t("wizard.setupSavedBackups", {
                count: backupCount,
                backupWord:
                  backupCount === 1
                    ? t("wizard.backupSingular")
                    : t("wizard.backupPlural"),
              })
            : t("wizard.setupReady"),
      });
      await onSetupSaved();
    } catch (error) {
      try {
        const latest = await getOnboardingState();
        acceptOnboardingSnapshot(latest);
        if (isOnboardingReady(latest)) {
          const installed = await invoke<SetupSnapshot>("get_setup_snapshot");
          pendingApplyRequestRef.current = null;
          baseDraftRef.current = draft;
          setBaseRevision(installed.revision);
          setCompletedActions(["preview", "initialize", "save", "validate"]);
          setSetupResult({
            kind: "success",
            title: t("wizard.setupReady"),
            message: t("wizard.setupReady"),
          });
          await onSetupSaved();
          return;
        }
        if (
          latest.state === "needsUserInput" &&
          latest.activeSession?.failureCode === "interrupted_before_apply"
        ) {
          // The backend proved that the configuration stayed at the base
          // revision. The previous operation is closed; a retry must use a
          // fresh id after the durable checkpoint is saved again.
          pendingApplyRequestRef.current = null;
        }
      } catch {
        // Keep the operation ID for an idempotent retry when the result is uncertain.
      }
      const message = normalizeOnboardingError(error).message;
      const invalidPathMessage =
        message.includes("os error 123") || message.toLowerCase().includes("invalid path")
          ? t("wizard.invalidFolderMessage")
          : message;
      setSetupResult({
        kind: "error",
        title: t("wizard.actionCouldNotFinish"),
        message: invalidPathMessage,
      });
    } finally {
      progressPausedRef.current = false;
      setSetupAction(null);
    }
  }

  async function cleanupCreatedFolders() {
    if (!createdFolderCount) return;
    if (
      !window.confirm(
        t("wizard.confirmCleanup"),
      )
    ) {
      return;
    }

    setSetupAction("cleanup");
    setSetupResult(null);
    try {
      const commandResult = await invoke<CleanupCreatedFoldersCommandResult>(
        "remove_setup_created_empty_folders",
        {
          expectedOnboardingRevision: onboardingRef.current.revision,
          confirmed: true,
        },
      );
      acceptOnboardingSnapshot(commandResult.onboarding);
      const result = commandResult.cleanup;
      setSetupResult({
        kind: result.failed.length ? "warning" : "success",
        title: result.failed.length ? t("wizard.foldersLeftUnchanged") : t("wizard.emptyFoldersRemoved"),
        message: t("wizard.cleanupMessage", {
          removed: result.removed.length,
          skipped: result.skipped.length,
          failed: result.failed.length,
        }),
        details: result,
      });
      setCreatedFolderCount(0);
      setCompletedActions((current) => current.filter((action) => action !== "initialize"));
      await onSetupSaved();
    } catch (error) {
      setSetupResult({
        kind: "error",
        title: t("wizard.cleanupCouldNotFinish"),
        message: commandErrorMessage(error),
      });
    } finally {
      setSetupAction(null);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_1fr]">
      <StepProgress steps={steps} currentIndex={stepIndex} />

      <div className="space-y-4">
        {currentStep.key === "welcome" && (
          <WelcomeStep
            showAdvancedWorkflows={showAdvancedWorkflows}
            onShowAdvancedWorkflows={setShowAdvancedWorkflows}
          />
        )}
        {currentStep.key === "mode" && (
          <FolderModeStep draft={draft} onChooseMode={chooseSetupMode} />
        )}
        {currentStep.key === "profile" && (
          <ProfileStep draft={draft} update={update} />
        )}
        {currentStep.key === "workspace" && (
          <WorkspaceStep
            draft={draft}
            onWorkspaceChange={updateWorkspaceBase}
            onChooseFolder={() => chooseDirectory("workspaceBase")}
          />
        )}
        {currentStep.key === "folders" && (
          draft.setupMode === "existingFolders" ? (
            <ExistingFoldersStep
              draft={draft}
              update={update}
              inspections={inspections}
              onInspect={inspectFolder}
              onApplySuggestion={applySuggestedFolder}
              onChooseDirectory={chooseDirectory}
              onChooseGmailCredentialsFolder={chooseGmailCredentialsFolder}
              onChooseTokenFolder={chooseTokenFolder}
              showAdvancedWorkflows={showAdvancedWorkflows}
            />
          ) : (
            <FolderPreviewStep draft={draft} />
          )
        )}
        {currentStep.key === "gmail" && (
          <GmailStep
            draft={draft}
            update={update}
            onChooseCredentials={() => chooseFile("gmailCredentialsFile")}
            onChooseTokenFolder={chooseTokenFolder}
          />
        )}
        {currentStep.key === "invoices" && (
          <InvoiceRulesStep
            draft={draft}
            update={update}
            updateRule={updateRule}
            addRule={addRule}
            removeRule={removeRule}
            updateList={updateList}
            addListItem={addListItem}
            removeListItem={removeListItem}
          />
        )}
        {currentStep.key === "contracts" && (
          <ContractsStep
            draft={draft}
            update={update}
            onChooseSharedScanFolder={() => chooseDirectory("sharedScanFolder")}
            onChooseOcrTextFolder={() => chooseDirectory("ocrTextOutputFolder")}
            onChooseContractsOutputFolder={() => chooseDirectory("signedContractsOutputFolder")}
            updateList={updateList}
            addListItem={addListItem}
            removeListItem={removeListItem}
          />
        )}
        {currentStep.key === "safety" && <SafetyStep draft={draft} update={update} />}
        {currentStep.key === "review" && <ReviewStep draft={draft} />}
        {currentStep.key === "finish" && (
          <FinishStep
            busy={setupAction === "finish"}
            saved={isOnboardingReady(onboardingRef.current)}
            setupResult={setupResult}
            onFinish={finishSetup}
            disabled={snapshotLoading || !backendSessionReady || !baseRevision}
            onDone={onClose}
            onCleanupCreatedFolders={cleanupCreatedFolders}
            createdFolderCount={createdFolderCount}
          />
        )}

        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lift backdrop-blur-xl">
          <button
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isFirst || snapshotLoading || !backendSessionReady}
            onClick={() => moveStep(-1)}
            type="button"
          >
            {t("wizard.back")}
          </button>
          <p className="hidden text-xs font-semibold text-slate-500 sm:block">
            {t("wizard.progressSaved")}
          </p>
          {!isLast && (
            <button
              className="min-w-32 rounded-lg bg-cta px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-cta-soft"
              disabled={snapshotLoading || !backendSessionReady}
              onClick={() => moveStep(1)}
              type="button"
            >
              {isFirst
                ? t("wizard.startSetup")
                : currentStep.key === "review"
                  ? t("wizard.reviewAndSave")
                  : t("wizard.next")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function validationGuidance(report: PreflightReport, t: ReturnType<typeof useI18n>["t"]) {
  const workflow = report.workflows.find(
    (current) => current.commandName && !current.canRun,
  );
  if (!workflow) return t("wizard.setupReady");

  const item = firstBlockingItem(report, workflow);
  if (!item) return staffMessage(workflow.message, workflow.status, workflow.key);

  if (item.key === "automationConfigPath") {
    return t("setup.saveToFinishDetail");
  }
  if (item.key === "copyScansioniScript" || item.key === "ocrPreprocessingScript") {
    return t("wizard.scanToolsMissing");
  }
  if (item.itemType === "script") {
    return t("setup.scriptsNeedInstallSummary");
  }
  if (item.key === "scansioniNetworkShare") {
    return t("wizard.sharedScanMissing");
  }
  if (item.itemType === "folder") {
    return t("setup.foldersNeedSummary");
  }
  if (item.key === "gmailTokenFolder" || item.key === "gmailTokenAlignment") {
    return t("setup.gmailReviewSummary");
  }
  if (item.key === "pythonExecutable") {
    return t("setup.pythonNeedSummary");
  }
  return staffMessage(item.message, item.status, item.key);
}

function firstBlockingItem(report: PreflightReport, workflow: WorkflowPreflight) {
  return (
    workflow.checkKeys
      .map((key) => report.items.find((item) => item.key === key))
      .find(isBlockingPreflightItem) ?? null
  );
}

function isBlockingPreflightItem(item: PreflightItem | undefined): item is PreflightItem {
  if (!item) return false;
  return ["missingConfiguration", "missingScript", "missingFolder", "permissionProblem"].includes(
    item.status,
  );
}

function normalizeDialogSelection(selected: string | string[] | null) {
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}

function normalizePathInput(value: string) {
  return repairConcatenatedAbsolutePath(value.trim().replace(/^["']|["']$/g, ""));
}

function folderPathForInspection(field: ExistingFolderField, value: string) {
  const normalized = normalizePathInput(value);
  if (field === "gmailCredentialsFile" || field === "gmailTokenFile") {
    return folderFromFileValue(normalized);
  }
  return normalized;
}

function folderFromFileValue(value: string) {
  const cleaned = value.replace(/[\\/]+$/g, "");
  if (!/\.[a-z0-9]+$/i.test(cleaned)) return cleaned;
  const index = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return index > 0 ? cleaned.slice(0, index) : cleaned;
}

function roleToDraftField(role: string): ExistingFolderField | null {
  const mapping: Record<ExistingFolderRole, ExistingFolderField> = {
    invoiceInputFolder: "invoiceInputFolder",
    invoiceOutputFolder: "invoiceOutputFolder",
    invoiceArchiveFolder: "invoiceArchiveFolder",
    invoiceLogFolder: "invoiceLogFolder",
    gmailCredentialsFolder: "gmailCredentialsFile",
    gmailTokenFolder: "gmailTokenFile",
    scansioniNetworkShare: "sharedScanFolder",
    scansioniLocalCacheFolder: "scansLocalCacheFolder",
    ocrTextOutputFolder: "ocrTextOutputFolder",
    contractsOutputFolder: "signedContractsOutputFolder",
    contractLogFolder: "contractLogFolder",
  };
  return role in mapping ? mapping[role as ExistingFolderRole] : null;
}

function roleLabel(role: string | null | undefined, t: ReturnType<typeof useI18n>["t"]) {
  switch (role) {
    case "invoiceInputFolder":
      return t("wizard.existingInvoiceInput");
    case "invoiceOutputFolder":
      return t("wizard.existingInvoiceOutput");
    case "invoiceArchiveFolder":
      return t("wizard.existingInvoiceArchive");
    case "invoiceLogFolder":
      return t("wizard.existingInvoiceLogs");
    case "gmailCredentialsFolder":
      return t("wizard.existingGmailCredentialsFolder");
    case "gmailTokenFolder":
      return t("wizard.existingGmailTokenFolder");
    case "scansioniNetworkShare":
      return t("wizard.existingSharedScans");
    case "scansioniLocalCacheFolder":
      return t("wizard.existingLocalScanCache");
    case "ocrTextOutputFolder":
      return t("wizard.existingOcrTextOutput");
    case "contractsOutputFolder":
      return t("wizard.existingSignedContracts");
    case "contractLogFolder":
      return t("wizard.existingContractLogs");
    default:
      return t("wizard.unknownFolderRole");
  }
}

type SetupActionResult = {
  kind: "success" | "warning" | "error";
  title: string;
  message: string;
  details?: unknown;
};
function WelcomeStep({
  showAdvancedWorkflows,
  onShowAdvancedWorkflows,
}: {
  showAdvancedWorkflows: boolean;
  onShowAdvancedWorkflows: (value: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<Sparkles className="h-6 w-6" />}
      title={t("wizard.setUpTitle")}
      helper={t("wizard.setUpHelper")}
    >
      <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-white/70 bg-white/65 p-4 transition hover:bg-white">
        <span>
          <span className="block text-sm font-bold text-slate-950">
            {t("wizard.advancedLaunchTitle")}
          </span>
          <span className="mt-1 block max-w-2xl text-sm font-medium leading-6 text-slate-600">
            {t("wizard.scopeHelper")}
          </span>
        </span>
        <input
          className="mt-1 h-5 w-5 shrink-0 accent-brand-700"
          type="checkbox"
          checked={showAdvancedWorkflows}
          onChange={(event) => onShowAdvancedWorkflows(event.target.checked)}
        />
      </label>
    </SetupStep>
  );
}

function FolderModeStep({
  draft,
  onChooseMode,
}: {
  draft: SetupDraft;
  onChooseMode: (mode: SetupDraft["setupMode"]) => void;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<FolderTree className="h-6 w-6" />}
      title={t("wizard.folderModeTitle")}
      helper={t("wizard.folderModeHelper")}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <DeliveryModeCard
          title={t("wizard.createNewWorkspace")}
          text={t("wizard.createNewWorkspaceText")}
          selected={draft.setupMode === "newWorkspace"}
          onClick={() => onChooseMode("newWorkspace")}
        />
        <DeliveryModeCard
          title={t("wizard.useExistingFolders")}
          text={t("wizard.useExistingFoldersText")}
          selected={draft.setupMode === "existingFolders"}
          onClick={() => onChooseMode("existingFolders")}
        />
      </div>
    </SetupStep>
  );
}

function ProfileStep({
  draft,
  update,
}: {
  draft: SetupDraft;
  update: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<Mail className="h-6 w-6" />}
      title={t("wizard.profileTitle")}
      helper={t("wizard.profileHelper")}
    >
      <div className="max-w-xl">
        <FieldLabel
          label={t("wizard.emailSignatureName")}
          help={t("wizard.emailSignatureHelp")}
        >
          <input
            className={inputClassName}
            value={draft.emailSignatureName}
            onChange={(event) => update("emailSignatureName", event.target.value)}
            placeholder={t("wizard.emailSignaturePlaceholder")}
          />
        </FieldLabel>
      </div>
    </SetupStep>
  );
}

function WorkspaceStep({
  draft,
  onWorkspaceChange,
  onChooseFolder,
}: {
  draft: SetupDraft;
  onWorkspaceChange: (path: string) => void;
  onChooseFolder: () => void;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<FolderTree className="h-6 w-6" />}
      title={t("wizard.workspaceTitle")}
      helper={t("wizard.workspaceHelper")}
    >
      <PathField
        label={t("wizard.workspaceFolder")}
        value={draft.workspaceBase}
        placeholder="C:\\InnPilot\\workspace"
        hint={t("wizard.workspaceHint")}
        onChange={onWorkspaceChange}
        onChoose={onChooseFolder}
      />
    </SetupStep>
  );
}

function FolderPreviewStep({ draft }: { draft: SetupDraft }) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<FolderTree className="h-6 w-6" />}
      title={t("wizard.folderPreviewTitle")}
      helper={t("wizard.folderPreviewHelper")}
    >
      <div className="rounded-lg bg-white/60 p-4">
        <p className="mb-3 text-sm font-semibold text-slate-900">{draft.workspaceBase}</p>
        <div className="grid gap-2 md:grid-cols-2">
        {workspaceFolders(draft).map((folder) => (
          <div key={folder.relativePath} className="rounded-md border border-white/70 bg-white/70 p-3">
            <p className="text-sm font-semibold text-slate-900">/{folder.relativePath}</p>

          </div>
        ))}
        </div>
      </div>
    </SetupStep>
  );
}

const EXISTING_FOLDER_FIELDS: {
  field: ExistingFolderField;
  labelKey: TranslationKey;
  helpKey: TranslationKey;
  placeholder?: string;
  chooseCredentialsFolder?: boolean;
  chooseTokenFolder?: boolean;
}[] = [
  { field: "invoiceInputFolder", labelKey: "wizard.existingInvoiceInput", helpKey: "wizard.pathCopyHelp" },
  { field: "invoiceOutputFolder", labelKey: "wizard.existingInvoiceOutput", helpKey: "wizard.pathCopyHelp" },
  { field: "invoiceArchiveFolder", labelKey: "wizard.existingInvoiceArchive", helpKey: "wizard.pathCopyHelp" },
  { field: "invoiceLogFolder", labelKey: "wizard.existingInvoiceLogs", helpKey: "wizard.pathCopyHelp" },
  { field: "gmailCredentialsFile", labelKey: "wizard.existingGmailCredentialsFolder", helpKey: "wizard.gmailCredentialsFolderHelp", chooseCredentialsFolder: true },
  { field: "gmailTokenFile", labelKey: "wizard.existingGmailTokenFolder", helpKey: "wizard.gmailTokenFolderHelp", chooseTokenFolder: true },
  { field: "sharedScanFolder", labelKey: "wizard.existingSharedScans", helpKey: "wizard.pathCopyHelp" },
  { field: "scansLocalCacheFolder", labelKey: "wizard.existingLocalScanCache", helpKey: "wizard.pathCopyHelp" },
  { field: "ocrTextOutputFolder", labelKey: "wizard.existingOcrTextOutput", helpKey: "wizard.pathCopyHelp" },
  { field: "signedContractsOutputFolder", labelKey: "wizard.existingSignedContracts", helpKey: "wizard.pathCopyHelp" },
  { field: "contractLogFolder", labelKey: "wizard.existingContractLogs", helpKey: "wizard.pathCopyHelp" },
];

function ExistingFoldersStep({
  draft,
  update,
  inspections,
  onInspect,
  onApplySuggestion,
  onChooseDirectory,
  onChooseGmailCredentialsFolder,
  onChooseTokenFolder,
  showAdvancedWorkflows,
}: {
  draft: SetupDraft;
  update: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
  inspections: Record<string, FolderInspectionState>;
  onInspect: (field: ExistingFolderField, value: string) => void;
  onApplySuggestion: (role: string | null | undefined, path: string) => void;
  onChooseDirectory: (field: PathFieldKey) => void;
  onChooseGmailCredentialsFolder: () => void;
  onChooseTokenFolder: () => void;
  showAdvancedWorkflows: boolean;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<FolderTree className="h-6 w-6" />}
      title={t("wizard.existingFoldersTitle")}
      helper={t("wizard.existingFoldersHelper")}
    >
      <div className="mb-4 rounded-lg bg-sky-50/80 p-4 text-sm font-semibold leading-6 text-sky-950">
        {t("wizard.discoveryReadOnly")}
      </div>
      <div className="grid gap-4">
        {EXISTING_FOLDER_FIELDS.filter(
          (item) =>
            showAdvancedWorkflows ||
            ![
              "sharedScanFolder",
              "scansLocalCacheFolder",
              "ocrTextOutputFolder",
              "signedContractsOutputFolder",
              "contractLogFolder",
            ].includes(item.field),
        ).map((item) => {
          const value = draft[item.field] as string;
          const inspection = inspections[item.field];
          const choose = item.chooseCredentialsFolder
            ? onChooseGmailCredentialsFolder
            : item.chooseTokenFolder
              ? onChooseTokenFolder
              : () => onChooseDirectory(item.field);
          return (
            <div key={item.field} className="rounded-lg border border-white/65 bg-white/55 p-4">
              <PathField
                label={t(item.labelKey)}
                value={value}
                placeholder={item.placeholder}
                hint={t(item.helpKey)}
                onChange={(nextValue) => update(item.field, normalizePathInput(nextValue) as SetupDraft[typeof item.field])}
                onChoose={choose}
                chooseLabel={t("wizard.chooseFolder")}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="rounded-md border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={inspection?.kind === "loading"}
                  onClick={() => onInspect(item.field, value)}
                >
                  {inspection?.kind === "loading" ? t("wizard.inspecting") : t("wizard.inspectFolder")}
                </button>

              </div>
              {inspection && (
                <FolderInspectionPanel
                  inspection={inspection}
                  onApplySuggestion={onApplySuggestion}
                />
              )}
            </div>
          );
        })}
      </div>
    </SetupStep>
  );
}

function FolderInspectionPanel({
  inspection,
  onApplySuggestion,
}: {
  inspection: FolderInspectionState;
  onApplySuggestion: (role: string | null | undefined, path: string) => void;
}) {
  const { t } = useI18n();
  if (inspection.kind === "loading") {
    return (
      <div className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
        {t("wizard.inspecting")}
      </div>
    );
  }
  if (inspection.kind === "error") {
    return (
      <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">
        {inspection.message}
      </div>
    );
  }

  const result = inspection.result;
  const suggestions = [...result.nearbyFolders, ...result.childFolders]
    .filter((folder) => folder.suggestedRole)
    .slice(0, 8);
  return (
    <div className="mt-3 rounded-lg border border-white/65 bg-white/70 p-4">
      <div className="grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-4">
        <span>{result.readable ? t("wizard.folderReadable") : t("wizard.folderNotReadable")}</span>
        <span>{result.writable ? t("wizard.folderWritable") : t("wizard.folderMayBeReadOnly")}</span>
        <span>{t("wizard.pdfCount", { count: result.pdfCount })}</span>
        <span>{t("wizard.txtCount", { count: result.txtCount })}</span>
      </div>
      {result.suggestedRole && (
        <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
          {t("wizard.suggestedRole", {
            role: roleLabel(result.suggestedRole, t),
            confidence: result.confidence ?? 0,
          })}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {t("wizard.nearbySuggestions")}
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {suggestions.map((folder) => (
              <div key={`${folder.suggestedRole}-${folder.path}`} className="rounded-md bg-white/75 p-3">
                <p className="text-sm font-semibold text-slate-900">{folder.name}</p>
                <p className="mt-1 break-words text-xs font-medium leading-5 text-slate-600">
                  {roleLabel(folder.suggestedRole, t)} · {folder.confidence}%
                </p>
                <button
                  className="mt-2 rounded-md border border-white/70 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-white"
                  type="button"
                  onClick={() => onApplySuggestion(folder.suggestedRole, folder.path)}
                >
                  {t("wizard.useThisFolder")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {result.recentModifiedPreview.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold text-slate-600">
            {t("wizard.filenamePreview")}
          </summary>
          <ul className="mt-2 max-h-36 overflow-auto rounded-md bg-white/65 p-3 text-xs font-medium leading-5 text-slate-600">
            {result.recentModifiedPreview.map((name) => (
              <li key={name} className="break-words">{name}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function GmailStep({
  draft,
  update,
  onChooseCredentials,
  onChooseTokenFolder,
}: {
  draft: SetupDraft;
  update: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
  onChooseCredentials: () => void;
  onChooseTokenFolder: () => void;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<Mail className="h-6 w-6" />}
      title={t("wizard.invoiceEmailsTitle")}
      helper={t("wizard.invoiceEmailsHelper")}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <DeliveryModeCard
          title={t("delivery.prepareOnly")}
          text={t("wizard.prepareOnlyText")}
          selected={draft.invoiceDeliveryMode === "prepareOnly"}
          onClick={() => update("invoiceDeliveryMode", "prepareOnly")}
        />
        <DeliveryModeCard
          title={t("delivery.gmailDrafts")}
          text={t("wizard.gmailDraftsText")}
          selected={draft.invoiceDeliveryMode === "gmailDrafts"}
          onClick={() => update("invoiceDeliveryMode", "gmailDrafts")}
        />
        <DeliveryModeCard
          title={t("delivery.sendAutomatically")}
          text={t("wizard.sendAutomaticallyText")}
          selected={draft.invoiceDeliveryMode === "sendAutomatically"}
          disabled
          onClick={() => update("invoiceDeliveryMode", "sendAutomatically")}
        />
      </div>
      {draft.invoiceDeliveryMode === "prepareOnly" && (
        <p className="mt-4 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
          {t("wizard.gmailOptional")}
        </p>
      )}
      {draft.invoiceDeliveryMode === "sendAutomatically" && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {t("wizard.sendUnavailable")}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel
          label={t("wizard.draftSubject")}
          help={t("wizard.draftSubjectHelp")}
        >
          <input
            className={inputClassName}
            value={draft.gmailSubject}
            onChange={(event) => update("gmailSubject", event.target.value)}
            placeholder="Invoices - Your Hotel"
          />
        </FieldLabel>
        <FieldLabel
          label={t("wizard.ccEmail")}
          help={t("wizard.ccEmailHelp")}
        >
          <input
            className={inputClassName}
            value={draft.ccEmail}
            onChange={(event) => update("ccEmail", event.target.value)}
            placeholder="backoffice@example.com"
          />
        </FieldLabel>
      </div>
      <details className="mt-5 rounded-md bg-white/55 p-4" open={draft.invoiceDeliveryMode === "gmailDrafts"}>
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          {t("wizard.gmailLocations")} {draft.invoiceDeliveryMode === "prepareOnly" ? t("wizard.optionalParenthetical") : ""}
        </summary>
        <div className="mt-4 grid gap-4">
          <PathField
            label={t("wizard.credentialsPath")}
            value={draft.gmailCredentialsFile}
            placeholder="C:\\InnPilot\\workspace\\Gmail\\Credentials\\gmail_credentials.json"
            hint={t("wizard.credentialsHelp")}
            onChange={(value) => update("gmailCredentialsFile", value)}
            onChoose={onChooseCredentials}
            chooseLabel={t("wizard.chooseFile")}
          />
          <PathField
            label={t("wizard.tokenPath")}
            value={draft.gmailTokenFile}
            placeholder="C:\\InnPilot\\workspace\\Gmail\\Token\\gmail_token.json"
            hint={t("wizard.tokenHelp")}
            onChange={(value) => update("gmailTokenFile", value)}
            onChoose={onChooseTokenFolder}
            chooseLabel={t("wizard.chooseFolder")}
          />
        </div>
      </details>
      {draft.invoiceDeliveryMode === "gmailDrafts" && (
        <p className="mt-4 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
          {t("wizard.gmailMayBeNeeded")}
        </p>
      )}
    </SetupStep>
  );
}

function InvoiceRulesStep({
  draft,
  update,
  updateRule,
  addRule,
  removeRule,
  updateList,
  addListItem,
  removeListItem,
}: {
  draft: SetupDraft;
  update: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
  updateRule: (id: string, patch: Partial<RecipientRuleDraft>) => void;
  addRule: () => void;
  removeRule: (id: string) => void;
  updateList: <K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    index: number,
    value: string,
  ) => void;
  addListItem: <K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    value?: string,
  ) => void;
  removeListItem: <K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    index: number,
  ) => void;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<ReceiptText className="h-6 w-6" />}
      title={t("wizard.invoiceRulesTitle")}
      helper={t("wizard.invoiceRulesHelper")}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <DeliveryModeCard
          title={t("invoiceSelection.allPdfs")}
          text={t("invoiceSelection.allPdfsFact")}
          selected={draft.invoiceFileSelectionMode === "allPdfs"}
          onClick={() => update("invoiceFileSelectionMode", "allPdfs")}
        />
        <DeliveryModeCard
          title={t("invoiceSelection.filenamePatterns")}
          text={t("invoiceSelection.filenamePatternsFact")}
          selected={draft.invoiceFileSelectionMode === "filenamePatterns"}
          onClick={() => update("invoiceFileSelectionMode", "filenamePatterns")}
        />
      </div>

      <p className="mt-4 rounded-md bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-950">
        {t("wizard.invoiceFolderNotice")}
      </p>

      <details
        className="mt-5 rounded-lg border border-white/65 bg-white/50 p-4"
        open={draft.invoiceFileSelectionMode === "filenamePatterns"}
      >
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          {t("wizard.optionalFilenameFilters")}
        </summary>
        <div className="mt-4">
          <ListEditor
            label={t("wizard.invoicePatterns")}
            help={t("wizard.invoicePatternsHelp")}
            values={draft.invoiceInputPatterns}
            placeholder="*.pdf"
            addLabel={t("wizard.addFilter")}
            onChange={(index, value) => updateList("invoiceInputPatterns", index, value)}
            onAdd={() => addListItem("invoiceInputPatterns", "")}
            onRemove={(index) => removeListItem("invoiceInputPatterns", index)}
          />
        </div>
      </details>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-800">{t("wizard.recipientRules")}</p>
          <button
            className="rounded-md border border-white/70 bg-white/65 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
            onClick={addRule}
          >
            {t("wizard.addRule")}
          </button>
        </div>
        {draft.recipientRules.map((rule, index) => (
          <div key={rule.id} className="grid gap-3 rounded-md bg-white/55 p-3 md:grid-cols-[1fr_1fr_auto]">
            <FieldLabel
              label={t("wizard.matchText", { number: index + 1 })}
              help={t("wizard.matchTextHelp")}
            >
              <input
                className={inputClassName}
                value={rule.matchText}
                onChange={(event) => updateRule(rule.id, { matchText: event.target.value })}
                placeholder="company or invoice text"
              />
            </FieldLabel>
            <FieldLabel
              label={t("wizard.recipientEmail")}
              help={t("wizard.recipientEmailHelp")}
            >
              <input
                className={inputClassName}
                value={rule.email}
                onChange={(event) => updateRule(rule.id, { email: event.target.value })}
                placeholder="recipient@example.com"
              />
            </FieldLabel>
            <button
              className="self-end rounded-md border border-white/70 bg-white/65 px-3 py-3 text-xs font-semibold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
              disabled={draft.recipientRules.length === 1}
              onClick={() => removeRule(rule.id)}
            >
              {t("wizard.remove")}
            </button>
          </div>
        ))}
      </div>
    </SetupStep>
  );
}

function ContractsStep({
  draft,
  update,
  onChooseSharedScanFolder,
  onChooseOcrTextFolder,
  onChooseContractsOutputFolder,
  updateList,
  addListItem,
  removeListItem,
}: {
  draft: SetupDraft;
  update: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
  onChooseSharedScanFolder: () => void;
  onChooseOcrTextFolder: () => void;
  onChooseContractsOutputFolder: () => void;
  updateList: <K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    index: number,
    value: string,
  ) => void;
  addListItem: <K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    value?: string,
  ) => void;
  removeListItem: <K extends "invoiceInputPatterns" | "scannerFilenamePrefixes" | "contractMarkerTexts">(
    key: K,
    index: number,
  ) => void;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<ScanText className="h-6 w-6" />}
      title={t("wizard.contractsTitle")}
      helper={t("wizard.contractsHelper")}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel
          label={t("wizard.contractYear")}
          help={t("wizard.contractYearHelp")}
        >
          <input
            className={inputClassName}
            value={draft.contractYear}
            onChange={(event) => update("contractYear", event.target.value)}
            placeholder="2026"
          />
        </FieldLabel>
      </div>
      <div className="mt-4 grid gap-4">
        <ListEditor
          label={t("wizard.scannerPrefixes")}
          help={t("wizard.scannerPrefixesHelp")}
          values={draft.scannerFilenamePrefixes}
          placeholder="Sharp MFP"
          addLabel={t("wizard.addScanner")}
          onChange={(index, value) => updateList("scannerFilenamePrefixes", index, value)}
          onAdd={() => addListItem("scannerFilenamePrefixes", "")}
          onRemove={(index) => removeListItem("scannerFilenamePrefixes", index)}
        />
        <ListEditor
          label={t("wizard.contractMarkers")}
          help={t("wizard.contractMarkersHelp")}
          values={draft.contractMarkerTexts}
          placeholder="Oggetto: Contratto di lavoro subordinato a tempo determinato"
          addLabel={t("wizard.addMarker")}
          multiline
          onChange={(index, value) => updateList("contractMarkerTexts", index, value)}
          onAdd={() => addListItem("contractMarkerTexts", "")}
          onRemove={(index) => removeListItem("contractMarkerTexts", index)}
        />
        <PathField
          label={t("wizard.sharedScanFolder")}
          value={draft.sharedScanFolder}
          placeholder="\\\\server\\shared\\Scansioni"
          hint={t("wizard.sharedScanHelp")}
          onChange={(value) => update("sharedScanFolder", value)}
          onChoose={onChooseSharedScanFolder}
        />
        <PathField
          label={t("wizard.textOutputFolder")}
          value={draft.ocrTextOutputFolder}
          hint={t("wizard.textOutputHelp")}
          onChange={(value) => update("ocrTextOutputFolder", value)}
          onChoose={onChooseOcrTextFolder}
        />
        <PathField
          label={t("wizard.contractOutputFolder")}
          value={draft.signedContractsOutputFolder}
          hint={t("wizard.contractOutputHelp")}
          onChange={(value) => update("signedContractsOutputFolder", value)}
          onChoose={onChooseContractsOutputFolder}
        />
      </div>
    </SetupStep>
  );
}

function SafetyStep({
  draft,
  update,
}: {
  draft: SetupDraft;
  update: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
}) {
  const { t } = useI18n();
  const packagedWorker = draft.pythonExecutable.toLowerCase().includes("innpilot-worker");
  return (
    <SetupStep
      icon={<ShieldCheck className="h-6 w-6" />}
      title={t("wizard.safetyTitle")}
      helper={t("wizard.safetyHelper")}
    >
      <div className="grid gap-3">
        <div className="rounded-lg border border-white/65 bg-white/65 p-4">
          <FieldLabel
            label={t("wizard.pythonUsed")}
            help={t("wizard.pythonHelp")}
          >
            {packagedWorker ? (
              <div className="flex items-center gap-3 rounded-md border border-emerald-100 bg-emerald-50/80 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-emerald-950">{t("support.pythonFound")}</p>
                  <p className="mt-1 text-xs font-medium text-emerald-800">{t("wizard.pythonHelp")}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <input
                    className={inputClassName}
                    value={draft.pythonExecutable}
                    onChange={(event) => update("pythonExecutable", event.target.value)}
                    placeholder={managedPythonExecutable()}
                  />
                  <button
                    className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                    type="button"
                    onClick={() => update("pythonExecutable", managedPythonExecutable())}
                  >
                    {t("wizard.useManagedPython")}
                  </button>
                </div>
                <p className="mt-2 text-xs font-medium leading-5 text-slate-600">
                  {t("wizard.recommendedPath", { path: managedPythonExecutable() })}
                </p>
              </>
            )}
          </FieldLabel>
        </div>
        <ToggleCard
          title={t("wizard.safeMode")}
          text={t("wizard.safeModeText")}
          help={t("wizard.safeModeHelp")}
          checked={draft.safeMode}
          onChange={(checked) => update("safeMode", checked)}
        />
        <ToggleCard
          title={t("wizard.archiveOriginals")}
          text={t("wizard.archiveText")}
          help={t("wizard.archiveHelp")}
          checked={draft.archiveOriginals}
          onChange={(checked) => update("archiveOriginals", checked)}
        />
        <ToggleCard
          title={t("wizard.hidePersonal")}
          text={t("wizard.hidePersonalText")}
          help={t("wizard.hidePersonalHelp")}
          checked={draft.redactLogs}
          onChange={(checked) => update("redactLogs", checked)}
        />
      </div>
    </SetupStep>
  );
}

function ReviewStep({ draft }: { draft: SetupDraft }) {
  const { t } = useI18n();
  const filledRules = draft.recipientRules.filter(
    (rule) => rule.matchText.trim() || rule.email.trim(),
  );
  return (
    <SetupStep
      icon={<FileCheck2 className="h-6 w-6" />}
      title={t("wizard.reviewTitle")}
      helper={t("wizard.reviewHelper")}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard title={t("wizard.stepWorkspace")} value={draft.workspaceBase || t("wizard.notSet")} />
        <SummaryCard title={t("wizard.invoiceDelivery")} value={deliveryModeSummary(draft.invoiceDeliveryMode, t)} />
        <SummaryCard title={t("wizard.invoiceFiles")} value={fileSelectionSummary(draft, t)} />
        <SummaryCard
          title={t("wizard.invoiceRules")}
          value={`${filledRules.length} ${
            filledRules.length === 1
              ? t("wizard.recipientRuleSingular")
              : t("wizard.recipientRulePlural")
          }`}
        />
        <SummaryCard title={t("wizard.contractYear")} value={draft.contractYear || t("wizard.notSet")} />
        <SummaryCard title={t("wizard.python")} value={draft.pythonExecutable || t("wizard.notSet")} />
        <SummaryCard
          title={t("wizard.safetyTitle")}
          value={[
            draft.safeMode ? t("wizard.safeMode") : t("wizard.realRunDefault"),
            draft.archiveOriginals ? t("wizard.archiveOriginals") : t("wizard.noArchivePreference"),
            draft.redactLogs ? t("wizard.hidePersonal") : t("wizard.fullSupportOutput"),
          ].join(", ")}
        />
      </div>
      <p className="mt-5 rounded-lg bg-brand-50/75 px-4 py-3 text-sm font-semibold text-brand-900">
        {t("wizard.reviewSaveHint")}
      </p>
    </SetupStep>
  );
}

function FinishStep({
  busy,
  saved,
  setupResult,
  onFinish,
  onDone,
  onCleanupCreatedFolders,
  createdFolderCount,
  disabled,
}: {
  busy: boolean;
  saved: boolean;
  setupResult: SetupActionResult | null;
  onFinish: () => void;
  onDone: () => void;
  onCleanupCreatedFolders: () => void;
  createdFolderCount: number;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<CheckCircle2 className="h-6 w-6" />}
      title={saved ? t("wizard.setupReady") : t("wizard.finishTitle")}
      helper={saved ? t("wizard.setupReadyGo") : t("wizard.finishHelper")}
    >
      <div className="rounded-lg bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900">
        {t("wizard.finishNote")}
      </div>

      {setupResult && (
        <div
          className={[
            "mt-4 rounded-lg p-4 text-sm font-semibold leading-6",
            setupResult.kind === "success"
              ? "bg-emerald-50 text-emerald-900"
              : setupResult.kind === "warning"
                ? "bg-amber-50 text-amber-900"
                : "bg-rose-50 text-rose-900",
          ].join(" ")}
        >
          <p>{setupResult.title}</p>
          <p className="mt-1 font-medium">{setupResult.message}</p>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        {saved ? (
          <button
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg bg-cta px-5 text-sm font-semibold text-white shadow-sm hover:bg-cta-soft"
            onClick={onDone}
            type="button"
          >
            {t("wizard.done")}
          </button>
        ) : (
          <button
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg bg-cta px-5 text-sm font-semibold text-white shadow-sm hover:bg-cta-soft disabled:cursor-not-allowed disabled:opacity-55"
            disabled={busy || disabled}
            onClick={onFinish}
            type="button"
          >
            {busy ? t("wizard.savingAndFinishing") : t("wizard.saveAndFinish")}
          </button>
        )}
        {createdFolderCount > 0 && !saved && (
          <button
            className="min-h-12 rounded-lg border border-amber-200 bg-amber-50 px-4 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            disabled={busy}
            onClick={onCleanupCreatedFolders}
            type="button"
          >
            {t("wizard.cleanupFolders")}
          </button>
        )}
      </div>
    </SetupStep>
  );
}
function PathField({
  label,
  value,
  placeholder,
  hint,
  chooseLabel,
  onChange,
  onChoose,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint: string;
  chooseLabel?: string;
  onChange: (value: string) => void;
  onChoose: () => void;
}) {
  const { t } = useI18n();
  const status = pathStatus(value);
  const resolvedChooseLabel = chooseLabel ?? t("wizard.choose");
  return (
    <FieldLabel label={label} help={hint}>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          className={inputClassName}
          value={value}
          onChange={(event) => onChange(normalizePathInput(event.target.value))}
          placeholder={placeholder}
        />
        <button
          className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
          onClick={onChoose}
          type="button"
        >
          {resolvedChooseLabel}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={[
            "rounded-md px-2 py-1 text-xs font-bold",
            status.kind === "ready"
              ? "bg-emerald-50 text-emerald-800"
              : status.kind === "warning"
                ? "bg-amber-50 text-amber-800"
                : "bg-slate-100 text-slate-700",
          ].join(" ")}
        >
          {t(status.labelKey)}
        </span>
      </div>
    </FieldLabel>
  );
}

function ListEditor({
  label,
  help,
  values,
  placeholder,
  addLabel,
  multiline = false,
  onChange,
  onAdd,
  onRemove,
}: {
  label: string;
  help: string;
  values: string[];
  placeholder: string;
  addLabel: string;
  multiline?: boolean;
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-white/65 bg-white/55 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800">{label}</p>
          <span
            className="inline-grid h-5 w-5 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800 ring-1 ring-brand-100"
            title={help}
            aria-label={help}
          >
            ?
          </span>
        </div>
        <button
          className="rounded-md border border-white/70 bg-white/65 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
          type="button"
          onClick={onAdd}
        >
          {addLabel}
        </button>
      </div>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[1fr_auto]">
            {multiline ? (
              <textarea
                className={textareaClassName}
                value={value}
                onChange={(event) => onChange(index, event.target.value)}
                placeholder={placeholder}
              />
            ) : (
              <input
                className={inputClassName}
                value={value}
                onChange={(event) => onChange(index, event.target.value)}
                placeholder={placeholder}
              />
            )}
            <button
              className="rounded-md border border-white/70 bg-white/65 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-45 md:self-start"
              disabled={values.length === 1}
              type="button"
              onClick={() => onRemove(index)}
            >
              {t("wizard.remove")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeliveryModeCard({
  title,
  text,
  selected,
  disabled = false,
  onClick,
}: {
  title: string;
  text: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        "rounded-lg border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-brand-300 bg-brand-50 text-brand-950 ring-2 ring-brand-100"
          : "border-white/70 bg-white/65 text-slate-800 hover:bg-white",
      ].join(" ")}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-2 block text-sm font-medium leading-5 opacity-80">{text}</span>
    </button>
  );
}

function pathStatus(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { kind: "empty", labelKey: "wizard.notSelected" } as const;
  }
  const normalized = trimmed.replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();
  if (
    normalized === "c:" ||
    normalized === "c:\\windows" ||
    normalized === "c:\\program files" ||
    normalized === "c:\\program files (x86)" ||
    normalized.endsWith("\\node_modules") ||
    normalized.endsWith("\\target") ||
    normalized.endsWith("\\dist")
  ) {
    return { kind: "warning", labelKey: "wizard.needsReview" } as const;
  }
  return { kind: "ready", labelKey: "wizard.looksUsable" } as const;
}


function ToggleCard({
  title,
  text,
  help,
  checked,
  onChange,
}: {
  title: string;
  text: string;
  help?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-white p-4">
      <span className="inline-flex items-center gap-2">
        <span className="text-sm font-semibold text-zinc-950">{title}</span>
        {help && <InfoHint text={help} />}
        <span className="sr-only">{text}</span>
      </span>
      <input
        className="h-5 w-5 accent-brand-700"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/65 bg-white/65 p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
      <p className="mt-2 break-words text-sm font-semibold leading-6 text-slate-900">{value}</p>
    </div>
  );
}

function deliveryModeSummary(
  mode: SetupDraft["invoiceDeliveryMode"],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (mode === "prepareOnly") return `${t("delivery.prepareOnly")}. ${t("delivery.prepareOnlyReassurance")}`;
  if (mode === "sendAutomatically") return t("delivery.sendAutomaticallyPromise");
  return `${t("delivery.gmailDrafts")}. ${t("delivery.draftsOnlyReassurance")}`;
}

function fileSelectionSummary(draft: SetupDraft, t: ReturnType<typeof useI18n>["t"]) {
  if (draft.invoiceFileSelectionMode === "filenamePatterns") {
    const count = draft.invoiceInputPatterns.filter((pattern) => pattern.trim()).length;
    return t("wizard.matchingFilenamesSummary", {
      count,
      filters: count === 1 ? t("wizard.filterSingular") : t("wizard.filterPlural"),
    });
  }
  return t("wizard.everyPdfSummary");
}
