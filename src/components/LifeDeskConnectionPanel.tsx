import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  CloudCog,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";

type ConnectionState = "notConnected" | "pairingIncomplete" | "connected";

type RunnerConnectionStatus = {
  state: ConnectionState;
  installationLabel?: string | null;
  keyFingerprintShort?: string | null;
  pairedAt?: string | null;
  lastSyncAt?: string | null;
  protocolVersion: number;
  privateKeyProtection: "windowsCurrentUser";
};

type RunnerSyncResult = {
  connection: RunnerConnectionStatus;
  serverTime: string;
  nextSyncSeconds: number;
  jobAvailable: boolean;
};

export function LifeDeskConnectionPanel() {
  const { language, t } = useI18n();
  const [status, setStatus] = useState<RunnerConnectionStatus | null>(null);
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
      setStatus(await invoke<RunnerConnectionStatus>("get_lifedesk_connection"));
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
      const next = await invoke<RunnerConnectionStatus>("pair_with_lifedesk", {
        pairingCode: pairingCode.trim(),
      });
      setStatus(next);
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
  const locale = language === "it" ? "it-IT" : "en-GB";

  return (
    <section className="overflow-hidden rounded-xl border border-white/70 bg-white/60 shadow-glass backdrop-blur-xl">
      <div className="border-b border-white/70 bg-[linear-gradient(110deg,rgb(var(--brand-50)),rgba(255,255,255,.72))] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-800 text-white shadow-sm">
              <CloudCog className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[.14em] text-brand-800">
                {t("lifedesk.eyebrow")}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">
                {t("lifedesk.title")}
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                {t("lifedesk.description")}
              </p>
            </div>
          </div>
          <span
            className={[
              "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1",
              connected
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-amber-50 text-amber-800 ring-amber-200",
            ].join(" ")}
          >
            {busy === "loading" ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : connected ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {connected ? t("lifedesk.connected") : t("lifedesk.notConnected")}
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.72fr)]">
        <div>
          {connected ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-emerald-950">
                    {status?.installationLabel || t("lifedesk.thisPc")}
                  </p>
                  <p className="mt-1 text-sm font-medium leading-6 text-emerald-900/75">
                    {t("lifedesk.connectedDetail")}
                  </p>
                </div>
              </div>
              <dl className="mt-4 grid gap-2 sm:grid-cols-2">
                <ConnectionDetail
                  label={t("lifedesk.lastContact")}
                  value={formatDate(status?.lastSyncAt, locale, t("lifedesk.notYet"))}
                />
                <ConnectionDetail
                  label={t("lifedesk.deviceIdentity")}
                  value={status?.keyFingerprintShort ? `${status.keyFingerprintShort}…` : "—"}
                  mono
                />
              </dl>
              <button
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-cta px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-cta-soft disabled:opacity-60"
                disabled={Boolean(busy)}
                onClick={() => void sync()}
                type="button"
              >
                {busy === "syncing" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                )}
                {t("lifedesk.syncNow")}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-white/80 bg-white/65 p-4">
              <label className="text-sm font-semibold text-slate-900" htmlFor="lifedesk-pairing-code">
                {t("lifedesk.codeLabel")}
              </label>
              <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
                {t("lifedesk.codeHelp")}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  id="lifedesk-pairing-code"
                  autoCapitalize="none"
                  autoComplete="off"
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 shadow-inner outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-200"
                  onChange={(event) => setPairingCode(event.target.value)}
                  placeholder={t("lifedesk.codePlaceholder")}
                  spellCheck={false}
                  type="password"
                  value={pairingCode}
                />
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cta px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-cta-soft disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!pairingCode.trim() || Boolean(busy)}
                  onClick={() => void pair()}
                  type="button"
                >
                  {busy === "pairing" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t("lifedesk.connect")}
                </button>
              </div>
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                {t("lifedesk.codePrivacy")}
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800 ring-1 ring-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
          {notice && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {notice}
            </p>
          )}
        </div>

        <div className="rounded-xl bg-slate-950 p-4 text-white shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden="true" />
            <p className="font-semibold">{t("lifedesk.securityTitle")}</p>
          </div>
          <ul className="mt-3 space-y-2 text-xs font-medium leading-5 text-slate-300">
            <li>{t("lifedesk.securityKey")}</li>
            <li>{t("lifedesk.securityOutbound")}</li>
            <li>{t("lifedesk.securityData")}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function ConnectionDetail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg bg-white/75 px-3 py-2 ring-1 ring-emerald-100">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-emerald-800/70">{label}</dt>
      <dd className={["mt-0.5 text-sm font-semibold text-emerald-950", mono ? "font-mono" : ""].join(" ")}>
        {value}
      </dd>
    </div>
  );
}

function formatDate(value: string | null | undefined, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

function readError(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error && value.message.trim()) return value.message;
  return fallback;
}
