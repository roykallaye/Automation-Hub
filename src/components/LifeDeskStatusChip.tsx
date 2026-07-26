import { invoke } from "@tauri-apps/api/core";
import { CloudOff, Link2, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import { operatorCopy } from "../operatorCopy";

type ConnectionStatus = {
  state: "notConnected" | "pairingIncomplete" | "connected";
  lastSyncAt?: string | null;
};

export function LifeDeskStatusChip({ onOpen }: { onOpen: () => void }) {
  const { language } = useI18n();
  const words = operatorCopy(language);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await invoke<ConnectionStatus>("get_lifedesk_connection");
        if (active) setStatus(next);
      } catch {
        if (active) setStatus({ state: "notConnected" });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const connected = status?.state === "connected";
  return (
    <button
      className={`op-cloud-chip${connected ? " is-connected" : ""}`}
      onClick={onOpen}
      title={connected ? words.shellConnected : words.connectionNotReady}
      type="button"
    >
      {status === null ? (
        <LoaderCircle aria-hidden="true" className="op-spin" size={16} />
      ) : connected ? (
        <Link2 aria-hidden="true" size={16} />
      ) : (
        <CloudOff aria-hidden="true" size={16} />
      )}
      <span>{connected ? words.shellConnected : words.shellLocal}</span>
      <i aria-hidden="true" />
    </button>
  );
}
