import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { automationActions } from "./actions";
import { applyBrandingToDocument } from "./branding";
import { AppFrame, type AssistantPresence } from "./components/AppFrame";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { SetupWizard } from "./components/SetupWizard/SetupWizard";
import { Button } from "./components/ui";
import { createTranslator, I18nProvider } from "./i18n";
import { staffMessage } from "./messages";
import { deriveModuleReadiness, moduleForCommand } from "./moduleReadiness";
import {
  commandErrorMessage,
  getInitialOnboardingState,
  getOnboardingState,
  isOnboardingStateReady,
  normalizeOnboardingError,
  shouldShowOnboardingJourney,
  type OnboardingSnapshot,
} from "./onboarding";
import { OnboardingJourney } from "./onboarding/OnboardingJourney";
import { assistantHasReachedInnPilot } from "./onboarding/stages";
import { ActivityPage } from "./routes/ActivityPage";
import { AssistantPage } from "./routes/AssistantPage";
import { AutomationsPage } from "./routes/AutomationsPage";
import { GuidePage } from "./routes/GuidePage";
import { HomePage } from "./routes/HomePage";
import { SettingsPage } from "./routes/SettingsPage";
import { SupportPage } from "./routes/SupportPage";
import { SystemPage } from "./routes/SystemPage";
import { WorkAreaDetailPage } from "./routes/WorkAreaDetailPage";
import { WorkAreasPage } from "./routes/WorkAreasPage";
import { attentionModules } from "./statusMapping";
import { assistantWorkAreaAccess } from "./assistantConnection";
import {
  archiveWorkArea,
  confirmWorkAreaFact,
  createWorkArea,
  getWorkArea,
  listWorkAreaOpportunities,
  listWorkAreas,
  submitWorkAreaAnswer,
} from "./workArea/api";
import { AssistantAccessPrompt } from "./workArea/components";
import type {
  AnswerValue,
  CreateWorkAreaCommand,
  OpportunityListing,
  WorkAreaDetail,
  WorkAreaSummary,
} from "./workArea/types";
import type {
  ActivityRecord,
  AppConfigStatus,
  AppPage,
  AutomationAction,
  DiscoveryManagerView,
  LatestLog,
  LifeDeskConnectionStatus,
  LocalAgentConnectionStatus,
  ManagedAutomationInstallResult,
  RunStatus,
  RunSummary,
} from "./types";

import "./design/system.css";

