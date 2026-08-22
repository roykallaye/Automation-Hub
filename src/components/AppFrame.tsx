/*
  The application frame.

  Primary navigation holds only destinations a manager uses often. System
  status, help and hotel settings sit in a quieter group at the bottom, so the
  operational destinations are never competing with configuration.

  The top bar carries one thing: whether a local assistant is present and
  whether anything is happening. That is the whole "agent presence" treatment —
  a labelled dot, not a dashboard.
*/

import {
  Activity as ActivityIcon,
  Bot,
  Building2,
  CircleHelp,
  Home,
  MonitorSmartphone,
  Settings2,
  SlidersHorizontal,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useI18n, type TranslationKey } from "../i18n";
import type { AppPage } from "../types";

export type AssistantPresence = "connected" | "notConnected" | "working" | "attention";

type NavItem = { key: AppPage; icon: LucideIcon; labelKey: TranslationKey };

// Work areas sits before Automations on purpose: automation opportunities are
// something InnPilot finds by understanding a business area, so the navigation
// reads in the order the work actually happens.
const PRIMARY: NavItem[] = [
  { key: "home", icon: Home, labelKey: "nav.home" },
  { key: "workAreas", icon: Building2, labelKey: "nav.workAreas" },
  { key: "automations", icon: Workflow, labelKey: "nav.automations" },
  { key: "activity", icon: ActivityIcon, labelKey: "nav.activity" },
  { key: "assistant", icon: Bot, labelKey: "nav.assistant" },
];

const SECONDARY: NavItem[] = [
  { key: "system", icon: SlidersHorizontal, labelKey: "nav.system" },
  { key: "support", icon: CircleHelp, labelKey: "nav.support" },
  { key: "settings", icon: Settings2, labelKey: "nav.settings" },
];

export function AppFrame({
  children,
  browserPreview,
  currentPage,
  hotelName,
  logoDataUrl,
  presence,
  attentionCount,
  notice,
  onDismissNotice,
  onPageChange,
}: {
  children: ReactNode;
  browserPreview: boolean;
  currentPage: AppPage;
  hotelName: string;
  logoDataUrl?: string | null;
  presence: AssistantPresence;
  attentionCount: number;
  notice?: string | null;
  onDismissNotice?: () => void;
  onPageChange: (page: AppPage) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="ip-app">
      <a className="ip-skip" href="#ip-main">
        {t("app.skipToContent")}
      </a>
      <div className="ip-shell">
        <nav aria-label={t("nav.section.operate")} className="ip-sidebar">
          <div className="ip-sidebar__brand">
            <span aria-hidden="true" className="ip-sidebar__mark">
              {logoDataUrl ? <img alt="" src={logoDataUrl} /> : "IP"}
            </span>
            <span className="ip-sidebar__names">
              <span className="ip-sidebar__product">InnPilot</span>
              <span className="ip-sidebar__hotel" title={hotelName}>
                {hotelName}
              </span>
            </span>
          </div>

          {PRIMARY.map((item) => (
            <NavButton
              active={currentPage === item.key}
              badge={item.key === "home" ? attentionCount : 0}
              item={item}
              key={item.key}
              onClick={() => onPageChange(item.key)}
            />
          ))}

          <div className="ip-sidebar__spacer" />

          <div className="ip-sidebar__group">
            {SECONDARY.map((item) => (
              <NavButton
                active={currentPage === item.key || (item.key === "support" && currentPage === "guide")}
                item={item}
                key={item.key}
                onClick={() => onPageChange(item.key)}
              />
            ))}
          </div>
        </nav>

        <div className="ip-main">
          <header className="ip-topbar">
            {notice ? (
              <div aria-live="polite" className="ip-topbar__notice" role="status">
                <span title={notice}>{notice}</span>
                {onDismissNotice ? (
                  <button
                    aria-label={t("common.close")}
                    onClick={onDismissNotice}
                    title={t("common.close")}
                    type="button"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </div>
            ) : null}
            {browserPreview ? (
              <span className="ip-presence" title={t("shell.browserPreviewHint")}>
                <MonitorSmartphone aria-hidden="true" size={14} />
                {t("shell.browserPreview")}
              </span>
            ) : (
              <PresenceChip presence={presence} />
            )}
          </header>
          <main className="ip-content" id="ip-main" key={currentPage}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function NavButton({
  active,
  badge = 0,
  item,
  onClick,
}: {
  active: boolean;
  badge?: number;
  item: NavItem;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  const label = t(item.labelKey);
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`ip-nav-item${active ? " is-active" : ""}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" size={17} />
      <span>{label}</span>
      {badge > 0 ? <span className="ip-nav-item__badge">{badge}</span> : null}
    </button>
  );
}

/**
 * The quiet-intelligence cue: a labelled dot. It pulses only while something is
 * actually happening, and the label means the dot is never the only signal.
 */
function PresenceChip({ presence }: { presence: AssistantPresence }) {
  const { t } = useI18n();
  const label =
    presence === "working"
      ? t("shell.working")
      : presence === "attention"
        ? t("shell.needsAttention")
        : presence === "connected"
          ? t("shell.assistantConnected")
          : t("shell.thisComputer");
  const modifier =
    presence === "working"
      ? " is-working"
      : presence === "attention"
        ? " is-attention"
        : presence === "connected"
          ? " is-connected"
          : "";
  return (
    <span className={`ip-presence${modifier}`}>
      <span aria-hidden="true" className="ip-presence__dot" />
      {label}
    </span>
  );
}
