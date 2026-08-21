/*
  Visual preview harness.

  Renders the redesigned screens against synthetic fixtures so the UI can be
  reviewed and screenshotted without a desktop build and without touching a
  real installation. Pick a scene with ?scene=<id>.

  This entry is not part of the app bundle: index.html is the only entry the
  Tauri build ships. It exists so visual regressions are cheap to catch.
*/

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppFrame, type AssistantPresence } from "../src/components/AppFrame";
import { JOURNEY_STAGES, stageStatus, type JourneyStage } from "../src/onboarding/stages";
import { I18nProvider, useI18n, type TranslationKey } from "../src/i18n";
import { ActivityPage } from "../src/routes/ActivityPage";
import { AssistantPage } from "../src/routes/AssistantPage";
import { AutomationsPage } from "../src/routes/AutomationsPage";
import { GuidePage } from "../src/routes/GuidePage";
import { HomePage } from "../src/routes/HomePage";
import { SettingsPage } from "../src/routes/SettingsPage";
import { SupportPage } from "../src/routes/SupportPage";
import { SystemPage } from "../src/routes/SystemPage";
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
} from "../src/onboarding/stageScreens";
import type { AppPage } from "../src/types";
import * as fixture from "./fixtures";

import "../src/styles.css";
import "../src/design/system.css";

const noop = () => undefined;

function Shell({
  page,
  children,
  presence = "connected",
}: {
  page: AppPage;
  children: React.ReactNode;
  presence?: AssistantPresence;
}) {
  return (
    <AppFrame
      attentionCount={page === "home" ? 1 : 0}
      browserPreview={false}
      currentPage={page}
      hotelName={fixture.HOTEL}
      onPageChange={noop}
      presence={presence}
    >
      {children}
    </AppFrame>
  );
}

const STAGE_KEY: Record<JourneyStage, TranslationKey> = {
  connect: "journey.stageConnect",
  check: "journey.stageCheck",
  review: "journey.stageReview",
  ready: "journey.stageReady",
};

