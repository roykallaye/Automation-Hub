/*
  The local assistant.

  This page answers: is an assistant connected, what can it do, what can it
  *not* do, what has it been doing, and how do I stop it. The capability lists
  are short and concrete rather than a wall of security prose, and the "cannot"
  list is shown with equal weight because that is the reassuring half.

  It is not a chat surface. InnPilot does not need to become another chat app.
*/

import { Bot, Check, Minus, RefreshCw, Unplug } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  Button,
  Card,
  DetailList,
  EmptyState,
  IconButton,
  Note,
  PageHead,
  Row,
  Rows,
  Section,
  Status,
  TechnicalDetails,
} from "../components/ui";
import { useI18n } from "../i18n";
import { commandErrorMessage } from "../onboarding";
import { formatWhen } from "../statusMapping";
import type { AppPage, DiscoveryManagerView, LocalAgentConnectionStatus } from "../types";

export function AssistantPage({
  agent,
  discovery,
  onAgentChange,
  onNavigate,
  onRefresh,
}: {
  agent: LocalAgentConnectionStatus | null;
  discovery: DiscoveryManagerView | null;
  onAgentChange: (status: LocalAgentConnectionStatus) => void;
  onNavigate: (page: AppPage) => void;
  onRefresh: () => void;
}) {
  const { language, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const connected = agent?.state === "connected";
  const expired = agent?.state === "expired";

  async function disconnect() {
    setConfirmingDisconnect(false);
    setBusy(true);
    setError(null);
    try {
      onAgentChange(await invoke<LocalAgentConnectionStatus>("revoke_local_agent_connection"));
    } catch (problem) {
      setError(commandErrorMessage(problem, t("assistant.connectionUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      onAgentChange(await invoke<LocalAgentConnectionStatus>("create_local_agent_connection"));
    } catch (problem) {
      setError(commandErrorMessage(problem, t("assistant.connectionUnavailable")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        actions={<IconButton busy={busy} icon={RefreshCw} label={t("assistant.check")} onClick={onRefresh} />}
        description={t("assistant.description")}
        title={t("assistant.title")}
      />

      <div className="ip-stack">
        {error ? <Note tone="problem">{error}</Note> : null}

        <Card pad>
          <div style={{ alignItems: "center", display: "flex", gap: 11, marginBottom: 6 }}>
            <span aria-hidden="true" className={`ip-headline__mark is-${connected ? "ready" : "attention"}`}>
              <Bot size={15} />
            </span>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 650, margin: 0 }}>
              {connected
                ? t("assistant.connectedHeading")
                : expired
                  ? t("assistant.expiredHeading")
                  : t("assistant.notConnectedHeading")}
            </h2>
            <Status
              label={connected ? t("status.connected") : t("status.notConnected")}
              tone={connected ? "ready" : "idle"}
            />
          </div>
          <p style={{ color: "var(--ip-muted)", fontSize: "0.9rem", margin: 0, maxWidth: "58ch" }}>
            {connected
              ? t("assistant.connectedText")
              : expired
                ? t("assistant.expiredText")
                : t("assistant.notConnectedText")}
          </p>

          <div className="ip-actions" style={{ marginTop: 16 }}>
            {connected ? (
              <Button
                busy={busy}
                icon={Unplug}
                onClick={() => setConfirmingDisconnect(true)}
                variant="danger"
              >
                {t("assistant.disconnect")}
              </Button>
            ) : (
              <Button busy={busy} icon={Bot} onClick={connect} variant="primary">
                {expired ? t("assistant.reconnect") : t("assistant.connect")}
              </Button>
            )}
            <Button onClick={() => onNavigate("guide")} variant="ghost">
              {t("home.howItWorks")}
            </Button>
          </div>
        </Card>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <Section title={t("assistant.canDo")}>
            <Card>
              <Rows>
                <Capability allowed label={t("assistant.canCheckSetup")} />
                <Capability allowed label={t("assistant.canPrepare")} />
                <Capability allowed label={t("assistant.canDiagnose")} />
              </Rows>
            </Card>
          </Section>

          <Section title={t("assistant.cannotDo")}>
            <Card>
              <Rows>
                <Capability label={t("assistant.cannotApprove")} />
                <Capability label={t("assistant.cannotRun")} />
                <Capability label={t("assistant.cannotRead")} />
              </Rows>
            </Card>
          </Section>
        </div>

        <Note tone="quiet">{t("assistant.approvalStays")}</Note>

        <Section title={t("assistant.recentActivity")}>
          <Card>
            {agent?.lastActivityAt ? (
              <Rows>
                <Row
                  meta={[
                    formatWhen(agent.lastActivityAt, language, t("common.never")),
                    agent.lastClientName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  title={t("assistant.lastActive", {
                    time: formatWhen(agent.lastActivityAt, language, t("common.never")),
                  })}
                />
              </Rows>
            ) : (
              <EmptyState
                icon={Bot}
                message={t("assistant.noActivityText")}
                title={t("assistant.noActivityTitle")}
              />
            )}
          </Card>
        </Section>

        <TechnicalDetails label={t("assistant.technical")}>
          <DetailList
            items={[
              { label: "State", value: agent?.state ?? "—" },
              { label: "Profile", value: agent?.profileId ?? "—", mono: true },
              { label: "Scopes", value: agent?.scopes.join(", ") || "—" },
              {
                label: "Access",
                value: agent?.connectionIsReadOnly === false ? "read/write" : "read-only",
              },
              { label: "Created", value: agent?.createdAt ?? "—" },
              { label: "Expires", value: agent?.expiresAt ?? "—" },
              { label: "MCP client", value: agent?.lastClientName ?? "—" },
              { label: "MCP protocol", value: agent?.lastProtocolVersion ?? "—" },
              { label: "Last tool", value: agent?.lastTool ?? "—", mono: true },
              { label: "Helper available", value: String(agent?.helperAvailable ?? false) },
              {
                label: "Discovery scope",
                value: discovery?.discovery.scope
                  ? `${discovery.discovery.scope.scopeId} · ${discovery.discovery.scope.state}`
                  : "—",
                mono: true,
              },
              { label: "Privacy", value: discovery?.discovery.privacySummary ?? "—" },
            ]}
          />
        </TechnicalDetails>
      </div>

      {confirmingDisconnect ? (
        <ConfirmDialog
          cancelLabel={t("common.cancel")}
          confirmLabel={t("assistant.disconnect")}
          message={t("assistant.disconnectText")}
          onCancel={() => setConfirmingDisconnect(false)}
          onConfirm={() => void disconnect()}
          title={t("assistant.disconnectTitle")}
        />
      ) : null}
    </>
  );
}

/** A capability line. The dash for "cannot" keeps meaning off colour alone. */
function Capability({ allowed = false, label }: { allowed?: boolean; label: string }) {
  return (
    <div className="ip-row" style={{ minHeight: 44 }}>
      <span className="ip-row__icon" style={{ color: allowed ? "var(--ip-ready)" : "var(--ip-faint)" }}>
        {allowed ? <Check aria-hidden="true" size={16} /> : <Minus aria-hidden="true" size={16} />}
      </span>
      <span className="ip-row__body">
        <span className="ip-row__title" style={{ fontWeight: 550 }}>
          {label}
        </span>
      </span>
    </div>
  );
}
