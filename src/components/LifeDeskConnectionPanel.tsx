import { invoke } from "@tauri-apps/api/core";
import { CloudCog, KeyRound, Lock, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import { formatWhen } from "../statusMapping";
import { Button, Card, DetailList, Note, Row, Rows, TechnicalDetails } from "./ui";
import type { LifeDeskConnectionStatus } from "../types";

type RunnerSyncResult = {
  connection: LifeDeskConnectionStatus;
  serverTime: string;
  nextSyncSeconds: number;
  jobAvailable: boolean;
};

/**
 * The LifeDesk link, described as what it currently is: an outbound connection
 * that InnPilot initiates. LifeDesk cannot reach into this computer, and the
 * copy here must not suggest otherwise.
 */
export function LifeDeskConnectionPanel() {
  const { language, t } = useI18n();
  const [status, setStatus] = useState<LifeDeskConnectionStatus | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [busy, setBusy] = useState<"loading" | "pairing" | "syncing" | null>("loading");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setBusy("loading");
    setError("");
    try {
      setStatus(await invoke<LifeDeskConnectionStatus>("get_lifedesk_connection"));
    } catch {
      setError(t("lifedesk.loadFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function pair() {
    if (!pairingCode.trim() || busy) return;
    setBusy("pairing");
    setError("");
    setNotice("");
    try {
      setStatus(
        await invoke<LifeDeskConnectionStatus>("pair_with_lifedesk", {
          pairingCode: pairingCode.trim(),
        }),
      );
      setPairingCode("");
      setNotice(t("lifedesk.paired"));
    } catch (caught) {
      setError(readError(caught, t("lifedesk.pairFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    if (busy) return;
    setBusy("syncing");
    setError("");
    setNotice("");
    try {
      const result = await invoke<RunnerSyncResult>("sync_with_lifedesk");
      setStatus(result.connection);
      setNotice(t("lifedesk.synced"));
    } catch (caught) {
      setError(readError(caught, t("lifedesk.syncFailed")));
    } finally {
      setBusy(null);
    }
  }

  const connected = status?.state === "connected";

  return (
    <Card>
      <Rows>
        <Row
          icon={CloudCog}
          meta={connected ? t("pair.lifedeskText") : t("pair.notConnectedText")}
          stackAsideOnMobile
          status={
            connected
              ? { tone: "ready", label: t("status.connected") }
              : { tone: "idle", label: t("status.notConnected") }
          }
          title={t("pair.lifedesk")}
          aside={
            connected ? (
              <Button
                busy={busy === "syncing"}
                icon={RefreshCw}
                onClick={() => void sync()}
                variant="secondary"
              >
                {t("pair.syncNow")}
              </Button>
            ) : undefined
          }
        />
        {connected ? (
          <Row
            meta={formatWhen(status?.lastSyncAt, language, t("lifedesk.notYet"))}
            title={t("pair.lastContact", {
              time: formatWhen(status?.lastSyncAt, language, t("lifedesk.notYet")),
            })}
          />
        ) : null}
      </Rows>

      {!connected ? (
        <div style={{ borderTop: "1px solid var(--ip-line)", padding: "16px 20px" }}>
          <label className="ip-field" htmlFor="lifedesk-pairing-code">
            <span className="ip-field__label">{t("lifedesk.codeLabel")}</span>
            <span className="ip-field__hint">{t("lifedesk.codeHelp")}</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
              <input
                autoCapitalize="none"
                autoComplete="off"
                className="ip-input"
                id="lifedesk-pairing-code"
                onChange={(event) => setPairingCode(event.target.value)}
                placeholder={t("lifedesk.codePlaceholder")}
                spellCheck={false}
                style={{ flex: "1 1 220px", width: "auto" }}
                type="password"
                value={pairingCode}
              />
              <Button
                busy={busy === "pairing"}
                disabled={!pairingCode.trim()}
                icon={KeyRound}
                onClick={() => void pair()}
                variant="primary"
              >
                {t("pair.connect")}
              </Button>
            </div>
          </label>
          <p className="ip-fineprint">
            <Lock aria-hidden="true" size={13} />
            {t("lifedesk.codePrivacy")}
          </p>
        </div>
      ) : null}

      {error || notice ? (
        <div style={{ padding: "0 20px 16px" }}>
          {error ? <Note tone="problem">{error}</Note> : null}
          {notice ? <Note tone="ready">{notice}</Note> : null}
        </div>
      ) : null}

      <div style={{ padding: "0 20px 16px" }}>
        <p className="ip-fineprint" style={{ marginTop: 0 }}>
          {t("pair.boundary")}
        </p>
        <TechnicalDetails label={t("common.technicalDetails")}>
          <DetailList
            items={[
              { label: "State", value: status?.state ?? "—" },
              { label: "Installation", value: status?.installationLabel ?? "—" },
              {
                label: "Device identity",
                value: status?.keyFingerprintShort ? `${status.keyFingerprintShort}…` : "—",
                mono: true,
              },
              { label: "Paired at", value: status?.pairedAt ?? "—" },
              { label: "Last sync", value: status?.lastSyncAt ?? "—" },
              { label: "Protocol", value: status ? String(status.protocolVersion) : "—" },
              { label: "Key protection", value: status?.privateKeyProtection ?? "—" },
              { label: "Security", value: t("lifedesk.securityOutbound") },
            ]}
          />
        </TechnicalDetails>
      </div>
    </Card>
  );
}

function readError(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message.trim()) return value.message;
  return fallback;
}
