import { FolderOpen, Loader2, Lock, Wrench, type LucideIcon } from "lucide-react";

import { moduleStatusLabel } from "../moduleReadiness";
import type { ModuleReadiness } from "../types";
import { InfoHint } from "./InfoHint";
import { StatusHint, type StatusTone } from "./StatusOrb";
import { TINT_TILE, TINT_WASH, type CardTint } from "./tints";

/*
  WorkflowGalleryCard: one automation as a premium gallery card.

  Layout contract (consistent across every card):
    tinted icon + name + info bubble + mode chip
    status hint + last run
    one primary action (or a blocked reason with a direct fix)
    safety statement
    optional folder shortcuts
  The "what this does" sentence lives behind the info bubble to keep the
  surface calm; screen readers still get it inline.
*/

export function workflowTone(module?: ModuleReadiness): StatusTone {
  if (!module) return "neutral";
  switch (module.status) {
    case "ready":
      return "ready";
    case "blocked":
      return "blocked";
    case "not_checked":
      return "neutral";
    default:
      return "attention";
  }
}

export function WorkflowGalleryCard({
  icon: Icon,
  title,
  whatItDoes,
  tint = "brand",
  modeChip,
  safety,
  module,
  lastRunLabel,
  isRunning,
  anyRunning,
  disabledReason,
  primaryLabel,
  onRun,
  fixLabel,
  onFix,
  links = [],
  onOpenPath,
}: {
  icon: LucideIcon;
  title: string;
  whatItDoes: string;
  tint?: CardTint;
  modeChip?: string;
  safety: string;
  module?: ModuleReadiness;
  lastRunLabel?: string | null;
  isRunning: boolean;
  anyRunning: boolean;
  disabledReason: string | null;
  primaryLabel: string;
  onRun: () => void;
  fixLabel?: string;
  onFix?: () => void;
  links?: { label: string; path?: string | null }[];
  onOpenPath?: (path?: string | null) => void;
}) {
  const tone = workflowTone(module);
  const blocked = Boolean(disabledReason);
  const RunIcon = isRunning ? Loader2 : Icon;

  return (
    <section
      className={`card-lift flex h-full flex-col rounded-xl border border-white/65 ${TINT_WASH[tint]} p-5 shadow-glass backdrop-blur-xl`}
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ring-1 ${TINT_TILE[tint]}`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
            <InfoHint text={whatItDoes} />
            {modeChip && (
              <span className="inline-flex shrink-0 rounded-md bg-white/80 px-2 py-1 text-[11px] font-bold text-brand-800 ring-1 ring-brand-200">
                {modeChip}
              </span>
            )}
          </div>
          <span className="sr-only">{whatItDoes}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/55 px-3 py-2">
        <StatusHint
          tone={tone}
          label={module ? moduleStatusLabel(module.status) : "Not checked"}
        />
        <span className="text-xs font-semibold text-slate-500">
          {lastRunLabel ?? "Not run yet"}
        </span>
      </div>

      <div className="mt-4">
        {blocked ? (
          <div className="rounded-lg border border-amber-100 bg-amber-50/80 p-3">
            <p className="text-sm font-semibold leading-5 text-amber-900">{disabledReason}</p>
            {onFix && (
              <button
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-ink px-3 text-xs font-semibold text-white transition hover:bg-ink-soft"
                onClick={onFix}
              >
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                {fixLabel ?? "Go fix this"}
              </button>
            )}
          </div>
        ) : (
          <button
            className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-md bg-ink px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-55"
            disabled={anyRunning}
            onClick={onRun}
          >
            <RunIcon
              className={["h-5 w-5", isRunning ? "animate-spin" : ""].join(" ")}
              aria-hidden="true"
            />
            {isRunning ? "Running..." : primaryLabel}
          </button>
        )}
      </div>

      <p className="mt-2 text-center text-xs font-semibold text-slate-500">{safety}</p>

      {links.length > 0 && onOpenPath && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {links.map((link) => (
            <button
              key={link.label}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/60 bg-white/60 px-3 text-xs font-semibold text-slate-800 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={anyRunning || !link.path}
              onClick={() => onOpenPath(link.path)}
              title={link.path ? undefined : "Folder is not configured."}
            >
              <FolderOpen className="h-4 w-4 text-brand-700" aria-hidden="true" />
              <span className="truncate">{link.label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** A quiet card for capabilities that are coming later — never alarming. */
export function FutureWorkflowCard({
  icon: Icon,
  title,
  whatItWillDo,
  tint = "violet",
  chip = "Coming soon",
  footnote,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  whatItWillDo: string;
  tint?: CardTint;
  chip?: string;
  footnote?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-dashed border-brand-200 bg-white/40 p-5">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ring-1 ${TINT_TILE[tint]} opacity-70`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
            <InfoHint text={whatItWillDo} />
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-800 ring-1 ring-brand-200">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {chip}
            </span>
          </div>
          <span className="sr-only">{whatItWillDo}</span>
        </div>
      </div>
      <div className="mt-auto pt-4">
        {actionLabel && onAction ? (
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-brand-200 bg-white/70 px-4 text-xs font-semibold text-brand-800 transition hover:bg-white"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : (
          footnote && <p className="text-xs font-semibold text-slate-500">{footnote}</p>
        )}
      </div>
    </section>
  );
}
