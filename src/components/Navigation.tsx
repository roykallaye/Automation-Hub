import {
  Activity,
  ClipboardCheck,
  Home,
  LifeBuoy,
  PlayCircle,
  Settings2,
  Wand2,
  type LucideIcon,
} from "lucide-react";

import type { AppPage } from "../types";
import type { NextAction } from "../nextAction";
import { useI18n, type TranslationKey } from "../i18n";

/*
  Navigation is organized by user intent:
    everyday work first (Home, Automations, Activity),
    then preparation and personalization (Setup, Hotel & Settings),
    then future and help (AI Assistant, Support).
*/
const navigationItems: {
  key: AppPage;
  labelKey: TranslationKey;
  icon: LucideIcon;
  groupKey?: TranslationKey;
}[] = [
  { key: "home", labelKey: "nav.home", icon: Home },
  { key: "automations", labelKey: "nav.automations", icon: PlayCircle },
  { key: "activity", labelKey: "nav.activity", icon: Activity },
  { key: "setup", labelKey: "nav.setup", icon: ClipboardCheck, groupKey: "nav.groupPrepare" },
  { key: "settings", labelKey: "nav.settings", icon: Settings2 },
  { key: "assistant", labelKey: "nav.assistant", icon: Wand2, groupKey: "nav.groupMore" },
  { key: "support", labelKey: "nav.support", icon: LifeBuoy },
];

export function Navigation({
  currentPage,
  nextAction,
  onPageChange,
}: {
  currentPage: AppPage;
  nextAction: NextAction;
  onPageChange: (page: AppPage) => void;
}) {
  const { t } = useI18n();
  return (
    <nav
      aria-label="Main navigation"
      className="flex gap-2 overflow-x-auto rounded-xl border border-white/65 bg-white/50 p-2 shadow-glass backdrop-blur-xl lg:sticky lg:top-7 lg:block lg:h-fit lg:space-y-1 lg:overflow-visible"
    >
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const active = item.key === currentPage;
        const isNext = item.key === nextAction.targetPage && !active;
        return (
          <div key={item.key} className="shrink-0 lg:shrink">
            {item.groupKey && (
              <p
                aria-hidden="true"
                className="hidden px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 lg:block"
              >
                {t(item.groupKey)}
              </p>
            )}
            <button
              aria-current={active ? "page" : undefined}
              className={[
                "inline-flex min-h-11 w-full shrink-0 items-center gap-3 rounded-md px-3 text-sm font-semibold transition",
                active
                  ? "bg-ink text-white shadow-sm ring-1 ring-slate-900/10"
                  : isNext
                    ? "bg-brand-50 text-brand-950 ring-1 ring-brand-200 shadow-[0_0_0_3px_rgb(var(--brand-700)/0.08)]"
                    : "text-slate-700 hover:bg-white/75 hover:text-slate-950",
              ].join(" ")}
              onClick={() => onPageChange(item.key)}
            >
              <Icon
                aria-hidden="true"
                className={[
                  "h-5 w-5 shrink-0",
                  active ? "text-brand-200" : "text-brand-700",
                ].join(" ")}
              />
              <span className="whitespace-nowrap">{t(item.labelKey)}</span>
              {isNext && (
                <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-800">
                  {t("nav.next")}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
