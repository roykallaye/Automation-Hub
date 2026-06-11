import { Clipboard, FileText, FolderOpen, PackageCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { DeveloperDetails } from "../components/DeveloperDetails";
import { PageHeader } from "../components/PageHeader";
import { ReadinessBadge } from "../components/StatusBadges";
import type {
  AppConfigStatus,
  LatestLog,
  ManagedAutomationInstallResult,
  RunSummary,
} from "../types";

export function SupportPage({
  configStatus,
  latestLogs,
  lastSummary,
  onOpenPath,
  onRefresh,
  onInstallAutomation,
}: {
  configStatus: AppConfigStatus | null;
  latestLogs: LatestLog[];
  lastSummary: RunSummary | null;
  onOpenPath: (path?: string | null) => void;
  onRefresh: () => void;
  onInstallAutomation: () => Promise<ManagedAutomationInstallResult>;
}) {
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<ManagedAutomationInstallResult | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [copiedPythonCommand, setCopiedPythonCommand] = useState(false);
  const config = configStatus?.config;
  const automationRoot = config?.automation.automationRootFolder;
  const pythonItem = configStatus?.preflight.items.find((item) => item.key === "pythonExecutable");
  const pythonPackagesItem = configStatus?.preflight.items.find(
    (item) => item.key === "pythonPackages",
  );
  const pythonPackageItems =
    configStatus?.preflight.dependencies.filter((item) => item.key.startsWith("pythonPackage")) ??
    [];
  const pythonInstallCommand = config ? buildPythonInstallCommand(config) : "";
  const canonicalScriptItems =
    configStatus?.preflight.items.filter((item) =>
      ["invoiceWorkflowScript", "gmailDraftScript", "contractProcessingScript"].includes(item.key),
    ) ?? [];
  const canonicalScriptsReady =
    canonicalScriptItems.length > 0 &&
    canonicalScriptItems.every((item) => item.status === "ready");
  const paths = config
    ? [
        ["Automation scripts folder", config.automation.automationRootFolder],
        ["Automation setup file", config.automation.automationConfigPath],
        ["Python", config.automation.pythonExecutable],
        ["Invoice script", config.scripts.invoiceWorkflowScript],
        ["Gmail draft script", config.scripts.gmailDraftScript],
        ["Copy scanned documents script", config.scripts.copyScansioniScript],
        ["Document reading script", config.scripts.ocrPreprocessingScript],
        ["Contracts script", config.scripts.contractProcessingScript],
        ["Invoice input folder", config.folders.invoiceInputFolder],
        ["Invoice output folder", config.folders.invoiceOutputFolder],
        ["Invoice archive folder", config.folders.invoiceArchiveFolder],
        ["Invoice log folder", config.folders.invoiceLogFolder],
        ["Shared scan folder", config.folders.scansioniNetworkShare],
        ["Local scan cache", config.folders.scansioniLocalCacheFolder],
        ["Document text output", config.folders.ocrTextOutputFolder],
        ["Contracts output folder", config.folders.contractsOutputFolder],
        ["Contract log folder", config.folders.contractLogFolder],
        ["Gmail sign-in file", config.gmail.tokenPath],
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Support" eyebrow="Advanced details">
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
          <h2 className="text-xl font-semibold text-slate-950">Configured paths</h2>
          <p className="mt-1 text-sm font-medium text-slate-600">
            Technical locations for setup support. Token contents are never shown.
          </p>
          <div className="mt-4 space-y-2">
            {paths.map(([label, value]) => (
              <div key={label} className="rounded-md bg-white/55 px-3 py-2">
                <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
                <p className="mt-1 break-words font-mono text-xs leading-5 text-slate-700">
                  {value || "Not configured"}
                </p>
              </div>
            ))}
            {!paths.length && (
              <div className="rounded-md bg-white/55 p-4 text-sm font-medium text-slate-700">
                Setup details are unavailable.
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/70 text-teal-800 ring-1 ring-teal-100">
                <PackageCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Automation scripts</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  Copies FlowHost's own automation scripts into the app data folder. This does not run workflows or touch hotel files.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-md bg-white/60 p-3 text-sm font-semibold text-slate-800">
              {canonicalScriptsReady ? "Canonical scripts found" : "Canonical scripts need attention"}
            </div>
            <p className="mt-3 break-words font-mono text-xs leading-5 text-slate-600">
              {automationRoot || "Automation scripts folder is not configured."}
            </p>
            <button
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={installing}
              onClick={async () => {
                const confirmed = window.confirm(
                  "Install or refresh FlowHost automation scripts? This copies FlowHost's own scripts into the app data folder. It does not run workflows or touch hotel files.",
                );
                if (!confirmed) return;
                setInstalling(true);
                setInstallResult(null);
                setInstallError(null);
                try {
                  const result = await onInstallAutomation();
                  setInstallResult(result);
                } catch (error) {
                  setInstallError(error instanceof Error ? error.message : String(error));
                } finally {
                  setInstalling(false);
                }
              }}
            >
              {installing ? "Installing..." : "Install/refresh managed scripts"}
            </button>
            {installResult && (
              <div className="mt-4 rounded-md bg-white/65 p-3 text-sm font-medium leading-6 text-slate-700">
                <p className="font-semibold text-slate-950">Managed scripts refreshed.</p>
                <p>Copied: {installResult.copied.length}</p>
                <p>Backups: {installResult.backedUp.length}</p>
                <p>Skipped: {installResult.skipped.length}</p>
                {installResult.errors.length > 0 && (
                  <p className="font-semibold text-rose-800">
                    Needs attention: {installResult.errors.length}
                  </p>
                )}
              </div>
            )}
            {installError && (
              <div className="mt-4 rounded-md bg-rose-50 p-3 text-sm font-semibold leading-6 text-rose-800">
                {installError}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-950">Python environment</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
              Python runs FlowHost automation scripts. Installing packages here does not run workflows.
            </p>
            <div className="mt-4 rounded-md bg-white/60 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">Selected Python</p>
              <p className="mt-1 break-words font-mono text-xs leading-5 text-slate-700">
                {config?.automation.pythonExecutable || "Not configured"}
              </p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800">
                  {pythonItem?.status === "ready" ? "Python found" : "Python missing"}
                </span>
                {pythonItem && <ReadinessBadge status={pythonItem.status} />}
              </div>
              {pythonItem?.message && (
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                  {friendlyPythonMessage(pythonItem.message)}
                </p>
              )}
            </div>

            <div className="mt-4 space-y-2">
              {pythonPackageItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{item.label}</p>
                    <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
                      {item.message}
                    </p>
                  </div>
                  <ReadinessBadge status={item.status} />
                </div>
              ))}
              {!pythonPackageItems.length && (
                <div className="rounded-md bg-white/55 p-3 text-sm font-medium text-slate-700">
                  Python package checks are unavailable.
                </div>
              )}
            </div>

            {pythonPackagesItem?.status !== "ready" && pythonInstallCommand && (
              <div className="mt-4 rounded-md border border-amber-100 bg-amber-50/80 p-3">
                <p className="text-sm font-semibold text-amber-950">
                  Install automation packages
                </p>
                <p className="mt-1 text-sm font-medium leading-6 text-amber-800">
                  Run this in PowerShell after Python is installed.
                </p>
                <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-white/75 p-3 font-mono text-xs leading-5 text-slate-800">
                  {pythonInstallCommand}
                </pre>
                <button
                  className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/70 bg-white/75 px-3 text-xs font-semibold text-slate-800 hover:bg-white"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(pythonInstallCommand);
                      setCopiedPythonCommand(true);
                    } catch {
                      setCopiedPythonCommand(false);
                    }
                  }}
                >
                  <Clipboard className="h-4 w-4 text-teal-700" />
                  {copiedPythonCommand ? "Copied" : "Copy command"}
                </button>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-teal-100 bg-teal-50/80 p-5 shadow-glass backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/70 text-teal-800 ring-1 ring-teal-100">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Safe local rehearsal</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  Use a fake workspace and Safe mode for runtime smoke tests. FlowHost creates Gmail drafts only and never sends emails automatically.
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-md border border-teal-100 bg-white/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
                Rehearsal guide
              </p>
              <p className="mt-1 font-mono text-xs text-slate-700">
                docs\FAKE_WORKSPACE_REHEARSAL.md
              </p>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                Follow this checklist for exact fake setup values, fake credentials, expected statuses, and result notes.
              </p>
            </div>
            <div className="mt-4 rounded-md bg-white/60 p-3 text-sm font-semibold text-slate-800">
              Safe mode is {config?.safety.dryRunDefault ? "on" : "off"}
            </div>
            <ol className="mt-4 space-y-2 text-sm font-medium leading-6 text-slate-700">
              <li>1. Open Setup and choose a fake workspace folder.</li>
              <li>2. Create folders, save setup, then check setup.</li>
              <li>3. Use fake files only and keep Gmail credentials unset unless testing validation.</li>
              <li>4. Run only dry-run automations and confirm Activity receives a summary.</li>
            </ol>
          </section>

          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-950">Preflight checks</h2>
            <div className="mt-4 space-y-2">
              {configStatus?.preflight.items.slice(0, 8).map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2"
                >
                  <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                  <ReadinessBadge status={item.status} />
                </div>
              ))}
              {!configStatus && (
                <div className="rounded-md bg-white/55 p-4 text-sm font-medium text-slate-700">
                  No setup check is available.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-950">Dependency checks</h2>
            <div className="mt-4 space-y-2">
              {configStatus?.preflight.dependencies.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2"
                >
                  <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                  <ReadinessBadge status={item.status} />
                </div>
              ))}
              {!configStatus && (
                <div className="rounded-md bg-white/55 p-4 text-sm font-medium text-slate-700">
                  Dependency checks are unavailable.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-950">Support logs</h2>
            <div className="mt-4 space-y-2">
              {latestLogs.map((log) => (
                <button
                  key={log.key}
                  className="flex w-full items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2 text-left text-xs transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!log.path}
                  onClick={() => onOpenPath(log.path)}
                >
                  <span className="font-semibold text-slate-700">{log.label}</span>
                  <FileText className="h-4 w-4 shrink-0 text-teal-700" />
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-950">Last technical code</h2>
            <p className="mt-2 text-sm font-medium text-slate-600">
              {lastSummary ? String(lastSummary.exit_code) : "No run yet."}
            </p>
          </section>

          {config?.folders.invoiceLogFolder && (
            <button
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-white/70 bg-white/65 px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
              onClick={() => onOpenPath(config.folders.invoiceLogFolder)}
            >
              <FolderOpen className="h-5 w-5 text-teal-700" />
              Open support log folder
            </button>
          )}
        </aside>
      </div>

      <section className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
        <DeveloperDetails configStatus={configStatus} />
      </section>
    </div>
  );
}

function buildPythonInstallCommand(config: AppConfigStatus["config"]) {
  const python = config.automation.pythonExecutable?.trim() || "python";
  const requirements = joinWindowsPath(config.automation.automationRootFolder, "requirements.txt");
  const pythonCommand =
    python.includes("\\") || python.includes("/") || python.includes(":")
      ? `& "${python}"`
      : python;
  return `${pythonCommand} -m pip install -r "${requirements}"`;
}

function joinWindowsPath(root: string, child: string) {
  const cleanRoot = root.trim().replace(/[\\/]$/, "");
  return cleanRoot ? `${cleanRoot}\\${child}` : child;
}

function friendlyPythonMessage(message: string) {
  return message
    .replace("Python found:", "Python found:")
    .replace("Python was not found at the selected path.", "Python was not found.");
}
