import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  FolderOpen,
  KeyRound,
  Loader2,
  Play,
  ScanText,
  ShieldCheck,
  Terminal,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Status = "idle" | "success" | "warning" | "error";

type StepResult = {
  name: string;
  exit_code: number;
};

type RunSummary = {
  automation_name: string;
  command_name: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  exit_code: number;
  status: Exclude<Status, "idle">;
  steps: StepResult[];
  last_output_lines: string[];
};

type CommandEvent = {
  command_name: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
  timestamp: string;
};

type LogInfo = {
  key: string;
  label: string;
  path?: string | null;
  modified?: string | null;
};

type AutomationAction = {
  label: string;
  commandName: string;
  icon: LucideIcon;
  requiresConfirmation?: boolean;
};

const paths = {
  invoicesInput: "C:\\Users\\back-office-life\\Desktop\\Fatture\\Input",
  readyInvoices: "C:\\Users\\back-office-life\\Desktop\\Fatture\\Output_ProntoInvio",
  fattureLogs: "C:\\Users\\back-office-life\\Desktop\\Fatture\\Log",
  networkScans: "\\\\172.16.47.20\\shared\\Scansioni",
  signedContracts:
    "C:\\Users\\back-office-life\\Desktop\\Life Hotel\\Staff\\2026\\CONTRATTI FIRMATI",
  codexScripts: "C:\\Users\\back-office-life\\Documents\\CodexScripts",
};

const invoiceAction: AutomationAction = {
  label: "Process Invoices & Create Gmail Drafts",
  commandName: "process_invoices_and_drafts",
  icon: Play,
};

const contractAction: AutomationAction = {
  label: "Process Signed Contracts",
  commandName: "process_signed_contracts",
  icon: ShieldCheck,
  requiresConfirmation: true,
};

const gmailReconnectAction: AutomationAction = {
  label: "Reconnect Gmail",
  commandName: "reconnect_gmail",
  icon: KeyRound,
};

const maintenanceActions: AutomationAction[] = [
  {
    label: "Copy Scansioni",
    commandName: "copy_scansioni",
    icon: Copy,
  },
  {
    label: "Run OCR Preprocessing",
    commandName: "ocr_preprocessing",
    icon: ScanText,
  },
];

