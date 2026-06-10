import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Building2,
  CheckCircle2,
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
  SaveSetupResult,
  SetupPreview,
  WorkspaceInitResult,
} from "../../types";
import { buildConfigPreview } from "./configPreview";
import {
  createRuleId,
  createSetupDraft,
  defaultPathsForWorkspace,
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

export function SetupWizard({
  config,
  onClose,
  onSetupSaved,
}: {
  config?: HubConfig | null;
  onClose: () => void;
  onSetupSaved: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<SetupDraft>(() => createSetupDraft(config));
  const [setupResult, setSetupResult] = useState<SetupActionResult | null>(null);
  const [setupAction, setSetupAction] = useState<string | null>(null);
  const preview = useMemo(() => buildConfigPreview(draft), [draft]);
  const currentStep = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  function update<K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateWorkspaceBase(nextWorkspace: string) {
    setDraft((current) => {
      const oldDefaults = defaultPathsForWorkspace(current.workspaceBase, current.contractYear);
      const nextDefaults = defaultPathsForWorkspace(nextWorkspace, current.contractYear);
      const defaultManagedFields: (keyof ReturnType<typeof defaultPathsForWorkspace>)[] = [
        "gmailCredentialsFile",
        "gmailTokenFile",
        "ocrTextOutputFolder",
        "signedContractsOutputFolder",
      ];
      const hasCustomValues = defaultManagedFields.some(
        (field) => current[field] && current[field] !== oldDefaults[field],
      );
      const shouldRefreshDefaults =
        !hasCustomValues ||
        window.confirm(
          "Update FlowHost's suggested Gmail, scan, and contract paths to match the new workspace folder?",
        );

      return {
        ...current,
        workspaceBase: nextWorkspace,
        ...(shouldRefreshDefaults ? nextDefaults : {}),
      };
    });
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
      update(field, selectedPath);
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
    if (selectedPath) update(field, selectedPath);
  }

  async function chooseTokenFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: draft.gmailTokenFile || draft.workspaceBase,
    });
    const selectedPath = normalizeDialogSelection(selected);
    if (selectedPath) update("gmailTokenFile", `${selectedPath.replace(/[\\/]+$/g, "")}\\gmail_token.json`);
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

  async function runSetupAction(action: "preview" | "initialize" | "save" | "validate") {
    if (
      (action === "initialize" || action === "save") &&
      !window.confirm(
        action === "initialize"
          ? "Create the missing FlowHost setup folders? Existing folders and files will be left unchanged."
          : "Save FlowHost setup files now? Existing setup files will be backed up first.",
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
        setSetupResult({
          kind: failed ? "warning" : "success",
          title: failed ? "Needs attention" : "Created folders",
          message: failed
            ? `${failed} folder${failed === 1 ? "" : "s"} need attention. ${created} created, ${alreadyExists} already existed.`
            : `${created} created, ${alreadyExists} already existed. Existing files were left unchanged.`,
          details: result,
        });
      } else if (action === "save") {
        const result = await invoke<SaveSetupResult>("save_setup_config", {
          draft,
          confirmed: true,
        });
        const blocking = result.validation.workflows.filter(
          (workflow) => workflow.commandName && !workflow.canRun,
        ).length;
        setSetupResult({
          kind: blocking ? "warning" : "success",
          title: blocking ? "Saved config, setup not ready yet" : "Setup ready",
          message: blocking
            ? `Saved config and created ${result.backups.length} backup${result.backups.length === 1 ? "" : "s"}. ${blocking} workflow${blocking === 1 ? "" : "s"} still need attention.`
            : `Saved config. ${result.backups.length} backup${result.backups.length === 1 ? "" : "s"} created.`,
          details: result,
        });
        onSetupSaved();
      } else {
        const result = await invoke<PreflightReport>("validate_setup");
        const blocking = result.workflows.filter(
          (workflow) => workflow.commandName && !workflow.canRun,
        ).length;
        setSetupResult({
          kind: blocking ? "warning" : "success",
          title: blocking ? "Setup needs attention" : "Setup check complete",
          message: blocking
            ? `${blocking} workflow${blocking === 1 ? "" : "s"} cannot run yet.`
            : "FlowHost setup checks completed.",
          details: result,
        });
      }
    } catch (error) {
      setSetupResult({
        kind: "error",
        title: "Setup action could not finish",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSetupAction(null);
    }
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
          />
        )}
        {currentStep.key === "contracts" && (
          <ContractsStep
            draft={draft}
            update={update}
            onChooseSharedScanFolder={() => chooseDirectory("sharedScanFolder")}
            onChooseOcrTextFolder={() => chooseDirectory("ocrTextOutputFolder")}
            onChooseContractsOutputFolder={() => chooseDirectory("signedContractsOutputFolder")}
          />
        )}
        {currentStep.key === "safety" && <SafetyStep draft={draft} update={update} />}
        {currentStep.key === "review" && (
          <ReviewStep
            draft={draft}
            preview={preview}
            busyAction={setupAction}
            setupResult={setupResult}
            onSetupAction={runSetupAction}
          />
        )}
        {currentStep.key === "finish" && (
          <FinishStep
            busyAction={setupAction}
            setupResult={setupResult}
            onSetupAction={runSetupAction}
          />
        )}

        <div className="flex items-center justify-between rounded-lg border border-white/60 bg-white/48 p-4 shadow-glass backdrop-blur-xl">
          <button
            className="rounded-md border border-white/70 bg-white/65 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={isFirst}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            Back
          </button>
          {isLast ? (
            <button
              className="rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={onClose}
            >
              Return to setup
            </button>
          ) : (
            <button
              className="rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
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
      title="Set up FlowHost"
      helper="FlowHost helps hotel staff prepare office automations in a safer, clearer workspace."
    >
      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard title="Drafts only" text="FlowHost creates Gmail drafts only. It never sends emails automatically." />
        <InfoCard title="Safe by design" text="High-impact actions ask for confirmation before they run." />
        <InfoCard title="Setup first" text="This guide collects details only. It will not create folders or save files yet." />
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
      helper="These names appear in FlowHost and in draft email text."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel label="Hotel display name">
          <input
            className={inputClassName}
            value={draft.hotelDisplayName}
            onChange={(event) => update("hotelDisplayName", event.target.value)}
            placeholder="Life Hotel"
          />
        </FieldLabel>
        <FieldLabel label="Email signature name">
          <input
            className={inputClassName}
            value={draft.emailSignatureName}
            onChange={(event) => update("emailSignatureName", event.target.value)}
            placeholder="Life Hotel Team"
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
      helper="Choose where FlowHost should later keep working folders. This is text only for now."
    >
      <PathField
        label="Workspace folder"
        value={draft.workspaceBase}
        placeholder="C:\\FlowHost Workspace"
        hint="Choose a normal folder such as Desktop or Documents, not a drive root."
        onChange={onWorkspaceChange}
        onChoose={onChooseFolder}
      />
      <p className="mt-3 text-sm font-medium text-slate-600">
        Suggested name: FlowHost Workspace
      </p>
    </SetupStep>
  );
}

function FolderPreviewStep({ draft }: { draft: SetupDraft }) {
  return (
    <SetupStep
      icon={<FolderTree className="h-6 w-6" />}
      title="Folder preview"
      helper="These folders will be created in a later phase. Nothing is created now."
    >
      <div className="grid gap-3 md:grid-cols-2">
        {workspaceFolders(draft).map((folder) => (
          <div key={folder.relativePath} className="rounded-md bg-white/60 p-3">
            <p className="text-sm font-semibold text-slate-900">{folder.relativePath}</p>
            <p className="mt-1 break-words font-mono text-xs leading-5 text-slate-600">
              {folder.fullPath}
            </p>
          </div>
        ))}
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
      title="Gmail drafts"
      helper="FlowHost creates Gmail drafts only. No emails are sent automatically."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel label="Draft subject">
          <input
            className={inputClassName}
            value={draft.gmailSubject}
            onChange={(event) => update("gmailSubject", event.target.value)}
            placeholder="Invoices - Life Hotel"
          />
        </FieldLabel>
        <FieldLabel label="CC email">
          <input
            className={inputClassName}
            value={draft.ccEmail}
            onChange={(event) => update("ccEmail", event.target.value)}
            placeholder="backoffice@example.com"
          />
        </FieldLabel>
      </div>
      <details className="mt-5 rounded-md bg-white/55 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          Gmail file locations
        </summary>
        <div className="mt-4 grid gap-4">
          <PathField
            label="Credentials file path"
            value={draft.gmailCredentialsFile}
            placeholder="C:\\FlowHost Workspace\\Gmail\\Credentials\\gmail_credentials.json"
            hint="Choose the Google credentials JSON file. FlowHost stores only the file path."
            onChange={(value) => update("gmailCredentialsFile", value)}
            onChoose={onChooseCredentials}
            chooseLabel="Choose file"
          />
          <PathField
            label="Gmail sign-in file path"
            value={draft.gmailTokenFile}
            placeholder="C:\\FlowHost Workspace\\Gmail\\Token\\gmail_token.json"
            hint="Choose the token folder. FlowHost will use gmail_token.json in that folder."
            onChange={(value) => update("gmailTokenFile", value)}
            onChoose={onChooseTokenFolder}
            chooseLabel="Choose folder"
          />
        </div>
      </details>
      <p className="mt-4 rounded-md bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900">
        Google sign-in may be required later when the real workflow runs.
      </p>
    </SetupStep>
  );
}

function InvoiceRulesStep({
  draft,
  update,
  updateRule,
  addRule,
  removeRule,
}: {
  draft: SetupDraft;
  update: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
  updateRule: (id: string, patch: Partial<RecipientRuleDraft>) => void;
  addRule: () => void;
  removeRule: (id: string) => void;
}) {
  return (
    <SetupStep
      icon={<ReceiptText className="h-6 w-6" />}
      title="Invoice rules"
      helper="Tell FlowHost which invoice files to look for and how draft recipients should be matched."
    >
      <FieldLabel label="Invoice input pattern">
        <input
          className={inputClassName}
          value={draft.invoiceInputPattern}
          onChange={(event) => update("invoiceInputPattern", event.target.value)}
          placeholder="Funzione Pubblica amministrazione*.pdf"
        />
      </FieldLabel>

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
            <FieldLabel label={`Match text ${index + 1}`}>
              <input
                className={inputClassName}
                value={rule.matchText}
                onChange={(event) => updateRule(rule.id, { matchText: event.target.value })}
                placeholder="company or invoice text"
              />
            </FieldLabel>
            <FieldLabel label="Recipient email">
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
}: {
  draft: SetupDraft;
  update: <K extends keyof SetupDraft>(key: K, value: SetupDraft[K]) => void;
  onChooseSharedScanFolder: () => void;
  onChooseOcrTextFolder: () => void;
  onChooseContractsOutputFolder: () => void;
}) {
  return (
    <SetupStep
      icon={<ScanText className="h-6 w-6" />}
      title="Contracts and scans"
      helper="Collect the scan and signed-contract details FlowHost will use later."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FieldLabel label="Contract year">
          <input
            className={inputClassName}
            value={draft.contractYear}
            onChange={(event) => update("contractYear", event.target.value)}
            placeholder="2026"
          />
        </FieldLabel>
        <FieldLabel label="Scanner filename prefix">
          <input
            className={inputClassName}
            value={draft.scannerFilenamePrefix}
            onChange={(event) => update("scannerFilenamePrefix", event.target.value)}
            placeholder="Sharp MFP"
          />
        </FieldLabel>
      </div>
      <div className="mt-4 grid gap-4">
        <FieldLabel label="Contract marker text">
          <textarea
            className={textareaClassName}
            value={draft.contractMarkerText}
            onChange={(event) => update("contractMarkerText", event.target.value)}
          />
        </FieldLabel>
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
          hint="FlowHost stores extracted document text here."
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
      helper="Choose safe defaults before any real workflow is connected."
    >
      <div className="grid gap-3">
        <ToggleCard
          title="Safe mode"
          text="Safe mode lets you test workflows without changing real files."
          checked={draft.safeMode}
          onChange={(checked) => update("safeMode", checked)}
        />
        <ToggleCard
          title="Archive originals"
          text="Original invoices can be archived before they leave the input folder."
          checked={draft.archiveOriginals}
          onChange={(checked) => update("archiveOriginals", checked)}
        />
        <ToggleCard
          title="Hide personal details in support output"
          text="Support output should avoid exposing guest or employee details where possible."
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
  setupResult,
  onSetupAction,
}: {
  draft: SetupDraft;
  preview: ReturnType<typeof buildConfigPreview>;
  busyAction: string | null;
  setupResult: SetupActionResult | null;
  onSetupAction: (action: "preview" | "initialize" | "save" | "validate") => void;
}) {
  const filledRules = draft.recipientRules.filter(
    (rule) => rule.matchText.trim() || rule.email.trim(),
  );
  return (
    <SetupStep
      icon={<FileCheck2 className="h-6 w-6" />}
      title="Review"
      helper="Check the setup draft. Nothing will be saved yet."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard title="Hotel" value={draft.hotelDisplayName || "Not set"} />
        <SummaryCard title="Workspace" value={draft.workspaceBase || "Not set"} />
        <SummaryCard title="Gmail drafts" value={draft.gmailSubject || "Not set"} />
        <SummaryCard title="Invoice rules" value={`${filledRules.length} rule${filledRules.length === 1 ? "" : "s"}`} />
        <SummaryCard title="Contract year" value={draft.contractYear || "Not set"} />
        <SummaryCard
          title="Safety"
          value={[
            draft.safeMode ? "Safe mode" : "Real-run default",
            draft.archiveOriginals ? "Archive originals" : "No archive preference",
            draft.redactLogs ? "Hide personal details" : "Show full support output",
          ].join(", ")}
        />
      </div>

      <details className="mt-5 rounded-md bg-slate-950/95 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-teal-200">
          Show technical preview
        </summary>
        <pre className="mt-4 max-h-96 overflow-auto rounded-md bg-black/30 p-4 font-mono text-xs leading-5 text-slate-100">
          {JSON.stringify(preview, null, 2)}
        </pre>
      </details>

      <SetupActionPanel
        busyAction={busyAction}
        setupResult={setupResult}
        onSetupAction={onSetupAction}
      />
    </SetupStep>
  );
}

function FinishStep({
  busyAction,
  setupResult,
  onSetupAction,
}: {
  busyAction: string | null;
  setupResult: SetupActionResult | null;
  onSetupAction: (action: "preview" | "initialize" | "save" | "validate") => void;
}) {
  return (
    <SetupStep
      icon={<CheckCircle2 className="h-6 w-6" />}
      title="Setup draft is ready"
      helper="Create folders, save setup files, then run a setup check. Workflows still run separately from Automations."
    >
      <div className="rounded-md bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900">
        Setup actions only create folders and save configuration. FlowHost will not run workflows or
        create Gmail drafts from this page.
      </div>
      <SetupActionPanel
        busyAction={busyAction}
        setupResult={setupResult}
        onSetupAction={onSetupAction}
      />
    </SetupStep>
  );
}

function SetupActionPanel({
  busyAction,
  setupResult,
  onSetupAction,
}: {
  busyAction: string | null;
  setupResult: SetupActionResult | null;
  onSetupAction: (action: "preview" | "initialize" | "save" | "validate") => void;
}) {
  return (
    <div className="mt-5 rounded-md bg-white/55 p-4">
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
          disabled={Boolean(busyAction)}
          onClick={() => onSetupAction("initialize")}
        />
        <SetupActionButton
          label="Save setup"
          busy={busyAction === "save"}
          disabled={Boolean(busyAction)}
          onClick={() => onSetupAction("save")}
        />
        <SetupActionButton
          label="Check setup"
          busy={busyAction === "validate"}
          disabled={Boolean(busyAction)}
          onClick={() => onSetupAction("validate")}
        />
      </div>
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
              <summary className="cursor-pointer text-xs font-bold">Show setup result details</summary>
              <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
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
      className="rounded-md border border-white/70 bg-white/75 px-3 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
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
    <FieldLabel label={label}>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          className={inputClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <button
          className="rounded-md border border-white/70 bg-white/75 px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-white"
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
    <div className="rounded-md bg-white/60 p-4">
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm font-medium leading-6 text-slate-600">{text}</p>
    </div>
  );
}

function ToggleCard({
  title,
  text,
  checked,
  onChange,
}: {
  title: string;
  text: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md bg-white/60 p-4">
      <span>
        <span className="block text-sm font-semibold text-slate-950">{title}</span>
        <span className="mt-1 block text-sm font-medium leading-6 text-slate-600">{text}</span>
      </span>
      <input
        className="h-5 w-5 accent-teal-700"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md bg-white/60 p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
      <p className="mt-2 break-words text-sm font-semibold leading-6 text-slate-900">{value}</p>
    </div>
  );
}
