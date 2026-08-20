import { invoke } from "@tauri-apps/api/core";
import { Eye, MailOpen, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { InfoHint } from "./InfoHint";
import { Button, Card, Note } from "./ui";
import { useI18n } from "../i18n";
import {
  BODY_VARIABLES,
  DEFAULT_TEMPLATES,
  renderTemplatePreview,
  sampleContext,
  SUBJECT_VARIABLES,
  type TemplateVariable,
} from "../templates";
import type { AppConfigStatus, OutputTemplates } from "../types";

/*
  TemplateEditor: customize what InnPilot writes for the hotel.

  Everything is saved locally. Editing or saving a template never runs a
  workflow, never contacts Gmail, and never sends an email — the preview is
  rendered entirely in the app with sample values.
*/
export function TemplateEditor({
  configStatus,
  onSaved,
}: {
  configStatus: AppConfigStatus | null;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const saved = configStatus?.config.templates ?? DEFAULT_TEMPLATES;
  const hotelName = configStatus?.config.client.displayName ?? t("branding.hotelPlaceholder");
  const [draft, setDraft] = useState<OutputTemplates>(saved);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(
    null,
  );
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(saved);
    // Refresh the form when the saved config changes elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configStatus]);

  function update(patch: Partial<OutputTemplates>) {
    setDraft((current) => ({ ...current, ...patch }));
    setResult(null);
  }

  function insertVariable(
    field: "gmailDraftSubject" | "gmailDraftBody",
    token: string,
  ) {
    const element = field === "gmailDraftBody" ? bodyRef.current : subjectRef.current;
    const value = draft[field];
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    update({ [field]: next } as Partial<OutputTemplates>);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      await invoke<AppConfigStatus>("save_output_templates", { draft });
      setResult({ kind: "success", message: t("templates.saved") });
      await onSaved();
    } catch (error) {
      setResult({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  const context = sampleContext(hotelName, draft.emailSignature);
  const previewSubject = renderTemplatePreview(draft.gmailDraftSubject, context);
  const previewBody = renderTemplatePreview(draft.gmailDraftBody, context);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <Card pad>
      <div style={{ alignItems: "center", display: "flex", gap: 9, marginBottom: 16 }}>
        <MailOpen aria-hidden="true" size={17} style={{ color: "var(--ip-muted)" }} />
        <h2 style={{ fontSize: "0.95rem", fontWeight: 650, margin: 0 }}>{t("templates.title")}</h2>
        <InfoHint text={t("templates.hint")} />
      </div>

      <div className="ip-template-grid">
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label className="ip-field">
              <span className="ip-field__label">{t("templates.subject")}</span>
              <input
                className="ip-input"
                onChange={(event) => update({ gmailDraftSubject: event.target.value })}
                placeholder={DEFAULT_TEMPLATES.gmailDraftSubject}
                ref={subjectRef}
                value={draft.gmailDraftSubject}
              />
            </label>
            <VariableChips
              onInsert={(token) => insertVariable("gmailDraftSubject", token)}
              variables={SUBJECT_VARIABLES}
            />
          </div>

          <div>
            <label className="ip-field">
              <span className="ip-field__label">{t("templates.body")}</span>
              <textarea
                className="ip-textarea"
                onChange={(event) => update({ gmailDraftBody: event.target.value })}
                ref={bodyRef}
                rows={9}
                value={draft.gmailDraftBody}
              />
            </label>
            <VariableChips
              onInsert={(token) => insertVariable("gmailDraftBody", token)}
              variables={BODY_VARIABLES}
            />
          </div>

          <label className="ip-field">
            <span className="ip-field__label">
              {t("templates.signature")}{" "}
              <span style={{ color: "var(--ip-faint)", fontWeight: 500 }}>
                ({t("templates.optional")})
              </span>
            </span>
            <input
              className="ip-input"
              onChange={(event) => update({ emailSignature: event.target.value })}
              placeholder={t("templates.signaturePlaceholder", { hotelName })}
              value={draft.emailSignature}
            />
          </label>
        </div>

        <div className="ip-template-preview">
          <p className="ip-field__label" style={{ alignItems: "center", display: "flex", gap: 7 }}>
            <Eye aria-hidden="true" size={15} />
            {t("templates.preview")}
          </p>
          <div className="ip-template-preview__sheet">
            <p className="ip-template-preview__subject">
              {previewSubject || t("templates.emptySubject")}
            </p>
            <pre className="ip-template-preview__body">
              {previewBody || t("templates.emptyBody")}
            </pre>
          </div>
          <p className="ip-field__hint">{t("templates.previewOnly")}</p>
        </div>
      </div>

      <div className="ip-actions" style={{ marginTop: 18 }}>
        <Button busy={saving} disabled={!isDirty} onClick={() => void save()} variant="primary">
          {t("templates.save")}
        </Button>
        <Button
          icon={RotateCcw}
          onClick={() => {
            setDraft(DEFAULT_TEMPLATES);
            setResult(null);
          }}
          variant="secondary"
        >
          {t("templates.reset")}
        </Button>
      </div>

      {result ? (
        <div style={{ marginTop: 12 }}>
          <Note tone={result.kind === "success" ? "ready" : "problem"}>{result.message}</Note>
        </div>
      ) : null}
    </Card>
  );
}

function VariableChips({
  variables,
  onInsert,
}: {
  variables: TemplateVariable[];
  onInsert: (token: string) => void;
}) {
  return (
    <div className="ip-chips">
      {variables.map((variable) => (
        <button
          className="ip-chip"
          key={variable.token}
          onClick={() => onInsert(variable.token)}
          title={variable.description}
          type="button"
        >
          {variable.token}
        </button>
      ))}
    </div>
  );
}