function App() {
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [liveOutput, setLiveOutput] = useState<string[]>([]);
  const [lastSummary, setLastSummary] = useState<RunSummary | null>(null);
  const [latestLogs, setLatestLogs] = useState<LogInfo[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [notice, setNotice] = useState<string>("Ready");
  const [pendingAction, setPendingAction] = useState<AutomationAction | null>(null);

  useEffect(() => {
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
      void refreshLatestLogs();
    });

    return () => {
      void unlistenOutput.then((unlisten) => unlisten());
      void unlistenFinished.then((unlisten) => unlisten());
    };
  }, []);

  const runningLabel = useMemo(() => {
    if (!runningCommand) return null;
    return [invoiceAction, contractAction, gmailReconnectAction, ...maintenanceActions].find(
      (action) => action.commandName === runningCommand,
    )?.label;
  }, [runningCommand]);

  async function refreshLatestLogs() {
    try {
      const logs = await invoke<LogInfo[]>("get_latest_logs");
      setLatestLogs(logs);
      return logs;
    } catch (error) {
      setNotice(readError(error));
      return [];
    }
  }

  async function openPath(path: string) {
    try {
      await invoke("open_path", { path });
    } catch (error) {
      setNotice(readError(error));
    }
  }

  async function startAction(action: AutomationAction) {
    if (action.requiresConfirmation) {
      setPendingAction(action);
      return;
    }
    await runAction(action);
  }

  async function runAction(action: AutomationAction) {
    setPendingAction(null);
    setRunningCommand(action.commandName);
    setLiveOutput([]);
    setStatus("idle");
    setNotice(`Running ${action.label}`);

    try {
      const summary = await invoke<RunSummary>("run_command", {
        commandName: action.commandName,
      });
      setLastSummary(summary);
      setStatus(summary.status);
      setNotice(summary.status === "error" ? "Run finished with errors" : "Run finished");
    } catch (error) {
      setStatus("error");
      setNotice(readError(error));
    } finally {
      setRunningCommand(null);
      void refreshLatestLogs();
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#eef2f4] text-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#f8fafc_0%,#dfe7e8_42%,#f5efe6_100%)]" />
      <div className="absolute inset-x-0 top-0 h-48 bg-white/45 backdrop-blur-3xl" />

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-8 py-7">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-teal-800">Life Hotel</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-normal text-slate-950">
              Automation Hub
            </h1>
          </div>
          <StatusPill status={runningCommand ? "warning" : status} label={runningLabel ?? notice} />
        </header>

        <div className="grid flex-1 grid-cols-[1fr_380px] gap-5">
          <section className="grid content-start gap-5">
            <div className="grid grid-cols-2 gap-5">
              <AutomationCard
                title="Invoices"
                action={invoiceAction}
                runningCommand={runningCommand}
                onRun={startAction}
                secondaryActions={[
                  {
                    label: "Input Folder",
                    icon: FolderOpen,
                    onClick: () => openPath(paths.invoicesInput),
                  },
                  {
                    label: "Ready Invoices",
                    icon: FolderOpen,
                    onClick: () => openPath(paths.readyInvoices),
                  },
                ]}
              />
              <AutomationCard
                title="Signed Contracts"
                action={contractAction}
                runningCommand={runningCommand}
                onRun={startAction}
                secondaryActions={[
                  {
                    label: "Scans Folder",
                    icon: FolderOpen,
                    onClick: () => openPath(paths.networkScans),
                  },
                  {
                    label: "Signed Contracts",
                    icon: FolderOpen,
                    onClick: () => openPath(paths.signedContracts),
                  },
                ]}
              />
            </div>

            <GmailAccessPanel
              action={gmailReconnectAction}
              disabled={Boolean(runningCommand)}
              isRunning={runningCommand === gmailReconnectAction.commandName}
              onRun={() => startAction(gmailReconnectAction)}
            />

            <section className="rounded-lg border border-white/60 bg-white/48 p-5 shadow-glass backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-950">Maintenance</h2>
                <Clock3 className="h-5 w-5 text-teal-700" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {maintenanceActions.map((action) => (
                  <ActionButton
                    key={action.commandName}
                    action={action}
                    isRunning={runningCommand === action.commandName}
                    disabled={Boolean(runningCommand)}
                    onClick={() => startAction(action)}
                  />
                ))}
                <button
                  className="inline-flex min-h-16 items-center justify-center gap-2 rounded-md border border-white/70 bg-white/65 px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(runningCommand)}
                  onClick={() => openPath(paths.codexScripts)}
                >
                  <FolderOpen className="h-5 w-5 text-teal-700" />
                  Logs Folder
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-slate-900/10 bg-slate-950/90 p-5 shadow-glass">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-white">
                  <Terminal className="h-5 w-5 text-teal-300" />
                  <h2 className="text-lg font-semibold">Live Output</h2>
                </div>
                <span className="text-xs font-medium text-slate-300">
                  {liveOutput.length ? `${liveOutput.length} lines` : "Idle"}
                </span>
              </div>
              <pre className="h-56 overflow-auto rounded-md bg-black/30 p-4 font-mono text-xs leading-5 text-slate-100">
                {liveOutput.length ? liveOutput.join("\n") : "Waiting for a run..."}
              </pre>
            </section>
          </section>

          <DetailsPanel
            summary={lastSummary}
            latestLogs={latestLogs}
            onOpenPath={openPath}
            onRefreshLogs={refreshLatestLogs}
          />
        </div>
      </section>

      {pendingAction && (
        <ConfirmationModal
          action={pendingAction}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => runAction(pendingAction)}
        />
      )}
    </main>
  );
}

function GmailAccessPanel({
  action,
  disabled,
  isRunning,
  onRun,
}: {
  action: AutomationAction;
  disabled: boolean;
  isRunning: boolean;
  onRun: () => void;
}) {
  const Icon = isRunning ? Loader2 : action.icon;
  return (
    <section className="grid grid-cols-[1fr_220px] items-center gap-4 rounded-lg border border-white/60 bg-white/48 p-5 shadow-glass backdrop-blur-xl">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-md bg-teal-50 text-teal-800 ring-1 ring-teal-100">
          <KeyRound className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Gmail access</h2>
          <p className="mt-1 text-sm font-medium text-slate-600">
            If Google access expires, reconnect once. A browser sign-in may open and drafts will retry.
          </p>
        </div>
      </div>
      <button
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
        disabled={disabled}
        onClick={onRun}
      >
        <Icon className={["h-5 w-5", isRunning ? "animate-spin" : ""].join(" ")} />
        Reconnect Gmail
      </button>
    </section>
  );
}

