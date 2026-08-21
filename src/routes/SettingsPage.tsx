/*
  Hotel settings — only what a manager actually owns.

  Identity, language, appearance and connections. Anything that is really
  automation plumbing (delivery mode, safety switches, storage location, email
  templates) sits under "Advanced", so hotel name and theme are not filed next
  to implementation internals.
*/

import { invoke } from "@tauri-apps/api/core";
import { Building2, CloudCog, Bot, Languages } from "lucide-react";
import { useState } from "react";

import { BrandingPanel } from "../components/BrandingPanel";
import { DesktopServicePanel } from "../components/DesktopServicePanel";
import { LifeDeskConnectionPanel } from "../components/LifeDeskConnectionPanel";
import { TemplateEditor } from "../components/TemplateEditor";
import {
  Card,
  Note,
  PageHead,
  Row,
  Rows,
  Section,
  Status,
  TechnicalDetails,
} from "../components/ui";
import { useI18n, type Language } from "../i18n";
import { deliveryModeLabel } from "../messages";
import { assistantHasReachedInnPilot } from "../onboarding/stages";
import type { AppConfigStatus, AppPage, LocalAgentConnectionStatus } from "../types";

export function SettingsPage({
  agent,
  configStatus,
  onNavigate,
  onRefresh,
}: {
  agent: LocalAgentConnectionStatus | null;
  configStatus: AppConfigStatus | null;
  onNavigate: (page: AppPage) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const { language, t } = useI18n();
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const config = configStatus?.config;
  const assistantConnected = assistantHasReachedInnPilot(agent);

  async function saveLanguage(next: Language) {
    if (next === language || savingLanguage) return;
    setSavingLanguage(true);
    setNotice(null);
    try {
      await invoke("save_app_language", { language: next });
      await onRefresh();
      setNotice(t("settings.saved"));
    } catch {
      setNotice(t("settings.languageSaveFailed"));
    } finally {
      setSavingLanguage(false);
    }
  }

  return (
    <>
      <PageHead description={t("settings.description")} title={t("settings.title")} />

      <div className="ip-stack">
        {notice ? <Note tone="ready">{notice}</Note> : null}

        <Section title={t("settings.hotel")}>
          <Card>
            <Rows>
              <Row
                icon={Building2}
                meta={t("settings.hotelNameHint")}
                title={config?.client.displayName || "InnPilot"}
              />
              <Row
                icon={Languages}
                meta={t("settings.languageHint")}
                stackAsideOnMobile
                title={t("settings.language")}
                aside={
                  <div className="ip-actions">
                    {(
                      [
                        ["en", "English"],
                        ["it", "Italiano"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        aria-pressed={language === value}
                        className={`ip-btn ${
                          language === value ? "ip-btn--primary" : "ip-btn--secondary"
                        }`}
                        disabled={savingLanguage}
                        key={value}
                        onClick={() => void saveLanguage(value)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                }
              />
            </Rows>
          </Card>
        </Section>

        <Section title={t("settings.appearance")}>
          <BrandingPanel configStatus={configStatus} onSaved={onRefresh} />
        </Section>

        <Section title={t("settings.connections")}>
          <Card>
            <Rows>
              <Row
                icon={Bot}
                meta={
                  assistantConnected
                    ? t("assistant.connectedText")
                    : t("assistant.notConnectedText")
                }
                onOpen={() => onNavigate("assistant")}
                openLabel={t("assistant.title")}
                status={
                  assistantConnected
                    ? { tone: "ready", label: t("status.connected") }
                    : { tone: "idle", label: t("status.notConnected") }
                }
                title={t("assistant.title")}
              />
            </Rows>
          </Card>
          <div style={{ marginTop: 12 }}>
            <LifeDeskConnectionPanel />
          </div>
        </Section>

        {/* Automation plumbing lives here, not beside the hotel's name. */}
        <Section description={t("settings.advancedHint")} title={t("settings.advanced")}>
          <div className="ip-stack ip-stack--tight">
            <Card>
              <Rows>
                <Row
                  icon={CloudCog}
                  meta={deliveryModeLabel(config?.invoiceDeliveryMode, t)}
                  onOpen={() => onNavigate("system")}
                  openLabel={t("field.invoiceDelivery")}
                  title={t("field.invoiceDelivery")}
                />
                <Row
                  title={t("field.safeMode")}
                  meta={t("field.safeModeMeaning")}
                  aside={
                    <Status
                      label={config?.safety.dryRunDefault ? t("common.on") : t("common.off")}
                      tone={config?.safety.dryRunDefault ? "ready" : "idle"}
                    />
                  }
                />
                <Row
                  title={t("field.redactLogs")}
                  meta={t("field.redactLogsMeaning")}
                  aside={
                    <Status
                      label={config?.safety.redactLogs ? t("common.on") : t("common.off")}
                      tone={config?.safety.redactLogs ? "ready" : "idle"}
                    />
                  }
                />
              </Rows>
            </Card>

            <DesktopServicePanel />
            <TemplateEditor configStatus={configStatus} onSaved={onRefresh} />

            <TechnicalDetails label={t("common.technicalDetails")}>
              <dl className="ip-detail-list">
                <div>
                  <dt>{t("settings.storageLocation")}</dt>
                  <dd className="ip-mono">
                    {configStatus?.configPath ?? t("settings.locationUnavailable")}
                  </dd>
                </div>
                <div>
                  <dt>{t("settings.localDataTitle")}</dt>
                  <dd>{t("settings.localDataText")}</dd>
                </div>
              </dl>
            </TechnicalDetails>
          </div>
        </Section>
      </div>
    </>
  );
}
