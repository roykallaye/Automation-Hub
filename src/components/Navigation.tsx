import {
  Activity,
  Home,
  LifeBuoy,
  PlayCircle,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { AppPage } from "../types";

const navigationItems: {
  key: AppPage;
  label: string;
  icon: LucideIcon;
}[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "automations", label: "Automations", icon: PlayCircle },
  { key: "setup", label: "Setup", icon: Settings },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "support", label: "Support", icon: LifeBuoy },
];

export function Navigation({
  currentPage,
  onPageChange,
}: {
  currentPage: AppPage;
  onPageChange: (page: AppPage) => void;
}) {
  return (
    <nav className="flex gap-2 rounded-lg border border-white/65 bg-white/50 p-2 shadow-glass backdrop-blur-xl lg:flex-col">
      {navigationItems.map((item) => {
        const Icon = item.icon;
        const active = item.key === currentPage;
        return (
          <button
            key={item.key}
            className={[
              "inline-flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition",
              active
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-700 hover:bg-white/75",
            ].join(" ")}
            onClick={() => onPageChange(item.key)}
          >
            <Icon className={["h-5 w-5", active ? "text-teal-200" : "text-teal-700"].join(" ")} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
