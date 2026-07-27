import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle, Power } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import type { DesktopServiceStatus } from "../types";

export function DesktopServicePanel() {
  const { t, language } = useI18n();
  const [status, setStatus] = useState<DesktopServiceStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setNotice(null);
    invoke<DesktopServiceStatus>("get_desktop_service_status")
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch(() => {
        if (active) setNotice(t("settings.desktopServiceLoadFailed"));
      });
    return () => {
      active = false;
    };
  }, [language]);

  async function toggleStartup() {
    if (!status || !status.changesAvailable || saving) return;
    const enabled = !status.launchAtSignIn;
    setSaving(true);
    setNotice(null);
    try {
      const nextStatus = await invoke<DesktopServiceStatus>(
        "set_desktop_service_enabled",
        { enabled, confirmed: true },
      );
      setStatus(nextStatus);
      setNotice(
        t(
          enabled
            ? "settings.desktopServiceEnabledNotice"
            : "settings.desktopServiceDisabledNotice",
        ),
      );
    } catch {
      setNotice(t("settings.desktopServiceSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-white/65 bg-white/60 shadow-glass backdrop-blur-xl">
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg tint-emerald-tile ring-1">
            <Power className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-950">
                {t("settings.desktopServiceTitle")}
              </h2>
              <span
                className={[
                  "rounded-full px-2.5 py-1 text-[11px] font-bold ring-1",
                  status?.launchAtSignIn
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                    : "bg-slate-50 text-slate-700 ring-slate-200",
                ].join(" ")}
              >
                {status
                  ? t(
                      status.launchAtSignIn
                        ? "settings.desktopServiceEnabled"
                        : "settings.desktopServiceDisabled",
                    )
                  : t("common.checking")}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-600">
              {t("settings.desktopServiceText")}
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              {t("settings.desktopServiceTrayDetail")}
            </p>
          </div>
        </div>

        <button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ink px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!status || !status.changesAvailable || saving}
          onClick={toggleStartup}
          type="button"
        >
          {saving ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Power className="h-4 w-4" aria-hidden="true" />
          )}
          {status?.changesAvailable === false
            ? t("settings.desktopServiceInstalledOnly")
            : t(
                status?.launchAtSignIn
                  ? "settings.desktopServiceDisable"
                  : "settings.desktopServiceEnable",
              )}
        </button>
      </div>

      {notice && (
        <p className="border-t border-white/70 bg-white/45 px-5 py-3 text-sm font-semibold text-brand-800">
          {notice}
        </p>
      )}
    </section>
  );
}
