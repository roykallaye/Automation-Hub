import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";

import {
  automationActions,
} from "./actions";
import { applyBrandingToDocument } from "./branding";
import { AppShell } from "./components/AppShell";
import { ConfirmationModal } from "./components/ConfirmationModal";
import { staffMessage } from "./messages";
import { deriveModuleReadiness, moduleForCommand } from "./moduleReadiness";
import { deriveNextAction } from "./nextAction";
import { ActivityPage } from "./routes/ActivityPage";
import { AssistantPage } from "./routes/AssistantPage";
import { AutomationsPage } from "./routes/AutomationsPage";
import { HomePage } from "./routes/HomePage";
import { SettingsPage } from "./routes/SettingsPage";
import { SetupPage } from "./routes/SetupPage";
import { SupportPage } from "./routes/SupportPage";
import type {
  AppPage,
  AppConfigStatus,
  ActivityRecord,
  AutomationAction,
  CommandEvent,
  LatestLog,
  ManagedAutomationInstallResult,
  RunStatus,
  RunSummary,
} from "./types";

function App() {
  const [configStatus, setConfigStatus] = useState<AppConfigStatus | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [liveOutput, setLiveOutput] = useState<string[]>([]);
  const [lastSummary, setLastSummary] = useState<RunSummary | null>(null);
  const [latestLogs, setLatestLogs] = useState<LatestLog[]>([]);
  const [activityHistory, setActivityHistory] = useState<ActivityRecord[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [notice, setNotice] = useState<string>("Loading setup");
  const [pendingAction, setPendingAction] = useState<AutomationAction | null>(null);
  const [currentPage, setCurrentPage] = useState<AppPage>("home");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);

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
    void refreshConfigStatus();
    void refreshLatestLogs();
    void refreshActivityHistory();
    void invoke<RunSummary | null>("get_last_run_summary").then((summary) => {
      if (summary) {
        setLastSummary(summary);
        setStatus(summary.status);
      }
    });

    const unlistenOutput = listen<CommandEvent>("command-output", (event) => {
      const prefix = event.payload.stream === "stderr" ? "stderr" : event.payload.stream;
      setLiveOutput((current) => {
        const next = [...current, `[${prefix}] ${event.payload.line}`];
        return next.slice(-500);
      });
    });
    const unlistenFinished = listen<RunSummary>("command-finished", (event) => {
      setLastSummary(event.payload);
      setStatus(event.payload.status);
      setNotice(event.payload.status === "error" ? "Run finished with errors" : "Run finished");
      void refreshConfigStatus();
      void refreshLatestLogs();
      void refreshActivityHistory();
    });

    return () => {
      void unlistenOutput.then((unlisten) => unlisten());
      void unlistenFinished.then((unlisten) => unlisten());
    };
  }, []);

  const actions = useMemo(() => automationActions, []);

  const runningLabel = useMemo(() => {
    if (!runningCommand) return null;
    return actions.find((action) => action.commandName === runningCommand)?.label;
  }, [actions, runningCommand]);

  const displayName = configStatus?.config.client.displayName || "InnPilot";
  const modules = useMemo(() => deriveModuleReadiness(configStatus), [configStatus]);
  const nextAction = useMemo(
    () =>
      deriveNextAction({
        loading: loadingConfig,
        configStatus,
        modules,
        lastSummary,
        activityHistory,
        runningCommand,
      }),
    [activityHistory, configStatus, lastSummary, loadingConfig, modules, runningCommand],
  );

  async function refreshConfigStatus() {
    try {
      const nextStatus = await invoke<AppConfigStatus>("get_config_status");
      setConfigStatus(nextStatus);
      setNotice("Ready");
      return nextStatus;
    } catch (error) {
      setNotice(readError(error));
      return null;
    } finally {
      setLoadingConfig(false);
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
      setNotice("No folder is configured for this action.");
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
      setNotice("No activity report is available for this run.");
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
    setLiveOutput([]);
    setStatus("idle");
    setNotice(`Running ${action.label}`);

    try {
      const summary = await invoke<RunSummary>("run_command", {
        commandName: action.commandName,
        confirmed,
      });
      setLastSummary(summary);
      setStatus(summary.status);
      setNotice(summary.status === "error" ? "Run finished with errors" : "Run finished");
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
    if (loadingConfig) return "InnPilot setup is still loading.";
    if (!configStatus) return "InnPilot setup could not be loaded.";
    const workflow = workflowFor(action);
    if (!workflow) return "Workflow status is not available.";
    if (!workflow.canRun) {
      const module = moduleForCommand(modules, action.commandName);
      if (module && module.status !== "ready") return module.nextAction;
      return staffMessage(workflow.message, workflow.status, workflow.key);
    }
    return null;
  }

  return (
    <AppShell
      currentPage={currentPage}
      displayName={displayName}
      logoDataUrl={logoDataUrl}
      status={runningCommand ? "warning" : status}
      statusLabel={runningLabel ?? notice}
      nextAction={nextAction}
      onPageChange={setCurrentPage}
    >
      {currentPage === "home" && (
        <HomePage
          configStatus={configStatus}
          modules={modules}
          loading={loadingConfig}
          lastSummary={lastSummary}
          nextAction={nextAction}
          onNavigate={setCurrentPage}
        />
      )}

      {currentPage === "automations" && (
        <AutomationsPage
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
          nextAction={nextAction}
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
          liveOutput={liveOutput}
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
          latestLogs={latestLogs}
          lastSummary={lastSummary}
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
    </AppShell>
  );
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;
