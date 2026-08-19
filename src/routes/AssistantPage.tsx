import {
  ClipboardList,
  Check,
  Cable,
  Copy,
  FileSignature,
  FileText,
  Lightbulb,
  ListChecks,
  Mail,
  MessageCircleQuestion,
  Repeat,
  RefreshCw,
  FolderSearch,
  ShieldCheck,
  Eye,
  ScanText,
  Send,
  Sparkles,
  Wand2,
  Unplug,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { TINT_TILE, type CardTint } from "../components/tints";
import { useI18n, type TranslationKey } from "../i18n";
import { commandErrorMessage } from "../onboarding";
import type { DiscoveryRequest } from "../types";

type LocalAgentConnectionStatus = {
  state: "notConnected" | "connected" | "expired";
  profileId: string | null;
  scopes: string[];
  createdAt: string | null;
  expiresAt: string | null;
  lastActivityAt: string | null;
  lastTool: string | null;
  lastClientName: string | null;
  lastProtocolVersion: string | null;
  helperAvailable: boolean;
  codexAddCommand: string | null;
  codexConfigToml: string | null;
  connectionIsReadOnly: boolean;
};

type DiscoveryManagerView = {
  discovery: {
    scope: null | {
      scopeId: string;
      revision: number;
      state: "active" | "revoked" | "expired";
      createdAt: string;
      expiresAt: string;
      roots: Array<{ rootId: string; displayLabel: string; localPath: string }>;
    };
    lastSnapshot: null | {
      snapshotId: string;
      createdAt: string;
      expiresAt: string;
      digest: string;
      truncated: boolean;
    };
    privacySummary: string;
  };
  proposal: null | {
    proposalId: string;
    status: string;
    changedFields: string[];
    warnings: string[];
    unresolvedQuestions: string[];
    agentConfidence: number | null;
    proposalDigest: string;
    createdAt: string;
    invalidationReason: string | null;
    localPaths: Array<{ field: string; localPath: string; evidenceRef: string }>;
    reviewOnly: boolean;
    mutationPerformed: boolean;
  };
};

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

function LocalAgentConnectionPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<LocalAgentConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await invoke<LocalAgentConnectionStatus>("get_local_agent_connection"));
    } catch (problem) {
      setError(commandErrorMessage(problem, t("assistant.connectionUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createConnection() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await invoke<LocalAgentConnectionStatus>("create_local_agent_connection"));
    } catch (problem) {
      setError(commandErrorMessage(problem, t("assistant.connectionUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  async function revokeConnection() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await invoke<LocalAgentConnectionStatus>("revoke_local_agent_connection"));
    } catch (problem) {
      setError(commandErrorMessage(problem, t("assistant.connectionUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  async function copyCommand() {
    if (!status?.codexAddCommand) return;
    try {
      await navigator.clipboard.writeText(status.codexAddCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t("assistant.copyFailed"));
    }
  }

  const connected = status?.state === "connected";
  const date = (value: string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        )
      : t("assistant.neverUsed");

  return (
    <section className="rounded-xl border border-white/70 bg-white/70 p-5 shadow-glass backdrop-blur-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-950 text-white">
            <Cable className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-950">
                {t("assistant.localConnectionTitle")}
              </h2>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  connected
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {connected
                  ? t("assistant.connected")
                  : status?.state === "expired"
                    ? t("assistant.expired")
                    : t("assistant.notConnected")}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-600">
              {t("assistant.localConnectionText")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            {t("assistant.checkConnection")}
          </button>
          {connected ? (
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-800 transition hover:bg-rose-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => void revokeConnection()}
            >
              <Unplug className="h-4 w-4" aria-hidden="true" />
              {t("assistant.revokeConnection")}
            </button>
          ) : (
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-cta px-4 text-sm font-semibold text-white transition hover:bg-cta-soft disabled:opacity-50"
              disabled={busy}
              onClick={() => void createConnection()}
            >
              <Cable className="h-4 w-4" aria-hidden="true" />
              {t("assistant.createConnection")}
            </button>
          )}
        </div>
      </div>

      {connected && status && (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {t("assistant.access")}
              </p>
              <p className="mt-1 font-semibold text-slate-900">
                {t("assistant.readOnlyAccess")}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {t("assistant.expires")}
              </p>
              <p className="mt-1 font-semibold text-slate-900">{date(status.expiresAt)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {t("assistant.lastActivity")}
              </p>
              <p className="mt-1 font-semibold text-slate-900">{date(status.lastActivityAt)}</p>
              {status.lastClientName && (
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  {status.lastClientName}
                  {status.lastProtocolVersion ? ` · MCP ${status.lastProtocolVersion}` : ""}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              disabled={!status.helperAvailable || !status.codexAddCommand}
              onClick={() => void copyCommand()}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t("assistant.copied") : t("assistant.copyCodexSetup")}
            </button>
            <p className="text-xs font-medium leading-5 text-slate-500">
              {status.helperAvailable
                ? t("assistant.codexSetupHint")
                : t("assistant.helperUnavailable")}
            </p>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">
          {error}
        </p>
      )}
    </section>
  );
}

function EnvironmentDiscoveryPanel() {
  const { t } = useI18n();
  const [view, setView] = useState<DiscoveryManagerView | null>(null);
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProposal, setShowProposal] = useState(false);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setView(await invoke<DiscoveryManagerView>("get_environment_discovery_status"));
    } catch (problem) {
      setError(commandErrorMessage(problem, t("assistant.discoveryUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function chooseRoots() {
    const selected = await open({ directory: true, multiple: true, title: t("assistant.chooseFolders") });
    if (!selected) return;
    const roots = (Array.isArray(selected) ? selected : [selected]).filter(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );
    setSelectedRoots(Array.from(new Set(roots)).slice(0, 3));
  }

  async function approve() {
    if (!selectedRoots.length) return;
    setBusy(true);
    setError(null);
    try {
      setView(
        await invoke<DiscoveryManagerView>("approve_environment_discovery", {
          request: { roots: selectedRoots, confirmed: true },
        }),
      );
      setSelectedRoots([]);
    } catch (problem) {
      setError(commandErrorMessage(problem, t("assistant.discoveryUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      setView(await invoke<DiscoveryManagerView>("revoke_environment_discovery"));
    } catch (problem) {
      setError(commandErrorMessage(problem, t("assistant.discoveryUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  const scope = view?.discovery.scope;
  const active = scope?.state === "active";
  const formatDate = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        )
      : t("assistant.neverUsed");

  return (
    <section className="rounded-xl border border-white/70 bg-white/70 p-5 shadow-glass backdrop-blur-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-950 text-white">
            <FolderSearch className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-950">
                {t("assistant.discoveryAccessTitle")}
              </h2>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                active ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"
              }`}>
                {active ? t("assistant.discoveryActive") : t("assistant.discoveryInactive")}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-slate-600">
              {t("assistant.discoveryPrivacy")}
            </p>
          </div>
        </div>
        <button
          aria-label={t("assistant.checkConnection")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>

      {active && scope ? (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {scope.roots.map((root) => (
              <div key={root.rootId} className="min-w-0 rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="truncate text-sm font-semibold text-slate-900">{root.displayLabel}</p>
                <p className="mt-0.5 truncate text-xs font-medium text-slate-500">{root.localPath}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-medium text-slate-500">
            <span>{t("assistant.lastDiscovery")}: {formatDate(view?.discovery.lastSnapshot?.createdAt)}</span>
            <button
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 font-semibold text-rose-800 transition hover:bg-rose-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => void revoke()}
            >
              <Unplug className="h-4 w-4" />
              {t("assistant.revokeDiscovery")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              disabled={busy}
              onClick={() => void chooseRoots()}
            >
              <FolderSearch className="h-4 w-4" />
              {t("assistant.chooseFolders")}
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              disabled={busy || !selectedRoots.length}
              onClick={() => void approve()}
            >
              <ShieldCheck className="h-4 w-4" />
              {t("assistant.allowInspection")}
            </button>
            <p className="text-xs font-medium text-slate-500">
              {selectedRoots.length
                ? t("assistant.foldersSelected", { count: selectedRoots.length })
                : t("assistant.selectUpToThree")}
            </p>
          </div>
        </div>
      )}

      {view?.proposal && (
        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-950">{t("assistant.proposalReady")}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {t("assistant.reviewOnly")} · {formatDate(view.proposal.createdAt)}
              </p>
            </div>
            <button
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => setShowProposal((current) => !current)}
            >
              <Eye className="h-4 w-4" />
              {showProposal ? t("assistant.closeProposal") : t("assistant.openProposal")}
            </button>
          </div>
          {showProposal && (
            <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-slate-900">{view.proposal.status}</p>
              {view.proposal.localPaths.map((path) => (
                <div key={path.field} className="mt-3 border-t border-slate-200 pt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{path.field}</p>
                  <p className="mt-1 break-all font-medium text-slate-800">{path.localPath}</p>
                </div>
              ))}
              {view.proposal.unresolvedQuestions.length > 0 && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t("assistant.needsClarification")}
                  </p>
                  <ul className="mt-1 space-y-1 text-slate-700">
                    {view.proposal.unresolvedQuestions.map((question) => <li key={question}>• {question}</li>)}
                  </ul>
                </div>
              )}
              <p className="mt-3 break-all text-[11px] font-medium text-slate-400">
                {view.proposal.proposalDigest}
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">{error}</p>}
    </section>
  );
}

export function AssistantPage() {
  const { t } = useI18n();
  const [request, setRequest] = useState("");
  const [selected, setSelected] = useState<FrequentRequest | null>(null);
  const [customPreview, setCustomPreview] = useState<string | null>(null);
  const [savingBrief, setSavingBrief] = useState(false);
  const [savedBrief, setSavedBrief] = useState<DiscoveryRequest | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function choose(card: FrequentRequest) {
    setSelected(card);
    setCustomPreview(null);
    setRequest(t(card.promptKey));
    setSavedBrief(null);
    setSaveError(null);
  }

  function previewCustom() {
    if (!request.trim()) return;
    setSelected(null);
    setCustomPreview(request.trim());
    setSavedBrief(null);
    setSaveError(null);
  }

  async function saveDiscoveryBrief() {
    if (!request.trim()) return;
    setSavingBrief(true);
    setSaveError(null);
    try {
      const stepKeys = selected?.planStepKeys ?? GENERIC_PLAN_STEP_KEYS;
      const result = await invoke<DiscoveryRequest>("create_discovery_request", {
        draft: {
          description: request.trim(),
          suggestedSteps: stepKeys.map((stepKey) => t(stepKey)),
        },
      });
      setSavedBrief(result);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingBrief(false);
    }
  }

  const showingPlan = selected || customPreview;

  return (
    <div className="space-y-5">
      <PageHeader title={t("assistant.title")} eyebrow={t("assistant.eyebrow")} />

      <LocalAgentConnectionPanel />
      <EnvironmentDiscoveryPanel />

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
                  className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-cta px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-cta-soft disabled:cursor-not-allowed disabled:opacity-50"
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
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-cta px-5 text-sm font-semibold text-white transition hover:bg-cta-soft disabled:cursor-not-allowed disabled:opacity-50"
              disabled={savingBrief || Boolean(savedBrief)}
              onClick={saveDiscoveryBrief}
            >
              <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
              {savingBrief
                ? t("assistant.savingBrief")
                : savedBrief
                  ? t("assistant.briefSaved")
                  : t("assistant.saveBrief")}
            </button>
            <span className="text-xs font-semibold text-slate-500">
              {savedBrief ? t("assistant.briefSavedNote") : t("assistant.localBriefNote")}
            </span>
          </div>
          {saveError && (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">
              {saveError}
            </p>
          )}
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
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg tint-amber-tile ring-1">
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
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg tint-sky-tile ring-1">
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
