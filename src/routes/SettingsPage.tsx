import {
  Check,
  FileEdit,
  Laptop,
  Lock,
  Mail,
  MonitorSmartphone,
  Send,
  ShieldCheck,
} from "lucide-react";

import { BrandingPanel } from "../components/BrandingPanel";
import { InfoHint } from "../components/InfoHint";
import { PageHeader } from "../components/PageHeader";
import { TemplateEditor } from "../components/TemplateEditor";
import { deliveryModeLabel } from "../messages";
import type { AppConfigStatus, AppPage } from "../types";

/*
  Hotel & Settings: ongoing customization, separate from first-install Setup.
  Identity/branding, output templates, automation preferences (read-only here,
  changed in guided setup), safety, and local-data transparency.
*/
export function SettingsPage({
  configStatus,
  onRefresh,
  onNavigate,
}: {
  configStatus: AppConfigStatus | null;
  onRefresh: () => void | Promise<void>;
  onNavigate: (page: AppPage) => void;
}) {
  const config = configStatus?.config;
  const deliveryMode = config?.invoiceDeliveryMode;

  return (
    <div className="space-y-5">
      <PageHeader title="Hotel & Settings" eyebrow="Make InnPilot yours" />

      <BrandingPanel configStatus={configStatus} onSaved={onRefresh} />

      <TemplateEditor configStatus={configStatus} onSaved={onRefresh} />

      <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700 ring-1 ring-sky-200">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-slate-950">Invoice delivery</h2>
          <InfoHint text="How prepared invoices leave the hotel. Changed safely in guided setup." />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <DeliveryModeCard
            icon={FileEdit}
            title="Prepare files only"
            description="Files are prepared for you to send yourself. Gmail is never contacted."
            active={deliveryMode === "prepareOnly"}
          />
          <DeliveryModeCard
            icon={Mail}
            title="Create Gmail drafts"
            description="Drafts are created for your review. No emails are sent."
            active={deliveryMode === "gmailDrafts"}
          />
          <DeliveryModeCard
            icon={Send}
            title="Send automatically"
            description="Locked until stronger controls are ready."
            active={deliveryMode === "sendAutomatically"}
            locked
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500">
            Current mode: {deliveryModeLabel(deliveryMode)} — no emails are ever sent
            automatically.
          </p>
          <button
            className="inline-flex min-h-10 items-center rounded-md border border-white/70 bg-white/70 px-4 text-sm font-semibold text-slate-800 transition hover:bg-white"
            onClick={() => onNavigate("setup")}
          >
            Change in guided setup
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-slate-950">Safety preferences</h2>
            <InfoHint text="InnPilot's guardrails, set during guided setup." />
          </div>
          <div className="mt-4 space-y-2">
            <SafetyLine
              label="Safe mode by default"
              detail="Runs rehearse without changing real files."
              value={config?.safety.dryRunDefault}
            />
            <SafetyLine
              label="Ask before moving files"
              detail="File moves always need a confirmation."
              value={config?.safety.requireConfirmationForFileMoves}
            />
            <SafetyLine
              label="Redact logs"
              detail="Personal details are removed from log files."
              value={config?.safety.redactLogs}
            />
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-200">
                <Laptop className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Your data stays here</h2>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                  InnPilot is local-first: settings, templates, logos, and run history live on
                  this computer. Nothing is uploaded anywhere.
                </p>
              </div>
            </div>
            <p className="mt-4 break-words rounded-md bg-white/60 px-3 py-2 font-mono text-xs leading-5 text-slate-600">
              {configStatus?.configPath ?? "Settings location unavailable."}
            </p>
          </section>

          <section className="rounded-xl border border-dashed border-brand-200 bg-white/40 p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/70 text-brand-300 ring-1 ring-brand-100">
                <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">Multi-PC sync</h2>
                  <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-800 ring-1 ring-brand-200">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Coming soon
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                  Share hotel settings between the front desk and back office, still without a
                  cloud account.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function DeliveryModeCard({
  icon: Icon,
  title,
  description,
  active,
  locked = false,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  active: boolean;
  locked?: boolean;
}) {
  return (
    <div
      className={[
        "relative rounded-lg border p-4",
        active
          ? "border-brand-300 bg-brand-50 ring-2 ring-brand-200"
          : locked
            ? "border-dashed border-brand-200 bg-white/40"
            : "border-white/70 bg-white/60",
      ].join(" ")}
    >
      {active && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          <Check className="h-3 w-3" aria-hidden="true" />
          Active
        </span>
      )}
      {locked && !active && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-800 ring-1 ring-brand-200">
          <Lock className="h-3 w-3" aria-hidden="true" />
          Future
        </span>
      )}
      <Icon
        className={["h-5 w-5", locked && !active ? "text-brand-300" : "text-brand-800"].join(" ")}
        aria-hidden="true"
      />
      <p className="mt-2 text-sm font-semibold text-slate-950">{title}</p>
      <p className="mt-1 text-xs font-medium leading-5 text-slate-600">{description}</p>
    </div>
  );
}

function SafetyLine({
  label,
  detail,
  value,
}: {
  label: string;
  detail: string;
  value?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-white/60 px-3 py-2.5">
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="text-xs font-medium text-slate-600">{detail}</p>
      </div>
      <span
        className={[
          "shrink-0 rounded-md px-2.5 py-1 text-xs font-bold ring-1",
          value
            ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
            : "bg-slate-50 text-slate-700 ring-slate-200",
        ].join(" ")}
      >
        {typeof value === "boolean" ? (value ? "On" : "Off") : "Unknown"}
      </span>
    </div>
  );
}
