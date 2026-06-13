import {
  ClipboardList,
  FileSignature,
  FileText,
  Lightbulb,
  ListChecks,
  Mail,
  MessageCircleQuestion,
  Repeat,
  ScanText,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { TINT_TILE, type CardTint } from "../components/tints";
import { useI18n, type TranslationKey } from "../i18n";

type FrequentRequest = {
  icon: typeof Mail;
  tint: CardTint;
  titleKey: TranslationKey;
  promptKey: TranslationKey;
  planStepKeys: TranslationKey[];
};

const FREQUENT_REQUESTS: FrequentRequest[] = [
  {
    icon: FileText,
    tint: "sky",
    titleKey: "assistant.requestInvoices",
    promptKey: "assistant.promptInvoices",
    planStepKeys: [
      "assistant.invoiceStep1",
      "assistant.invoiceStep2",
      "assistant.invoiceStep3",
      "assistant.invoiceStep4",
    ],
  },
  {
    icon: FileSignature,
    tint: "violet",
    titleKey: "assistant.requestContracts",
    promptKey: "assistant.promptContracts",
    planStepKeys: [
      "assistant.contractStep1",
      "assistant.contractStep2",
      "assistant.contractStep3",
      "assistant.contractStep4",
    ],
  },
  {
    icon: ScanText,
    tint: "amber",
    titleKey: "assistant.requestScans",
    promptKey: "assistant.promptScans",
    planStepKeys: [
      "assistant.scansStep1",
      "assistant.scansStep2",
      "assistant.scansStep3",
      "assistant.scansStep4",
    ],
  },
  {
    icon: Mail,
    tint: "rose",
    titleKey: "assistant.requestGuestEmails",
    promptKey: "assistant.promptGuestEmails",
    planStepKeys: [
      "assistant.guestStep1",
      "assistant.guestStep2",
      "assistant.guestStep3",
      "assistant.guestStep4",
    ],
  },
  {
    icon: ClipboardList,
    tint: "emerald",
    titleKey: "assistant.requestSummary",
    promptKey: "assistant.promptSummary",
    planStepKeys: [
      "assistant.summaryStep1",
      "assistant.summaryStep2",
      "assistant.summaryStep3",
      "assistant.summaryStep4",
    ],
  },
  {
    icon: Repeat,
    tint: "brand",
    titleKey: "assistant.requestIdeas",
    promptKey: "assistant.promptIdeas",
    planStepKeys: [
      "assistant.ideasStep1",
      "assistant.ideasStep2",
      "assistant.ideasStep3",
      "assistant.ideasStep4",
    ],
  },
];

const SUGGESTED_QUESTION_KEYS: TranslationKey[] = [
  "assistant.question1",
  "assistant.question2",
  "assistant.question3",
  "assistant.question4",
];

const HOW_STEP_KEYS: TranslationKey[] = [
  "assistant.howStep1",
  "assistant.howStep2",
  "assistant.howStep3",
  "assistant.howStep4",
];

const GENERIC_PLAN_STEP_KEYS: TranslationKey[] = [
  "assistant.genericStep1",
  "assistant.genericStep2",
  "assistant.genericStep3",
  "assistant.genericStep4",
];

export function AssistantPage() {
  const { t } = useI18n();
  const [request, setRequest] = useState("");
  const [selected, setSelected] = useState<FrequentRequest | null>(null);
  const [customPreview, setCustomPreview] = useState<string | null>(null);

  function choose(card: FrequentRequest) {
    setSelected(card);
    setCustomPreview(null);
    setRequest(t(card.promptKey));
  }

  function previewCustom() {
    if (!request.trim()) return;
    setSelected(null);
    setCustomPreview(request.trim());
  }

  const showingPlan = selected || customPreview;

  return (
    <div className="space-y-5">
      <PageHeader title={t("assistant.title")} eyebrow={t("assistant.eyebrow")} />

      <section className="overflow-hidden rounded-xl border border-brand-100 bg-white/55 shadow-glass backdrop-blur-xl">
        <div className="bg-[linear-gradient(120deg,rgb(var(--brand-50))_0%,transparent_60%)] p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div
              aria-hidden="true"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-800 text-white shadow-sm"
            >
              <Wand2 className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                  {t("assistant.heroTitle")}
                </h2>
                <span className="inline-flex rounded-full bg-brand-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                  {t("assistant.badge")}
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                {t("assistant.heroText")}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">
                {t("assistant.question")}
              </span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="w-full rounded-md border border-white/70 bg-white/85 px-4 py-3 text-sm font-medium text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200"
                  value={request}
                  onChange={(event) => setRequest(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") previewCustom();
                  }}
                  placeholder={t("assistant.placeholder")}
                />
                <button
                  className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!request.trim()}
                  onClick={previewCustom}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {t("assistant.previewPlan")}
                </button>
              </div>
            </label>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              {t("assistant.previewOnly")}
            </p>
          </div>
        </div>
      </section>

      {showingPlan && (
        <section className="animate-rise rounded-xl border border-brand-100 bg-brand-50/70 p-5 shadow-glass">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/80 text-brand-800 ring-1 ring-brand-100">
              <ListChecks className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-brand-800">
                {t("assistant.planPreview")}
              </p>
              <h3 className="mt-0.5 text-lg font-semibold text-slate-950">
                {selected ? t(selected.titleKey) : `"${customPreview}"`}
              </h3>
            </div>
          </div>
          <ol className="mt-4 space-y-2">
            {(selected?.planStepKeys ?? GENERIC_PLAN_STEP_KEYS).map((stepKey, index) => (
              <li
                key={stepKey}
                className="flex items-start gap-3 rounded-md bg-white/70 px-3 py-2.5 text-sm font-medium leading-6 text-slate-800"
              >
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-800 text-[11px] font-bold text-white">
                  {index + 1}
                </span>
                {t(stepKey)}
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-md bg-ink/40 px-5 text-sm font-semibold text-white"
              disabled
              title={t("assistant.futureNote")}
            >
              <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
              {t("assistant.startInterview")}
            </button>
            <span className="text-xs font-semibold text-slate-500">
              {t("assistant.futureNote")}
            </span>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          {t("assistant.frequent")}
        </h3>
        <div className="stagger-children grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {FREQUENT_REQUESTS.map((card) => {
            const Icon = card.icon;
            const active = selected?.titleKey === card.titleKey;
            return (
              <button
                key={card.titleKey}
                className={[
                  "card-lift rounded-xl border p-4 text-left shadow-glass backdrop-blur-xl",
                  active
                    ? "border-brand-300 bg-brand-50/80 ring-2 ring-brand-200"
                    : "border-white/65 bg-white/55 hover:bg-white/75",
                ].join(" ")}
                onClick={() => choose(card)}
              >
                <div
                  aria-hidden="true"
                  className={`grid h-10 w-10 place-items-center rounded-lg ring-1 ${TINT_TILE[card.tint]}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-950">{t(card.titleKey)}</p>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
                  "{t(card.promptKey)}"
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 ring-1 ring-amber-200">
              <Lightbulb className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-950">
                {t("assistant.questionsTitle")}
              </h3>
              <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                {t("assistant.questionsText")}
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {SUGGESTED_QUESTION_KEYS.map((questionKey) => (
              <li
                key={questionKey}
                className="rounded-md bg-white/60 px-3 py-2.5 text-sm font-medium leading-6 text-slate-700"
              >
                "{t(questionKey)}"
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-white/65 bg-white/55 p-5 shadow-glass backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700 ring-1 ring-sky-200">
              <Send className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-950">{t("assistant.howTitle")}</h3>
              <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                {t("assistant.howText")}
              </p>
            </div>
          </div>
          <ol className="mt-4 space-y-2">
            {HOW_STEP_KEYS.map((stepKey, index) => (
              <li
                key={stepKey}
                className="flex items-start gap-3 rounded-md bg-white/60 px-3 py-2.5 text-sm font-medium leading-6 text-slate-700"
              >
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-900">
                  {index + 1}
                </span>
                {t(stepKey)}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
