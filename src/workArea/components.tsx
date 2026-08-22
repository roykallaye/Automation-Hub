/*
  The Work Area component set.

  Small on purpose, and built from the Phase G pieces rather than beside them:
  Card, Row, Status, Note and TechnicalDetails do the visual work, so a Work
  Area screen reads as the same product as Automations or Activity.
*/

import { ArrowRight, Check, Hand, Info, Minus, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, Note, Status, type StatusTone } from "../components/ui";
import { useI18n, type TranslationKey } from "../i18n";
import {
  COVERAGE_LABEL,
  COVERAGE_TONE,
  MAGNITUDE_LABEL,
  MEDIUM_LABEL,
  TRUTH_LABEL,
  TRUTH_TONE,
} from "./vocabulary";
import type { Fact, MappedWorkflow, Magnitude, SectionCoverage } from "./types";

/* ------------------------------------------------------------- stage nav */

export type WorkAreaStage = "understand" | "improve" | "automate";

export const STAGES: WorkAreaStage[] = ["understand", "improve", "automate"];

const STAGE_TITLE: Record<WorkAreaStage, TranslationKey> = {
  understand: "workArea.nav.understand",
  improve: "workArea.nav.improve",
  automate: "workArea.nav.automate",
};

const STAGE_HINT: Record<WorkAreaStage, TranslationKey> = {
  understand: "workArea.nav.understandHint",
  improve: "workArea.nav.improveHint",
  automate: "workArea.nav.automateHint",
};

/**
 * Understand → Improve → Automate.
 *
 * The sequence is the product argument, so the navigation states it rather than
 * implying it. A stage whose prerequisite is unmet is still reachable — being
 * told why Automate is empty is more useful than a dead control — but it is
 * visibly quieter, so the three never look equally available.
 */
