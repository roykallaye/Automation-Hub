import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import {
  Building2,
  Cable,
  Laptop,
  Mail,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";

import { BrandingPanel } from "../components/BrandingPanel";
import { DesktopServicePanel } from "../components/DesktopServicePanel";
import { LifeDeskConnectionPanel } from "../components/LifeDeskConnectionPanel";
import { PageHeader } from "../components/PageHeader";
import { TemplateEditor } from "../components/TemplateEditor";
import { useI18n, type Language } from "../i18n";
import { deliveryModeLabel } from "../messages";
import type { AppConfigStatus, AppPage } from "../types";

type SettingsSection = "general" | "connection" | "email" | "safety";

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
  const [section, setSection] = useState<SettingsSection>("general");
  const [languageNotice, setLanguageNotice] = useState<string | null>(null);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const config = configStatus?.config;

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

  const sections = [
    { id: "general", label: t("settings.generalTab"), icon: Building2 },
    { id: "connection", label: t("settings.connectionTab"), icon: Cable },
    { id: "email", label: t("settings.emailTab"), icon: Mail },
    { id: "safety", label: t("settings.safetyTab"), icon: ShieldCheck },
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.title")} />

      <nav
        aria-label={t("settings.title")}
        className="grid gap-1 rounded-xl border border-white/70 bg-white/55 p-1.5 shadow-glass backdrop-blur-xl sm:grid-cols-4"
      >
        {sections.map(({ id, label, icon: Icon }) => {
          const active = section === id;
          return (
            <button
              key={id}
              aria-current={active ? "page" : undefined}
              className={[
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition",
                active
                  ? "bg-ink text-white shadow-sm"
                  : "text-slate-600 hover:bg-white/75 hover:text-slate-950",
              ].join(" ")}
              onClick={() => setSection(id)}
              type="button"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </nav>

      {section === "general" && (
        <div className="space-y-5">
          <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700 ring-1 ring-brand-200">
                  <MonitorSmartphone className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {t("settings.languageTitle")}
                </h2>
              </div>
              <div className="inline-grid rounded-lg border border-white/70 bg-white/55 p-1 sm:grid-cols-2">
                {([
                  ["en", t("settings.english")],
                  ["it", t("settings.italian")],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={[
                      "min-h-10 rounded-md px-5 text-sm font-semibold transition",
                      language === value
                        ? "bg-ink text-white shadow-sm"
                        : "text-slate-700 hover:bg-white/80",
                    ].join(" ")}
                    disabled={savingLanguage}
                    onClick={() => saveLanguage(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {languageNotice && (
              <p className="mt-3 text-sm font-semibold text-brand-800">{languageNotice}</p>
            )}
          </section>

          <BrandingPanel configStatus={configStatus} onSaved={onRefresh} />
        </div>
      )}

      {section === "connection" && (
        <div className="space-y-5">
          <LifeDeskConnectionPanel />
          <DesktopServicePanel />
        </div>
      )}

      {section === "email" && (
        <div className="space-y-5">
          <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg tint-sky-tile ring-1">
                  <Mail className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    {t("settings.invoiceDeliveryTitle")}
                  </h2>
                  <p className="mt-0.5 text-sm font-medium text-slate-600">
                    {deliveryModeLabel(config?.invoiceDeliveryMode, t)}
                  </p>
                </div>
              </div>
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-white/70 bg-white/70 px-4 text-sm font-semibold text-slate-800 transition hover:bg-white"
                onClick={() => onNavigate("setup")}
                type="button"
              >
                {t("settings.changeInSetup")}
              </button>
            </div>
          </section>

          <TemplateEditor configStatus={configStatus} onSaved={onRefresh} />
        </div>
      )}

      {section === "safety" && (
        <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg tint-emerald-tile ring-1">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-semibold text-slate-950">
                {t("settings.safetyTitle")}
              </h2>
            </div>
            <div className="mt-4 space-y-2">
              <SafetyLine label={t("settings.safeModeLabel")} value={config?.safety.dryRunDefault} />
              <SafetyLine
                label={t("settings.confirmMovesLabel")}
                value={config?.safety.requireConfirmationForFileMoves}
              />
              <SafetyLine label={t("settings.redactLogsLabel")} value={config?.safety.redactLogs} />
            </div>
            <button
              className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-white/70 bg-white/70 px-4 text-sm font-semibold text-slate-800 transition hover:bg-white"
              onClick={() => onNavigate("setup")}
              type="button"
            >
              {t("settings.changeInSetup")}
            </button>
          </section>

          <section className="h-fit rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg tint-violet-tile ring-1">
                <Laptop className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {t("settings.localDataTitle")}
                </h2>
                <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                  {t("settings.localDataText")}
                </p>
              </div>
            </div>
            <details className="mt-4 rounded-lg bg-white/60 px-3 py-2.5">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                {t("settings.storageLocation")}
              </summary>
              <p className="mt-2 break-words font-mono text-xs leading-5 text-slate-600">
                {configStatus?.configPath ?? t("settings.locationUnavailable")}
              </p>
            </details>
          </section>
        </div>
      )}
    </div>
  );
}

function SafetyLine({ label, value }: { label: string; value?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/60 px-3 py-3">
      <p className="text-sm font-semibold text-slate-900">{label}</p>
      <span
        className={[
          "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ring-1",
          value
            ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
            : "bg-slate-50 text-slate-700 ring-slate-200",
        ].join(" ")}
      >
        {typeof value === "boolean" ? (value ? t("common.on") : t("common.off")) : t("common.unknown")}
      </span>
    </div>
  );
}