function AutomationCard({
  title,
  action,
  runningCommand,
  onRun,
  secondaryActions,
}: {
  title: string;
  action: AutomationAction;
  runningCommand: string | null;
  onRun: (action: AutomationAction) => void;
  secondaryActions: {
    label: string;
    icon: LucideIcon;
    onClick: () => void;
  }[];
}) {
  return (
    <section className="rounded-lg border border-white/60 bg-white/48 p-5 shadow-glass backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        <div className="h-2.5 w-2.5 rounded-full bg-teal-500 shadow-[0_0_18px_rgba(20,184,166,0.8)]" />
      </div>
      <ActionButton
        action={action}
        isPrimary
        isRunning={runningCommand === action.commandName}
        disabled={Boolean(runningCommand)}
        onClick={() => onRun(action)}
      />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {secondaryActions.map((secondary) => (
          <button
            key={secondary.label}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/60 bg-white/55 px-3 text-sm font-medium text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={Boolean(runningCommand)}
            onClick={secondary.onClick}
          >
            <secondary.icon className="h-4 w-4 text-teal-700" />
            <span>{secondary.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ActionButton({
  action,
  disabled,
  isPrimary = false,
  isRunning,
  onClick,
}: {
  action: AutomationAction;
  disabled: boolean;
  isPrimary?: boolean;
  isRunning: boolean;
  onClick: () => void;
}) {
  const Icon = isRunning ? Loader2 : action.icon;
  return (
    <button
      className={[
        "inline-flex w-full items-center justify-center gap-3 rounded-md font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55",
        isPrimary
          ? "min-h-20 bg-slate-950 px-5 text-base text-white hover:bg-slate-800"
          : "min-h-16 border border-white/70 bg-white/65 px-4 text-sm text-slate-800 hover:bg-white",
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className={["h-5 w-5", isRunning ? "animate-spin" : ""].join(" ")} />
      {action.label}
    </button>
  );
}

function DetailsPanel({
  summary,
  latestLogs,
  onOpenPath,
  onRefreshLogs,
}: {
  summary: RunSummary | null;
  latestLogs: LogInfo[];
  onOpenPath: (path: string) => void;
  onRefreshLogs: () => void;
}) {
  return (
    <aside className="rounded-lg border border-white/60 bg-white/52 p-5 shadow-glass backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-950">Run Details</h2>
        <button
          className="rounded-md border border-white/70 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
          onClick={onRefreshLogs}
        >
          Refresh
        </button>
      </div>

      {summary ? (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-medium text-teal-800">{summary.automation_name}</p>
            <StatusPill status={summary.status} label={summary.status} compact />
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Metric label="Start" value={formatDate(summary.start_time)} />
            <Metric label="End" value={formatDate(summary.end_time)} />
            <Metric label="Duration" value={formatDuration(summary.duration_ms)} />
            <Metric label="Exit code" value={String(summary.exit_code)} />
          </dl>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">Steps</p>
            <div className="space-y-2">
              {summary.steps.map((step) => (
                <div
                  key={step.name}
                  className="flex items-center justify-between rounded-md bg-white/55 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-800">{step.name}</span>
                  <span className="font-mono text-xs text-slate-600">{step.exit_code}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">Last 100 Lines</p>
            <pre className="h-52 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100">
              {summary.last_output_lines.length
                ? summary.last_output_lines.join("\n")
                : "No captured output."}
            </pre>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-white/70 bg-white/55 p-4 text-sm font-medium text-slate-700">
          No run yet.
        </div>
      )}

      <div className="mt-5 border-t border-white/60 pt-5">
        <p className="mb-3 text-sm font-semibold text-slate-800">Latest Logs</p>
        <div className="space-y-2">
          {latestLogs.map((log) => (
            <button
              key={log.key}
              className="flex w-full items-center justify-between gap-3 rounded-md bg-white/55 px-3 py-2 text-left text-xs transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!log.path}
              onClick={() => log.path && onOpenPath(log.path)}
            >
              <span className="font-semibold text-slate-700">{log.label}</span>
              <FileText className="h-4 w-4 shrink-0 text-teal-700" />
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ConfirmationModal({
  action,
  onCancel,
  onConfirm,
}: {
  action: AutomationAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-6 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-lg border border-white/70 bg-white/90 p-5 shadow-glass">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-slate-950">{action.label}</h2>
          </div>
          <button className="rounded-md p-2 hover:bg-slate-100" onClick={onCancel}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm font-medium text-slate-700">
          This will process and move files. Continue?
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            className="rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={onConfirm}
          >
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}

function StatusPill({
  status,
  label,
  compact = false,
}: {
  status: Status;
  label: string;
  compact?: boolean;
}) {
  const Icon =
    status === "success" ? CheckCircle2 : status === "error" ? XCircle : status === "warning" ? AlertTriangle : Clock3;
  const styles =
    status === "success"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : status === "error"
        ? "bg-rose-50 text-rose-800 ring-rose-200"
        : status === "warning"
          ? "bg-amber-50 text-amber-800 ring-amber-200"
          : "bg-white/70 text-slate-700 ring-white";

  return (
    <div
      className={[
        "inline-flex items-center gap-2 rounded-md px-3 font-semibold ring-1",
        compact ? "mt-2 py-1.5 text-xs" : "py-2 text-sm shadow-sm",
        styles,
      ].join(" ")}
    >
      <Icon className="h-4 w-4" />
      {label}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/55 p-3">
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default App;