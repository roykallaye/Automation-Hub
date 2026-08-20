/*
  "How InnPilot works" — the plain-language explanation of the whole product.

  Five steps, very little text, one vertical flow. It also carries the
  InnPilot ↔ LifeDesk explanation, because the two questions ("what does this
  thing do?" and "how does it relate to the other thing?") arrive together.

  The relationship section states the boundary explicitly and describes only
  what is actually implemented today: an outbound, InnPilot-initiated link.
  Nothing here implies LifeDesk can reach into this computer.
*/

import { ArrowUpDown, CloudCog, MonitorCheck } from "lucide-react";

import { Card, PageHead, Section, Status } from "../components/ui";
import { useI18n, type TranslationKey } from "../i18n";
import type { LifeDeskConnectionStatus } from "../types";

const STEPS: { titleKey: TranslationKey; textKey: TranslationKey }[] = [
  { titleKey: "guide.step1", textKey: "guide.step1Text" },
  { titleKey: "guide.step2", textKey: "guide.step2Text" },
  { titleKey: "guide.step3", textKey: "guide.step3Text" },
  { titleKey: "guide.step4", textKey: "guide.step4Text" },
  { titleKey: "guide.step5", textKey: "guide.step5Text" },
];

export function GuidePage({ lifedesk }: { lifedesk: LifeDeskConnectionStatus | null }) {
  const { t } = useI18n();
  const connected = lifedesk?.state === "connected";

  return (
    <>
      <PageHead description={t("guide.description")} title={t("guide.title")} />

      <div className="ip-stack">
        <Card pad>
          <ol className="ip-flow">
            {STEPS.map((step, index) => (
              <li key={step.titleKey}>
                <span aria-hidden="true" className="ip-flow__num">
                  {index + 1}
                </span>
                <span className="ip-flow__title">{t(step.titleKey)}</span>
                <p className="ip-flow__text">{t(step.textKey)}</p>
              </li>
            ))}
          </ol>
        </Card>

        <Section title={t("pair.title")}>
          <Card>
            <div className="ip-relationship">
              <div className="ip-relationship__node">
                <small>{t("pair.innpilotWhere")}</small>
                <strong>
                  <MonitorCheck aria-hidden="true" size={16} />
                  {t("pair.innpilot")}
                </strong>
                <p>{t("pair.innpilotText")}</p>
              </div>

              <div className="ip-relationship__link">
                <ArrowUpDown aria-hidden="true" size={15} />
                {t("pair.link")}
                <span style={{ marginLeft: "auto" }}>
                  <Status
                    label={connected ? t("status.connected") : t("status.notConnected")}
                    tone={connected ? "ready" : "idle"}
                  />
                </span>
              </div>

              <div className="ip-relationship__node">
                <small>{t("pair.lifedeskWhere")}</small>
                <strong>
                  <CloudCog aria-hidden="true" size={16} />
                  {t("pair.lifedesk")}
                </strong>
                <p>{connected ? t("pair.lifedeskText") : t("pair.notConnectedText")}</p>
              </div>
            </div>
          </Card>

          {/* The boundary sentence is the point of this whole section. */}
          <p className="ip-fineprint" style={{ marginTop: 12 }}>
            {t("pair.boundary")}
          </p>
        </Section>
      </div>
    </>
  );
}
