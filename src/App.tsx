import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Clock3, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  automationActions,
  contractAction,
  gmailReconnectAction,
  invoiceAction,
  maintenanceActions,
} from "./actions";
import { ConfirmationModal } from "./components/ConfirmationModal";
import { DetailsPanel } from "./components/DetailsPanel";
import { LiveOutputPanel } from "./components/LiveOutputPanel";
import { SetupStatusPanel } from "./components/SetupStatusPanel";
import { StatusPill } from "./components/StatusBadges";
import {
  ActionButton,
  AutomationCard,
  GmailAccessPanel,
} from "./components/WorkflowCard";
import { staffMessage } from "./messages";
import type {
  AppConfigStatus,
  AutomationAction,
  CommandEvent,
  LatestLog,
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
  const [status, setStatus] = useState<RunStatus>("idle");
  const [notice, setNotice] = useState<string>("Loading setup");
  const [pendingAction, setPendingAction] = useState<AutomationAction | null>(null);

  useEffect(() => {
    void refreshConfigStatus();
    void refreshLatestLogs();
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

  const displayName = configStatus?.config.client.displayName || "FlowHost";

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

  async function refreshAll() {
    await refreshConfigStatus();
    await refreshLatestLogs();
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
    if (loadingConfig) return "FlowHost setup is still loading.";
    if (!configStatus) return "FlowHost setup could not be loaded.";
    const workflow = workflowFor(action);
    if (!workflow) return "Workflow status is not available.";
    if (!workflow.canRun) {
      return staffMessage(workflow.message, workflow.status, workflow.key);
    }
    return null;
  }

  const folders = configStatus?.config.folders;
  const logsFolder = folders?.invoiceLogFolder;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#eef2f4] text-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#f8fafc_0%,#dfe7e8_42%,#f5efe6_100%)]" />
      <div className="absolute inset-x-0 top-0 h-48 bg-white/45 backdrop-blur-3xl" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-8 py-7">
        <header className="flex items-center justify-between gap-5">
          <div>
            <p className="text-sm font-medium text-teal-800">{displayName}</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-normal text-slate-950">
              FlowHost Automation Hub
            </h1>
          </div>
          <StatusPill status={runningCommand ? "warning" : status} label={runningLabel ?? notice} />
        </header>

        <SetupStatusPanel
          configStatus={configStatus}
          loading={loadingConfig}
          onRefresh={refreshAll}
        />

        <div className="grid flex-1 grid-cols-[1fr_380px] gap-5">
          <section className="grid content-start gap-5">
            <div className="grid grid-cols-2 gap-5">
              <AutomationCard
                title="Invoices"
                action={invoiceAction}
                workflow={workflowFor(invoiceAction)}
                runningCommand={runningCommand}
                disabledReason={actionDisabledReason(invoiceAction)}
                onRun={startAction}
                secondaryActions={[
                  {
                    label: "Input folder",
                    icon: FolderOpen,
                    path: folders?.invoiceInputFolder,
                  },
                  {
                    label: "Ready invoices",
                    icon: FolderOpen,
                    path: folders?.invoiceOutputFolder,
                  },
                ]}
                onOpenPath={openPath}
              />
              <AutomationCard
                title="Signed contracts"
                action={contractAction}
                workflow={workflowFor(contractAction)}
                runningCommand={runningCommand}
                disabledReason={actionDisabledReason(contractAction)}
                onRun={startAction}
                secondaryActions={[
                  {
                    label: "Shared scan folder",
                    icon: FolderOpen,
                    path: folders?.scansioniNetworkShare,
                  },
                  {
                    label: "Signed contracts",
                    icon: FolderOpen,
                    path: folders?.contractsOutputFolder,
                  },
                ]}
                onOpenPath={openPath}
              />
            </div>

            <GmailAccessPanel
              action={gmailReconnectAction}
              workflow={workflowFor(gmailReconnectAction)}
              disabledReason={actionDisabledReason(gmailReconnectAction)}
              disabled={Boolean(runningCommand)}
              isRunning={runningCommand === gmailReconnectAction.commandName}
              onRun={() => startAction(gmailReconnectAction)}
            />

            <section className="rounded-lg border border-white/60 bg-white/48 p-5 shadow-glass backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-950">Support tools</h2>
                <Clock3 className="h-5 w-5 text-teal-700" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {maintenanceActions.map((action) => (
                  <ActionButton
                    key={action.commandName}
                    action={action}
                    workflow={workflowFor(action)}
                    isRunning={runningCommand === action.commandName}
                    disabled={Boolean(runningCommand) || Boolean(actionDisabledReason(action))}
                    disabledReason={actionDisabledReason(action)}
                    onClick={() => startAction(action)}
                  />
                ))}
                <button
                  className="inline-flex min-h-16 items-center justify-center gap-2 rounded-md border border-white/70 bg-white/65 px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(runningCommand) || !logsFolder}
                  onClick={() => openPath(logsFolder)}
                  title={logsFolder ? undefined : "No support log folder is configured."}
                >
                  <FolderOpen className="h-5 w-5 text-teal-700" />
                  Support logs
                </button>
              </div>
            </section>

            <LiveOutputPanel liveOutput={liveOutput} />
          </section>

          <DetailsPanel
            summary={lastSummary}
            latestLogs={latestLogs}
            configStatus={configStatus}
            onOpenPath={openPath}
            onRefresh={refreshAll}
          />
        </div>
      </section>

      {pendingAction && (
        <ConfirmationModal
          action={pendingAction}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => runAction(pendingAction, true)}
        />
      )}
    </main>
  );
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;
