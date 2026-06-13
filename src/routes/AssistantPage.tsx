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

/*
  AI Assistant: a future core capability, presented today as a beautiful local
  prototype. Picking a request or typing one renders an example plan preview —
  generated entirely in the app. Nothing runs, nothing is sent anywhere.
*/

type FrequentRequest = {
  icon: typeof Mail;
  tint: CardTint;
  title: string;
  prompt: string;
  planSteps: string[];
};

const FREQUENT_REQUESTS: FrequentRequest[] = [
  {
    icon: FileText,
    tint: "sky",
    title: "Process invoices automatically",
    prompt: "Process our partner invoices automatically",
    planSteps: [
      "Watch the invoice input folder for new PDFs",
      "Read each invoice and find the recipient",
      "Prepare files per partner, ready to send",
      "Summarize the run in Activity",
    ],
  },
  {
    icon: FileSignature,
    tint: "violet",
    title: "Handle signed contracts",
    prompt: "File signed staff contracts in the right folders",
    planSteps: [
      "Detect contract scans from the office scanner",
      "Read the document and confirm it is a signed contract",
      "File it under the right year and category",
      "Report anything that needs a human decision",
    ],
  },
  {
    icon: ScanText,
    tint: "amber",
    title: "Organize scanned documents",
    prompt: "Keep our scans folder tidy automatically",
    planSteps: [
      "Copy new scans to a safe local folder",
      "Read each scan into searchable text",
      "Group documents by type",
      "Flag unreadable pages for review",
    ],
  },
  {
    icon: Mail,
    tint: "rose",
    title: "Prepare guest emails",
    prompt: "Draft routine guest emails for review",
    planSteps: [
      "Use your saved templates and hotel voice",
      "Prepare drafts for staff review — never send",
      "Attach the right documents automatically",
      "Keep a record of every prepared draft",
    ],
  },
  {
    icon: ClipboardList,
    tint: "emerald",
    title: "Summarize daily back-office work",
    prompt: "Give me a daily summary of back-office work",
    planSteps: [
      "Collect results from every automation run",
      "Write a short morning summary",
      "Highlight anything needing attention",
      "Keep summaries on this computer",
    ],
  },
  {
    icon: Repeat,
    tint: "brand",
    title: "Find repeated manual tasks",
    prompt: "Help us find tasks worth automating",
    planSteps: [
      "Interview the team about weekly routines",
      "Spot repetitive, rule-based steps",
      "Estimate time saved per task",
      "Propose automations, one at a time",
    ],
  },
];

const SUGGESTED_QUESTIONS = [
  "What takes your team the most time each week?",
  "Which documents do you copy or rename by hand?",
  "What do you double-check every single day?",
  "Which emails do you write again and again?",
];

export function AssistantPage() {
  const [request, setRequest] = useState("");
  const [selected, setSelected] = useState<FrequentRequest | null>(null);
  const [customPreview, setCustomPreview] = useState<string | null>(null);

  function choose(card: FrequentRequest) {
    setSelected(card);
    setCustomPreview(null);
    setRequest(card.prompt);
  }

  function previewCustom() {
    if (!request.trim()) return;
    setSelected(null);
    setCustomPreview(request.trim());
  }

  const showingPlan = selected || customPreview;

  return (
    <div className="space-y-5">
      <PageHeader title="AI Assistant" eyebrow="Design new automations together" />

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
                  Your future automation concierge
                </h2>
                <span className="inline-flex rounded-full bg-brand-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                  Prototype · Coming soon
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                The InnPilot Assistant will interview your team, find repetitive work, estimate
                the time it can give back, and turn approved ideas into new automations — with
                the same safety rules as everything else here.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">
                What would you like to automate?
              </span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="w-full rounded-md border border-white/70 bg-white/85 px-4 py-3 text-sm font-medium text-slate-900 outline-none ring-1 ring-transparent transition placeholder:text-slate-400 focus:border-brand-200 focus:ring-brand-200"
                  value={request}
                  onChange={(event) => setRequest(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") previewCustom();
                  }}
                  placeholder="e.g. Every Friday we copy supplier invoices into three folders..."
                />
                <button
                  className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!request.trim()}
                  onClick={previewCustom}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Preview a plan
                </button>
              </div>
            </label>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Example preview only — nothing runs, nothing leaves this computer.
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
                Example plan preview
              </p>
              <h3 className="mt-0.5 text-lg font-semibold text-slate-950">
                {selected ? selected.title : `"${customPreview}"`}
              </h3>
            </div>
          </div>
          <ol className="mt-4 space-y-2">
            {(selected?.planSteps ?? GENERIC_PLAN_STEPS).map((step, index) => (
              <li
                key={step}
                className="flex items-start gap-3 rounded-md bg-white/70 px-3 py-2.5 text-sm font-medium leading-6 text-slate-800"
              >
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-800 text-[11px] font-bold text-white">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-md bg-ink/40 px-5 text-sm font-semibold text-white"
              disabled
              title="The AI interview is part of a future InnPilot release."
            >
              <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
              Start AI interview
            </button>
            <span className="text-xs font-semibold text-slate-500">
              Available in a future release. Approved plans will appear in Automations.
            </span>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          Frequent requests from hotels
        </h3>
        <div className="stagger-children grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {FREQUENT_REQUESTS.map((card) => {
            const Icon = card.icon;
            const active = selected?.title === card.title;
            return (
              <button
                key={card.title}
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
                <p className="mt-3 text-sm font-semibold text-slate-950">{card.title}</p>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
                  "{card.prompt}"
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
                Questions the Assistant will ask
              </h3>
              <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                Discovery starts with your routines, not with technology.
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-2">
            {SUGGESTED_QUESTIONS.map((question) => (
              <li
                key={question}
                className="rounded-md bg-white/60 px-3 py-2.5 text-sm font-medium leading-6 text-slate-700"
              >
                "{question}"
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
              <h3 className="text-lg font-semibold text-slate-950">How it will work</h3>
              <p className="mt-1 text-sm font-medium leading-6 text-slate-600">
                From conversation to running automation, always with you in control.
              </p>
            </div>
          </div>
          <ol className="mt-4 space-y-2">
            {[
              "Tell the Assistant about a repetitive task",
              "Answer a few short questions about how it works today",
              "Review a clear plan with estimated time saved",
              "Approve it — the automation appears in your gallery, safe mode first",
            ].map((step, index) => (
              <li
                key={step}
                className="flex items-start gap-3 rounded-md bg-white/60 px-3 py-2.5 text-sm font-medium leading-6 text-slate-700"
              >
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-900">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

const GENERIC_PLAN_STEPS = [
  "Understand the task with a short interview",
  "Map the folders, documents, and rules involved",
  "Draft a step-by-step automation plan for your approval",
  "Rehearse in safe mode before anything real changes",
];
