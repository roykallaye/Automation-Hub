import {
  Activity,
  ClipboardCheck,
  LifeBuoy,
  PlayCircle,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";

import { DestinationCard } from "../components/DestinationCard";
import { StatusHint, type StatusTone } from "../components/StatusOrb";
import { useI18n } from "../i18n";
import type { CardTint } from "../components/tints";
import { deliveryModeLabel } from "../messages";
import type {
  AppConfigStatus,
  AppPage,
  ModuleReadiness,
  RunSummary,
} from "../types";
import type { NextAction } from "../nextAction";

/*
  Home is a calm, guided entry point â€” not a dashboard.

  One hero with the single next action, then large destination cards.
  Nothing runs from Home; the user is guided to the right place instead.
*/
export function HomePage({
  configStatus,
  modules,
  loading,
  lastSummary,
  nextAction,
  onNavigate,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  loading: boolean;
  lastSummary: RunSummary | null;
  nextAction: NextAction;
  onNavigate: (page: AppPage) => void;
}) {
  const { t } = useI18n();
  const safeModeOn = configStatus?.config.safety.dryRunDefault ?? false;
  const deliveryMode = configStatus?.config.invoiceDeliveryMode;
  const destinations = buildDestinations({ configStatus, modules, loading, lastSummary, t });

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-white/65 bg-white/55 shadow-glass backdrop-blur-xl">
        <div className="bg-[linear-gradient(120deg,rgb(var(--brand-50))_0%,transparent_55%)] p-6 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div
                aria-hidden="true"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-800 text-white shadow-sm"
              >
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-brand-800">{timeOfDayGreeting(t)}</p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                  {nextAction.title}
                </h2>
                <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                  {nextAction.shortMessage}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {safeModeOn && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("home.safeModeOn")}
                    </span>
                  )}
                  {deliveryMode && (
                    <span className="inline-flex rounded-md bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-800 ring-1 ring-brand-200">
                      {t("home.invoicesMode", { mode: deliveryModeLabel(deliveryMode, t) })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              className="shrink-0 rounded-md bg-ink px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft"
              onClick={() => onNavigate(nextAction.targetPage)}
            >
              {nextAction.buttonLabel}
            </button>
          </div>

          {lastSummary && (
            <button
              className="mt-5 inline-flex w-full items-center justify-between gap-3 rounded-lg border border-white/70 bg-white/60 px-4 py-3 text-left transition hover:bg-white/85 sm:w-auto sm:min-w-[22rem]"
              onClick={() => onNavigate("activity")}
            >
              <span className="min-w-0">
                <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">
                  {t("home.mostRecent")}
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">
                  {lastSummary.automation_name} Â· {formatTime(lastSummary.end_time)}
                </span>
              </span>
              <StatusHint
                tone={lastRunTone(lastSummary)}
                label={lastRunLabel(lastSummary, t)}
              />
            </button>
          )}
        </div>
      </section>

      <div className="stagger-children grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {destinations.map((destination) => (
          <DestinationCard
            key={destination.page}
            icon={destination.icon}
            title={destination.title}
            description={destination.description}
            tint={destination.tint}
            hintTone={destination.hintTone}
            hintLabel={destination.hintLabel}
            actionLabel={destination.actionLabel}
            futureChip={destination.futureChip}
            highlighted={destination.page === nextAction.targetPage}
            onOpen={() => onNavigate(destination.page)}
          />
        ))}
      </div>
    </div>
  );
}

type Destination = {
  page: AppPage;
  icon: typeof Sparkles;
  title: string;
  description: string;
  tint: CardTint;
  hintTone: StatusTone;
  hintLabel: string;
  actionLabel: string;
  futureChip?: string;
};

