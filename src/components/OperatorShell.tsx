import { AlertTriangle, CheckCircle2, LoaderCircle, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "../i18n";
import { operatorCopy } from "../operatorCopy";
import type { AppPage, RunStatus } from "../types";
import { LifeDeskStatusChip } from "./LifeDeskStatusChip";
import { OperatorNavigation } from "./OperatorNavigation";
import "../operator-experience.css";

export function OperatorShell({
  children,
  currentPage,
  displayName,
  logoDataUrl,
  onPageChange,
  status,
  statusLabel,
}: {
  children: ReactNode;
  currentPage: AppPage;
  displayName: string;
  logoDataUrl?: string | null;
  status: RunStatus;
  statusLabel: string;
  onPageChange: (page: AppPage) => void;
}) {
  const { language, t } = useI18n();
  const words = operatorCopy(language);
  const working = status === "warning";
  const needsAttention = status === "error";

  return (
    <main className="op-app">
      <div aria-hidden="true" className="op-leaf op-leaf--one" />
      <div aria-hidden="true" className="op-leaf op-leaf--two" />
      <a className="op-skip" href="#main-content">{t("app.skipToContent")}</a>

      <section className="op-shell">
        <header className="op-topbar">
          <div className="op-brand">
            {logoDataUrl ? (
              <img alt="" src={logoDataUrl} />
            ) : (
              <span aria-hidden="true">{brandInitial(displayName)}</span>
            )}
            <div>
              <strong>{displayName}</strong>
              <small>INNPILOT · LIFE HOTEL OPERATIONS</small>
            </div>
          </div>
          <div className="op-topbar__actions">
            <span
              className={`op-run-state${working ? " is-working" : ""}${needsAttention ? " is-error" : ""}`}
              title={statusLabel}
            >
              {working ? (
                <LoaderCircle aria-hidden="true" className="op-spin" size={15} />
              ) : needsAttention ? (
                <AlertTriangle aria-hidden="true" size={15} />
              ) : (
                <CheckCircle2 aria-hidden="true" size={15} />
              )}
              {working ? words.shellWorking : needsAttention ? words.shellAttention : statusLabel}
            </span>
            <LifeDeskStatusChip onOpen={() => onPageChange("settings")} />
            <button
              aria-label={words.navSettings}
              className="op-icon-button"
              onClick={() => onPageChange("settings")}
              type="button"
            >
              <Settings2 aria-hidden="true" size={19} />
            </button>
          </div>
        </header>

        <div className="op-layout">
          <OperatorNavigation currentPage={currentPage} onPageChange={onPageChange} />
          <div className="op-content" id="main-content" key={currentPage}>
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}

function brandInitial(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? trimmed[0].toUpperCase() : "I";
}
