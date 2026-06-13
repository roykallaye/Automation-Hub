import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Building2,
  CheckCircle2,
  Copy,
  FileCheck2,
  FolderTree,
  Mail,
  ReceiptText,
  ScanText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n, type TranslationKey } from "../../i18n";
import type {
  HubConfig,
  PreflightReport,
  PreflightItem,
  SaveSetupResult,
  SetupPreview,
  WorkflowPreflight,
  WorkspaceInitResult,
} from "../../types";
import { staffMessage } from "../../messages";
import { buildConfigPreview } from "./configPreview";
import {
  createRuleId,
  createSetupDraft,
  defaultPathsForWorkspace,
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
  | "gmailCredentialsFile"
  | "gmailTokenFile"
  | "sharedScanFolder"
  | "ocrTextOutputFolder"
  | "signedContractsOutputFolder";

type SetupAction = "preview" | "initialize" | "save" | "validate";

type SetupCleanupResult = {
  removed: string[];
  skipped: string[];
  failed: string[];
};

export function SetupWizard({
  config,
  onClose,
  onSetupSaved,
}: {
  config?: HubConfig | null;
  onClose: () => void;
  onSetupSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<SetupDraft>(() => createSetupDraft(config));
  const [setupResult, setSetupResult] = useState<SetupActionResult | null>(null);
  const [setupAction, setSetupAction] = useState<string | null>(null);
  const [completedActions, setCompletedActions] = useState<SetupAction[]>([]);
  const [createdFolderPaths, setCreatedFolderPaths] = useState<string[]>([]);
  const steps = useMemo<WizardStepMeta[]>(
    () => stepDefinitions.map((step) => ({ key: step.key, title: t(step.titleKey) })),
    [t],
  );
  const preview = useMemo(() => buildConfigPreview(draft), [draft]);
  const currentStep = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  function update<K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setCompletedActions([]);
    setSetupResult(null);
  }

  function updateWorkspaceBase(nextWorkspace: string) {
    const repairedWorkspace = repairConcatenatedAbsolutePath(nextWorkspace);
    setDraft((current) => {
      const oldDefaults = defaultPathsForWorkspace(current.workspaceBase, current.contractYear);
      const nextDefaults = defaultPathsForWorkspace(repairedWorkspace, current.contractYear);
      const defaultManagedFields: (keyof ReturnType<typeof defaultPathsForWorkspace>)[] = [
        "sharedScanFolder",
        "gmailCredentialsFile",
        "gmailTokenFile",
        "ocrTextOutputFolder",
        "signedContractsOutputFolder",
      ];
      const refreshedDefaults = Object.fromEntries(
        defaultManagedFields
          .filter((field) => !current[field] || current[field] === oldDefaults[field])
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
      update(field, repairConcatenatedAbsolutePath(selectedPath) as SetupDraft[typeof field]);
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
    if (selectedPath) update(field, repairConcatenatedAbsolutePath(selectedPath) as SetupDraft[typeof field]);
  }

  async function chooseTokenFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: draft.gmailTokenFile || draft.workspaceBase,
    });
    const selectedPath = normalizeDialogSelection(selected);
    if (selectedPath) update("gmailTokenFile", `${repairConcatenatedAbsolutePath(selectedPath).replace(/[\\/]+$/g, "")}\\gmail_token.json`);
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

  async function runSetupAction(action: SetupAction) {
    if (
      (action === "initialize" || action === "save") &&
      !window.confirm(
        action === "initialize"
          ? t("wizard.confirmCreateFolders")
          : t("wizard.confirmSaveSetup"),
      )
    ) {
      return;
    }

    setSetupAction(action);
    setSetupResult(null);
    try {
      if (action === "preview") {
        const result = await invoke<SetupPreview>("preview_setup", { draft });
        setSetupResult({
          kind: "success",
          title: t("wizard.previewReady"),
          message: t("wizard.previewMessage", {
            folders: result.folderPlan.length,
            warnings: result.warnings.length,
            warningWord:
              result.warnings.length === 1
                ? t("wizard.warningSingular")
                : t("wizard.warningPlural"),
          }),
          details: result,
        });
        markActionComplete("preview");
      } else if (action === "initialize") {
        const result = await invoke<WorkspaceInitResult>("initialize_workspace", {
          draft,
          confirmed: true,
        });
        const created = result.folders.filter((folder) => folder.action === "created").length;
        const alreadyExists = result.folders.filter(
          (folder) => folder.action === "alreadyExists",
        ).length;
        const failed = result.folders.filter((folder) => folder.action === "failed").length;
        const invalidPathFailure = result.folders.some((folder) =>
          folder.message.includes("os error 123") ||
          folder.message.toLowerCase().includes("invalid path"),
        );
        setSetupResult({
          kind: failed ? "warning" : "success",
          title: failed
            ? invalidPathFailure
              ? t("wizard.invalidFolderPath")
              : t("wizard.actionNeedsAttention")
            : t("wizard.createdFolders"),
          message: failed
            ? invalidPathFailure
              ? t("wizard.invalidFolderMessage")
              : t("wizard.foldersNeedAttention", {
                  failed,
                  folderWord:
                    failed === 1 ? t("wizard.folderSingular") : t("wizard.folderPlural"),
                  created,
                  alreadyExists,
                })
            : t("wizard.createdMessage", { created, alreadyExists }),
          details: result,
        });
        if (!failed) {
          markActionComplete("initialize");
          setCreatedFolderPaths(
            result.folders
              .filter((folder) => folder.action === "created")
              .map((folder) => folder.path),
          );
        }
        await onSetupSaved();
      } else if (action === "save") {
        const result = await invoke<SaveSetupResult>("save_setup_config", {
          draft,
          confirmed: true,
        });
        const blocking = result.validation.workflows.filter(
          (workflow) => workflow.commandName && !workflow.canRun,
        ).length;
        const guidance = validationGuidance(result.validation, t);
        setSetupResult({
          kind: blocking ? "warning" : "success",
          title: blocking ? t("wizard.savedOneStep") : t("wizard.setupReady"),
          message: blocking
            ? `${guidance} ${t("wizard.backupsCreated", {
                count: result.backups.length,
                backupWord:
                  result.backups.length === 1
                    ? t("wizard.backupSingular")
                    : t("wizard.backupPlural"),
              })}`
            : t("wizard.setupSavedBackups", {
                count: result.backups.length,
                backupWord:
                  result.backups.length === 1
                    ? t("wizard.backupSingular")
                    : t("wizard.backupPlural"),
              }),
          details: result,
        });
        markActionComplete("save");
        await onSetupSaved();
      } else {
        const result = await invoke<PreflightReport>("validate_setup");
        const blocking = result.workflows.filter(
          (workflow) => workflow.commandName && !workflow.canRun,
        ).length;
        setSetupResult({
          kind: blocking ? "warning" : "success",
          title: blocking ? t("wizard.setupNeedsStep") : t("wizard.setupCheckPassed"),
          message: blocking
            ? validationGuidance(result, t)
            : t("wizard.setupReadyGo"),
          details: result,
        });
        if (!blocking) markActionComplete("validate");
        await onSetupSaved();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const invalidPathMessage =
        message.includes("os error 123") || message.toLowerCase().includes("invalid path")
          ? t("wizard.invalidFolderMessage")
          : message;
      setSetupResult({
        kind: "error",
        title: t("wizard.actionCouldNotFinish"),
        message: invalidPathMessage,
        details: invalidPathMessage === message ? undefined : { technicalError: message },
      });
    } finally {
      setSetupAction(null);
    }
  }

  async function cleanupCreatedFolders() {
    if (!createdFolderPaths.length) return;
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
      const result = await invoke<SetupCleanupResult>("remove_setup_created_empty_folders", {
        workspaceBase: draft.workspaceBase,
        paths: createdFolderPaths,
        confirmed: true,
      });
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
      setCreatedFolderPaths([]);
      setCompletedActions((current) => current.filter((action) => action !== "initialize"));
      await onSetupSaved();
    } catch (error) {
      setSetupResult({
        kind: "error",
        title: t("wizard.cleanupCouldNotFinish"),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSetupAction(null);
    }
  }

  function markActionComplete(action: SetupAction) {
    setCompletedActions((current) =>
      current.includes(action) ? current : [...current, action],
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_1fr]">
      <StepProgress steps={steps} currentIndex={stepIndex} />

      <div className="space-y-4">
        {currentStep.key === "welcome" && <WelcomeStep />}
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
        {currentStep.key === "folders" && <FolderPreviewStep draft={draft} />}
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
        {currentStep.key === "review" && (
          <ReviewStep
            draft={draft}
            preview={preview}
            busyAction={setupAction}
            completedActions={completedActions}
            setupResult={setupResult}
            onSetupAction={runSetupAction}
            onCleanupCreatedFolders={cleanupCreatedFolders}
            createdFolderCount={createdFolderPaths.length}
          />
        )}
        {currentStep.key === "finish" && (
          <FinishStep
            busyAction={setupAction}
            completedActions={completedActions}
            setupResult={setupResult}
            onSetupAction={runSetupAction}
            onCleanupCreatedFolders={cleanupCreatedFolders}
            createdFolderCount={createdFolderPaths.length}
          />
        )}

        <div className="flex items-center justify-between rounded-xl border border-white/65 bg-white/55 p-4 shadow-glass backdrop-blur-xl">
          <button
            className="rounded-md border border-white/70 bg-white/65 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={isFirst}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            {t("wizard.back")}
          </button>
          {isLast ? (
            <button
              className="rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-ink-soft"
              onClick={onClose}
            >
              {t("wizard.returnSetup")}
            </button>
          ) : (
            <button
              className="rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-ink-soft"
              onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}
            >
              {isFirst ? t("wizard.startSetup") : t("wizard.next")}
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

type SetupActionResult = {
  kind: "success" | "warning" | "error";
  title: string;
  message: string;
  details?: unknown;
};

function WelcomeStep() {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<Sparkles className="h-6 w-6" />}
      title={t("wizard.setUpTitle")}
      helper={t("wizard.setUpHelper")}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title={t("wizard.emailChoice")} text={t("wizard.emailChoiceText")} />
        <InfoCard title={t("wizard.confirmFirst")} text={t("wizard.confirmFirstText")} />
        <InfoCard title={t("wizard.guidedSetup")} text={t("wizard.guidedSetupText")} />
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
      icon={<Building2 className="h-6 w-6" />}
      title={t("wizard.profileTitle")}
      helper={t("wizard.profileHelper")}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel
          label={t("wizard.hotelDisplayName")}
          help={t("wizard.hotelDisplayHelp")}
        >
          <input
            className={inputClassName}
            value={draft.hotelDisplayName}
            onChange={(event) => update("hotelDisplayName", event.target.value)}
            placeholder={t("branding.hotelPlaceholder")}
          />
        </FieldLabel>
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
      <p className="mt-3 text-sm font-medium text-slate-600">
        {t("wizard.suggestedFolder", { path: "C:\\InnPilot\\workspace" })}
      </p>
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
            <p className="mt-1 break-words text-xs font-medium leading-5 text-slate-600">
              {folder.fullPath}
            </p>
          </div>
        ))}
        </div>
      </div>
    </SetupStep>
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
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                className={inputClassName}
                value={draft.pythonExecutable}
                onChange={(event) => update("pythonExecutable", event.target.value)}
                placeholder={managedPythonExecutable()}
              />
              <button
                className="rounded-md border border-white/70 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
                type="button"
                onClick={() => update("pythonExecutable", managedPythonExecutable())}
              >
                {t("wizard.useManagedPython")}
              </button>
            </div>
            <p className="mt-2 text-xs font-medium leading-5 text-slate-600">
              {t("wizard.recommendedPath", { path: managedPythonExecutable() })}
            </p>
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

function ReviewStep({
  draft,
  preview,
  busyAction,
  completedActions,
  setupResult,
  onSetupAction,
  onCleanupCreatedFolders,
  createdFolderCount,
}: {
  draft: SetupDraft;
  preview: ReturnType<typeof buildConfigPreview>;
  busyAction: string | null;
  completedActions: SetupAction[];
  setupResult: SetupActionResult | null;
  onSetupAction: (action: SetupAction) => void;
  onCleanupCreatedFolders: () => void;
  createdFolderCount: number;
}) {
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
        <SummaryCard title={t("wizard.hotel")} value={draft.hotelDisplayName || t("wizard.notSet")} />
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
          title="Safety"
          value={[
            draft.safeMode ? t("wizard.safeMode") : t("wizard.realRunDefault"),
            draft.archiveOriginals ? t("wizard.archiveOriginals") : t("wizard.noArchivePreference"),
            draft.redactLogs ? t("wizard.hidePersonal") : t("wizard.fullSupportOutput"),
          ].join(", ")}
        />
      </div>

      <details className="mt-5 max-w-full rounded-md bg-ink/95 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-brand-200">
          {t("wizard.technicalDetails")}
        </summary>
        <button
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-slate-100 hover:bg-white/20"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(JSON.stringify(preview, null, 2))}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          {t("wizard.copyDetails")}
        </button>
        <pre className="mt-3 max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-4 font-mono text-xs leading-5 text-slate-100">
          {JSON.stringify(preview, null, 2)}
        </pre>
      </details>

      <SetupActionPanel
        busyAction={busyAction}
        completedActions={completedActions}
        setupResult={setupResult}
        onSetupAction={onSetupAction}
        onCleanupCreatedFolders={onCleanupCreatedFolders}
        createdFolderCount={createdFolderCount}
      />
    </SetupStep>
  );
}

function FinishStep({
  busyAction,
  completedActions,
  setupResult,
  onSetupAction,
  onCleanupCreatedFolders,
  createdFolderCount,
}: {
  busyAction: string | null;
  completedActions: SetupAction[];
  setupResult: SetupActionResult | null;
  onSetupAction: (action: SetupAction) => void;
  onCleanupCreatedFolders: () => void;
  createdFolderCount: number;
}) {
  const { t } = useI18n();
  return (
    <SetupStep
      icon={<CheckCircle2 className="h-6 w-6" />}
      title={t("wizard.finishTitle")}
      helper={t("wizard.finishHelper")}
    >
      <div className="rounded-md bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900">
        {t("wizard.finishNote")}
      </div>
      <SetupActionPanel
        busyAction={busyAction}
        completedActions={completedActions}
        setupResult={setupResult}
        onSetupAction={onSetupAction}
        onCleanupCreatedFolders={onCleanupCreatedFolders}
        createdFolderCount={createdFolderCount}
      />
    </SetupStep>
  );
}

function SetupActionPanel({
  busyAction,
  completedActions,
  setupResult,
  onSetupAction,
  onCleanupCreatedFolders,
  createdFolderCount,
}: {
  busyAction: string | null;
  completedActions: SetupAction[];
  setupResult: SetupActionResult | null;
  onSetupAction: (action: SetupAction) => void;
  onCleanupCreatedFolders: () => void;
  createdFolderCount: number;
}) {
  const { t } = useI18n();
  const hasPreview = completedActions.includes("preview");
  const hasInitialize = completedActions.includes("initialize");
  const hasSave = completedActions.includes("save");
  return (
    <div className="mt-5 rounded-lg bg-white/60 p-4">
      <ol className="mb-4 grid gap-2 text-sm font-semibold text-slate-700 md:grid-cols-4">
        {[
          ["1", t("wizard.previewSetup")],
          ["2", t("wizard.createFolders")],
          ["3", t("wizard.saveSetup")],
          ["4", t("wizard.checkSetup")],
        ].map(([number, label]) => (
          <li key={label} className="rounded-md bg-white/65 px-3 py-2">
            <span className="mr-2 text-brand-700">{number}.</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="grid gap-3 md:grid-cols-4">
        <SetupActionButton
          label={t("wizard.previewSetup")}
          busy={busyAction === "preview"}
          disabled={Boolean(busyAction)}
          onClick={() => onSetupAction("preview")}
        />
        <SetupActionButton
          label={t("wizard.createFolders")}
          busy={busyAction === "initialize"}
          disabled={Boolean(busyAction) || !hasPreview}
          onClick={() => onSetupAction("initialize")}
        />
        <SetupActionButton
          label={t("wizard.saveSetup")}
          busy={busyAction === "save"}
          disabled={Boolean(busyAction) || !hasInitialize}
          onClick={() => onSetupAction("save")}
        />
        <SetupActionButton
          label={t("wizard.checkSetup")}
          busy={busyAction === "validate"}
          disabled={Boolean(busyAction) || !hasSave}
          onClick={() => onSetupAction("validate")}
        />
      </div>
      {createdFolderCount > 0 && (
        <button
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={Boolean(busyAction)}
          onClick={onCleanupCreatedFolders}
          type="button"
        >
          {t("wizard.cleanupFolders")}
        </button>
      )}
      {setupResult && (
        <div
          className={[
            "mt-4 rounded-md p-4 text-sm font-semibold leading-6",
            setupResult.kind === "success"
              ? "bg-emerald-50 text-emerald-900"
              : setupResult.kind === "warning"
                ? "bg-amber-50 text-amber-900"
                : "bg-rose-50 text-rose-900",
          ].join(" ")}
        >
          <p>{setupResult.title}</p>
          <p className="mt-1 font-medium">{setupResult.message}</p>
          {setupResult.details !== undefined && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-bold">{t("wizard.technicalDetails")}</summary>
              <button
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-slate-100 hover:bg-white/20"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(JSON.stringify(setupResult.details, null, 2))}
              >
                <Copy className="h-3.5 w-3.5" />
                {t("wizard.copyDetails")}
              </button>
              <pre className="mt-3 max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-ink p-3 font-mono text-xs leading-5 text-slate-100">
                {JSON.stringify(setupResult.details, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function SetupActionButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      className="rounded-md border border-white/70 bg-white/80 px-3 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? t("wizard.working") : label}
    </button>
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
          onChange={(event) => onChange(repairConcatenatedAbsolutePath(event.target.value))}
          placeholder={placeholder}
        />
        <button
          className="rounded-md border border-white/70 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
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
        <span className="text-xs font-medium leading-5 text-slate-600">{hint}</span>
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

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-white/65 bg-white/65 p-4">
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-slate-600">{text}</p>
    </div>
  );
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
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/65 bg-white/65 p-4">
      <span>
        <span className="block text-sm font-semibold text-slate-950">{title}</span>
        {help && (
          <span
            className="ml-2 inline-grid h-5 w-5 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800 ring-1 ring-brand-100"
            title={help}
            aria-label={help}
          >
            ?
          </span>
        )}
        <span className="mt-1 block text-sm font-medium leading-6 text-slate-600">{text}</span>
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
