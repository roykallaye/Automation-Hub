import {
  Activity,
  ClipboardCheck,
  Home,
  LifeBuoy,
  PlayCircle,
  Settings2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "../i18n";
import { operatorCopy } from "../operatorCopy";
import type { AppPage } from "../types";

type NavigationItem = {
  key: AppPage;
  icon: LucideIcon;
  label: string;
};

export function OperatorNavigation({
  currentPage,
  onPageChange,
}: {
  currentPage: AppPage;
  onPageChange: (page: AppPage) => void;
}) {
  const { language } = useI18n();
  const words = operatorCopy(language);
  const primary: NavigationItem[] = [
    { key: "home", icon: Home, label: words.navToday },
    { key: "automations", icon: PlayCircle, label: words.navWorkflows },
    { key: "activity", icon: Activity, label: words.navHistory },
  ];
  const system: NavigationItem[] = [
    { key: "setup", icon: ClipboardCheck, label: words.navSetup },
    { key: "settings", icon: Settings2, label: words.navSettings },
    { key: "support", icon: LifeBuoy, label: words.navSupport },
  ];

  return (
    <nav aria-label="Main navigation" className="op-navigation">
      <div className="op-navigation__primary">
        {primary.map((item) => (
          <NavigationButton
            active={currentPage === item.key}
            item={item}
            key={item.key}
            onClick={() => onPageChange(item.key)}
          />
        ))}
      </div>
      <div className="op-navigation__system">
        <p><Wrench aria-hidden="true" size={13} /> {words.navSystem}</p>
        {system.map((item) => (
          <NavigationButton
            active={currentPage === item.key}
            compact
            item={item}
            key={item.key}
            onClick={() => onPageChange(item.key)}
          />
        ))}
      </div>
    </nav>
  );
}

function NavigationButton({
  active,
  compact = false,
  item,
  onClick,
}: {
  active: boolean;
  compact?: boolean;
  item: NavigationItem;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`op-nav-button${active ? " is-active" : ""}${compact ? " is-compact" : ""}`}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" size={compact ? 17 : 19} />
      <span>{item.label}</span>
    </button>
  );
}
