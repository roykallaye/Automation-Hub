import { invoke } from "@tauri-apps/api/core";
import { Eye, MailOpen, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { InfoHint } from "./InfoHint";
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
  const saved = configStatus?.config.templates ?? DEFAULT_TEMPLATES;
  const hotelName = configStatus?.config.client.displayName ?? "Your Hotel";
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
      setResult({ kind: "success", message: "Templates saved. Nothing was sent." });
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
    <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-200">
          <MailOpen className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold text-slate-950">Email templates</h2>
        <InfoHint text="The wording InnPilot uses for prepared invoice emails and Gmail drafts. Saved on this computer — nothing is sent." />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">
                Draft subject
              </span>
              <input
                ref={subjectRef}
                className="w-full rounded-md border border-white/70 bg-white/80 px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200"
                value={draft.gmailDraftSubject}
                onChange={(event) => update({ gmailDraftSubject: event.target.value })}
                placeholder={DEFAULT_TEMPLATES.gmailDraftSubject}
              />
            </label>
            <VariableChips
              variables={SUBJECT_VARIABLES}
              onInsert={(token) => insertVariable("gmailDraftSubject", token)}
            />
          </div>

          <div>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">
                Email body
              </span>
              <textarea
                ref={bodyRef}
                rows={9}
                className="w-full resize-y rounded-md border border-white/70 bg-white/80 px-3 py-3 text-sm font-medium leading-6 text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200"
                value={draft.gmailDraftBody}
                onChange={(event) => update({ gmailDraftBody: event.target.value })}
              />
            </label>
            <VariableChips
              variables={BODY_VARIABLES}
              onInsert={(token) => insertVariable("gmailDraftBody", token)}
            />
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-800">
              Signature <span className="font-medium text-slate-500">(optional)</span>
            </span>
            <input
              className="w-full rounded-md border border-white/70 bg-white/80 px-3 py-3 text-sm font-semibold text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200"
              value={draft.emailSignature}
              onChange={(event) => update({ emailSignature: event.target.value })}
              placeholder={`${hotelName} (used when empty)`}
            />
          </label>
        </div>

        <div className="flex flex-col rounded-lg border border-white/70 bg-white/70 p-4">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Eye className="h-4 w-4 text-brand-700" aria-hidden="true" />
            Preview with sample values
          </p>
          <div className="mt-3 flex-1 rounded-md bg-white p-4 ring-1 ring-slate-900/5">
            <p className="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-950">
              {previewSubject || "(empty subject)"}
            </p>
            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm font-medium leading-6 text-slate-700">
              {previewBody || "(empty body)"}
            </pre>
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            Example only — created on this computer, never sent.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
          disabled={saving || !isDirty}
          onClick={() => void save()}
        >
          {saving ? "Saving..." : "Save templates"}
        </button>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/70 bg-white/65 px-4 text-sm font-semibold text-slate-700 transition hover:bg-white"
          type="button"
          onClick={() => {
            setDraft(DEFAULT_TEMPLATES);
            setResult(null);
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reset to default
        </button>
        {result && (
          <p
            role="status"
            className={[
              "animate-pop text-sm font-semibold",
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

function VariableChips({
  variables,
  onInsert,
}: {
  variables: TemplateVariable[];
  onInsert: (token: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {variables.map((variable) => (
        <button
          key={variable.token}
          type="button"
          className="rounded-full bg-brand-50 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-100"
          title={variable.description}
          onClick={() => onInsert(variable.token)}
        >
          {variable.token}
        </button>
      ))}
    </div>
  );
}