function App() {
  const [configStatus, setConfigStatus] = useState<AppConfigStatus | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [checkingReadiness, setCheckingReadiness] = useState(true);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<RunSummary | null>(null);
  const [latestLogs, setLatestLogs] = useState<LatestLog[]>([]);
  const [activityHistory, setActivityHistory] = useState<ActivityRecord[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [notice, setNotice] = useState<string>("");
  const [pendingAction, setPendingAction] = useState<AutomationAction | null>(null);
  const [currentPage, setCurrentPage] = useState<AppPage>("home");
  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const [onboardingResolved, setOnboardingResolved] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [agent, setAgent] = useState<LocalAgentConnectionStatus | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryManagerView | null>(null);
  const [lifedesk, setLifedesk] = useState<LifeDeskConnectionStatus | null>(null);
  /** Set when the manager deliberately chooses the manual/advanced path. */
  const [manualSetup, setManualSetup] = useState(false);
  const [journeySupport, setJourneySupport] = useState(false);
  const [journeyEntered, setJourneyEntered] = useState(false);
  /**
   * Set when the manager leaves the journey from the Ready screen. Only ever
   * honoured while the backend itself reports a ready state — it decides which
   * screen to show, never whether setup succeeded.
   */
  const [leftJourney, setLeftJourney] = useState(false);
  const [workAreas, setWorkAreas] = useState<WorkAreaSummary[]>([]);
  const [workAreaDetail, setWorkAreaDetail] = useState<WorkAreaDetail | null>(null);
  const [workAreaBusy, setWorkAreaBusy] = useState(false);
  const [workAreaError, setWorkAreaError] = useState<string | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityListing[]>([]);
  /** "Not now" on the access prompt is remembered for this session only. */
  const [accessPromptDismissed, setAccessPromptDismissed] = useState(false);
  const configRefreshId = useRef(0);

  const browserPreview =
    typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

  const t = useMemo(() => createTranslator(configStatus?.config.language), [
    configStatus?.config.language,
  ]);
  const actions = useMemo(() => automationActions, []);
  const modules = useMemo(() => deriveModuleReadiness(configStatus, t), [configStatus, t]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPage]);

  useEffect(() => {
    if (onboarding && !isOnboardingStateReady(onboarding)) {
      setJourneyEntered(true);
    }
  }, [onboarding]);

  const branding = configStatus?.config.client.branding;
  useEffect(() => {
    applyBrandingToDocument(branding);
    let cancelled = false;
    if (branding?.logoPath) {
      invoke<string | null>("read_branding_logo")
        .then((dataUrl) => {
          if (!cancelled) setLogoDataUrl(dataUrl);
        })
        .catch(() => {
          if (!cancelled) setLogoDataUrl(null);
        });
    } else {
      setLogoDataUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [branding]);

  /** Connection-shaped state used by the shell, System, Assistant and Settings. */
  const refreshConnections = useCallback(async () => {
    if (browserPreview) return;
    const [nextAgent, nextDiscovery, nextLifedesk] = await Promise.allSettled([
      invoke<LocalAgentConnectionStatus>("get_local_agent_connection"),
      invoke<DiscoveryManagerView>("get_environment_discovery_status"),
      invoke<LifeDeskConnectionStatus>("get_lifedesk_connection"),
    ]);
    if (nextAgent.status === "fulfilled") setAgent(nextAgent.value);
    if (nextDiscovery.status === "fulfilled") setDiscovery(nextDiscovery.value);
    if (nextLifedesk.status === "fulfilled") setLifedesk(nextLifedesk.value);
  }, [browserPreview]);

  /*
    Work Areas.

    Every operation below is a round trip. React never edits an area in memory:
    it sends a typed local manager operation and then renders whatever the
    backend says the area now is. That is what keeps "answered", "map ready",
    "plan stale" and "automation candidate" backend facts rather than screen
    state that happens to look right.
  */
  const refreshWorkAreas = useCallback(async () => {
    if (browserPreview) return;
    try {
      const [areas, listings] = await Promise.all([
        listWorkAreas(),
        listWorkAreaOpportunities(),
      ]);
      setWorkAreas(areas);
      setOpportunities(listings);
    } catch (error) {
      setWorkAreaError(commandErrorMessage(error));
    }
  }, [browserPreview]);

  async function openWorkArea(workAreaId: string) {
    setWorkAreaError(null);
    setWorkAreaBusy(true);
    try {
      setWorkAreaDetail(await getWorkArea(workAreaId));
    } catch (error) {
      setWorkAreaDetail(null);
      setWorkAreaError(commandErrorMessage(error));
    } finally {
      setWorkAreaBusy(false);
    }
  }

  async function addWorkArea(command: CreateWorkAreaCommand) {
    setWorkAreaError(null);
    setWorkAreaBusy(true);
    try {
      const detail = await createWorkArea(command);
      setWorkAreaDetail(detail);
      await refreshWorkAreas();
      return true;
    } catch (error) {
      setWorkAreaError(commandErrorMessage(error));
      return false;
    } finally {
      setWorkAreaBusy(false);
    }
  }

  /**
   * Record one manager answer.
   *
   * `expectedRevision` is the revision the manager was looking at, so an answer
   * given against a view that has since changed is refused rather than applied
   * to a different area than the one on screen.
   */
  async function answerWorkAreaQuestion(input: {
    questionId: string;
    value: AnswerValue;
    requestId: string;
  }) {
    if (!workAreaDetail) return;
    setWorkAreaError(null);
    setWorkAreaBusy(true);
    try {
      setWorkAreaDetail(
        await submitWorkAreaAnswer({
          workAreaId: workAreaDetail.context.id,
          questionId: input.questionId,
          value: input.value,
          expectedRevision: workAreaDetail.context.revision,
          requestId: input.requestId,
        }),
      );
      await refreshWorkAreas();
    } catch (error) {
      setWorkAreaError(commandErrorMessage(error));
    } finally {
      setWorkAreaBusy(false);
    }
  }

  /**
   * Manager confirmation.
   *
   * Sent with the revision on screen, so a confirmation given against a view
   * that has since moved on is refused rather than applied to something else.
   */
  async function confirmWorkAreaTarget(targetId: string) {
    if (!workAreaDetail) return;
    setWorkAreaError(null);
    setWorkAreaBusy(true);
    try {
      setWorkAreaDetail(
        await confirmWorkAreaFact({
          workAreaId: workAreaDetail.context.id,
          targetId,
          expectedRevision: workAreaDetail.context.revision,
        }),
      );
      await refreshWorkAreas();
    } catch (error) {
      setWorkAreaError(commandErrorMessage(error));
    } finally {
      setWorkAreaBusy(false);
    }
  }

  async function archiveOpenWorkArea() {
    if (!workAreaDetail) return;
    setWorkAreaBusy(true);
    try {
      setWorkAreas(
        await archiveWorkArea(workAreaDetail.context.id, workAreaDetail.context.revision),
      );
      setWorkAreaDetail(null);
      await refreshWorkAreas();
    } catch (error) {
      setWorkAreaError(commandErrorMessage(error));
    } finally {
      setWorkAreaBusy(false);
    }
  }

  /**
   * Create a fresh grant so the assistant can help with Work Areas.
   *
   * This deliberately goes through the normal connect flow rather than adding
   * scopes to the existing grant: the manager approves the new access, and the
   * Assistant page is where the reconnect command lives.
   */
  async function updateAssistantAccess() {
    setWorkAreaBusy(true);
    try {
      setAgent(await invoke<LocalAgentConnectionStatus>("create_local_agent_connection"));
      setCurrentPage("assistant");
    } catch (error) {
      setWorkAreaError(commandErrorMessage(error));
    } finally {
      setWorkAreaBusy(false);
    }
  }

  useEffect(() => {
    if (browserPreview) {
      setOnboardingResolved(true);
    } else {
      void getInitialOnboardingState()
        .then((snapshot) => {
          setOnboarding(snapshot);
          setOnboardingResolved(true);
        })
        .catch((error) => {
          setNotice(normalizeOnboardingError(error).message);
          // Onboarding is the local authority. A corrupt/future record, or an
          // unavailable authority, fails closed into Help rather than Home.
          setCurrentPage("support");
          setOnboardingResolved(true);
        });
    }

    void refreshConfigStatus();
    void refreshLatestLogs();
    void refreshActivityHistory();
    void refreshConnections();
    void refreshWorkAreas();
    void invoke<RunSummary | null>("get_last_run_summary")
      .then((summary) => {
        if (summary) {
          setLastSummary(summary);
          setStatus(summary.status);
        }
      })
      .catch(() => undefined);

    const unlistenFinished = listen<RunSummary>("command-finished", (event) => {
      setLastSummary(event.payload);
      setStatus(event.payload.status);
      setNotice(event.payload.status === "error" ? t("app.runFinishedErrors") : t("app.runFinished"));
      void refreshConfigStatus();
      void refreshLatestLogs();
      void refreshActivityHistory();
    });

    return () => {
      void unlistenFinished.then((unlisten) => unlisten());
    };
  }, []);

  async function refreshConfigStatus() {
    const requestId = ++configRefreshId.current;
    setCheckingReadiness(true);
    try {
      const nextStatus = await invoke<AppConfigStatus>("get_config_status");
      if (requestId !== configRefreshId.current) return null;
      setConfigStatus(nextStatus);
      void refreshVerifiedConfigStatus(requestId);
      return nextStatus;
    } catch (error) {
      if (requestId === configRefreshId.current) {
        setNotice(commandErrorMessage(error));
        setCheckingReadiness(false);
      }
      return null;
    } finally {
      if (requestId === configRefreshId.current) {
        setLoadingConfig(false);
      }
    }
  }

  async function refreshVerifiedConfigStatus(requestId: number) {
    try {
      const verifiedStatus = await invoke<AppConfigStatus>("refresh_config_status");
      if (requestId !== configRefreshId.current) return;
      setConfigStatus(verifiedStatus);
      setCheckingReadiness(false);
    } catch {
      if (requestId !== configRefreshId.current) return;
      setNotice(t("app.readinessCheckFailed"));
      setCheckingReadiness(false);
    }
  }

  async function refreshLatestLogs() {
    try {
      setLatestLogs(await invoke<LatestLog[]>("get_latest_logs"));
    } catch (error) {
      setNotice(commandErrorMessage(error));
    }
  }

  async function refreshActivityHistory() {
    try {
      setActivityHistory(await invoke<ActivityRecord[]>("get_activity_history"));
    } catch (error) {
      setNotice(commandErrorMessage(error));
    }
  }

  async function refreshAll() {
    await refreshConfigStatus();
    await refreshLatestLogs();
    await refreshActivityHistory();
    await refreshConnections();
  }

  async function openPath(path?: string | null) {
    if (!path) {
      setNotice(t("app.noFolderConfigured"));
      return;
    }
    try {
      await invoke("open_path", { path });
    } catch (error) {
      setNotice(commandErrorMessage(error));
    }
  }

  async function openActivityReport(path?: string | null) {
    if (!path) {
      setNotice(t("app.noActivityReport"));
      return;
    }
    try {
      await invoke("open_activity_report", { path });
    } catch (error) {
      setNotice(commandErrorMessage(error));
    }
  }

  async function installManagedAutomationScripts() {
    const result = await invoke<ManagedAutomationInstallResult>(
      "install_managed_automation_scripts",
      { confirmed: true },
    );
    await refreshAll();
    return result;
  }

  async function startAction(action: AutomationAction) {
    const disabledReason = actionDisabledReason(action);
    if (disabledReason) {
      setNotice(disabledReason);
      return;
    }
    if (action.requiresConfirmation) {
      setPendingAction(action);
      return;
    }
    await runAction(action, false);
  }

  async function runAction(action: AutomationAction, confirmed: boolean) {
    setPendingAction(null);
    setRunningCommand(action.commandName);
    setStatus("idle");
    try {
      const summary = await invoke<RunSummary>("run_command", {
        commandName: action.commandName,
        confirmed,
      });
      setLastSummary(summary);
      setStatus(summary.status);
      setNotice(summary.status === "error" ? t("app.runFinishedErrors") : t("app.runFinished"));
    } catch (error) {
      setStatus("error");
      setNotice(commandErrorMessage(error));
    } finally {
      setRunningCommand(null);
      void refreshAll();
    }
  }

  function actionDisabledReason(action: AutomationAction) {
    if (loadingConfig) return t("app.setupLoading");
    if (checkingReadiness) return t("app.readinessChecking");
    if (!configStatus) return t("app.setupLoadFailed");
    const workflow = configStatus.preflight.workflows.find(
      (candidate) => candidate.key === action.workflowKey,
    );
    if (!workflow) return t("app.workflowStatusMissing");
    if (!workflow.canRun) {
      const module = moduleForCommand(modules, action.commandName);
      if (module && module.status !== "ready") return module.nextAction;
      return staffMessage(workflow.message, workflow.status, workflow.key);
    }
    return null;
  }

  /*
    The old-grant case, stated accurately.

    A grant created before Work Areas existed is valid and in use; it simply
    never received the mapping scopes, because stored scopes are not widened in
    place. That is a capability gap, not a broken connection, so it is raised
    only where it actually blocks something.
  */
  const workAreaAccess = assistantWorkAreaAccess(agent);
  const accessPrompt =
    workAreaAccess === "needsUpdate" && !accessPromptDismissed ? (
      <AssistantAccessPrompt
        busy={workAreaBusy}
        onDismiss={() => setAccessPromptDismissed(true)}
        onReconnect={() => void updateAssistantAccess()}
      />
    ) : null;

  // Structural evidence is reachable only while the approved discovery scope
  // is active. If it is not, a map built from folder structure is standing on
  // information InnPilot can no longer see.
  const evidenceUnavailable = Boolean(
    workAreaDetail &&
      workAreaDetail.context.linkedEvidence.length > 0 &&
      discovery !== null &&
      discovery.discovery.scope?.state !== "active",
  );

  const hotelName = configStatus?.config.client.displayName || "InnPilot";
  const runningLabel = runningCommand
    ? (actions.find((action) => action.commandName === runningCommand)?.label ?? null)
    : null;
  const attentionCount = attentionModules(modules).length;

  const presence: AssistantPresence = runningCommand
    ? "working"
    : status === "error" || attentionCount > 0
      ? "attention"
      : assistantHasReachedInnPilot(agent)
        ? "connected"
        : "notConnected";

  // Wait for the backend to say where this installation stands before painting.
  if (!onboardingResolved) return null;

  const showJourney =
    onboarding !== null &&
    shouldShowOnboardingJourney(onboarding, journeyEntered, leftJourney);

  /* -------- Manual / advanced setup: preserved, deliberately opt-in -------- */
  if (manualSetup && onboarding) {
    return (
      <I18nProvider language={configStatus?.config.language}>
        <div className="ip-app">
          <div className="ip-journey">
            <div className="ip-journey__bar">
              <span className="ip-journey__brand">{t("system.manualConfiguration")}</span>
              <Button onClick={() => setManualSetup(false)} variant="ghost">
                {t("common.close")}
              </Button>
            </div>
            <div className="ip-journey__body">
              <div className="ip-journey__panel ip-journey__panel--wide">
                <SetupWizard
                  config={configStatus?.config}
                  onboarding={onboarding}
                  onOnboardingChanged={setOnboarding}
                  onClose={() => setManualSetup(false)}
                  onSetupSaved={refreshAll}
                />
              </div>
            </div>
          </div>
        </div>
      </I18nProvider>
    );
  }

  if (journeySupport) {
    return (
      <I18nProvider language={configStatus?.config.language}>
        <div className="ip-app">
          <div className="ip-journey">
            <div className="ip-journey__bar">
              <span className="ip-journey__brand">{t("nav.support")}</span>
              <Button onClick={() => setJourneySupport(false)} variant="ghost">
                {t("common.back")}
              </Button>
            </div>
            <div className="ip-journey__body">
              <div className="ip-journey__panel ip-journey__panel--wide">
                <SupportPage
                  configStatus={configStatus}
                  onInstallAutomation={installManagedAutomationScripts}
                  onNavigate={setCurrentPage}
                  onOpenPath={openPath}
                  onRefresh={refreshAll}
                />
              </div>
            </div>
          </div>
        </div>
      </I18nProvider>
    );
  }

  /* ---------------- Fresh install: the four-stage journey ---------------- */
  if (showJourney && onboarding) {
    return (
      <I18nProvider language={configStatus?.config.language}>
        <div className="ip-app">
          <OnboardingJourney
            onFinished={() => {
              setLeftJourney(true);
              setJourneySupport(false);
              setCurrentPage("home");
              void refreshAll();
              void getOnboardingState().then(setOnboarding).catch(() => undefined);
            }}
            onManualSetup={() => setManualSetup(true)}
            onOpenSupport={() => {
              setJourneySupport(true);
            }}
            onSnapshotChange={setOnboarding}
            snapshot={onboarding}
          />
        </div>
      </I18nProvider>
    );
  }

  /* ------------------------- Normal application ------------------------- */
  return (
    <I18nProvider language={configStatus?.config.language}>
      <AppFrame
        attentionCount={attentionCount}
        browserPreview={browserPreview}
        currentPage={currentPage}
        hotelName={hotelName}
        logoDataUrl={logoDataUrl}
        notice={notice}
        onDismissNotice={() => setNotice("")}
        onPageChange={setCurrentPage}
        presence={presence}
      >
        {currentPage === "home" && (
          <HomePage
            activityHistory={activityHistory}
            configStatus={configStatus}
            hotelName={hotelName}
            loading={loadingConfig}
            modules={modules}
            onNavigate={setCurrentPage}
            onOpenWorkArea={(id) => {
              setCurrentPage("workAreas");
              void openWorkArea(id);
            }}
            runningLabel={runningLabel}
            workAreas={workAreas}
          />
        )}

        {currentPage === "workAreas" &&
          (workAreaDetail ? (
            <WorkAreaDetailPage
              busy={workAreaBusy}
              detail={workAreaDetail}
              error={workAreaError}
              evidenceUnavailable={evidenceUnavailable}
              onAnswer={answerWorkAreaQuestion}
              onArchive={archiveOpenWorkArea}
              onConfirm={confirmWorkAreaTarget}
              onBack={() => {
                setWorkAreaDetail(null);
                setWorkAreaError(null);
              }}
              onOpenAssistant={() => setCurrentPage("assistant")}
              reconnectPrompt={accessPrompt}
            />
          ) : (
            <WorkAreasPage
              areas={workAreas}
              busy={workAreaBusy}
              error={workAreaError}
              loading={workAreaBusy}
              onCreate={addWorkArea}
              onOpen={(id) => void openWorkArea(id)}
              onRefresh={() => void refreshWorkAreas()}
              reconnectPrompt={accessPrompt}
            />
          ))}

        {currentPage === "automations" && (
          <AutomationsPage
            actionDisabledReason={actionDisabledReason}
            activityHistory={activityHistory}
            configStatus={configStatus}
            modules={modules}
            onNavigate={setCurrentPage}
            onOpenPath={openPath}
            onOpenWorkArea={(id) => {
              setCurrentPage("workAreas");
              void openWorkArea(id);
            }}
            onRun={startAction}
            opportunities={opportunities}
            runningCommand={runningCommand}
          />
        )}

        {currentPage === "activity" && (
          <ActivityPage
            activityHistory={activityHistory}
            configStatus={configStatus}
            latestLogs={latestLogs}
            onOpenActivityReport={openActivityReport}
            onOpenPath={openPath}
            onOpenWorkArea={(id) => {
              setCurrentPage("workAreas");
              void openWorkArea(id);
            }}
            onRefresh={refreshAll}
            workAreas={workAreas}
          />
        )}

        {currentPage === "assistant" && (
          <AssistantPage
            agent={agent}
            discovery={discovery}
            onAgentChange={setAgent}
            onNavigate={setCurrentPage}
            onRefresh={refreshConnections}
          />
        )}

        {currentPage === "system" && (
          <SystemPage
            agent={agent}
            configStatus={configStatus}
            lifedesk={lifedesk}
            loading={checkingReadiness}
            modules={modules}
            onboarding={onboarding}
            onNavigate={setCurrentPage}
            onOpenManualSetup={() => setManualSetup(true)}
            onRefresh={refreshAll}
          />
        )}

        {currentPage === "settings" && (
          <SettingsPage
            agent={agent}
            configStatus={configStatus}
            onNavigate={setCurrentPage}
            onRefresh={refreshAll}
          />
        )}

        {currentPage === "support" && (
          <SupportPage
            configStatus={configStatus}
            onInstallAutomation={installManagedAutomationScripts}
            onNavigate={setCurrentPage}
            onOpenPath={openPath}
            onRefresh={refreshAll}
          />
        )}

        {currentPage === "guide" && <GuidePage lifedesk={lifedesk} />}

        {pendingAction && (
          <ConfirmDialog
            cancelLabel={t("common.cancel")}
            confirmLabel={t("common.confirm")}
            message={pendingAction.confirmationMessage}
            onCancel={() => setPendingAction(null)}
            onConfirm={() => void runAction(pendingAction, true)}
            title={pendingAction.confirmationTitle}
          />
        )}

      </AppFrame>
    </I18nProvider>
  );
}

export default App;
