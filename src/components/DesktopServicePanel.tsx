import { invoke } from "@tauri-apps/api/core";
import { Power } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import { Button, Card, Note, Row, Rows } from "./ui";
import type { DesktopServiceStatus } from "../types";

export function DesktopServicePanel() {
  const { language, t } = useI18n();
  const [status, setStatus] = useState<DesktopServiceStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setNotice(null);
    invoke<DesktopServiceStatus>("get_desktop_service_status")
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch(() => {
        if (active) setNotice(t("settings.desktopServiceLoadFailed"));
      });
    return () => {
      active = false;
    };
  }, [language]);

  async function toggleStartup() {
    if (!status || !status.changesAvailable || saving) return;
    const enabled = !status.launchAtSignIn;
    setSaving(true);
    setNotice(null);
    try {
      const nextStatus = await invoke<DesktopServiceStatus>("set_desktop_service_enabled", {
        enabled,
        confirmed: true,
      });
      setStatus(nextStatus);
      setNotice(
        t(
          enabled
            ? "settings.desktopServiceEnabledNotice"
            : "settings.desktopServiceDisabledNotice",
        ),
      );
    } catch {
      setNotice(t("settings.desktopServiceSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Rows>
        <Row
          icon={Power}
          meta={t("settings.desktopServiceText")}
          status={
            status
              ? status.launchAtSignIn
                ? { tone: "ready", label: t("settings.desktopServiceEnabled") }
                : { tone: "idle", label: t("settings.desktopServiceDisabled") }
              : { tone: "idle", label: t("common.checking") }
          }
          title={t("settings.desktopServiceTitle")}
          aside={
            <Button
              busy={saving}
              disabled={!status || !status.changesAvailable}
              onClick={toggleStartup}
              variant="secondary"
            >
              {status?.changesAvailable === false
                ? t("settings.desktopServiceInstalledOnly")
                : t(
                    status?.launchAtSignIn
                      ? "settings.desktopServiceDisable"
                      : "settings.desktopServiceEnable",
                  )}
            </Button>
          }
        />
      </Rows>
      {notice ? (
        <div style={{ padding: "0 20px 16px" }}>
          <Note tone="quiet">{notice}</Note>
        </div>
      ) : null}
    </Card>
  );
}
