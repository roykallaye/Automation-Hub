/*
  The InnPilot component set.

  Deliberately small: every screen is built from these pieces so the product
  reads as one system rather than twenty near-identical card variants. Anything
  developer-facing (paths, digests, revisions, evidence) belongs inside
  <TechnicalDetails>, never in the default view.
*/

import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDashed,
  Info,
  LoaderCircle,
  Minus,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ status */

export type StatusTone = "ready" | "attention" | "problem" | "running" | "idle";

const STATUS_ICON: Record<StatusTone, LucideIcon> = {
  ready: Check,
  attention: AlertTriangle,
  problem: AlertTriangle,
  running: LoaderCircle,
  idle: Minus,
};

/** Status is always icon + word, so it never depends on color alone. */
export function Status({ tone, label }: { tone: StatusTone; label: string }) {
  const Icon = STATUS_ICON[tone];
  return (
    <span className={`ip-status ip-status--${tone}`}>
      <Icon aria-hidden="true" className={tone === "running" ? "ip-spin" : undefined} size={13} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ layout */

export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="ip-page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ip-page-head__actions">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  aside,
  children,
}: {
  title?: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      {title ? (
        <div className="ip-section__head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Card({
  children,
  pad = false,
  quiet = false,
}: {
  children: ReactNode;
  pad?: boolean;
  quiet?: boolean;
}) {
  return (
    <div className={`ip-card${pad ? " ip-card--pad" : ""}${quiet ? " ip-card--quiet" : ""}`}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- status row */

/**
 * The workhorse. A business-facing label, an optional one-line meaning, and a
 * status. `onOpen` turns it into a button; otherwise it is inert content.
 */
export function Row({
  icon: Icon,
  title,
  meta,
  status,
  aside,
  onOpen,
  openLabel,
}: {
  icon?: LucideIcon;
  title: string;
  meta?: string;
  status?: { tone: StatusTone; label: string };
  aside?: ReactNode;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const body = (
    <>
      {Icon ? (
        <span className="ip-row__icon">
          <Icon aria-hidden="true" size={17} />
        </span>
      ) : null}
      <span className="ip-row__body">
        <span className="ip-row__title">{title}</span>
        {meta ? <span className="ip-row__meta">{meta}</span> : null}
      </span>
      <span className="ip-row__aside">
        {status ? <Status label={status.label} tone={status.tone} /> : null}
        {aside}
        {onOpen ? <ChevronRight aria-hidden="true" className="ip-row__chevron" size={17} /> : null}
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

export function Rows({ children }: { children: ReactNode }) {
  return <div className="ip-rows">{children}</div>;
}

/* ----------------------------------------------------------------- buttons */

export function Button({
  children,
  icon: Icon,
  variant = "secondary",
  size = "md",
  block = false,
  busy = false,
  disabled = false,
  onClick,
  type = "button",
  title,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  block?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      className={[
        "ip-btn",
        `ip-btn--${variant}`,
        size === "lg" ? "ip-btn--lg" : "",
        block ? "ip-btn--block" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || busy}
      onClick={onClick}
      title={title}
      type={type}
    >
      {busy ? (
        <LoaderCircle aria-hidden="true" className="ip-spin" size={16} />
      ) : Icon ? (
        <Icon aria-hidden="true" size={16} />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  onClick,
  busy = false,
  disabled = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className="ip-icon-btn"
      disabled={disabled || busy}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" className={busy ? "ip-spin" : undefined} size={17} />
    </button>
  );
}

/* -------------------------------------------------------------- disclosure */

/**
 * Where paths, digests, revisions and evidence live. Present on many screens,
 * prominent on none.
 */
export function TechnicalDetails({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="ip-disclosure">
      <summary>
        <ChevronRight aria-hidden="true" className="ip-disclosure__caret" size={15} />
        {label}
      </summary>
      <div className="ip-disclosure__body">{children}</div>
    </details>
  );
}

export function DetailList({ items }: { items: { label: string; value: string; mono?: boolean }[] }) {
  return (
    <dl className="ip-detail-list">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? "ip-mono" : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------ empty & note */

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="ip-empty">
      <span className="ip-empty__icon">
        <Icon aria-hidden="true" size={20} />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

export function Note({
  tone = "quiet",
  children,
}: {
  tone?: "quiet" | "ready" | "attention" | "problem";
  children: ReactNode;
}) {
  const Icon = tone === "problem" || tone === "attention" ? AlertTriangle : tone === "ready" ? Check : Info;
  return (
    <p className={`ip-note ip-note--${tone}`} role={tone === "problem" ? "alert" : undefined}>
      <Icon aria-hidden="true" size={15} />
      <span>{children}</span>
    </p>
  );
}

/* --------------------------------------------------------------- progress */

export type ProgressStep = {
  key: string;
  label: string;
  state: "done" | "active" | "pending";
};

/** Only ever rendered from real backend state — never a fake timer. */
export function ProgressFlow({ steps }: { steps: ProgressStep[] }) {
  return (
    <ul className="ip-progress">
      {steps.map((step) => (
        <li className={`is-${step.state}`} key={step.key}>
          <span className="ip-progress__mark">
            {step.state === "done" ? (
              <Check aria-hidden="true" size={15} />
            ) : step.state === "active" ? (
              <LoaderCircle aria-hidden="true" className="ip-spin" size={15} />
            ) : (
              <CircleDashed aria-hidden="true" size={15} />
            )}
          </span>
          {step.label}
          <span className="ip-visually-hidden">
            {step.state === "done" ? " — done" : step.state === "active" ? " — in progress" : " — waiting"}
          </span>
        </li>
      ))}
    </ul>
  );
}
