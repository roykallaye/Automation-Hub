import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Image, Palette, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  applyBrandingToDocument,
  BRAND_PALETTES,
  DEFAULT_BRANDING,
  MAX_WATERMARK_OPACITY_PERCENT,
  tripletToCss,
} from "../branding";
import { useI18n } from "../i18n";
import { InfoHint } from "./InfoHint";
import type { AppConfigStatus, ClientBranding } from "../types";

/**
 * Hotel identity editor: name, palette, logo, and watermark.
 * Changes preview instantly and persist only when saved.
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

  // Leaving the page without saving must not keep an unsaved preview applied.
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

  function resetToDefault() {
    setDraft(DEFAULT_BRANDING);
    applyBrandingToDocument(DEFAULT_BRANDING);
    setResult(null);
  }

  const isDirty =
    displayName !== savedName || JSON.stringify(draft) !== JSON.stringify(savedBranding);

  return (
    <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 ring-1 ring-amber-200">
          <Palette className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold text-slate-950">{t("branding.title")}</h2>
        <InfoHint text={t("branding.hint")} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-800">{t("branding.hotelName")}</span>
          <input
            className="w-full rounded-md border border-white/70 bg-white/80 px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setResult(null);
            }}
            placeholder={t("branding.hotelPlaceholder")}
          />
        </label>

        <div>
          <span className="mb-2 block text-sm font-semibold text-slate-800">{t("branding.hotelLogo")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/70 bg-white/80 px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
              type="button"
              onClick={() => void chooseLogo()}
            >
              <Image className="h-4 w-4 text-brand-700" aria-hidden="true" />
              {draft.logoPath ? t("branding.changeLogo") : t("branding.chooseLogo")}
            </button>
            {draft.logoPath && (
              <button
                className="inline-flex min-h-11 items-center gap-1 rounded-md border border-white/70 bg-white/65 px-3 text-xs font-semibold text-slate-700 hover:bg-white"
                type="button"
                onClick={() => update({ logoPath: "" })}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                {t("branding.remove")}
              </button>
            )}
          </div>
          <p className="mt-2 truncate text-xs font-medium text-slate-500" title={draft.logoPath}>
            {draft.logoPath || t("branding.noLogo")}
          </p>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-semibold text-slate-800">{t("branding.palette")}</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {BRAND_PALETTES.map((palette) => {
            const selected = draft.palette === palette.id;
            return (
              <button
                key={palette.id}
                type="button"
                aria-pressed={selected}
                className={[
                  "rounded-lg border p-3 text-left transition",
                  selected
                    ? "border-brand-300 bg-brand-50 ring-2 ring-brand-200"
                    : "border-white/70 bg-white/65 hover:bg-white",
                ].join(" ")}
                onClick={() => update({ palette: palette.id })}
              >
                <span className="flex items-center gap-1.5" aria-hidden="true">
                  {[palette.brand[700], palette.brand[300], palette.brand[100]].map(
                    (triplet, index) => (
                      <span
                        key={index}
                        className="h-4 w-4 rounded-full ring-1 ring-slate-900/10"
                        style={{ backgroundColor: tripletToCss(triplet) }}
                      />
                    ),
                  )}
                  <span
                    className="h-4 w-4 rounded-full ring-1 ring-slate-900/10"
                    style={{ backgroundColor: tripletToCss(palette.ink) }}
                  />
                </span>
                <span className="mt-2 block text-sm font-semibold text-slate-900">
                  {palette.name}
                </span>
                <span className="mt-0.5 block text-xs font-medium text-slate-600">
                  {palette.tagline}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/65 bg-white/65 p-4">
          <span>
            <span className="block text-sm font-semibold text-slate-950">{t("branding.watermark")}</span>
            <span className="mt-1 block text-sm font-medium leading-5 text-slate-600">
              {t("branding.watermarkHint")}
            </span>
          </span>
          <input
            className="h-5 w-5 accent-brand-700"
            type="checkbox"
            checked={draft.watermarkEnabled}
            onChange={(event) => update({ watermarkEnabled: event.target.checked })}
          />
        </label>
        <label className="block rounded-lg border border-white/65 bg-white/65 p-4">
          <span className="flex items-center justify-between text-sm font-semibold text-slate-950">
            {t("branding.watermarkStrength")}
            <span className="text-xs font-bold text-slate-600">{draft.watermarkOpacity}%</span>
          </span>
          <input
            className="mt-3 w-full accent-brand-700"
            type="range"
            min={0}
            max={MAX_WATERMARK_OPACITY_PERCENT}
            value={draft.watermarkOpacity}
            disabled={!draft.watermarkEnabled}
            aria-label={t("branding.watermarkStrength")}
            onChange={(event) => update({ watermarkOpacity: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
          disabled={saving || !isDirty}
          onClick={() => void save()}
        >
          {saving ? t("common.saving") : t("branding.save")}
        </button>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/70 bg-white/65 px-4 text-sm font-semibold text-slate-700 transition hover:bg-white"
          type="button"
          onClick={resetToDefault}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t("branding.reset")}
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
