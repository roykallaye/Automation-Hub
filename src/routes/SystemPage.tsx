/*
  System status — what "Setup" becomes once onboarding is finished.

  Its job is reporting, not configuring: four things a manager might reasonably
  ask about, when they were last checked, and the actions that follow. No path
  fields. Manual configuration is present, clearly labelled as the fallback it
  is.
*/

import { Bot, CloudCog, RefreshCw, ServerCog, SlidersHorizontal, Workflow } from "lucide-react";

import {
  Button,
  Card,
  DetailList,
  IconButton,
  Note,
  PageHead,
  Row,
  Rows,
  Section,
  TechnicalDetails,
} from "../components/ui";
import { useI18n } from "../i18n";
import { isOnboardingReady, type OnboardingSnapshot } from "../onboarding";
import { formatWhen } from "../statusMapping";
import type {
  AppConfigStatus,
  AppPage,
  LifeDeskConnectionStatus,
  LocalAgentConnectionStatus,
  ModuleReadiness,
} from "../types";

export function SystemPage({
  agent,
  configStatus,
  lifedesk,
  loading,
  modules,
  onboarding,
  onNavigate,
  onOpenManualSetup,
  onRefresh,
}: {
  agent: LocalAgentConnectionStatus | null;
  configStatus: AppConfigStatus | null;
  lifedesk: LifeDeskConnectionStatus | null;
  loading: boolean;
  modules: ModuleReadiness[];
  onboarding: OnboardingSnapshot | null;
  onNavigate: (page: AppPage) => void;
  onOpenManualSetup: () => void;
  onRefresh: () => void;
}) {
  const { language, t } = useI18n();

  const ready = onboarding ? isOnboardingReady(onboarding) : false;
  const workModules = modules.filter((module) => module.id !== "support");
  const troubled = workModules.filter(
    (module) => module.status === "blocked" || module.status === "needs_attention",
  );

  const agentConnected = agent?.state === "connected";
  const lifedeskConnected = lifedesk?.state === "connected";

  return (
    <>
      <PageHead
        actions={
          <IconButton
            busy={loading}
            icon={RefreshCw}
            label={t("common.refresh")}
            onClick={onRefresh}
          />
        }
        description={t("system.description")}
        title={t("system.title")}
      />

      <div className="ip-stack">
        <Card>
          <Rows>
            <Row
              icon={ServerCog}
              meta={ready ? t("system.innpilotReady") : t("system.innpilotIncomplete")}
              status={
                ready
                  ? { tone: "ready", label: t("status.ready") }
                  : { tone: "attention", label: t("status.attention") }
              }
              title={t("system.innpilot")}
            />
            <Row
              icon={Bot}
              meta={
                agentConnected
                  ? t("assistant.connectedText")
                  : agent?.state === "expired"
                    ? t("assistant.expiredText")
                    : t("assistant.notConnectedText")
              }
              onOpen={() => onNavigate("assistant")}
              openLabel={t("system.assistant")}
              status={
                agentConnected
                  ? { tone: "ready", label: t("status.connected") }
                  : { tone: "idle", label: t("status.notConnected") }
              }
              title={t("system.assistant")}
            />
            <Row
              icon={Workflow}
              meta={
                troubled.length === 0
                  ? t("system.workflowsReady")
                  : troubled.length === 1
                    ? t("system.workflowsIssue", { count: 1 })
                    : t("system.workflowsIssues", { count: troubled.length })
              }
              onOpen={() => onNavigate("automations")}
              openLabel={t("system.workflows")}
              status={
                troubled.length === 0
                  ? { tone: "ready", label: t("status.ready") }
                  : { tone: "attention", label: t("status.attention") }
              }
              title={t("system.workflows")}
            />
            <Row
              icon={CloudCog}
              meta={lifedeskConnected ? t("pair.lifedeskText") : t("pair.notConnectedText")}
              onOpen={() => onNavigate("settings")}
              openLabel={t("system.lifedesk")}
              status={
                lifedeskConnected
                  ? { tone: "ready", label: t("status.connected") }
                  : { tone: "idle", label: t("status.notConnected") }
              }
              title={t("system.lifedesk")}
            />
          </Rows>
        </Card>

        <Section title={t("system.lastCheck")}>
          <Card pad quiet>
            <p style={{ color: "var(--ip-muted)", fontSize: "0.875rem", margin: 0 }}>
              {formatWhen(
                configStatus?.preflight.checkedAt,
                language,
                t("system.lastCheckNever"),
              )}
            </p>
            <div className="ip-actions" style={{ marginTop: 12 }}>
              <Button busy={loading} icon={RefreshCw} onClick={onRefresh} variant="primary">
                {t("system.checkSetup")}
              </Button>
              {!agentConnected ? (
                <Button icon={Bot} onClick={() => onNavigate("assistant")} variant="secondary">
                  {t("system.reconnectAssistant")}
                </Button>
              ) : null}
            </div>
          </Card>
        </Section>

        {troubled.length > 0 ? (
          <Section title={t("home.needsAttentionSection")}>
            <Card>
              <Rows>
                {troubled.map((module) => (
                  <Row
                    key={module.id}
                    meta={module.nextAction || module.shortReason}
                    status={{
                      tone: module.status === "blocked" ? "problem" : "attention",
                      label:
                        module.status === "blocked" ? t("status.problem") : t("status.attention"),
                    }}
                    title={module.title}
                  />
                ))}
              </Rows>
            </Card>
          </Section>
        ) : null}

        {/* Manual configuration stays fully available, but is plainly the fallback. */}
        <Section title={t("common.advanced")}>
          <Card>
            <Rows>
              <Row
                icon={SlidersHorizontal}
                meta={t("system.manualConfigurationHint")}
                onOpen={onOpenManualSetup}
                openLabel={t("system.manualConfiguration")}
                title={t("system.manualConfiguration")}
              />
            </Rows>
          </Card>
        </Section>

        {!ready && onboarding ? (
          <Note tone="attention">{t("system.innpilotIncomplete")}</Note>
        ) : null}

        <TechnicalDetails label={t("common.technicalDetails")}>
          <DetailList
            items={[
              { label: "Configuration", value: configStatus?.configPath ?? "—", mono: true },
              {
                label: "Checked at",
                value: configStatus?.preflight.checkedAt ?? "—",
                mono: true,
              },
              { label: "Onboarding state", value: onboarding?.state ?? "—" },
              {
                label: "Onboarding revision",
                value: onboarding ? String(onboarding.revision) : "—",
              },
              {
                label: "Installation readiness",
                value: onboarding?.installation.readiness ?? "—",
              },
              {
                label: "LifeDesk protocol",
                value: lifedesk ? String(lifedesk.protocolVersion) : "—",
              },
            ]}
          />
          {configStatus ? (
            <div style={{ marginTop: 14 }}>
              <DetailList
                items={configStatus.preflight.items.map((item) => ({
                  label: item.label,
                  value: `${item.status} · ${item.path ?? "—"}`,
                  mono: true,
                }))}
              />
            </div>
          ) : null}
        </TechnicalDetails>
      </div>
    </>
  );
}