function Rail({ current }: { current: JourneyStage }) {
  const { t } = useI18n();
  return (
    <ol className="ip-stages">
      {JOURNEY_STAGES.map((stage, index) => {
        const status = stageStatus(stage, current);
        return (
          <li
            className={`ip-stage${status === "done" ? " is-done" : ""}${status === "current" ? " is-current" : ""}`}
            key={stage}
          >
            <span aria-hidden="true" className="ip-stage__dot" />
            {t(STAGE_KEY[stage])}
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

function Journey({
  stage,
  wide = false,
  children,
}: {
  stage: JourneyStage;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="ip-app">
      <div className="ip-journey">
        <div className="ip-journey__bar">
          <span className="ip-journey__brand">InnPilot</span>
          <Rail current={stage} />
        </div>
        <div className="ip-journey__body">
          <div className={`ip-journey__panel${wide ? " ip-journey__panel--wide" : ""}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

const SCENES: Record<string, () => JSX.Element> = {
  "home-ready": () => (
    <Shell page="home">
      <HomePage
        activityHistory={fixture.activity}
        configStatus={fixture.configStatus}
        hotelName={fixture.HOTEL}
        loading={false}
        modules={fixture.modulesReady}
        onNavigate={noop}
        runningLabel={null}
      />
    </Shell>
  ),
  "home-attention": () => (
    <Shell page="home">
      <HomePage
        activityHistory={fixture.activity}
        configStatus={fixture.configStatus}
        hotelName={fixture.HOTEL}
        loading={false}
        modules={fixture.modulesAttention}
        onNavigate={noop}
        runningLabel={null}
      />
    </Shell>
  ),
  "home-empty": () => (
    <Shell page="home">
      <HomePage
        activityHistory={[]}
        configStatus={fixture.configStatus}
        hotelName={fixture.HOTEL}
        loading={false}
        modules={fixture.modulesReady}
        onNavigate={noop}
        runningLabel={null}
      />
    </Shell>
  ),
  automations: () => (
    <Shell page="automations">
      <AutomationsPage
        actionDisabledReason={() => null}
        activityHistory={fixture.activity}
        configStatus={fixture.configStatus}
        modules={fixture.modulesAttention}
        onNavigate={noop}
        onOpenPath={noop}
        onRun={noop}
        runningCommand={null}
      />
    </Shell>
  ),
  activity: () => (
    <Shell page="activity">
      <ActivityPage
        activityHistory={fixture.activity}
        configStatus={fixture.configStatus}
        latestLogs={[]}
        onOpenActivityReport={noop}
        onOpenPath={noop}
        onRefresh={noop}
      />
    </Shell>
  ),
  "activity-empty": () => (
    <Shell page="activity">
      <ActivityPage
        activityHistory={[]}
        configStatus={fixture.configStatus}
        latestLogs={[]}
        onOpenActivityReport={noop}
        onOpenPath={noop}
        onRefresh={noop}
      />
    </Shell>
  ),
  assistant: () => (
    <Shell page="assistant">
      <AssistantPage
        agent={fixture.agentConnected}
        discovery={fixture.discoveryWithProposal}
        onAgentChange={noop}
        onNavigate={noop}
        onRefresh={noop}
      />
    </Shell>
  ),
  system: () => (
    <Shell page="system">
      <SystemPage
        agent={fixture.agentConnected}
        configStatus={fixture.configStatus}
        lifedesk={fixture.lifedeskConnected}
        loading={false}
        modules={fixture.modulesAttention}
        onboarding={fixture.snapshot("ready")}
        onNavigate={noop}
        onOpenManualSetup={noop}
        onRefresh={noop}
      />
    </Shell>
  ),
  "assistant-prepared": () => (
    <Shell page="assistant" presence="attention">
      <AssistantPage
        agent={fixture.agentPrepared}
        discovery={fixture.discoveryChecking}
        onAgentChange={noop}
        onNavigate={noop}
        onRefresh={noop}
      />
    </Shell>
  ),
  settings: () => (
    <Shell page="settings">
      <SettingsPage
        agent={fixture.agentConnected}
        configStatus={fixture.configStatus}
        onNavigate={noop}
        onRefresh={noop}
      />
    </Shell>
  ),
  support: () => (
    <Shell page="support">
      <SupportPage
        configStatus={fixture.configStatus}
        onInstallAutomation={async () => {
          throw new Error("Synthetic preview only");
        }}
        onNavigate={noop}
        onOpenPath={noop}
        onRefresh={noop}
      />
    </Shell>
  ),
  guide: () => (
    <Shell page="guide">
      <GuidePage lifedesk={fixture.lifedeskConnected} />
    </Shell>
  ),
  "onboard-connect": () => (
    <Journey stage="connect">
      <ConnectIntroStage busy={false} onConnect={noop} onManual={noop} />
    </Journey>
  ),
  "onboard-assistant": () => (
    <Journey stage="connect">
      <ConnectAssistantStage
        agent={fixture.agentNotConnected}
        busy={false}
        checkedAt={null}
        onCheck={noop}
        onCreate={noop}
        onManual={noop}
      />
    </Journey>
  ),
  "onboard-notconfigured": () => (
    <Journey stage="connect">
      <ConnectAssistantStage
        agent={fixture.agentNotConnected}
        busy={false}
        checkedAt={null}
        onCheck={noop}
        onCreate={noop}
        onManual={noop}
      />
    </Journey>
  ),
  "onboard-expired": () => (
    <Journey stage="connect">
      <ConnectAssistantStage
        agent={{ ...fixture.agentPreparedNotReached, state: "expired" }}
        busy={false}
        checkedAt={Date.parse("2026-08-21T09:41:07Z")}
        onCheck={noop}
        onCreate={noop}
        onManual={noop}
      />
    </Journey>
  ),
  "assistant-accessready": () => (
    <Shell page="assistant">
      <AssistantPage
        agent={fixture.agentPreparedNotReached}
        discovery={fixture.discoveryChecking}
        onAgentChange={noop}
        onNavigate={noop}
        onRefresh={noop}
      />
    </Shell>
  ),
  "onboard-waiting-busy": () => (
    <Journey stage="connect">
      <ConnectAssistantStage
        agent={fixture.agentPreparedNotReached}
        busy
        checkedAt={Date.parse("2026-08-21T09:41:07Z")}
        onCheck={noop}
        onCreate={noop}
        onManual={noop}
      />
    </Journey>
  ),
  "onboard-waiting": () => (
    <Journey stage="connect">
      <ConnectAssistantStage
        agent={fixture.agentPreparedNotReached}
        busy={false}
        checkedAt={Date.parse("2026-08-21T09:41:07Z")}
        onCheck={noop}
        onCreate={noop}
        onManual={noop}
      />
    </Journey>
  ),
  "onboard-scope": () => (
    <Journey stage="check">
      <ChooseScopeStage
        busy={false}
        onApprove={noop}
        onChoose={noop}
        reason="missing"
        selectedRoots={[
          "D:\\ExampleHotel\\Amministrazione",
          "D:\\ExampleHotel\\Scansioni",
        ]}
      />
    </Journey>
  ),
  "onboard-scope-revoked": () => (
    <Journey stage="check">
      <ChooseScopeStage
        busy={false}
        onApprove={noop}
        onChoose={noop}
        reason="revoked"
        selectedRoots={[]}
      />
    </Journey>
  ),
  "onboard-checking": () => (
    <Journey stage="check">
      <CheckingStage
        agentConnected
        busy={false}
        discovery={fixture.discoveryChecking}
        onRefresh={noop}
        state="discoveryRunning"
      />
    </Journey>
  ),
  "onboard-question": () => (
    <Journey stage="check">
      <QuestionStage
        busy={false}
        onRefresh={noop}
        questions={["Which folder is currently used for new invoices?"]}
      />
    </Journey>
  ),
  "onboard-review": () => (
    <Journey stage="review" wide>
      <ReviewStage
        busy={false}
        discovery={fixture.discoveryWithProposal}
        onApprove={noop}
        onRefresh={noop}
      />
    </Journey>
  ),
  "onboard-stale": () => (
    <Journey stage="review" wide>
      <ReviewStage
        busy={false}
        discovery={{
          ...fixture.discoveryWithProposal,
          proposal: fixture.discoveryWithProposal.proposal
            ? {
                ...fixture.discoveryWithProposal.proposal,
                invalidationReason: "proposal_stale_config",
              }
            : null,
          review: fixture.discoveryWithProposal.review
            ? { ...fixture.discoveryWithProposal.review, approvalEligible: false }
            : null,
        }}
        onApprove={noop}
        onRefresh={noop}
      />
    </Journey>
  ),
  "onboard-applying": () => (
    <Journey stage="review">
      <ApplyingStage state="verifying" />
    </Journey>
  ),
  "onboard-ready": () => (
    <Journey stage="ready">
      <ReadyStage deferredItems={["gmailDrafts"]} onGo={noop} />
    </Journey>
  ),
  "onboard-rolledback": () => (
    <Journey stage="review">
      <RolledBackStage
        busy={false}
        issue={null}
        onManual={noop}
        onRetry={noop}
        onSupport={noop}
      />
    </Journey>
  ),
  "onboard-failed": () => (
    <Journey stage="review">
      <FailedStage failureCode="validation_failed" issue={null} onSupport={noop} />
    </Journey>
  ),
};

const scene = new URLSearchParams(window.location.search).get("scene") ?? "home-ready";
const language = new URLSearchParams(window.location.search).get("lang") ?? "en";
const Scene = SCENES[scene] ?? SCENES["home-ready"];

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <I18nProvider language={language}>
      <Scene />
    </I18nProvider>
  </StrictMode>,
);

/*
  Layout self-check.

  Publishes horizontal-overflow measurements onto <html data-overflow> so a
  headless run can assert "no horizontal scroll at this viewport" instead of
  someone squinting at a screenshot. `overflow` is the page-level check; the
  widest offending element is reported so a failure is actionable.
*/
window.setTimeout(() => {
  const docWidth = document.documentElement.scrollWidth;
  const viewport = document.documentElement.clientWidth;
  const overflowing: string[] = [];
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.right > viewport + 1) {
      overflowing.push(
        `${element.tagName.toLowerCase()}.${element.className || "?"}@${Math.round(rect.right)}`,
      );
    }
  }
  document.documentElement.dataset.overflow = String(Math.max(0, docWidth - viewport));
  document.documentElement.dataset.viewport = String(viewport);
  document.documentElement.dataset.offenders = overflowing.slice(0, 3).join(" | ") || "none";
}, 700);
