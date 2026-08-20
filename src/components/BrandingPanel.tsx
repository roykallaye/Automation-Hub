import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Image, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { applyBrandingToDocument, DEFAULT_BRANDING } from "../branding";
import { useI18n } from "../i18n";
import { Button, Card, Note } from "./ui";
import type { AppConfigStatus, ClientBranding } from "../types";

/**
 * Hotel identity: the name and the logo.
 *
 * The stored branding record still carries palette, colour and watermark
 * fields, and they are round-tripped untouched so existing installations keep
 * their persisted values. They are no longer offered as choices: the palette
 * selector never had any visual effect (applyBrandingToDocument resolves the
 * default palette regardless of the stored id), so presenting twelve themes
 * was offering a decision that did nothing.
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
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    setDisplayName(savedName);
    setDraft(savedBranding);
    // Refresh the local form when the saved config changes elsewhere.
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
    <Card pad>
      <div style={{ display: "grid", gap: 18 }}>
        <label className="ip-field">
          <span className="ip-field__label">{t("settings.hotelName")}</span>
          <input
            className="ip-input"
            onChange={(event) => {
              setDisplayName(event.target.value);
              setResult(null);
            }}
            placeholder={t("branding.hotelPlaceholder")}
            value={displayName}
          />
          <span className="ip-field__hint">{t("settings.hotelNameHint")}</span>
        </label>

        <div className="ip-field">
          <span className="ip-field__label">{t("settings.logo")}</span>
          <div className="ip-actions">
            <Button icon={Image} onClick={() => void chooseLogo()} variant="secondary">
              {draft.logoPath ? t("branding.changeLogo") : t("branding.chooseLogo")}
            </Button>
            {draft.logoPath ? (
              <Button icon={X} onClick={() => update({ logoPath: "" })} variant="ghost">
                {t("branding.remove")}
              </Button>
            ) : null}
          </div>
          {draft.logoPath ? (
            <span className="ip-field__hint" title={draft.logoPath}>
              {logoFileName(draft.logoPath)}
            </span>
          ) : null}
        </div>

        <div className="ip-actions">
          <Button
            busy={saving}
            disabled={!isDirty}
            onClick={() => void save()}
            variant="primary"
          >
            {t("settings.save")}
          </Button>
        </div>

        {result ? (
          <Note tone={result.kind === "success" ? "ready" : "problem"}>{result.message}</Note>
        ) : null}
      </div>
    </Card>
  );
}

function logoFileName(path: string) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
