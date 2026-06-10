import { KeyRound, Loader2, type LucideIcon } from "lucide-react";

import type { AutomationAction, WorkflowPreflight } from "../types";
import { ReadinessBadge } from "./StatusBadges";

export function GmailAccessPanel({
  action,
  workflow,
  disabled,
  disabledReason,
  isRunning,
  buttonLabel = "Check Gmail sign-in",
  onRun,
}: {
  action: AutomationAction;
  workflow?: WorkflowPreflight;
  disabled: boolean;
  disabledReason: string | null;
  isRunning: boolean;
  buttonLabel?: string;
  onRun: () => void;
}) {
  const Icon = isRunning ? Loader2 : action.icon;
  const blocked = disabled || Boolean(disabledReason);
  return (
    <section className="grid gap-4 rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex items-center gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-800 ring-1 ring-teal-100">
          <KeyRound className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-950">Gmail sign-in</h2>
            {workflow && <ReadinessBadge status={workflow.status} />}
          </div>
          <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
            {disabledReason ??
              "Drafts only. No emails are sent automatically."}
          </p>
        </div>
      </div>
      <button
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
        disabled={blocked}
        onClick={onRun}
        title={disabledReason ?? undefined}
      >
        <Icon className={["h-5 w-5", isRunning ? "animate-spin" : ""].join(" ")} />
        {buttonLabel}
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
  description,
  buttonLabel,
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
  description?: string;
  buttonLabel?: string;
}) {
  const Icon = action.icon;
  return (
    <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-800 ring-1 ring-teal-100">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
            {description && (
              <p className="mt-1 text-sm font-medium leading-6 text-slate-600">{description}</p>
            )}
          </div>
        </div>
        {workflow ? (
          <ReadinessBadge status={workflow.status} />
        ) : (
          <ReadinessBadge status="notChecked" />
        )}
      </div>
      <ActionButton
        action={action}
        workflow={workflow}
        isPrimary
        isRunning={runningCommand === action.commandName}
        disabled={Boolean(runningCommand) || Boolean(disabledReason)}
        disabledReason={disabledReason}
        onClick={() => onRun(action)}
        label={buttonLabel}
      />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {secondaryActions.map((secondary) => (
          <button
            key={secondary.label}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/60 bg-white/60 px-3 text-sm font-semibold text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
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
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
          {disabledReason}
        </p>
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
  label,
}: {
  action: AutomationAction;
  workflow?: WorkflowPreflight;
  disabled: boolean;
  disabledReason: string | null;
  isPrimary?: boolean;
  isRunning: boolean;
  onClick: () => void;
  label?: string;
}) {
  const Icon = isRunning ? Loader2 : action.icon;
  return (
    <button
      className={[
        "inline-flex w-full items-center justify-center gap-3 rounded-md font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55",
        isPrimary
          ? "min-h-16 bg-slate-950 px-5 text-base text-white hover:bg-slate-800"
          : "min-h-16 border border-white/70 bg-white/65 px-4 text-sm text-slate-800 hover:bg-white",
      ].join(" ")}
      disabled={disabled}
      onClick={onClick}
      title={disabledReason ?? undefined}
    >
      <Icon className={["h-5 w-5", isRunning ? "animate-spin" : ""].join(" ")} />
      {label ?? action.label}
    </button>
  );
}
