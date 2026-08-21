/*
  The onboarding stage screens.

  Each screen answers exactly one question and offers one obvious next move.
  Nothing here decides anything: eligibility, validation and outcome all come
  from the backend views passed in. Paths, digests, revisions and evidence are
  present but always behind "Technical details".
*/

import {
  AlertTriangle,
  Bot,
  Check,
  CircleHelp,
  Copy,
  FolderOpen,
  LifeBuoy,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import {
  Button,
  Card,
  DetailList,
  Note,
  ProgressFlow,
  Status,
  TechnicalDetails,
  type ProgressStep,
} from "../components/ui";
import { useI18n, type TranslationKey, type Translate } from "../i18n";
import {
  PROPOSAL_GROUP_LABEL,
  PROPOSAL_GROUP_ORDER,
  groupForField,
  humanizeFieldKey,
  isPathField,
  lookupField,
  type ProposalGroupId,
} from "../proposalVocabulary";
import type { OnboardingState } from "../onboarding";
import type {
  DiscoveryManagerView,
  LocalAgentConnectionStatus,
  ManagerProposalApplySummary,
  ManagerProposalReviewField,
} from "../types";

/* ================================================================ 1 CONNECT */

export function ConnectIntroStage({
  busy,
  onConnect,
  onManual,
}: {
  busy: boolean;
  onConnect: () => void;
  onManual: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="ip-stage-head">
        <h1>{t("connectIntro.title")}</h1>
        <p>{t("connectIntro.text")}</p>
      </div>

      <Note tone="quiet">{t("connectIntro.reassurance")}</Note>

      <div className="ip-stage-foot">
        <Button busy={busy} icon={Bot} onClick={onConnect} size="lg" variant="primary">
          {t("connectIntro.primary")}
        </Button>
        <Button onClick={onManual} size="lg" variant="ghost">
          {t("connectIntro.secondary")}
        </Button>
      </div>

      <p className="ip-fineprint">
        <Lock aria-hidden="true" size={13} />
        {t("connectIntro.privacy")}
      </p>
    </>
  );
}

export function ConnectAssistantStage({
  agent,
  busy,
  checkedAt,
  onCheck,
  onCreate,
  onManual,
}: {
  agent: LocalAgentConnectionStatus | null;
  busy: boolean;
  /** When the last read of backend state landed, manual or automatic. */
  checkedAt: number | null;
  onCheck: () => void;
  onCreate: () => void;
  onManual: () => void;
}) {
  const { language, t } = useI18n();
  const [copied, setCopied] = useState(false);
  const needsFreshProfile = !agent?.profileId || agent.state === "expired";
  // The grant exists as soon as it is created locally; the assistant has only
  // truly arrived once it has actually called InnPilot.
  const connectionPrepared = Boolean(agent?.profileId) && agent?.state !== "expired";

  async function copyCommand() {
    if (!agent?.codexAddCommand) return;
    try {
      await navigator.clipboard.writeText(agent.codexAddCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="ip-stage-head">
        <h1>{connectionPrepared ? t("connect.waitingTitle") : t("connectAssistant.title")}</h1>
        <p>{connectionPrepared ? t("connect.waitingText") : t("connectAssistant.text")}</p>
      </div>

      <Card pad>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <strong style={{ fontSize: "0.95rem", fontWeight: 650 }}>{t("connect.codex")}</strong>
          <Status
            label={connectionPrepared ? t("connect.notReachedYet") : t("connect.codexSupported")}
            tone="idle"
          />
        </div>

        <ol className="ip-steps">
          <li>
            <span className="ip-steps__num">1</span>
            <div className="ip-steps__body">
              <span className="ip-steps__title">{t("connect.stepCreate")}</span>
              <span className="ip-steps__hint">{t("connect.stepCreateHint")}</span>
              {needsFreshProfile ? (
                <div>
                  <Button busy={busy} onClick={onCreate} variant="primary">
                    {t("connect.create")}
                  </Button>
                </div>
              ) : (
                <Status label={t("status.ready")} tone="ready" />
              )}
            </div>
          </li>

          <li>
            <span className="ip-steps__num">2</span>
            <div className="ip-steps__body">
              <span className="ip-steps__title">{t("connect.stepCopy")}</span>
              <span className="ip-steps__hint">{t("connect.stepCopyHint")}</span>
              {agent?.helperAvailable === false ? (
                <Note tone="attention">{t("connect.helperUnavailable")}</Note>
              ) : (
                <div>
                  <Button
                    disabled={!agent?.codexAddCommand}
                    icon={copied ? Check : Copy}
                    onClick={() => void copyCommand()}
                    variant="secondary"
                  >
                    {copied ? t("connect.copied") : t("connect.copy")}
                  </Button>
                </div>
              )}
            </div>
          </li>

          <li>
            <span className="ip-steps__num">3</span>
            <div className="ip-steps__body">
              <span className="ip-steps__title">{t("connect.stepCheck")}</span>
              <span className="ip-steps__hint">{t("connect.stepCheckHint")}</span>

              {/*
                The result of the most recent read. Re-keyed on checkedAt so the
                row remounts and replays its highlight — that flicker is the
                only thing telling the manager a fresh answer just arrived,
                since an unchanged verdict otherwise looks like nothing
                happened.
              */}
              {connectionPrepared ? (
                <div className="ip-check-result" key={checkedAt ?? "initial"}>
                  <Status label={t("connect.notReachedYet")} tone="idle" />
                  {checkedAt ? (
                    <span className="ip-check-result__when">
                      {t("connect.lastChecked", { time: clockTime(checkedAt, language) })}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="ip-actions">
                <Button busy={busy} icon={RefreshCw} onClick={onCheck} variant="secondary">
                  {t("connect.check")}
                </Button>
              </div>

              {connectionPrepared ? (
                <span className="ip-steps__hint">{t("connect.checkingAutomatically")}</span>
              ) : null}
            </div>
          </li>
        </ol>
      </Card>

      {/* Without this the screen is a dead end for anyone not using Codex. */}
      <div className="ip-stage-foot">
        <Button onClick={onManual} variant="ghost">
          {t("connectIntro.secondary")}
        </Button>
      </div>

      <p className="ip-fineprint">
        <Lock aria-hidden="true" size={13} />
        {t("connectIntro.privacy")}
      </p>

      <AgentTechnicalDetails agent={agent} />
    </>
  );
}

function clockTime(at: number, language: string) {
  return new Intl.DateTimeFormat(language === "it" ? "it-IT" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(at));
}

function AgentTechnicalDetails({ agent }: { agent: LocalAgentConnectionStatus | null }) {
  const { t } = useI18n();
  if (!agent) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <TechnicalDetails label={t("common.technicalDetails")}>
        <DetailList
          items={[
            { label: "Connection state", value: agent.state },
            { label: "Profile", value: agent.profileId ?? "—", mono: true },
            { label: "Scopes", value: agent.scopes.join(", ") || "—" },
            { label: "Access", value: agent.connectionIsReadOnly ? "read-only" : "read/write" },
            { label: "Expires", value: agent.expiresAt ?? "—" },
            { label: "MCP client", value: agent.lastClientName ?? "—" },
            { label: "MCP protocol", value: agent.lastProtocolVersion ?? "—" },
            { label: "Last tool", value: agent.lastTool ?? "—", mono: true },
            { label: "Connection command", value: agent.codexAddCommand ?? "—", mono: true },
          ]}
        />
      </TechnicalDetails>
    </div>
  );
}

/* ============================================================= 2 LET IT CHECK */

export function ChooseScopeStage({
  busy,
  onApprove,
  onChoose,
  reason,
  selectedRoots,
}: {
  busy: boolean;
  onApprove: () => void;
  onChoose: () => void;
  reason: "missing" | "revoked";
  selectedRoots: string[];
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="ip-stage-head">
        <h1>{reason === "revoked" ? t("scope.revoked") : t("scope.title")}</h1>
        <p>{reason === "revoked" ? t("scope.revokedText") : t("scope.text")}</p>
      </div>

      {selectedRoots.length > 0 ? (
        <Card>
          <div className="ip-rows">
            {selectedRoots.map((root) => (
              <div className="ip-row" key={root}>
                <span className="ip-row__icon">
                  <FolderOpen aria-hidden="true" size={17} />
                </span>
                <span className="ip-row__body">
                  <span className="ip-row__title">{folderName(root)}</span>
                  {/* The absolute path is genuinely useful here: the manager is
                      confirming which physical folder they just picked. */}
                  <span className="ip-row__meta">{root}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="ip-stage-foot">
        {selectedRoots.length > 0 ? (
          <>
            <Button busy={busy} icon={ShieldCheck} onClick={onApprove} size="lg" variant="primary">
              {t("scope.allow")}
            </Button>
            <Button onClick={onChoose} variant="ghost">
              {t("scope.chooseAnother")}
            </Button>
          </>
        ) : (
          <Button icon={FolderOpen} onClick={onChoose} size="lg" variant="primary">
            {t("scope.choose")}
          </Button>
        )}
        <span style={{ color: "var(--ip-faint)", fontSize: "0.82rem" }}>
          {selectedRoots.length > 0
            ? t("scope.selected", { count: selectedRoots.length })
            : t("scope.selectUpToThree")}
        </span>
      </div>

      <p className="ip-fineprint">
        <Lock aria-hidden="true" size={13} />
        {t("scope.privacy")}
      </p>
    </>
  );
}

export function CheckingStage({
  agentConnected,
  busy,
  discovery,
  onRefresh,
  state,
}: {
  agentConnected: boolean;
  busy: boolean;
  discovery: DiscoveryManagerView | null;
  onRefresh: () => void;
  state: OnboardingState;
}) {
  const { t } = useI18n();
  const scopeActive = discovery?.discovery.scope?.state === "active";
  const snapshotTaken = Boolean(discovery?.discovery.lastSnapshot);
  const proposalStarted = Boolean(discovery?.proposal);

  // Every step below is backed by a real backend fact. Nothing advances on a timer.
  const steps: ProgressStep[] = [
    {
      key: "agent",
      label: t("checking.assistantConnected"),
      state: agentConnected ? "done" : "pending",
    },
    {
      key: "scope",
      label: t("checking.folderApproved"),
      state: scopeActive ? "done" : "pending",
    },
    {
      key: "inspect",
      label: t("checking.checkingSetup"),
      state: snapshotTaken ? "done" : scopeActive ? "active" : "pending",
    },
    {
      key: "prepare",
      label: t("checking.preparing"),
      state: proposalStarted ? "done" : snapshotTaken ? "active" : "pending",
    },
  ];

  const revoked = discovery?.discovery.scope?.state === "revoked";

  return (
    <>
      <div className="ip-stage-head">
        <h1>{revoked ? t("scope.revoked") : t("checking.title")}</h1>
        <p>{revoked ? t("scope.revokedText") : t("checking.text")}</p>
      </div>

      {!revoked ? (
        <Card pad>
          <ProgressFlow steps={steps} />
        </Card>
      ) : null}

      <div className="ip-stage-foot">
        <Button busy={busy} icon={RefreshCw} onClick={onRefresh} variant="secondary">
          {t("checking.refresh")}
        </Button>
        <span style={{ color: "var(--ip-faint)", fontSize: "0.82rem" }}>
          {state === "discoveryRunning" ? t("checking.takesAMoment") : t("checking.waitingForAssistant")}
        </span>
      </div>

      <ScopeTechnicalDetails discovery={discovery} />
    </>
  );
}

export function QuestionStage({
  busy,
  onRefresh,
  questions,
}: {
  busy: boolean;
  onRefresh: () => void;
  questions: string[];
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="ip-stage-head">
        <h1>{t("question.title")}</h1>
        <p>{t("question.text")}</p>
      </div>

      {questions.length > 0 ? (
        <Card>
          <div className="ip-rows">
            {questions.map((question) => (
              <div className="ip-row" key={question}>
                <span className="ip-row__icon">
                  <CircleHelp aria-hidden="true" size={17} />
                </span>
                <span className="ip-row__body">
                  <span className="ip-row__title">{question}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Note tone="quiet">{t("question.answerInAssistant")}</Note>

      <div className="ip-stage-foot">
        <Button busy={busy} icon={RefreshCw} onClick={onRefresh} variant="secondary">
          {t("question.recheck")}
        </Button>
      </div>
    </>
  );
}

function ScopeTechnicalDetails({ discovery }: { discovery: DiscoveryManagerView | null }) {
  const { t } = useI18n();
  const scope = discovery?.discovery.scope;
  if (!scope) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <TechnicalDetails label={t("common.technicalDetails")}>
        <DetailList
          items={[
            { label: "Scope", value: `${scope.scopeId} (rev ${scope.revision})`, mono: true },
            { label: "State", value: scope.state },
            { label: "Expires", value: scope.expiresAt },
            ...scope.roots.map((root) => ({
              label: root.displayLabel,
              value: root.localPath,
              mono: true,
            })),
            {
              label: "Last snapshot",
              value: discovery?.discovery.lastSnapshot
                ? `${discovery.discovery.lastSnapshot.snapshotId} · ${discovery.discovery.lastSnapshot.digest}`
                : "—",
              mono: true,
            },
            { label: "Privacy", value: discovery?.discovery.privacySummary ?? "—" },
          ]}
        />
      </TechnicalDetails>
    </div>
  );
}

/* ================================================================= 3 REVIEW */

export function ReviewStage({
  busy,
  discovery,
  onApprove,
  onRefresh,
}: {
  busy: boolean;
  discovery: DiscoveryManagerView | null;
  onApprove: () => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const proposal = discovery?.proposal;
  const review = discovery?.review;

  if (!proposal || !review) {
    return (
      <>
        <div className="ip-stage-head">
          <h1>{t("review.noProposalTitle")}</h1>
          <p>{t("review.noProposalText")}</p>
        </div>
        <div className="ip-stage-foot">
          <Button busy={busy} icon={RefreshCw} onClick={onRefresh} variant="secondary">
            {t("common.refresh")}
          </Button>
        </div>
      </>
    );
  }

  const grouped = groupFields(review.fields);
  const stale = proposal.invalidationReason !== null;

  return (
    <>
      <div className="ip-stage-head">
        <h1>{t("review.title")}</h1>
        <p>{t("review.text")}</p>
      </div>

      <p className="ip-attribution">
        <Sparkles aria-hidden="true" size={14} />
        {t("review.preparedBy")}
      </p>

      {/* ---- Will change ---- */}
      <Card pad>
        <h2 className="ip-review-heading">{t("review.willChange")}</h2>
        {grouped.length === 0 ? (
          <p style={{ color: "var(--ip-muted)", fontSize: "0.875rem", margin: 0 }}>
            {t("review.noProposalText")}
          </p>
        ) : (
          grouped.map(([group, fields]) => (
            <div className="ip-review-group" key={group}>
              <h3 className="ip-review-group__title">{t(PROPOSAL_GROUP_LABEL[group])}</h3>
              {fields.map((field) => (
                <ChangeRow field={field} key={field.field} t={t} />
              ))}
            </div>
          ))
        )}
      </Card>

      {/* ---- Will stay as it is ---- */}
      {review.willNotChange.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Card pad quiet>
            <h2 className="ip-review-heading">{t("review.willStay")}</h2>
            <ul style={{ display: "grid", gap: 7, listStyle: "none", margin: 0, padding: 0 }}>
              {review.willNotChange.map((item) => (
                <li
                  key={item}
                  style={{
                    alignItems: "center",
                    color: "var(--ip-muted)",
                    display: "flex",
                    fontSize: "0.865rem",
                    gap: 8,
                  }}
                >
                  <Check aria-hidden="true" size={14} style={{ color: "var(--ip-ready)" }} />
                  {preserveLabel(item, t)}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {/* ---- Needs attention ---- */}
      {proposal.warnings.length > 0 || proposal.unresolvedQuestions.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Card pad>
            <h2 className="ip-review-heading">
              <AlertTriangle aria-hidden="true" size={16} style={{ color: "var(--ip-attention)" }} />
              {t("review.needsAttention")}
            </h2>
            <ul style={{ display: "grid", gap: 7, listStyle: "none", margin: 0, padding: 0 }}>
              {[...proposal.warnings, ...proposal.unresolvedQuestions].map((item) => (
                <li key={item} style={{ color: "var(--ip-ink-soft)", fontSize: "0.865rem" }}>
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {/* ---- Approval (Phase F path, backend-gated) ---- */}
      <div style={{ marginTop: 22 }}>
        {stale ? <Note tone="attention">{t("review.stale")}</Note> : null}
        {!stale && !review.approvalEligible ? (
          <Note tone="attention">{t("review.notEligible")}</Note>
        ) : null}

        <div className="ip-stage-foot">
          <Button
            busy={busy}
            disabled={!review.approvalEligible}
            icon={ShieldCheck}
            onClick={onApprove}
            size="lg"
            variant="primary"
          >
            {t("review.approve")}
          </Button>
          {stale ? (
            <Button busy={busy} icon={RefreshCw} onClick={onRefresh} variant="secondary">
              {t("common.refresh")}
            </Button>
          ) : null}
        </div>
        <p className="ip-fineprint">
          <ShieldCheck aria-hidden="true" size={13} />
          {t("review.approveExplanation")}
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <TechnicalDetails label={t("common.technicalDetails")}>
          <DetailList
            items={[
              { label: t("review.digest"), value: proposal.proposalDigest, mono: true },
              {
                label: t("review.revision"),
                value: `${proposal.proposalId} · rev ${proposal.revision}`,
                mono: true,
              },
              { label: "Status", value: proposal.status },
              { label: "Target configuration", value: proposal.targetConfigurationRevision, mono: true },
              { label: "Review only", value: String(proposal.reviewOnly) },
              { label: "Mutation performed", value: String(proposal.mutationPerformed) },
              { label: "Invalidation reason", value: proposal.invalidationReason ?? "—" },
              {
                label: "Agent confidence",
                value: proposal.agentConfidence === null ? "—" : String(proposal.agentConfidence),
              },
            ]}
          />
          <div style={{ marginTop: 14 }}>
            <DetailList
              items={review.fields.map((field) => ({
                label: field.field,
                value: `${field.currentValue} → ${field.proposedValue} · ${field.evidence} · ${field.validation}`,
                mono: true,
              }))}
            />
          </div>
        </TechnicalDetails>
      </div>
    </>
  );
}

function ChangeRow({ field, t }: { field: ManagerProposalReviewField; t: Translate }) {
  const vocabulary = lookupField(field.field);
  const label = vocabulary ? t(vocabulary.labelKey) : humanizeFieldKey(field.field);
  const meaning = vocabulary ? t(vocabulary.meaningKey) : null;

  return (
    <div className="ip-review-item">
      <span className="ip-review-item__label">{label}</span>
      {/* A folder shows availability rather than a path; a setting shows its
          new value. The real path stays in Technical details. */}
      {isPathField(field.field) ? (
        <Status label={t("status.available")} tone="ready" />
      ) : (
        <Status label={settingValueLabel(field.proposedValue, t)} tone="ready" />
      )}
      {meaning ? <span className="ip-review-item__value">{meaning}</span> : null}
    </div>
  );
}

/** Maps the backend's raw setting values onto business words. */
function settingValueLabel(value: string, t: Translate) {
  const map: Record<string, TranslationKey> = {
    allPdfs: "field.allPdfs",
    filenamePatterns: "field.filenamePatterns",
    prepareOnly: "field.prepareOnly",
    gmailDrafts: "field.gmailDrafts",
    Yes: "field.yes",
    No: "field.no",
    "—": "field.notSet",
  };
  const key = map[value];
  return key ? t(key) : value;
}

function preserveLabel(item: string, t: Translate) {
  const key = `preserve.${item}` as TranslationKey;
  const translated = t(key);
  // A backend guarantee we have not translated yet should still read as a
  // sentence rather than a camelCase identifier.
  return translated === key ? humanizeFieldKey(item) : translated;
}

function groupFields(fields: ManagerProposalReviewField[]) {
  const buckets = new Map<ProposalGroupId, ManagerProposalReviewField[]>();
  for (const field of fields) {
    const group = groupForField(field.field);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(field);
    else buckets.set(group, [field]);
  }
  return PROPOSAL_GROUP_ORDER.filter((group) => buckets.has(group)).map(
    (group) => [group, buckets.get(group) as ManagerProposalReviewField[]] as const,
  );
}

/* =============================================================== APPLYING */

export function ApplyingStage({ state }: { state: OnboardingState }) {
  const { t } = useI18n();

  // "applying" and "verifying" are distinct backend states, so the checklist
  // reflects genuine progress rather than an animation.
  const verifying = state === "verifying";
  const steps: ProgressStep[] = [
    { key: "recovery", label: t("applying.recoveryPoint"), state: "done" },
    { key: "applied", label: t("applying.applied"), state: verifying ? "done" : "active" },
    { key: "verify", label: t("applying.verifying"), state: verifying ? "active" : "pending" },
  ];

  return (
    <>
      <div className="ip-stage-head">
        <h1>{t("applying.title")}</h1>
        <p>{t("applying.text")}</p>
      </div>
      <Card pad>
        <ProgressFlow steps={steps} />
      </Card>
      <p className="ip-fineprint">
        <ShieldCheck aria-hidden="true" size={13} />
        {t("applying.doNotClose")}
      </p>
    </>
  );
}

/* ================================================================== 4 READY */

export function ReadyStage({
  deferredItems,
  onGo,
}: {
  deferredItems: string[];
  onGo: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="ip-stage-head">
        <h1>{t("ready.title")}</h1>
        <p>{t("ready.text")}</p>
      </div>

      <div className="ip-stage-foot">
        <Button icon={Check} onClick={onGo} size="lg" variant="primary">
          {t("ready.go")}
        </Button>
      </div>

      {/* Deferred integrations are optional, not a failure — quiet and secondary. */}
      {deferredItems.length > 0 ? (
        <div style={{ marginTop: 28 }}>
          <div className="ip-section__head">
            <div>
              <h2>{t("ready.optional")}</h2>
              <p>{t("ready.optionalText")}</p>
            </div>
          </div>
          <Card quiet>
            <div className="ip-rows">
              {deferredItems.map((item) => (
                <div className="ip-row" key={item}>
                  <span className="ip-row__body">
                    <span className="ip-row__title">{deferredLabel(item, t)}</span>
                  </span>
                  <span className="ip-row__aside">
                    <Status label={t("status.notConnected")} tone="idle" />
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function deferredLabel(item: string, t: Translate) {
  if (item.toLowerCase().includes("gmail")) return t("ready.deferredGmail");
  return t("ready.deferredGeneric", { item: humanizeFieldKey(item) });
}

/* ========================================================= FAILURE STATES */

export function RolledBackStage({
  busy,
  issue,
  onManual,
  onRetry,
  onSupport,
}: {
  busy: boolean;
  issue: ManagerProposalApplySummary | null;
  onManual: () => void;
  onRetry: () => void;
  onSupport: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="ip-stage-head">
        <h1>{t("rolledBack.title")}</h1>
        <p>{t("rolledBack.text")}</p>
      </div>

      <Note tone="ready">{t("preserve.unrelatedConfigurationPreserved")}</Note>

      {issue?.safeFailureCode || issue?.blockerKeys.length ? (
        <TechnicalDetails label={t("rolledBack.reviewIssue")}>
          <DetailList
            items={[
              ...(issue.safeFailureCode
                ? [{ label: "Failure code", value: issue.safeFailureCode, mono: true }]
                : []),
              ...(issue.blockerKeys.length
                ? [{ label: "Checks", value: issue.blockerKeys.join(", "), mono: true }]
                : []),
            ]}
          />
        </TechnicalDetails>
      ) : null}

      <div className="ip-stage-foot">
        <Button busy={busy} icon={RefreshCw} onClick={onRetry} size="lg" variant="primary">
          {t("rolledBack.tryAgain")}
        </Button>
        <Button onClick={onManual} variant="secondary">
          {t("rolledBack.manual")}
        </Button>
        <Button icon={LifeBuoy} onClick={onSupport} variant="ghost">
          {t("rolledBack.support")}
        </Button>
      </div>
    </>
  );
}

export function FailedStage({
  failureCode,
  issue,
  onSupport,
}: {
  failureCode: string | null;
  issue: ManagerProposalApplySummary | null;
  onSupport: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="ip-stage-head">
        <h1>{t("failed.title")}</h1>
        <p>{t("failed.text")}</p>
      </div>

      <div className="ip-stage-foot">
        <Button icon={LifeBuoy} onClick={onSupport} size="lg" variant="primary">
          {t("failed.support")}
        </Button>
      </div>

      {/* The raw code is available, but it is never the first thing shown. */}
      {failureCode || issue?.safeFailureCode || issue?.blockerKeys.length ? (
        <div style={{ marginTop: 18 }}>
          <TechnicalDetails label={t("failed.technical")}>
            <DetailList
              items={[
                ...(failureCode
                  ? [{ label: "Failure code", value: failureCode, mono: true }]
                  : []),
                ...(!failureCode && issue?.safeFailureCode
                  ? [{ label: "Failure code", value: issue.safeFailureCode, mono: true }]
                  : []),
                ...(issue?.blockerKeys.length
                  ? [{ label: "Checks", value: issue.blockerKeys.join(", "), mono: true }]
                  : []),
              ]}
            />
          </TechnicalDetails>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ shared */

function folderName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
