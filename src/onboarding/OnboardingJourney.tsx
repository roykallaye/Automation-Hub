/*
  Phase G — the fresh-install journey: Connect → Let it check → Review → Ready.

  This component owns no onboarding state of its own. Every screen is chosen by
  `projectJourney` from backend truth, and every transition happens because the
  backend moved, not because React advanced a step. The assistant does its work
  out of band (over MCP), so while the manager is waiting we re-read the
  authoritative state on a gentle interval — observing progress, never
  simulating it.

  Approval goes through the existing Phase F path unchanged, including the
  stable request id that makes a retry idempotent rather than a second
  operation.
*/

import { invoke } from "@tauri-apps/api/core";
import { open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { Bot } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Note } from "../components/ui";
import { useI18n } from "../i18n";
import {
  beginOrResumeOnboarding,
  commandErrorMessage,
  getOnboardingState,
  type OnboardingSnapshot,
} from "../onboarding";
import type {
  DiscoveryManagerView,
  LocalAgentConnectionStatus,
  ProposalApplyResult,
} from "../types";
import { JOURNEY_STAGES, projectJourney, stageStatus, type JourneyStage } from "./stages";
import {
  ApplyingStage,
  CheckingStage,
  ChooseScopeStage,
  ConnectAssistantStage,
  ConnectIntroStage,
  FailedStage,
  QuestionStage,
  ReadyStage,
  ReviewStage,
  RolledBackStage,
} from "./stageScreens";

/** How often to re-read backend state while waiting on out-of-band assistant work. */
const POLL_MS = 4000;

