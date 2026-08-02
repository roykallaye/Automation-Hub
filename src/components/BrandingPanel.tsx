import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Building2, Image, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { applyBrandingToDocument, DEFAULT_BRANDING } from "../branding";
import { useI18n } from "../i18n";
import { InfoHint } from "./InfoHint";
import type { AppConfigStatus, ClientBranding } from "../types";

/**
 * Everyday hotel identity editor. Advanced visual theme values remain
 * preserved in the configuration without cluttering the main settings UI.
 */
export function BrandingPanel({
  configStatus,
  onSaved,
}: {
  configStatus: AppConfigStatus | null;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const savedBranding = configStatus?.config.client.branding ?? DEFAULT_BRANDING;
  const savedName = configStatus?.config.client.displayName ?? "";
  const [displayName, setDisplayName] = useState(savedName);
  const [draft, setDraft] = useState<ClientBranding>(savedBranding);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );

  useEffect(() => {
    setDisplayName(savedName);
    setDraft(savedBranding);
    // Refresh local form when saved config changes elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configStatus]);

  const savedBrandingRef = useRef(savedBranding);
  savedBrandingRef.current = savedBranding;
  useEffect(() => {
    return () => applyBrandingToDocument(savedBrandingRef.current);
  }, []);

  function update(patch: Partial<ClientBranding>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      applyBrandingToDocument(next);
      return next;
    });
    setResult(null);
  }

  async function chooseLogo() {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) update({ logoPath: path });
  }

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      await invoke<AppConfigStatus>("save_client_branding", {
        draft: { displayName, ...draft },
      });
      setResult({ kind: "success", message: t("branding.saved") });
      await onSaved();
    } catch (error) {
      setResult({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      applyBrandingToDocument(savedBranding);
    } finally {
      setSaving(false);
    }
  }

  const isDirty =
    displayName !== savedName || JSON.stringify(draft) !== JSON.stringify(savedBranding);

  return (
    <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200">
          <Building2 className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-slate-950">{t("branding.title")}</h2>
        <InfoHint text={t("branding.hint")} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-800">
            {t("branding.hotelName")}
          </span>
          <input
            className="w-full rounded-lg border border-white/70 bg-white/80 px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setResult(null);
            }}
            placeholder={t("branding.hotelPlaceholder")}
          />
        </label>

        <div>
          <span className="mb-2 block text-sm font-semibold text-slate-800">
            {t("branding.hotelLogo")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/70 bg-white/80 px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
              type="button"
              onClick={() => void chooseLogo()}
            >
              <Image className="h-4 w-4 text-brand-700" aria-hidden="true" />
              {draft.logoPath ? t("branding.changeLogo") : t("branding.chooseLogo")}
            </button>
            {draft.logoPath && (
              <button
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-white/70 bg-white/65 px-3 text-xs font-semibold text-slate-700 hover:bg-white"
                type="button"
                onClick={() => update({ logoPath: "" })}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                {t("branding.remove")}
              </button>
            )}
          </div>
          {draft.logoPath && (
            <p className="mt-2 truncate text-xs font-semibold text-zinc-500" title={draft.logoPath}>
              {logoFileName(draft.logoPath)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-cta px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-cta-soft disabled:cursor-not-allowed disabled:opacity-50"
          disabled={saving || !isDirty}
          onClick={() => void save()}
        >
          {saving ? t("common.saving") : t("branding.save")}
        </button>
        {result && (
          <p
            role="status"
            className={[
              "text-sm font-semibold",
              result.kind === "success" ? "text-emerald-800" : "text-rose-800",
            ].join(" ")}
          >
            {result.message}
          </p>
        )}
      </div>
    </section>
  );
}

function logoFileName(path: string) {
  const parts = path.split(/[/\\\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
