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

const steps: WizardStepMeta[] = [
  { key: "welcome", title: "Welcome" },
  { key: "profile", title: "Hotel" },
  { key: "workspace", title: "Workspace" },
  { key: "folders", title: "Folders" },
  { key: "gmail", title: "Gmail drafts" },
  { key: "invoices", title: "Invoices" },
  { key: "contracts", title: "Contracts" },
  { key: "safety", title: "Safety" },
  { key: "review", title: "Review" },
  { key: "finish", title: "Finish" },
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
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<SetupDraft>(() => createSetupDraft(config));
  const [setupResult, setSetupResult] = useState<SetupActionResult | null>(null);
  const [setupAction, setSetupAction] = useState<string | null>(null);
  const [completedActions, setCompletedActions] = useState<SetupAction[]>([]);
  const [createdFolderPaths, setCreatedFolderPaths] = useState<string[]>([]);
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
          ? "Create the missing InnPilot setup folders? Existing folders and files will be left unchanged."
          : "Save InnPilot setup files now? Existing setup files will be backed up first.",
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
          title: "Setup preview ready",
          message: `${result.folderPlan.length} folders checked. ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}.`,
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
              ? "Invalid folder path"
              : "Needs attention"
            : "Created folders",
          message: failed
            ? invalidPathFailure
              ? "InnPilot generated an invalid folder path. Please contact setup support."
              : `${failed} folder${failed === 1 ? "" : "s"} need attention. ${created} created, ${alreadyExists} already existed.`
            : `${created} created, ${alreadyExists} already existed. Existing files were left unchanged.`,
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
        const guidance = validationGuidance(result.validation);
        setSetupResult({
          kind: blocking ? "warning" : "success",
          title: blocking ? "Saved setup, one step remains" : "Setup ready",
          message: blocking
            ? `${guidance} ${result.backups.length} backup${result.backups.length === 1 ? "" : "s"} created.`
            : `Setup saved. ${result.backups.length} backup${result.backups.length === 1 ? "" : "s"} created.`,
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
          title: blocking ? "Setup needs one more step" : "Setup check passed",
          message: blocking
            ? validationGuidance(result)
            : "Setup is ready. Go to Automations when you want to run workflows.",
          details: result,
        });
        if (!blocking) markActionComplete("validate");
        await onSetupSaved();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const invalidPathMessage =
        message.includes("os error 123") || message.toLowerCase().includes("invalid path")
          ? "InnPilot generated an invalid folder path. Please contact setup support."
          : message;
      setSetupResult({
        kind: "error",
        title: "Setup action could not finish",
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
        "Remove empty folders created during this setup attempt? InnPilot will skip folders that contain files.",
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
        title: result.failed.length ? "Some folders were left unchanged" : "Empty folders removed",
        message: `${result.removed.length} removed, ${result.skipped.length} skipped, ${result.failed.length} need attention.`,
        details: result,
      });
      setCreatedFolderPaths([]);
      setCompletedActions((current) => current.filter((action) => action !== "initialize"));
      await onSetupSaved();
    } catch (error) {
      setSetupResult({
        kind: "error",
        title: "Cleanup could not finish",
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
            Back
          </button>
          {isLast ? (
            <button
              className="rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-ink-soft"
              onClick={onClose}
            >
              Return to setup
            </button>
          ) : (
            <button
              className="rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-ink-soft"
              onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}
            >
              {isFirst ? "Start setup" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function validationGuidance(report: PreflightReport) {
  const workflow = report.workflows.find(
    (current) => current.commandName && !current.canRun,
  );
  if (!workflow) return "Setup is ready.";

  const item = firstBlockingItem(report, workflow);
  if (!item) return staffMessage(workflow.message, workflow.status, workflow.key);

  if (item.key === "automationConfigPath") {
    return "Folders may be ready. Save setup to finish.";
  }
  if (item.key === "copyScansioniScript" || item.key === "ocrPreprocessingScript") {
    return "Setup saved. Some scan/OCR tools are not configured yet.";
  }
  if (item.itemType === "script") {
    return "Setup saved. Some automation tools are not configured yet.";
  }
  if (item.key === "scansioniNetworkShare") {
    return "Setup saved. The shared scan folder is not reachable yet.";
  }
  if (item.itemType === "folder") {
    return "Setup saved. One folder still needs attention.";
  }
  if (item.key === "gmailTokenFolder" || item.key === "gmailTokenAlignment") {
    return "Setup saved. Gmail sign-in setup still needs attention.";
  }
  if (item.key === "pythonExecutable") {
    return "Setup saved. Python is not available yet.";
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
  return (
    <SetupStep
      icon={<Sparkles className="h-6 w-6" />}
      title="Set up InnPilot"
      helper="A few guided steps prepare InnPilot for this hotel."
    >
      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="Email choice" text="Prepare files only or create Gmail drafts for review." />
        <InfoCard title="Confirm first" text="Important actions ask before they run." />
        <InfoCard title="Guided setup" text="Preview, create folders, then save when ready." />
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
  return (
    <SetupStep
      icon={<Building2 className="h-6 w-6" />}
      title="Hotel profile"
      helper="These names appear in InnPilot and in draft email text."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel
          label="Hotel display name"
          help="Shown inside InnPilot and used in prepared email text."
        >
          <input
            className={inputClassName}
            value={draft.hotelDisplayName}
            onChange={(event) => update("hotelDisplayName", event.target.value)}
            placeholder="Your Hotel"
          />
        </FieldLabel>
        <FieldLabel
          label="Email signature name"
          help="The closing name used in draft email text, e.g. 'Your Hotel Team'."
        >
          <input
            className={inputClassName}
            value={draft.emailSignatureName}
            onChange={(event) => update("emailSignatureName", event.target.value)}
            placeholder="Your Hotel Team"
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
  return (
    <SetupStep
      icon={<FolderTree className="h-6 w-6" />}
      title="Workspace"
      helper="Choose where InnPilot keeps its working folders."
    >
      <PathField
        label="Workspace folder"
        value={draft.workspaceBase}
        placeholder="C:\\InnPilot\\workspace"
        hint="Choose a normal folder such as Desktop or Documents, not a drive root."
        onChange={onWorkspaceChange}
        onChoose={onChooseFolder}
      />
      <p className="mt-3 text-sm font-medium text-slate-600">
        Suggested folder: C:\InnPilot\workspace
      </p>
    </SetupStep>
  );
}

function FolderPreviewStep({ draft }: { draft: SetupDraft }) {
  return (
    <SetupStep
      icon={<FolderTree className="h-6 w-6" />}
      title="Folder preview"
      helper="These folders keep daily work organized."
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
  return (
    <SetupStep
      icon={<Mail className="h-6 w-6" />}
      title="Invoice emails"
      helper="Choose how InnPilot should help with invoice email delivery."
    >
      <div className="grid gap-3 md:grid-cols-3">
        <DeliveryModeCard
          title="Prepare files only"
          text="I will send emails myself."
          selected={draft.invoiceDeliveryMode === "prepareOnly"}
          onClick={() => update("invoiceDeliveryMode", "prepareOnly")}
        />
        <DeliveryModeCard
          title="Create Gmail drafts"
          text="Recommended. Emails are not sent automatically."
          selected={draft.invoiceDeliveryMode === "gmailDrafts"}
          onClick={() => update("invoiceDeliveryMode", "gmailDrafts")}
        />
        <DeliveryModeCard
          title="Send automatically"
          text="Future advanced option. Not available yet."
          selected={draft.invoiceDeliveryMode === "sendAutomatically"}
          disabled
          onClick={() => update("invoiceDeliveryMode", "sendAutomatically")}
        />
      </div>
      {draft.invoiceDeliveryMode === "prepareOnly" && (
        <p className="mt-4 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
          Gmail setup is optional in this mode. InnPilot will prepare invoice files only.
        </p>
      )}
      {draft.invoiceDeliveryMode === "sendAutomatically" && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          Automatic sending is not enabled yet. Choose Prepare files only or Create Gmail drafts.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel
          label="Draft subject"
          help="The subject line used for prepared invoice emails."
        >
          <input
            className={inputClassName}
            value={draft.gmailSubject}
            onChange={(event) => update("gmailSubject", event.target.value)}
            placeholder="Invoices - Your Hotel"
          />
        </FieldLabel>
        <FieldLabel
          label="CC email"
          help="Optional address copied on every prepared invoice email."
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
          Gmail file locations {draft.invoiceDeliveryMode === "prepareOnly" ? "(optional)" : ""}
        </summary>
        <div className="mt-4 grid gap-4">
          <PathField
            label="Credentials file path"
            value={draft.gmailCredentialsFile}
            placeholder="C:\\InnPilot\\workspace\\Gmail\\Credentials\\gmail_credentials.json"
            hint="Choose the Google credentials JSON file. InnPilot stores only the file path."
            onChange={(value) => update("gmailCredentialsFile", value)}
            onChoose={onChooseCredentials}
            chooseLabel="Choose file"
          />
          <PathField
            label="Gmail sign-in file path"
            value={draft.gmailTokenFile}
            placeholder="C:\\InnPilot\\workspace\\Gmail\\Token\\gmail_token.json"
            hint="Choose the token folder. InnPilot will use gmail_token.json in that folder."
            onChange={(value) => update("gmailTokenFile", value)}
            onChoose={onChooseTokenFolder}
            chooseLabel="Choose folder"
          />
        </div>
      </details>
      {draft.invoiceDeliveryMode === "gmailDrafts" && (
        <p className="mt-4 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
          Google sign-in may be needed later. No emails are sent automatically.
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
  return (
    <SetupStep
      icon={<ReceiptText className="h-6 w-6" />}
      title="Invoice rules"
      helper="Match invoice text to the right draft recipient."
    >
      <ListEditor
        label="Invoice file name patterns"
        help="InnPilot looks for invoice PDFs whose names match any of these patterns."
        values={draft.invoiceInputPatterns}
        placeholder="Funzione Pubblica amministrazione*.pdf"
        addLabel="Add pattern"
        onChange={(index, value) => updateList("invoiceInputPatterns", index, value)}
        onAdd={() => addListItem("invoiceInputPatterns", "")}
        onRemove={(index) => removeListItem("invoiceInputPatterns", index)}
      />

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-800">Recipient rules</p>
          <button
            className="rounded-md border border-white/70 bg-white/65 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
            onClick={addRule}
          >
            Add rule
          </button>
        </div>
        {draft.recipientRules.map((rule, index) => (
          <div key={rule.id} className="grid gap-3 rounded-md bg-white/55 p-3 md:grid-cols-[1fr_1fr_auto]">
            <FieldLabel
              label={`Match text ${index + 1}`}
              help="If this text appears in the invoice, InnPilot routes it to the matching email."
            >
              <input
                className={inputClassName}
                value={rule.matchText}
                onChange={(event) => updateRule(rule.id, { matchText: event.target.value })}
                placeholder="company or invoice text"
              />
            </FieldLabel>
            <FieldLabel
              label="Recipient email"
              help="The draft recipient for invoices matching this rule."
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
              Remove
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
  return (
    <SetupStep
      icon={<ScanText className="h-6 w-6" />}
      title="Contracts and scans"
      helper="Choose where scanned files and signed contracts belong."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel
          label="Contract year"
          help="Signed contracts are organized under this year's folder."
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
          label="Scanner filename prefixes"
          help="InnPilot checks scanned PDF names that begin with any of these labels."
          values={draft.scannerFilenamePrefixes}
          placeholder="Sharp MFP"
          addLabel="Add scanner"
          onChange={(index, value) => updateList("scannerFilenamePrefixes", index, value)}
          onAdd={() => addListItem("scannerFilenamePrefixes", "")}
          onRemove={(index) => removeListItem("scannerFilenamePrefixes", index)}
        />
        <ListEditor
          label="Contract marker texts"
          help="A scan is treated as a contract if its extracted text contains any of these phrases."
          values={draft.contractMarkerTexts}
          placeholder="Oggetto: Contratto di lavoro subordinato a tempo determinato"
          addLabel="Add marker"
          multiline
          onChange={(index, value) => updateList("contractMarkerTexts", index, value)}
          onAdd={() => addListItem("contractMarkerTexts", "")}
          onRemove={(index) => removeListItem("contractMarkerTexts", index)}
        />
        <PathField
          label="Shared scan folder"
          value={draft.sharedScanFolder}
          placeholder="\\\\server\\shared\\Scansioni"
          hint="Choose the shared folder where scanned documents arrive."
          onChange={(value) => update("sharedScanFolder", value)}
          onChoose={onChooseSharedScanFolder}
        />
        <PathField
          label="Document text output folder"
          value={draft.ocrTextOutputFolder}
          hint="InnPilot stores extracted document text here."
          onChange={(value) => update("ocrTextOutputFolder", value)}
          onChoose={onChooseOcrTextFolder}
        />
        <PathField
          label="Signed contracts output folder"
          value={draft.signedContractsOutputFolder}
          hint="Processed signed contracts will be organized here later."
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
  return (
    <SetupStep
      icon={<ShieldCheck className="h-6 w-6" />}
      title="Safety"
      helper="Keep first runs cautious and support output private."
    >
      <div className="grid gap-3">
        <div className="rounded-lg border border-white/65 bg-white/65 p-4">
          <FieldLabel
            label="Python used by automations"
            help="Setup support can point InnPilot to the managed Python installed for automation checks."
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
                Use managed Python
              </button>
            </div>
            <p className="mt-2 text-xs font-medium leading-5 text-slate-600">
              Recommended: {managedPythonExecutable()}
            </p>
          </FieldLabel>
        </div>
        <ToggleCard
          title="Safe mode"
          text="Safe mode lets you test workflows without changing real files."
          help="Keep this on for rehearsal and first checks. Dry runs do not move/delete files or create Gmail drafts."
          checked={draft.safeMode}
          onChange={(checked) => update("safeMode", checked)}
        />
        <ToggleCard
          title="Archive originals"
          text="Original invoices can be archived before they leave the input folder."
          help="In real runs, successful original invoice PDFs are kept in an archive instead of being deleted."
          checked={draft.archiveOriginals}
          onChange={(checked) => update("archiveOriginals", checked)}
        />
        <ToggleCard
          title="Hide personal details in support output"
          text="Support output should avoid exposing guest or employee details where possible."
          help="Keeps support messages more private when logs or reports are shown."
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
  const filledRules = draft.recipientRules.filter(
    (rule) => rule.matchText.trim() || rule.email.trim(),
  );
  return (
    <SetupStep
      icon={<FileCheck2 className="h-6 w-6" />}
      title="Review"
      helper="Check the setup before creating folders or saving."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard title="Hotel" value={draft.hotelDisplayName || "Not set"} />
        <SummaryCard title="Workspace" value={draft.workspaceBase || "Not set"} />
        <SummaryCard title="Invoice delivery" value={deliveryModeSummary(draft.invoiceDeliveryMode)} />
        <SummaryCard
          title="Invoice rules"
          value={`${filledRules.length} recipient rule${filledRules.length === 1 ? "" : "s"}, ${draft.invoiceInputPatterns.filter((pattern) => pattern.trim()).length} file pattern${draft.invoiceInputPatterns.filter((pattern) => pattern.trim()).length === 1 ? "" : "s"}`}
        />
        <SummaryCard title="Contract year" value={draft.contractYear || "Not set"} />
        <SummaryCard title="Python" value={draft.pythonExecutable || "Not set"} />
        <SummaryCard
          title="Safety"
          value={[
            draft.safeMode ? "Safe mode" : "Real-run default",
            draft.archiveOriginals ? "Archive originals" : "No archive preference",
            draft.redactLogs ? "Hide personal details" : "Show full support output",
          ].join(", ")}
        />
      </div>

      <details className="mt-5 max-w-full rounded-md bg-ink/95 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-brand-200">
          Technical details for support
        </summary>
        <button
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-slate-100 hover:bg-white/20"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(JSON.stringify(preview, null, 2))}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy details
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
  return (
    <SetupStep
      icon={<CheckCircle2 className="h-6 w-6" />}
      title="Setup draft is ready"
      helper="Create folders, save setup, then run a setup check."
    >
      <div className="rounded-md bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900">
        Setup actions only create folders and save settings. Workflows stay on the Automations page.
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
  const hasPreview = completedActions.includes("preview");
  const hasInitialize = completedActions.includes("initialize");
  const hasSave = completedActions.includes("save");
  return (
    <div className="mt-5 rounded-lg bg-white/60 p-4">
      <ol className="mb-4 grid gap-2 text-sm font-semibold text-slate-700 md:grid-cols-4">
        {[
          ["1", "Preview setup"],
          ["2", "Create folders"],
          ["3", "Save setup"],
          ["4", "Check setup"],
        ].map(([number, label]) => (
          <li key={label} className="rounded-md bg-white/65 px-3 py-2">
            <span className="mr-2 text-brand-700">{number}.</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="grid gap-3 md:grid-cols-4">
        <SetupActionButton
          label="Preview setup"
          busy={busyAction === "preview"}
          disabled={Boolean(busyAction)}
          onClick={() => onSetupAction("preview")}
        />
        <SetupActionButton
          label="Create folders"
          busy={busyAction === "initialize"}
          disabled={Boolean(busyAction) || !hasPreview}
          onClick={() => onSetupAction("initialize")}
        />
        <SetupActionButton
          label="Save setup"
          busy={busyAction === "save"}
          disabled={Boolean(busyAction) || !hasInitialize}
          onClick={() => onSetupAction("save")}
        />
        <SetupActionButton
          label="Check setup"
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
          Remove empty folders created by this setup
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
              <summary className="cursor-pointer text-xs font-bold">Technical details for support</summary>
              <button
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-white/25 bg-white/10 px-3 py-2 text-xs font-bold text-slate-100 hover:bg-white/20"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(JSON.stringify(setupResult.details, null, 2))}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy details
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
  return (
    <button
      className="rounded-md border border-white/70 bg-white/80 px-3 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? "Working..." : label}
    </button>
  );
}

function PathField({
  label,
  value,
  placeholder,
  hint,
  chooseLabel = "Choose",
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
  const status = pathStatus(value);
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
          {chooseLabel}
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
          {status.label}
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
              Remove
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
    return { kind: "empty", label: "Not selected" } as const;
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
    return { kind: "warning", label: "Needs review" } as const;
  }
  return { kind: "ready", label: "Looks usable" } as const;
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

function deliveryModeSummary(mode: SetupDraft["invoiceDeliveryMode"]) {
  if (mode === "prepareOnly") return "Prepare files only. Emails are sent manually.";
  if (mode === "sendAutomatically") return "Send automatically is not available yet.";
  return "Create Gmail drafts. No automatic sending.";
}