export function OnboardingJourney({
  snapshot,
  onSnapshotChange,
  onFinished,
  onManualSetup,
  onOpenSupport,
}: {
  snapshot: OnboardingSnapshot;
  onSnapshotChange: (snapshot: OnboardingSnapshot) => void;
  onFinished: () => void;
  onManualSetup: () => void;
  onOpenSupport: () => void;
}) {
  const { t } = useI18n();
  const [agent, setAgent] = useState<LocalAgentConnectionStatus | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryManagerView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  const approvalRequestRef = useRef<{ proposalKey: string; requestId: string } | null>(null);

  const projection = projectJourney(snapshot, agent, discovery);
  const { stage, view } = projection;

  const readBackendState = useCallback(async () => {
    const [nextSnapshot, nextAgent, nextDiscovery] = await Promise.allSettled([
      getOnboardingState(),
      invoke<LocalAgentConnectionStatus>("get_local_agent_connection"),
      invoke<DiscoveryManagerView>("get_environment_discovery_status"),
    ]);
    if (nextSnapshot.status === "fulfilled") onSnapshotChange(nextSnapshot.value);
    if (nextAgent.status === "fulfilled") setAgent(nextAgent.value);
    if (nextDiscovery.status === "fulfilled") setDiscovery(nextDiscovery.value);
  }, [onSnapshotChange]);

  useEffect(() => {
    void readBackendState();
  }, [readBackendState]);

  // Poll only while the manager is genuinely waiting on the assistant or on a
  // transaction. Settled screens (intro, ready, failures) do not poll.
  const shouldPoll =
    view.kind === "checking" ||
    view.kind === "question" ||
    view.kind === "applying" ||
    (view.kind === "connectAssistant" && agent?.state !== "connected");

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => void readBackendState(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [shouldPoll, readBackendState]);

  async function run<T>(action: () => Promise<T>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (problem) {
      setError(commandErrorMessage(problem, fallback));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startAgentOnboarding() {
    await run(async () => {
      const next = await beginOrResumeOnboarding("agentAssisted", snapshot.revision);
      onSnapshotChange(next);
      await readBackendState();
    }, t("assistant.connectionUnavailable"));
  }

  async function createConnection() {
    await run(async () => {
      setAgent(await invoke<LocalAgentConnectionStatus>("create_local_agent_connection"));
    }, t("assistant.connectionUnavailable"));
  }

  async function chooseFolders() {
    const picked = await openFolderPicker({
      directory: true,
      multiple: true,
      title: t("scope.choose"),
    });
    if (!picked) return;
    const roots = (Array.isArray(picked) ? picked : [picked]).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    setSelectedRoots(Array.from(new Set(roots)).slice(0, 3));
  }

  async function approveScope() {
    if (selectedRoots.length === 0) return;
    await run(async () => {
      setDiscovery(
        await invoke<DiscoveryManagerView>("approve_environment_discovery", {
          request: { roots: selectedRoots, confirmed: true },
        }),
      );
      setSelectedRoots([]);
      await readBackendState();
    }, t("scope.unavailable"));
  }

  /**
   * Phase F approval, unchanged. The request id is derived once per proposal
   * identity and reused on retry so a lost response cannot create a second
   * operation; on failure we ask the backend for the authoritative outcome
   * rather than deciding here what happened.
   */
  async function approveAndFinish() {
    const proposal = discovery?.proposal;
    if (!proposal || !discovery?.review?.approvalEligible) return;

    const proposalKey = `${proposal.proposalId}:${proposal.revision}:${proposal.proposalDigest}`;
    if (approvalRequestRef.current?.proposalKey !== proposalKey) {
      approvalRequestRef.current = { proposalKey, requestId: `phaseg-ui-${crypto.randomUUID()}` };
    }

    setBusy(true);
    setError(null);
    try {
      await invoke<ProposalApplyResult>("approve_and_apply_setup_proposal", {
        request: {
          proposalId: proposal.proposalId,
          proposalRevision: proposal.revision,
          proposalDigest: proposal.proposalDigest,
          requestId: approvalRequestRef.current.requestId,
          confirmed: true,
        },
      });
      approvalRequestRef.current = null;
      await readBackendState();
    } catch (problem) {
      const message = commandErrorMessage(problem, t("review.applyFailed"));
      let authoritativeOutcomeLoaded = false;
      try {
        const authoritative = await invoke<DiscoveryManagerView>(
          "get_environment_discovery_status",
        );
        setDiscovery(authoritative);
        const application = authoritative.application;
        if (application?.proposalId === proposal.proposalId) {
          authoritativeOutcomeLoaded = ["succeeded", "rolled_back", "failed_recoverable"].includes(
            application.status,
          );
        }
        if (authoritativeOutcomeLoaded || application?.status === "invalidated") {
          approvalRequestRef.current = null;
        }
        await readBackendState();
      } catch {
        // Keep the request id so a later attempt can still ask the backend for
        // the outcome without starting another operation.
      }
      setError(authoritativeOutcomeLoaded ? null : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ip-journey">
      <div className="ip-journey__bar">
        <span className="ip-journey__brand">
          <Bot aria-hidden="true" size={17} />
          InnPilot
        </span>
        <StageRail current={stage} />
      </div>

      <div className="ip-journey__body">
        <div
          className={`ip-journey__panel${view.kind === "review" ? " ip-journey__panel--wide" : ""}`}
        >
          {error ? <div style={{ marginBottom: 16 }}><Note tone="problem">{error}</Note></div> : null}

          {view.kind === "connectIntro" ? (
            <ConnectIntroStage
              busy={busy}
              onConnect={startAgentOnboarding}
              onManual={onManualSetup}
            />
          ) : null}

          {view.kind === "connectAssistant" ? (
            <ConnectAssistantStage
              agent={agent}
              busy={busy}
              onCheck={readBackendState}
              onCreate={createConnection}
            />
          ) : null}

          {view.kind === "chooseScope" ? (
            <ChooseScopeStage
              busy={busy}
              onApprove={approveScope}
              onChoose={chooseFolders}
              selectedRoots={selectedRoots}
            />
          ) : null}

          {view.kind === "checking" ? (
            <CheckingStage
              agentConnected={agent?.state === "connected"}
              busy={busy}
              discovery={discovery}
              onRefresh={readBackendState}
              state={snapshot.state}
            />
          ) : null}

          {view.kind === "question" ? (
            <QuestionStage
              busy={busy}
              onRefresh={readBackendState}
              questions={discovery?.proposal?.unresolvedQuestions ?? []}
            />
          ) : null}

          {view.kind === "review" ? (
            <ReviewStage
              busy={busy}
              discovery={discovery}
              onApprove={approveAndFinish}
            />
          ) : null}

          {view.kind === "applying" ? <ApplyingStage state={snapshot.state} /> : null}

          {view.kind === "ready" ? (
            <ReadyStage deferredItems={view.deferredItems} onGo={onFinished} />
          ) : null}

          {view.kind === "rolledBack" ? (
            <RolledBackStage
              busy={busy}
              onManual={onManualSetup}
              onRetry={readBackendState}
              onSupport={onOpenSupport}
            />
          ) : null}

          {view.kind === "failedRecoverable" ? (
            <FailedStage
              failureCode={snapshot.activeSession?.failureCode ?? null}
              onSupport={onOpenSupport}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StageRail({ current }: { current: JourneyStage }) {
  const { t } = useI18n();
  const labels: Record<JourneyStage, string> = {
    connect: t("journey.stageConnect"),
    check: t("journey.stageCheck"),
    review: t("journey.stageReview"),
    ready: t("journey.stageReady"),
  };
  const currentIndex = JOURNEY_STAGES.indexOf(current);

  return (
    <ol
      aria-label={t("journey.stageConnect")}
      className="ip-stages"
      // Communicates position to assistive tech without needing the visual rail.
      aria-valuenow={currentIndex + 1}
      aria-valuemin={1}
      aria-valuemax={JOURNEY_STAGES.length}
      role="group"
    >
      {JOURNEY_STAGES.map((item, index) => {
        const status = stageStatus(item, current);
        return (
          <li
            aria-current={status === "current" ? "step" : undefined}
            className={`ip-stage${status === "done" ? " is-done" : ""}${
              status === "current" ? " is-current" : ""
            }`}
            key={item}
          >
            <span aria-hidden="true" className="ip-stage__dot" />
            {labels[item]}
            {index < JOURNEY_STAGES.length - 1 ? (
              <span aria-hidden="true" className="ip-stage__sep">
                ·
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
