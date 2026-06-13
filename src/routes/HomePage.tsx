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
  Home is a calm, guided entry point — not a dashboard.

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
  const safeModeOn = configStatus?.config.safety.dryRunDefault ?? false;
  const deliveryMode = configStatus?.config.invoiceDeliveryMode;
  const destinations = buildDestinations({ configStatus, modules, loading, lastSummary });

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
                <p className="text-sm font-semibold text-brand-800">{timeOfDayGreeting()}</p>
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
                      Safe mode on — runs do not change real files
                    </span>
                  )}
                  {deliveryMode && (
                    <span className="inline-flex rounded-md bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-800 ring-1 ring-brand-200">
                      Invoices: {deliveryModeLabel(deliveryMode)}
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
                  Most recent
                </span>
                <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">
                  {lastSummary.automation_name} · {formatTime(lastSummary.end_time)}
                </span>
              </span>
              <StatusHint
                tone={lastRunTone(lastSummary)}
                label={lastRunLabel(lastSummary)}
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
}: {
  configStatus: AppConfigStatus | null;
  modules: ModuleReadiness[];
  loading: boolean;
  lastSummary: RunSummary | null;
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
      title: "Setup",
      description: "Prepare folders, tools, and invoice delivery — one step at a time.",
      tint: "sky",
      hintTone: loading ? "neutral" : primaryReady ? "ready" : "attention",
      hintLabel: loading ? "Checking..." : primaryReady ? "Checks passing" : "Finish setup",
      actionLabel: primaryReady ? "Review" : "Continue",
    },
    {
      page: "automations",
      icon: PlayCircle,
      title: "Automations",
      description: "Run today's back-office work and see exactly what will happen first.",
      tint: "brand",
      hintTone: loading ? "neutral" : primaryReady ? "ready" : "attention",
      hintLabel: loading
        ? "Checking..."
        : `${readyCount} of ${workModules.length} ready`,
      actionLabel: "Open",
    },
    {
      page: "activity",
      icon: Activity,
      title: "Activity",
      description: "A clear story of every run: what was found, prepared, and skipped.",
      tint: "emerald",
      hintTone: lastSummary ? lastRunTone(lastSummary) : "neutral",
      hintLabel: lastSummary ? lastRunLabel(lastSummary) : "No runs yet",
      actionLabel: "Review",
    },
    {
      page: "settings",
      icon: Settings2,
      title: "Hotel & Settings",
      description: "Your name, colors, logo, and the wording InnPilot writes for you.",
      tint: "amber",
      hintTone: hotelNamed ? "ready" : "neutral",
      hintLabel: hotelNamed ? hotelName! : "Make it yours",
      actionLabel: "Customize",
    },
    {
      page: "assistant",
      icon: Wand2,
      title: "AI Assistant",
      description: "Describe a repetitive task and shape it into a new automation.",
      tint: "violet",
      hintTone: "future",
      hintLabel: "Prototype",
      actionLabel: "Explore",
      futureChip: "Coming soon",
    },
    {
      page: "support",
      icon: LifeBuoy,
      title: "Support",
      description: "Calm diagnostics for tools and folders — no terminal needed.",
      tint: "rose",
      hintTone: supportTone,
      hintLabel:
        supportTone === "ready"
          ? "All tools found"
          : supportTone === "neutral"
            ? "Checking..."
            : "Check tools",
      actionLabel: "Open",
    },
  ];
}

function lastRunTone(summary: RunSummary): StatusTone {
  if (summary.status === "success") return "ready";
  if (summary.status === "warning") return "attention";
  return "blocked";
}

function lastRunLabel(summary: RunSummary) {
  if (summary.status === "success") return "Completed";
  if (summary.status === "warning") return "Needs review";
  return "Needs attention";
}

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
