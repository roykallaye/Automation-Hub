import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  automationActions,
} from "./actions";
import { applyBrandingToDocument } from "./branding";
import { OperatorShell } from "./components/OperatorShell";
import { ConfirmationModal } from "./components/ConfirmationModal";
import { createTranslator, I18nProvider } from "./i18n";
import { staffMessage } from "./messages";
import { deriveModuleReadiness, moduleForCommand } from "./moduleReadiness";
import { deriveNextAction } from "./nextAction";
import {
  getInitialOnboardingState,
  initialPageForOnboarding,
  normalizeOnboardingError,
  type OnboardingSnapshot,
} from "./onboarding";
import { ActivityPage } from "./routes/ActivityPage";
import { AssistantPage } from "./routes/AssistantPage";
import { OperatorAutomationsPage } from "./routes/OperatorAutomationsPage";
import { OperatorHomePage } from "./routes/OperatorHomePage";
import { SettingsPage } from "./routes/SettingsPage";
import { SetupPage } from "./routes/SetupPage";
import { SupportPage } from "./routes/SupportPage";
import type {
  AppPage,
  AppConfigStatus,
  ActivityRecord,
  AutomationAction,
  LatestLog,
  ManagedAutomationInstallResult,
  RunStatus,
  RunSummary,
} from "./types";

