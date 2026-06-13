import {
  Clipboard,
  Cpu,
  FileText,
  FolderOpen,
  HeartPulse,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import { DeveloperDetails } from "../components/DeveloperDetails";
import { InfoHint } from "../components/InfoHint";
import { PageHeader } from "../components/PageHeader";
import { ReadinessBadge } from "../components/StatusBadges";
import { StatusHint, type StatusTone } from "../components/StatusOrb";
import { useI18n } from "../i18n";
import type {
  AppConfigStatus,
  AppPage,
  LatestLog,
  ManagedAutomationInstallResult,
  PreflightItem,
  RunSummary,
} from "../types";

/*
  Support is a calm diagnostic center: a health summary first, then guided
  fixes with in-app buttons. Raw paths, preflight tables, and JSON live behind
  one "Technical details" area at the end.
*/
export function SupportPage({
  configStatus,
  latestLogs,
  lastSummary,
  onOpenPath,
  onRefresh,
  onInstallAutomation,
  onNavigate,
}: {
  configStatus: AppConfigStatus | null;
  latestLogs: LatestLog[];
  lastSummary: RunSummary | null;
  onOpenPath: (path?: string | null) => void;
  onRefresh: () => void;
  onInstallAutomation: () => Promise<ManagedAutomationInstallResult>;
  onNavigate: (page: AppPage) => void;
}) {
  const { t } = useI18n();
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<ManagedAutomationInstallResult | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [copiedPythonCommand, setCopiedPythonCommand] = useState(false);
  const [copiedSupportBundle, setCopiedSupportBundle] = useState(false);

  const config = configStatus?.config;
  const items = configStatus?.preflight.items ?? [];
  const automationRoot = config?.automation.automationRootFolder;
  const pythonItem = items.find((item) => item.key === "pythonExecutable");
  const pythonPackagesItem = items.find((item) => item.key === "pythonPackages");
  const pythonPackageItems =
    configStatus?.preflight.dependencies.filter((item) => item.key.startsWith("pythonPackage")) ??
    [];
  const pythonInstallCommand = config ? buildPythonInstallCommand(config) : "";

  const scriptItems = items.filter((item) => item.itemType === "script");
  const folderItems = items.filter((item) => item.itemType === "folder");
  const gmailRelevant = config?.invoiceDeliveryMode !== "prepareOnly";
  const gmailItems = gmailRelevant
    ? items.filter((item) =>
        ["gmailCredentialsFile", "gmailTokenPath", "gmailTokenFolder"].includes(item.key),
      )
    : [];

  const canonicalScriptItems = items.filter((item) =>
    ["invoiceWorkflowScript", "gmailDraftScript", "contractProcessingScript"].includes(item.key),
  );
  const canonicalScriptsReady =
    canonicalScriptItems.length > 0 &&
    canonicalScriptItems.every((item) => item.status === "ready");

  const healthAreas: { label: string; tone: StatusTone; note: string }[] = configStatus
    ? [
        healthArea(t("support.python"), [pythonItem, pythonPackagesItem], t),
        healthArea(t("support.automationScripts"), scriptItems, t),
        healthArea(t("support.foldersPermissions"), folderItems, t),
        ...(gmailRelevant ? [healthArea(t("support.gmailSignin"), gmailItems, t)] : []),
      ]
    : [];

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

  async function copySupportBundle() {
    if (!configStatus) return;
    const bundle = {
      configPath: configStatus.configPath,
      checkedAt: configStatus.preflight.checkedAt,
      items: configStatus.preflight.items.map((item) => ({
        key: item.key,
        status: item.status,
        message: item.message,
      })),
      workflows: configStatus.preflight.workflows.map((workflow) => ({
        key: workflow.key,
        status: workflow.status,
        canRun: workflow.canRun,
        message: workflow.message,
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setCopiedSupportBundle(true);
    } catch {
      setCopiedSupportBundle(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("support.title")} eyebrow={t("support.eyebrow")}>
        <button
          className="rounded-md border border-white/70 bg-white/65 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          onClick={onRefresh}
        >
          {t("support.checkAgain")}
        </button>
      </PageHeader>

      <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-rose-100 text-rose-700 ring-1 ring-rose-200">
            <HeartPulse className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-slate-950">{t("support.health")}</h2>
          <InfoHint text={t("support.healthHint")} />
        </div>
        <div className="stagger-children mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {healthAreas.map((area) => (
            <div key={area.label} className="rounded-lg border border-white/70 bg-white/60 p-3.5">
              <p className="text-sm font-semibold text-slate-900">{area.label}</p>
              <div className="mt-2">
              <StatusHint tone={area.tone} label={toneLabel(area.tone, t)} />
              </div>
              <p className="mt-1.5 text-xs font-medium leading-5 text-slate-600">{area.note}</p>
            </div>
          ))}
          {!configStatus && (
            <p className="text-sm font-medium text-slate-700">
              {t("support.setupUnavailable")}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-200">
              <PackageCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-slate-950">{t("support.automationScripts")}</h2>
            <InfoHint text={t("support.scriptsHint")} />
          </div>
          <div className="mt-4">
            <StatusHint
              tone={canonicalScriptsReady ? "ready" : "attention"}
              label={canonicalScriptsReady ? t("support.scriptsFound") : t("support.scriptsNeedAttention")}
            />
          </div>
          <button
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
            disabled={installing}
            onClick={async () => {
              const confirmed = window.confirm(
                t("support.confirmInstallScripts"),
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
            {installing ? t("support.installing") : t("support.installRefresh")}
          </button>
          {installResult && (
            <div className="animate-pop mt-4 rounded-md bg-white/65 p-3 text-sm font-medium leading-6 text-slate-700">
              <p className="font-semibold text-slate-950">{t("support.scriptsRefreshed")}</p>
              <p>
                {t("support.installCounts", {
                  copied: installResult.copied.length,
                  backedUp: installResult.backedUp.length,
                  skipped: installResult.skipped.length,
                })}
              </p>
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
          <p className="mt-3 break-words font-mono text-xs leading-5 text-slate-500">
            {automationRoot || t("support.automationFolderMissing")}
          </p>
        </section>

        <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
              <Cpu className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-slate-950">{t("support.pythonEnvironment")}</h2>
            <InfoHint text={t("support.pythonHint")} />
          </div>
          <div className="mt-4 rounded-md bg-white/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-800">
                {pythonItem?.status === "ready" ? t("support.pythonFound") : t("support.pythonMissing")}
              </span>
              {pythonItem && <ReadinessBadge status={pythonItem.status} />}
            </div>
            <p className="mt-2 break-words font-mono text-xs leading-5 text-slate-600">
              {config?.automation.pythonExecutable || t("support.notConfigured")}
            </p>
            {pythonItem?.message && pythonItem.status !== "ready" && (
              <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                {pythonItem.message}
              </p>
            )}
          </div>

          <div className="mt-3 space-y-2">
            {pythonPackageItems.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2"
              >
                <span className="text-xs font-semibold text-slate-800">{item.label}</span>
                <ReadinessBadge status={item.status} />
              </div>
            ))}
          </div>

          {pythonPackagesItem?.status !== "ready" && pythonInstallCommand && (
            <div className="mt-4 rounded-md border border-amber-100 bg-amber-50/80 p-3">
              <p className="text-sm font-semibold text-amber-950">{t("support.installPackages")}</p>
              <p className="mt-1 text-sm font-medium leading-6 text-amber-800">
                {t("support.installPackagesHint")}
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
                <Clipboard className="h-4 w-4 text-brand-700" aria-hidden="true" />
                {copiedPythonCommand ? t("common.copied") : t("support.copyCommand")}
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 ring-1 ring-amber-200">
              <FolderOpen className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-slate-950">{t("support.foldersShortcuts")}</h2>
            <InfoHint text={t("support.foldersHint")} />
          </div>
          <div className="mt-4 grid gap-2">
            {[
              [t("support.openInvoiceInput"), config?.folders.invoiceInputFolder],
              [t("support.openReadyInvoices"), config?.folders.invoiceOutputFolder],
              [t("support.openContracts"), config?.folders.contractsOutputFolder],
              [t("support.openSupportLogs"), config?.folders.invoiceLogFolder],
            ].map(([label, path]) => (
              <button
                key={label}
                className="inline-flex min-h-11 items-center justify-start gap-2 rounded-md border border-white/70 bg-white/65 px-3 text-sm font-semibold text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!path}
                onClick={() => onOpenPath(path)}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
                {label}
              </button>
            ))}
            <button
              className="inline-flex min-h-11 items-center justify-start gap-2 rounded-md border border-white/70 bg-white/65 px-3 text-sm font-semibold text-slate-800 transition hover:bg-white"
              onClick={() => onNavigate("setup")}
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
              {t("support.fixFolders")}
            </button>
            <button
              className="inline-flex min-h-11 items-center justify-start gap-2 rounded-md border border-white/70 bg-white/65 px-3 text-sm font-semibold text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!configStatus}
              onClick={() => void copySupportBundle()}
            >
              <Clipboard className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
              {copiedSupportBundle ? t("support.copiedBundle") : t("support.copyBundle")}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-brand-100 bg-brand-50/80 p-5 shadow-glass backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/70 text-brand-800 ring-1 ring-brand-100">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-950">{t("support.safeRehearsal")}</h2>
              <p className="mt-1 text-sm font-medium leading-6 text-slate-700">
                {t("support.safeRehearsalText")}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-md bg-white/60 p-3 text-sm font-semibold text-slate-800">
            {t("support.safeModeIs", {
              value: config?.safety.dryRunDefault ? t("common.on") : t("common.off"),
            })}
          </div>
          <ol className="mt-4 space-y-2 text-sm font-medium leading-6 text-slate-700">
            <li>1. {t("support.rehearsal1")}</li>
            <li>2. {t("support.rehearsal2")}</li>
            <li>3. {t("support.rehearsal3")}</li>
            <li>4. {t("support.rehearsal4")}</li>
          </ol>
          <p className="mt-4 rounded-md border border-brand-100 bg-white/70 p-3 font-mono text-xs text-slate-700">
            docs\FAKE_WORKSPACE_REHEARSAL.md
          </p>
        </section>
      </div>

      <details className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">
          {t("support.technicalDetails")}
        </summary>
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          <section>
            <h3 className="text-base font-semibold text-slate-950">{t("support.configuredPaths")}</h3>
            <p className="mt-1 text-sm font-medium text-slate-600">
              {t("support.tokenHidden")}
            </p>
            <div className="mt-3 space-y-2">
              {paths.map(([label, value]) => (
                <div key={label} className="rounded-md bg-white/55 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
                  <p className="mt-1 break-words font-mono text-xs leading-5 text-slate-700">
                    {value || t("support.notConfigured")}
                  </p>
                </div>
              ))}
              {!paths.length && (
                <p className="rounded-md bg-white/55 p-4 text-sm font-medium text-slate-700">
                  {t("support.detailsUnavailable")}
                </p>
              )}
            </div>
          </section>

          <div className="space-y-5">
            <section>
              <h3 className="text-base font-semibold text-slate-950">{t("support.preflight")}</h3>
              <div className="mt-3 space-y-2">
                {items.slice(0, 8).map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                    <ReadinessBadge status={item.status} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-950">{t("support.dependencies")}</h3>
              <div className="mt-3 space-y-2">
                {configStatus?.preflight.dependencies.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-slate-700">{item.label}</span>
                    <ReadinessBadge status={item.status} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-950">{t("support.logs")}</h3>
              <div className="mt-3 space-y-2">
                {latestLogs.map((log) => (
                  <button
                    key={log.key}
                    className="flex w-full items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2 text-left text-xs transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!log.path}
                    onClick={() => onOpenPath(log.path)}
                  >
                    <span className="font-semibold text-slate-700">{log.label}</span>
                    <FileText className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-base font-semibold text-slate-950">{t("support.lastCode")}</h3>
              <p className="mt-2 text-sm font-medium text-slate-600">
                {lastSummary ? String(lastSummary.exit_code) : t("support.noRunYet")}
              </p>
            </section>
          </div>
        </div>
        <DeveloperDetails configStatus={configStatus} />
      </details>
    </div>
  );
}

function healthArea(
  label: string,
  items: (PreflightItem | undefined)[],
  t: ReturnType<typeof useI18n>["t"],
): { label: string; tone: StatusTone; note: string } {
  const present = items.filter((item): item is PreflightItem => Boolean(item));
  if (!present.length) {
    return { label, tone: "neutral", note: t("support.notCheckedYet") };
  }
  const blocking = present.find((item) =>
    ["missingConfiguration", "missingScript", "missingFolder", "permissionProblem"].includes(
      item.status,
    ),
  );
  if (blocking) {
    return { label, tone: "attention", note: friendlyHealthNote(blocking, t) };
  }
  if (present.some((item) => item.status === "warning")) {
    return { label, tone: "attention", note: t("support.reviewConvenient") };
  }
  if (present.some((item) => item.status === "notChecked")) {
    return { label, tone: "neutral", note: t("support.notCheckedYet") };
  }
  return { label, tone: "ready", note: t("support.everythingGood") };
}

function friendlyHealthNote(item: PreflightItem, t: ReturnType<typeof useI18n>["t"]) {
  if (item.key === "pythonExecutable") return t("support.pythonNotFound");
  if (item.key === "pythonPackages") return t("support.packagesInstall");
  if (item.itemType === "script") return t("support.installScriptsBelow");
  if (item.itemType === "folder") return t("support.fixFoldersGuided");
  if (item.key === "gmailCredentialsFile")
    return t("support.chooseGmailOrPrepare");
  if (item.key.startsWith("gmail")) return t("support.finishGmail");
  return t("support.needsOneStep");
}

function toneLabel(tone: StatusTone, t: ReturnType<typeof useI18n>["t"]) {
  if (tone === "ready") return t("support.good");
  if (tone === "attention") return t("common.needsAttention");
  if (tone === "blocked") return t("common.cannotRunYet");
  if (tone === "future") return t("support.future");
  return t("support.notChecked");
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
