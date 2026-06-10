import { KeyRound, Loader2, type LucideIcon } from "lucide-react";

import type { AutomationAction, WorkflowPreflight } from "../types";
import { ReadinessBadge } from "./StatusBadges";

export function GmailAccessPanel({
  action,
  workflow,
  disabled,
  disabledReason,
  isRunning,
  onRun,
}: {
  action: AutomationAction;
  workflow?: WorkflowPreflight;
  disabled: boolean;
  disabledReason: string | null;
  isRunning: boolean;
  onRun: () => void;
}) {
  const Icon = isRunning ? Loader2 : action.icon;
  const blocked = disabled || Boolean(disabledReason);
  return (
    <section className="grid grid-cols-[1fr_220px] items-center gap-4 rounded-lg border border-white/60 bg-white/48 p-5 shadow-glass backdrop-blur-xl">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-md bg-teal-50 text-teal-800 ring-1 ring-teal-100">
          <KeyRound className="h-6 w-6" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-950">Gmail sign-in</h2>
            {workflow && <ReadinessBadge status={workflow.status} />}
          </div>
          <p className="mt-1 text-sm font-medium text-slate-600">
            {disabledReason ??
              "If Google access expires, reconnect once. A browser sign-in may open and drafts will retry."}
          </p>
        </div>
      </div>
      <button
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
        disabled={blocked}
        onClick={onRun}
        title={disabledReason ?? undefined}
      >
        <Icon className={["h-5 w-5", isRunning ? "animate-spin" : ""].join(" ")} />
        Reconnect Gmail
      </button>
    </section>
  );
}

export function AutomationCard({
  title,
  action,
  workflow,
  runningCommand,
  disabledReason,
  onRun,
  secondaryActions,
  onOpenPath,
}: {
  title: string;
  action: AutomationAction;
  workflow?: WorkflowPreflight;
  runningCommand: string | null;
  disabledReason: string | null;
  onRun: (action: AutomationAction) => void;
  secondaryActions: {
    label: string;
    icon: LucideIcon;
    path?: string | null;
  }[];
  onOpenPath: (path?: string | null) => void;
}) {
  return (
    <section className="rounded-lg border border-white/60 bg-white/48 p-5 shadow-glass backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        {workflow ? <ReadinessBadge status={workflow.status} /> : <ReadinessBadge status="notChecked" />}
      </div>
      <ActionButton
        action={action}
        workflow={workflow}
        isPrimary
        isRunning={runningCommand === action.commandName}
        disabled={Boolean(runningCommand) || Boolean(disabledReason)}
        disabledReason={disabledReason}
        onClick={() => onRun(action)}
      />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {secondaryActions.map((secondary) => (
          <button
            key={secondary.label}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/60 bg-white/55 px-3 text-sm font-medium text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={Boolean(runningCommand) || !secondary.path}
            onClick={() => onOpenPath(secondary.path)}
            title={secondary.path ? undefined : "Folder is not configured."}
          >
            <secondary.icon className="h-4 w-4 text-teal-700" />
            <span>{secondary.label}</span>
          </button>
        ))}
      </div>
      {disabledReason && (
        <p className="mt-3 text-xs font-semibold leading-5 text-amber-800">{disabledReason}</p>
      )}
    </section>
  );
}

export function ActionButton({
  action,
  disabled,
  disabledReason,
  isPrimary = false,
  isRunning,
  onClick,
}: {
  action: AutomationAction;
  workflow?: WorkflowPreflight;
  disabled: boolean;
  disabledReason: string | null;
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
      title={disabledReason ?? undefined}
    >
      <Icon className={["h-5 w-5", isRunning ? "animate-spin" : ""].join(" ")} />
      {action.label}
    </button>
  );
}