function App() {
  const [configStatus, setConfigStatus] = useState<AppConfigStatus | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [checkingReadiness, setCheckingReadiness] = useState(true);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<RunSummary | null>(null);
  const [latestLogs, setLatestLogs] = useState<LatestLog[]>([]);
  const [activityHistory, setActivityHistory] = useState<ActivityRecord[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [notice, setNotice] = useState<string>("");
  const [pendingAction, setPendingAction] = useState<AutomationAction | null>(null);
  const [currentPage, setCurrentPage] = useState<AppPage | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const configRefreshId = useRef(0);
  const initialRouteResolved = useRef(false);
  const browserPreview =
    typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPage]);

  const branding = configStatus?.config.client.branding;
  useEffect(() => {
    applyBrandingToDocument(branding);
    let cancelled = false;
    if (branding?.logoPath) {
      invoke<string | null>("read_branding_logo")
        .then((dataUrl) => {
          if (!cancelled) setLogoDataUrl(dataUrl);
        })
        .catch(() => {
          if (!cancelled) setLogoDataUrl(null);
        });
    } else {
      setLogoDataUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [branding]);

  useEffect(() => {
    if (browserPreview) {
      resolveInitialRoute("home");
    } else {
      void getInitialOnboardingState()
        .then((snapshot) => {
          setOnboarding(snapshot);
          resolveInitialRoute(initialPageForOnboarding(snapshot));
        })
        .catch((error) => {
          setNotice(normalizeOnboardingError(error).message);
          // Onboarding is the local authority. A corrupt/future record, or an
          // unavailable authority, fails closed into Support rather than Home.
          resolveInitialRoute("support");
        });
    }

    void refreshConfigStatus();
    void refreshLatestLogs();
    void refreshActivityHistory();
    void invoke<RunSummary | null>("get_last_run_summary").then((summary) => {
      if (summary) {
        setLastSummary(summary);
        setStatus(summary.status);
      }
    });


    const unlistenFinished = listen<RunSummary>("command-finished", (event) => {
      setLastSummary(event.payload);
      setStatus(event.payload.status);
      setNotice(event.payload.status === "error" ? t("app.runFinishedErrors") : t("app.runFinished"));
      void refreshConfigStatus();
      void refreshLatestLogs();
      void refreshActivityHistory();
    });

    return () => {
      void unlistenFinished.then((unlisten) => unlisten());
    };
  }, []);

  function resolveInitialRoute(page: AppPage) {
    if (initialRouteResolved.current) return;
    initialRouteResolved.current = true;
    setCurrentPage(page);
  }

  const actions = useMemo(() => automationActions, []);
  const t = useMemo(() => createTranslator(configStatus?.config.language), [configStatus?.config.language]);

  const runningLabel = useMemo(() => {
    if (!runningCommand) return null;
    return actions.find((action) => action.commandName === runningCommand)?.label;
  }, [actions, runningCommand]);

  const displayName = configStatus?.config.client.displayName || "InnPilot";
  const modules = useMemo(() => deriveModuleReadiness(configStatus, t), [configStatus, t]);
  const nextAction = useMemo(
    () =>
      deriveNextAction({
        loading: loadingConfig || checkingReadiness,
        configStatus,
        modules,
        lastSummary,
        activityHistory,
        runningCommand,
        t,
      }),
    [activityHistory, checkingReadiness, configStatus, lastSummary, loadingConfig, modules, runningCommand, t],
  );

  async function refreshConfigStatus() {
    const requestId = ++configRefreshId.current;
    setCheckingReadiness(true);
    try {
      const nextStatus = await invoke<AppConfigStatus>("get_config_status");
      if (requestId !== configRefreshId.current) return null;
      setConfigStatus(nextStatus);
      setNotice(t("app.readinessChecking"));
      void refreshVerifiedConfigStatus(requestId);
      return nextStatus;
    } catch (error) {
      if (requestId === configRefreshId.current) {
        setNotice(readError(error));
        setCheckingReadiness(false);
      }
      return null;
    } finally {
      if (requestId === configRefreshId.current) {
        setLoadingConfig(false);
      }
    }
  }

  async function refreshVerifiedConfigStatus(requestId: number) {
    try {
      const verifiedStatus = await invoke<AppConfigStatus>("refresh_config_status");
      if (requestId !== configRefreshId.current) return;
      setConfigStatus(verifiedStatus);
      setNotice(t("app.ready"));
      setCheckingReadiness(false);
    } catch {
      if (requestId !== configRefreshId.current) return;
      setNotice(t("app.readinessCheckFailed"));
      setCheckingReadiness(false);
    }
  }

  async function refreshLatestLogs() {
    try {
      const logs = await invoke<LatestLog[]>("get_latest_logs");
      setLatestLogs(logs);
      return logs;
    } catch (error) {
      setNotice(readError(error));
      return [];
    }
  }

  async function refreshActivityHistory() {
    try {
      const history = await invoke<ActivityRecord[]>("get_activity_history");
      setActivityHistory(history);
      return history;
    } catch (error) {
      setNotice(readError(error));
      return [];
    }
  }

  async function refreshAll() {
    await refreshConfigStatus();
    await refreshLatestLogs();
    await refreshActivityHistory();
  }

  async function openPath(path?: string | null) {
    if (!path) {
      setNotice(t("app.noFolderConfigured"));
      return;
    }
    try {
      await invoke("open_path", { path });
    } catch (error) {
      setNotice(readError(error));
    }
  }

  async function openActivityReport(path?: string | null) {
    if (!path) {
      setNotice(t("app.noActivityReport"));
      return;
    }
    try {
      await invoke("open_activity_report", { path });
    } catch (error) {
      setNotice(readError(error));
    }
  }

  async function installManagedAutomationScripts() {
    const result = await invoke<ManagedAutomationInstallResult>("install_managed_automation_scripts", {
      confirmed: true,
    });
    await refreshAll();
    return result;
  }

  async function startAction(action: AutomationAction) {
    const disabledReason = actionDisabledReason(action);
    if (disabledReason) {
      setNotice(disabledReason);
      return;
    }

    const shouldConfirm = action.requiresConfirmation;
    if (shouldConfirm) {
      setPendingAction(action);
      return;
    }
    await runAction(action, false);
  }

  async function runAction(action: AutomationAction, confirmed: boolean) {
    setPendingAction(null);
    setRunningCommand(action.commandName);
    setStatus("idle");
    setNotice(t("app.runningAction", { action: action.label }));

    try {
      const summary = await invoke<RunSummary>("run_command", {
        commandName: action.commandName,
        confirmed,
      });
      setLastSummary(summary);
      setStatus(summary.status);
      setNotice(summary.status === "error" ? t("app.runFinishedErrors") : t("app.runFinished"));
    } catch (error) {
      setStatus("error");
      setNotice(readError(error));
    } finally {
      setRunningCommand(null);
      void refreshAll();
    }
  }

  function workflowFor(action: AutomationAction) {
    return configStatus?.preflight.workflows.find((workflow) => workflow.key === action.workflowKey);
  }

  function actionDisabledReason(action: AutomationAction) {
    if (loadingConfig) return t("app.setupLoading");
    if (checkingReadiness) return t("app.readinessChecking");
    if (!configStatus) return t("app.setupLoadFailed");
    const workflow = workflowFor(action);
    if (!workflow) return t("app.workflowStatusMissing");
    if (!workflow.canRun) {
      const module = moduleForCommand(modules, action.commandName);
      if (module && module.status !== "ready") return module.nextAction;
      return staffMessage(workflow.message, workflow.status, workflow.key);
    }
    return null;
  }

  if (currentPage === null) return null;

  return (
    <I18nProvider language={configStatus?.config.language}>
      <OperatorShell
        browserPreview={browserPreview}
        currentPage={currentPage}
        displayName={displayName}
        logoDataUrl={logoDataUrl}
        status={runningCommand ? "warning" : status}
        statusLabel={
          browserPreview
            ? t("app.browserPreview")
            : runningLabel ?? (notice || t("app.loadingSetup"))
        }
        onPageChange={setCurrentPage}
      >
      {currentPage === "home" && (
        <OperatorHomePage
          configStatus={configStatus}
          modules={modules}
          loading={loadingConfig}
          lastSummary={lastSummary}
          activityHistory={activityHistory}
          nextAction={nextAction}
          onNavigate={setCurrentPage}
        />
      )}

      {currentPage === "automations" && (
        <OperatorAutomationsPage
          configStatus={configStatus}
          modules={modules}
          activityHistory={activityHistory}
          runningCommand={runningCommand}
          actionDisabledReason={actionDisabledReason}
          onRun={startAction}
          onOpenPath={openPath}
          onNavigate={setCurrentPage}
        />
      )}

      {currentPage === "setup" && (
        <SetupPage
          configStatus={configStatus}
          modules={modules}
          loading={loadingConfig}
          onboarding={onboarding}
          onOnboardingChanged={setOnboarding}
          onRefresh={refreshAll}
          onGoToAutomations={() => setCurrentPage("automations")}
          onGoToSupport={() => setCurrentPage("support")}
        />
      )}

      {currentPage === "activity" && (
        <ActivityPage
          configStatus={configStatus}
          latestLogs={latestLogs}
          activityHistory={activityHistory}
          lastSummary={lastSummary}
          onOpenPath={openPath}
          onOpenActivityReport={openActivityReport}
          onRefresh={refreshAll}
          onNavigate={setCurrentPage}
        />
      )}

      {currentPage === "settings" && (
        <SettingsPage
          configStatus={configStatus}
          onRefresh={refreshAll}
          onNavigate={setCurrentPage}
        />
      )}

      {currentPage === "assistant" && <AssistantPage />}

      {currentPage === "support" && (
        <SupportPage
          configStatus={configStatus}
          onOpenPath={openPath}
          onRefresh={refreshAll}
          onInstallAutomation={installManagedAutomationScripts}
          onNavigate={setCurrentPage}
        />
      )}

      {pendingAction && (
        <ConfirmationModal
          action={pendingAction}
          deliveryMode={configStatus?.config.invoiceDeliveryMode}
          fileSelectionMode={configStatus?.config.invoiceFileSelectionMode}
          safeModeOn={configStatus?.config.safety.dryRunDefault}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => runAction(pendingAction, true)}
        />
      )}
      </OperatorShell>
    </I18nProvider>
  );
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;