export function StageNav({
  current,
  unlocked,
  onSelect,
}: {
  current: WorkAreaStage;
  unlocked: Record<WorkAreaStage, boolean>;
  onSelect: (stage: WorkAreaStage) => void;
}) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("workArea.nav.label")} className="ip-wa-stages">
      {STAGES.map((stage, index) => {
        const active = stage === current;
        const locked = !unlocked[stage];
        return (
          <button
            aria-current={active ? "page" : undefined}
            className={`ip-wa-stage${active ? " is-active" : ""}${locked ? " is-locked" : ""}`}
            key={stage}
            onClick={() => onSelect(stage)}
            type="button"
          >
            <span aria-hidden="true" className="ip-wa-stage__num">
              {index + 1}
            </span>
            <span className="ip-wa-stage__body">
              <span className="ip-wa-stage__title">{t(STAGE_TITLE[stage])}</span>
              <span className="ip-wa-stage__hint">{t(STAGE_HINT[stage])}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* --------------------------------------------------------------- coverage */

/** One line of "what InnPilot knows about this part of the area". */
export function CoverageRow({
  icon: Icon,
  title,
  count,
  coverage,
  onOpen,
  openLabel,
}: {
  icon: LucideIcon;
  title: string;
  count: string;
  coverage?: SectionCoverage;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const { t } = useI18n();
  const body = (
    <>
      <span className="ip-row__icon">
        <Icon aria-hidden="true" size={17} />
      </span>
      <span className="ip-row__body">
        <span className="ip-row__title">{title}</span>
        <span className="ip-row__meta">{count}</span>
      </span>
      <span className="ip-row__aside">
        {coverage ? (
          <Status label={t(COVERAGE_LABEL[coverage])} tone={COVERAGE_TONE[coverage]} />
        ) : null}
      </span>
    </>
  );
  if (onOpen) {
    return (
      <button aria-label={openLabel} className="ip-row" onClick={onOpen} type="button">
        {body}
      </button>
    );
  }
  return <div className="ip-row">{body}</div>;
}

/* ------------------------------------------------------------------ facts */

/**
 * A list of mapped facts.
 *
 * Every entry carries how settled it is. An InnPilot guess is labelled "Needs
 * confirmation" and toned as attention, so it can never be mistaken at a glance
 * for something the manager actually said.
 */
export function FactList({
  busy = false,
  facts,
  empty,
  onConfirm,
}: {
  busy?: boolean;
  facts: Fact[];
  empty: string;
  /** Offered only for things InnPilot guessed, and only the manager may act. */
  onConfirm?: (factId: string) => void;
}) {
  const { t } = useI18n();
  if (facts.length === 0) {
    return <p className="ip-wa-empty-line">{empty}</p>;
  }
  return (
    <ul className="ip-wa-facts">
      {facts.map((fact) => (
        <li key={fact.id}>
          <span className="ip-wa-facts__label">{fact.label}</span>
          {fact.detail ? <span className="ip-wa-facts__detail">{fact.detail}</span> : null}
          <Status label={t(TRUTH_LABEL[fact.status])} tone={TRUTH_TONE[fact.status]} />
          {onConfirm && fact.status === "inferred" ? (
            <button
              aria-label={t("workArea.confirm.factLabel", { label: fact.label })}
              className="ip-btn ip-btn--ghost ip-wa-confirm"
              disabled={busy}
              onClick={() => onConfirm(fact.id)}
              type="button"
            >
              <Check aria-hidden="true" size={14} />
              {t("workArea.confirm.action")}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- workflows */

/**
 * A current-state process, read top to bottom.
 *
 * `title` is required rather than assumed: the caller must say whether this is
 * how the area works today or a suggestion, and the two are never rendered as
 * one flow.
 */
export function WorkflowFlow({
  steps,
  title,
  tone = "current",
}: {
  steps: MappedWorkflow["steps"];
  title: string;
  tone?: "current" | "suggested";
}) {
  const { t } = useI18n();
  return (
    <div className={`ip-wa-flow ip-wa-flow--${tone}`}>
      <h3 className="ip-wa-flow__title">{title}</h3>
      {steps.length === 0 ? (
        <p className="ip-wa-empty-line">{t("workArea.workflow.noSteps")}</p>
      ) : (
        <ol>
          {steps.map((step) => (
            <li key={step.id}>
              <span className="ip-wa-flow__text">{step.description}</span>
              {step.medium !== "digital" ? (
                <span className="ip-wa-chip">{t(MEDIUM_LABEL[step.medium])}</span>
              ) : null}
              {step.isDecision ? (
                <span className="ip-wa-chip">{t("workArea.workflow.decision")}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Today beside a suggestion, never merged into one diagram. */
export function FlowComparison({ children }: { children: ReactNode }) {
  return <div className="ip-wa-compare">{children}</div>;
}

/* ------------------------------------------------------------- attributes */

/** Effort, risk and benefit: present, subordinate, never the headline. */
export function Attributes({
  items,
}: {
  items: { labelKey: TranslationKey; value: Magnitude | null }[];
}) {
  const { t } = useI18n();
  const shown = items.filter((item) => item.value !== null);
  if (shown.length === 0) return null;
  return (
    <dl className="ip-wa-attributes">
      {shown.map((item) => (
        <div key={item.labelKey}>
          <dt>{t(item.labelKey)}</dt>
          <dd>{t(MAGNITUDE_LABEL[item.value as Magnitude])}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ notes */

/**
 * Silence is not completeness.
 *
 * The domain treats "no exceptions recorded" as "InnPilot does not know what
 * happens when this fails", and the UI has to say so. Hiding an empty section
 * would quietly imply the opposite.
 */
export function StillUnclear({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="ip-wa-unclear">
      <span className="ip-wa-unclear__head">
        <Info aria-hidden="true" size={14} />
        {t("workArea.stillUnclear")}
      </span>
      <span>{children}</span>
    </div>
  );
}

/**
 * The planning-only boundary.
 *
 * Placed where a manager is about to wonder what InnPilot just did to their
 * computer — the first Work Area screen, the Guide, and the Automate stage —
 * and deliberately not repeated on every card.
 */
export function PlanningOnlyNote() {
  const { t } = useI18n();
  return (
    <p className="ip-fineprint ip-wa-boundary">
      <ShieldCheck aria-hidden="true" size={14} />
      {t("workArea.planningOnly")}
    </p>
  );
}

/** A short "this is what happens next" line under a status. */
export function KeepManualBadge() {
  const { t } = useI18n();
  return (
    <span className="ip-wa-keep-manual">
      <Hand aria-hidden="true" size={14} />
      {t("workArea.category.keepManual")}
    </span>
  );
}

/* ---------------------------------------------------------------- section */

/**
 * A titled block inside a stage.
 *
 * Heading level 2: the page title is the h1 and stages themselves are
 * navigation, not headings, so blocks are the first level below the page.
 * Anything inside a block is an h3.
 */
export function Block({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description?: string;
  status?: { tone: StatusTone; label: string };
  children: ReactNode;
}) {
  return (
    <Card pad>
      <div className="ip-wa-block__head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {status ? <Status label={status.label} tone={status.tone} /> : null}
      </div>
      {children}
    </Card>
  );
}

/** A capability line reused by the Assistant page and the Automate stage. */
export function CapabilityLine({ allowed = false, label }: { allowed?: boolean; label: string }) {
  return (
    <div className="ip-row" style={{ minHeight: 40 }}>
      <span
        className="ip-row__icon"
        style={{ color: allowed ? "var(--ip-ready)" : "var(--ip-faint)" }}
      >
        {allowed ? <Check aria-hidden="true" size={16} /> : <Minus aria-hidden="true" size={16} />}
      </span>
      <span className="ip-row__body">
        <span className="ip-row__title" style={{ fontWeight: 550 }}>
          {label}
        </span>
      </span>
    </div>
  );
}

/**
 * The old-grant prompt.
 *
 * A connection created before Work Areas existed is still a working
 * connection — it simply was never granted the mapping capabilities. Saying
 * "disconnected" would be false, and quietly adding the scopes would take an
 * approval the manager never gave. So this asks, in the one place the gap
 * actually matters, and the answer creates a fresh grant through the existing
 * connect flow.
 */
export function AssistantAccessPrompt({
  busy,
  onDismiss,
  onReconnect,
}: {
  busy: boolean;
  onDismiss: () => void;
  onReconnect: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card pad>
      <h2 className="ip-wa-prompt__title">{t("workArea.access.title")}</h2>
      <p className="ip-wa-prompt__text">{t("workArea.access.text")}</p>
      <div className="ip-actions" style={{ marginTop: 14 }}>
        <button
          className="ip-btn ip-btn--primary"
          disabled={busy}
          onClick={onReconnect}
          type="button"
        >
          {t("workArea.access.reconnect")}
        </button>
        <button className="ip-btn ip-btn--ghost" onClick={onDismiss} type="button">
          {t("workArea.access.notNow")}
        </button>
      </div>
    </Card>
  );
}

/** "What must happen first" — the honest blocker list on an opportunity. */
export function Prerequisites({ items }: { items: string[] }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <div className="ip-wa-prereq">
      <span className="ip-wa-prereq__head">{t("workArea.improvement.firstThis")}</span>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <ArrowRight aria-hidden="true" size={13} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export { Note };
