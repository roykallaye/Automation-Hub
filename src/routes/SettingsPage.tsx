import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
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
import { useI18n, type Language } from "../i18n";
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
  const { t, language } = useI18n();
  const [languageNotice, setLanguageNotice] = useState<string | null>(null);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const config = configStatus?.config;
  const deliveryMode = config?.invoiceDeliveryMode;

  async function saveLanguage(nextLanguage: Language) {
    if (nextLanguage === language || savingLanguage) return;
    setSavingLanguage(true);
    setLanguageNotice(null);
    try {
      await invoke("save_app_language", { language: nextLanguage });
      await onRefresh();
      setLanguageNotice(t("settings.languageSaved"));
    } catch {
      setLanguageNotice(t("settings.languageSaveFailed"));
    } finally {
      setSavingLanguage(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.title")} eyebrow={t("settings.eyebrow")} />

      <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700 ring-1 ring-brand-200">
            <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-slate-950">{t("settings.languageTitle")}</h2>
          <InfoHint text={t("settings.languageHint")} />
        </div>
        <div className="mt-4 inline-grid rounded-lg border border-white/70 bg-white/55 p-1 sm:grid-cols-2">
          {([
            ["en", t("settings.english")],
            ["it", t("settings.italian")],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={[
                "min-h-11 rounded-md px-5 text-sm font-semibold transition",
                language === value
                  ? "bg-ink text-white shadow-sm"
                  : "text-slate-700 hover:bg-white/80",
              ].join(" ")}
              disabled={savingLanguage}
              onClick={() => saveLanguage(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {languageNotice && (
          <p className="mt-3 text-sm font-semibold text-brand-800">{languageNotice}</p>
        )}
      </section>

      <BrandingPanel configStatus={configStatus} onSaved={onRefresh} />

      <TemplateEditor configStatus={configStatus} onSaved={onRefresh} />

      <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700 ring-1 ring-sky-200">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-semibold text-slate-950">{t("settings.invoiceDeliveryTitle")}</h2>
          <InfoHint text={t("settings.invoiceDeliveryHint")} />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <DeliveryModeCard
            icon={FileEdit}
            title={t("delivery.prepareOnly")}
            description={t("settings.prepareDesc")}
            active={deliveryMode === "prepareOnly"}
          />
          <DeliveryModeCard
            icon={Mail}
            title={t("delivery.gmailDrafts")}
            description={t("settings.draftsDesc")}
            active={deliveryMode === "gmailDrafts"}
          />
          <DeliveryModeCard
            icon={Send}
            title={t("delivery.sendAutomatically")}
            description={t("settings.sendDesc")}
            active={deliveryMode === "sendAutomatically"}
            locked
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold text-slate-500">
            {t("settings.currentMode", { mode: deliveryModeLabel(deliveryMode, t) })}
          </p>
          <button
            className="inline-flex min-h-10 items-center rounded-md border border-white/70 bg-white/70 px-4 text-sm font-semibold text-slate-800 transition hover:bg-white"
            onClick={() => onNavigate("setup")}
          >
            {t("settings.changeInSetup")}
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-semibold text-slate-950">{t("settings.safetyTitle")}</h2>
            <InfoHint text={t("settings.safetyHint")} />
          </div>
          <div className="mt-4 space-y-2">
            <SafetyLine
              label={t("settings.safeModeLabel")}
              detail={t("settings.safeModeDetail")}
              value={config?.safety.dryRunDefault}
            />
            <SafetyLine
              label={t("settings.confirmMovesLabel")}
              detail={t("settings.confirmMovesDetail")}
              value={config?.safety.requireConfirmationForFileMoves}
            />
            <SafetyLine
              label={t("settings.redactLogsLabel")}
              detail={t("settings.redactLogsDetail")}
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
                <h2 className="text-xl font-semibold text-slate-950">{t("settings.localDataTitle")}</h2>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                  {t("settings.localDataText")}
                </p>
              </div>
            </div>
            <p className="mt-4 break-words rounded-md bg-white/60 px-3 py-2 font-mono text-xs leading-5 text-slate-600">
              {configStatus?.configPath ?? t("settings.locationUnavailable")}
            </p>
          </section>

          <section className="rounded-xl border border-dashed border-brand-200 bg-white/40 p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/70 text-brand-300 ring-1 ring-brand-100">
                <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">{t("settings.multiPcTitle")}</h2>
                  <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-800 ring-1 ring-brand-200">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    {t("common.comingSoon")}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                  {t("settings.multiPcText")}
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
  const { t } = useI18n();
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
          {t("common.active")}
        </span>
      )}
      {locked && !active && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-800 ring-1 ring-brand-200">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {t("common.future")}
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
  const { t } = useI18n();
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
        {typeof value === "boolean"
          ? value
            ? t("common.on")
            : t("common.off")
          : t("common.unknown")}
      </span>
    </div>
  );
}

