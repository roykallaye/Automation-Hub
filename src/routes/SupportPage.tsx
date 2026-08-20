/*
  Help — calm and diagnostic.

  It opens with the one question a worried manager is asking ("Is InnPilot
  working?"), then offers the repair actions that are actually available, then
  recovery. Every developer-facing artefact — python command, script install
  detail, folder paths, preflight items, the support bundle — is preserved but
  moved behind "Technical details".

  The support bundle still contains no path, filename, address, credential or
  raw log, and is still copied only on an explicit click.
*/

import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  CircleHelp,
  Clipboard,
  FolderOpen,
  HeartPulse,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  Button,
  Card,
  DetailList,
  EmptyState,
  IconButton,
  Note,
  PageHead,
  Row,
  Rows,
  Section,
  TechnicalDetails,
} from "../components/ui";
import { useI18n, type Translate } from "../i18n";
import { commandErrorMessage } from "../onboarding";
import { readinessTone } from "../statusMapping";
import type {
  AppConfigStatus,
  AppPage,
  HubConfig,
  ManagedAutomationInstallResult,
  PreflightItem,
  RecoveryActionResult,
  RecoveryStatus,
} from "../types";

export function SupportPage({
  configStatus,
  onInstallAutomation,
  onNavigate,
  onOpenPath,
  onRefresh,
}: {
  configStatus: AppConfigStatus | null;
  onInstallAutomation: () => Promise<ManagedAutomationInstallResult>;
  onNavigate: (page: AppPage) => void;
  onOpenPath: (path?: string | null) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<ManagedAutomationInstallResult | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [copiedBundle, setCopiedBundle] = useState(false);
  const [copiedPython, setCopiedPython] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState<"create" | "restore" | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [recoveryError, setRecoveryError] = useState("");

  useEffect(() => {
    let active = true;
    invoke<RecoveryStatus>("get_recovery_status")
      .then((status) => {
        if (active) setRecoveryStatus(status);
      })
      .catch((error) => {
        if (active) setRecoveryError(commandErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const config = configStatus?.config;
  const items = configStatus?.preflight.items ?? [];
  const problems = items.filter(
    (item) => item.status !== "ready" && item.status !== "notChecked",
  );
  const workflowsBlocked =
    configStatus?.preflight.workflows.filter(
      (workflow) => workflow.commandName && !workflow.canRun,
    ) ?? [];
  const healthy = Boolean(configStatus) && problems.length === 0 && workflowsBlocked.length === 0;

  const scriptsNeedInstall = items.some(
    (item) =>
      ["invoiceWorkflowScript", "gmailDraftScript", "contractProcessingScript"].includes(item.key) &&
      item.status !== "ready",
  );
  const pythonItem = items.find((item) => item.key === "pythonExecutable");
  const pythonPackagesItem = items.find((item) => item.key === "pythonPackages");
  const pythonInstallCommand = config ? buildPythonInstallCommand(config) : "";
  const latestRecovery =
    recoveryStatus?.points.find((point) => point.integrity === "ready") ??
    recoveryStatus?.points[0] ??
    null;

  async function installScripts() {
    setInstalling(true);
    setInstallError(null);
    try {
      setInstallResult(await onInstallAutomation());
    } catch (error) {
      setInstallError(commandErrorMessage(error));
    } finally {
      setInstalling(false);
    }
  }

  async function createRecoveryPoint() {
    setRecoveryBusy("create");
    setRecoveryError("");
    setRecoveryNotice("");
    try {
      await invoke<RecoveryActionResult>("create_recovery_point");
      setRecoveryStatus(await invoke<RecoveryStatus>("get_recovery_status"));
      setRecoveryNotice(t("settings.saved"));
    } catch (error) {
      setRecoveryError(commandErrorMessage(error));
    } finally {
      setRecoveryBusy(null);
    }
  }

  async function restoreRecoveryPoint(pointId: string) {
    if (!window.confirm(t("support.recoveryRestoreConfirm"))) return;
    setRecoveryBusy("restore");
    setRecoveryError("");
    setRecoveryNotice("");
    try {
      await invoke<RecoveryActionResult>("restore_recovery_configuration", {
        pointId,
        confirmed: true,
      });
      await onRefresh();
      setRecoveryStatus(await invoke<RecoveryStatus>("get_recovery_status"));
      setRecoveryNotice(t("support.recoveryRestored"));
    } catch (error) {
      setRecoveryError(commandErrorMessage(error));
    } finally {
      setRecoveryBusy(null);
    }
  }

  async function copySupportBundle() {
    if (!configStatus) return;
    const bundle = {
      schema: "innpilot-support-v1",
      checkedAt: configStatus.preflight.checkedAt,
      app: {
        configSchemaVersion: configStatus.config.schemaVersion,
        language: configStatus.config.language,
        invoiceDeliveryMode: configStatus.config.invoiceDeliveryMode,
        safeMode: configStatus.config.safety.dryRunDefault,
      },
      items: configStatus.preflight.items.map((item) => ({ key: item.key, status: item.status })),
      workflows: configStatus.preflight.workflows.map((workflow) => ({
        key: workflow.key,
        status: workflow.status,
        canRun: workflow.canRun,
      })),
      privacy:
        "No local path, document, filename, email address, OAuth data, raw log, or device key.",
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setCopiedBundle(true);
    } catch {
      setCopiedBundle(false);
    }
  }

  return (
    <>
      <PageHead
        actions={<IconButton icon={RefreshCw} label={t("common.refresh")} onClick={onRefresh} />}
        description={t("support.description")}
        title={t("support.title")}
      />

      <div className="ip-headline" style={{ paddingTop: 0 }}>
        <div className="ip-headline__state">
          <span aria-hidden="true" className={`ip-headline__mark is-${healthy ? "ready" : "attention"}`}>
            {healthy ? <Check size={16} /> : <HeartPulse size={16} />}
          </span>
          <h1 style={{ fontSize: "1.25rem" }}>
            {configStatus
              ? healthy
                ? t("home.allNormal")
                : t("support.isWorking")
              : t("home.unavailable")}
          </h1>
        </div>
        <p>{healthy ? t("home.allNormalText") : t("support.description")}</p>
      </div>

      <div className="ip-stack">
        <div className="ip-actions">
          <Button icon={RefreshCw} onClick={onRefresh} variant="primary">
            {t("support.runCheck")}
          </Button>
          <Button icon={CircleHelp} onClick={() => onNavigate("guide")} variant="ghost">
            {t("support.howItWorks")}
          </Button>
        </div>

        {/* Only real, current problems are listed — never a generic checklist. */}
        {problems.length > 0 ? (
          <Section title={t("support.commonIssues")}>
            <Card>
              <Rows>
                {problems.slice(0, 8).map((item) => (
                  <Row
                    key={item.key}
                    meta={item.message}
                    status={{ tone: readinessTone(item.status), label: statusWord(item, t) }}
                    title={item.label}
                  />
                ))}
              </Rows>
            </Card>
            {scriptsNeedInstall ? (
              <div className="ip-actions" style={{ marginTop: 12 }}>
                <Button
                  busy={installing}
                  icon={PackageCheck}
                  onClick={() => void installScripts()}
                  variant="secondary"
                >
                  {t("support.installRefresh")}
                </Button>
                <Button onClick={() => onNavigate("system")} variant="ghost">
                  {t("system.checkSetup")}
                </Button>
              </div>
            ) : null}
            {installError ? <Note tone="problem">{installError}</Note> : null}
            {installResult ? <Note tone="ready">{t("support.scriptsRefreshed")}</Note> : null}
          </Section>
        ) : null}

        <Section title={t("support.recovery")}>
          <Card>
            {recoveryStatus && recoveryStatus.points.length > 0 ? (
              <Rows>
                <Row
                  icon={Save}
                  meta={t("support.recoveryText")}
                  status={{
                    tone: latestRecovery?.integrity === "ready" ? "ready" : "attention",
                    label:
                      recoveryStatus.points.length === 1
                        ? t("support.recoveryAvailable", { count: 1 })
                        : t("support.recoveryAvailablePlural", {
                            count: recoveryStatus.points.length,
                          }),
                  }}
                  title={t("support.recovery")}
                />
              </Rows>
            ) : (
              <EmptyState
                icon={Save}
                level={3}
                message={t("support.recoveryText")}
                title={t("support.recoveryNone")}
              />
            )}
          </Card>

          <div className="ip-actions" style={{ marginTop: 12 }}>
            <Button
              busy={recoveryBusy === "create"}
              icon={Save}
              onClick={() => void createRecoveryPoint()}
              variant="secondary"
            >
              {t("support.recoveryCreate")}
            </Button>
            {latestRecovery ? (
              <Button
                busy={recoveryBusy === "restore"}
                icon={RotateCcw}
                onClick={() => void restoreRecoveryPoint(latestRecovery.id)}
                variant="secondary"
              >
                {t("support.recoveryRestore")}
              </Button>
            ) : null}
          </div>
          {recoveryNotice ? <Note tone="ready">{recoveryNotice}</Note> : null}
          {recoveryError ? <Note tone="problem">{recoveryError}</Note> : null}
        </Section>

        <TechnicalDetails label={t("support.logs")}>
          <DetailList
            items={[
              { label: "Configuration", value: configStatus?.configPath ?? "—", mono: true },
              { label: "Checked at", value: configStatus?.preflight.checkedAt ?? "—", mono: true },
              {
                label: "Python",
                value: config?.automation.pythonExecutable || "—",
                mono: true,
              },
              { label: "Python status", value: pythonItem?.status ?? "—" },
              { label: "Python packages", value: pythonPackagesItem?.status ?? "—" },
              {
                label: "Automation root",
                value: config?.automation.automationRootFolder || "—",
                mono: true,
              },
              ...items.map((item) => ({
                label: item.label,
                value: `${item.status} · ${item.path ?? "—"}`,
                mono: true,
              })),
            ]}
          />

          <div className="ip-actions" style={{ marginTop: 14 }}>
            {pythonInstallCommand ? (
              <Button
                icon={copiedPython ? Check : Clipboard}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(pythonInstallCommand)
                    .then(() => setCopiedPython(true))
                    .catch(() => setCopiedPython(false));
                }}
                variant="secondary"
              >
                {copiedPython ? t("common.copied") : t("support.copyCommand")}
              </Button>
            ) : null}
            <Button
              icon={copiedBundle ? Check : Clipboard}
              onClick={() => void copySupportBundle()}
              variant="secondary"
            >
              {copiedBundle ? t("common.copied") : t("support.contact")}
            </Button>
            {config?.folders.invoiceLogFolder ? (
              <Button
                icon={FolderOpen}
                onClick={() => onOpenPath(config.folders.invoiceLogFolder)}
                variant="secondary"
              >
                {t("support.openSupportLogs")}
              </Button>
            ) : null}
          </div>
        </TechnicalDetails>
      </div>
    </>
  );
}

function statusWord(item: PreflightItem, t: Translate) {
  switch (item.status) {
    case "ready":
      return t("status.ready");
    case "warning":
      return t("status.attention");
    case "notChecked":
      return t("status.checking");
    default:
      return t("status.problem");
  }
}

function buildPythonInstallCommand(config: HubConfig) {
  const executable = config.automation.pythonExecutable || "python";
  const quoted = executable.includes(" ") ? `"${executable}"` : executable;
  return `${quoted} -m pip install -r requirements.txt`;
}