function buildDestinations({
  configStatus,
  modules,
  loading,
  lastSummary,
  t,
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  loading: boolean;
  lastSummary: RunSummary | null;
  t: ReturnType<typeof useI18n>["t"];
}): Destination[] {
  const deliveryMode = configStatus?.config.invoiceDeliveryMode;
  const primaryIds =
    deliveryMode === "prepareOnly" ? ["invoices"] : ["invoices", "gmailDrafts"];
  const primaryReady =
    !loading &&
    Boolean(configStatus) &&
    primaryIds.every(
      (id) => modules.find((module) => module.id === id)?.status === "ready",
    );
  const workModules = modules.filter((module) => module.id !== "support");
  const readyCount = workModules.filter((module) => module.status === "ready").length;

  const pythonItem = configStatus?.preflight.items.find(
    (item) => item.key === "pythonExecutable",
  );
  const supportTone: StatusTone = loading
    ? "neutral"
    : pythonItem?.status === "ready"
      ? "ready"
      : "attention";

  const hotelName = configStatus?.config.client.displayName?.trim();
  const hotelNamed = Boolean(hotelName) && hotelName !== "Your Hotel";

  return [
    {
      page: "setup",
      icon: ClipboardCheck,
      title: t("home.setupTitle"),
      description: t("home.setupDescription"),
      tint: "sky",
      hintTone: loading ? "neutral" : primaryReady ? "ready" : "attention",
      hintLabel: loading ? t("common.checking") : primaryReady ? t("home.setupReady") : t("home.setupFinish"),
      actionLabel: primaryReady ? t("common.review") : t("common.continue"),
    },
    {
      page: "automations",
      icon: PlayCircle,
      title: t("home.automationsTitle"),
      description: t("home.automationsDescription"),
      tint: "brand",
      hintTone: loading ? "neutral" : primaryReady ? "ready" : "attention",
      hintLabel: loading
        ? t("common.checking")
        : t("home.readyCount", { ready: readyCount, total: workModules.length }),
      actionLabel: t("common.open"),
    },
    {
      page: "activity",
      icon: Activity,
      title: t("home.activityTitle"),
      description: t("home.activityDescription"),
      tint: "emerald",
      hintTone: lastSummary ? lastRunTone(lastSummary) : "neutral",
      hintLabel: lastSummary ? lastRunLabel(lastSummary, t) : t("home.noRunsYet"),
      actionLabel: t("common.review"),
    },
    {
      page: "settings",
      icon: Settings2,
      title: t("home.settingsTitle"),
      description: t("home.settingsDescription"),
      tint: "amber",
      hintTone: hotelNamed ? "ready" : "neutral",
      hintLabel: hotelNamed ? hotelName! : t("home.makeItYours"),
      actionLabel: t("common.customize"),
    },
    {
      page: "assistant",
      icon: Wand2,
      title: t("home.assistantTitle"),
      description: t("home.assistantDescription"),
      tint: "violet",
      hintTone: "future",
      hintLabel: t("home.prototype"),
      actionLabel: t("common.explore"),
      futureChip: t("common.comingSoon"),
    },
    {
      page: "support",
      icon: LifeBuoy,
      title: t("home.supportTitle"),
      description: t("home.supportDescription"),
      tint: "rose",
      hintTone: supportTone,
      hintLabel:
        supportTone === "ready"
          ? t("home.allToolsFound")
          : supportTone === "neutral"
            ? t("common.checking")
            : t("home.checkTools"),
      actionLabel: t("common.open"),
    },
  ];
}

function lastRunTone(summary: RunSummary): StatusTone {
  if (summary.status === "success") return "ready";
  if (summary.status === "warning") return "attention";
  return "blocked";
}

function lastRunLabel(summary: RunSummary, t: ReturnType<typeof useI18n>["t"]) {
  if (summary.status === "success") return t("status.completed");
  if (summary.status === "warning") return t("status.needsReview");
  return t("status.needsAttention");
}

function timeOfDayGreeting(t: ReturnType<typeof useI18n>["t"]) {
  const hour = new Date().getHours();
  if (hour < 12) return t("home.goodMorning");
  if (hour < 18) return t("home.goodAfternoon");
  return t("home.goodEvening");
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

