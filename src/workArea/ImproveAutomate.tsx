/*
  Improve and Automate.

  Improve is where the product earns its keep. "Digitize this first" and "keep
  this manual" are real answers, not consolation prizes for failing to find an
  automation — so the categories are listed in the order the work actually
  happens, Automate is last, and nothing gives it special visual weight.

  Automate only ever reflects what the backend already decided. A workflow
  reaches candidate status by passing `workflow_automation_gate`; this file
  cannot promote anything, and a proposed future workflow can never justify
  itself.
*/

import { Lightbulb, Sparkles } from "lucide-react";

import { Button, Card, EmptyState, Note, Status } from "../components/ui";
import { useI18n } from "../i18n";
import { Attributes, Block, KeepManualBadge, Prerequisites, StillUnclear } from "./components";
import {
  CAPABILITY_LABEL,
  CATEGORY_LABEL,
  CATEGORY_TEXT,
  IMPROVEMENT_ORDER,
  isAutomationTopic,
  PRODUCT_GAP_LABEL,
  READINESS_LABEL,
  READINESS_TEXT,
  READINESS_TONE,
} from "./vocabulary";
import type { ImprovementPlan, Opportunity, WorkAreaContext } from "./types";

/* ----------------------------------------------------------------- improve */

export function ImproveStage({
  context,
  onBackToUnderstand,
  plan,
}: {
  context: WorkAreaContext;
  onBackToUnderstand: () => void;
  plan: ImprovementPlan | null;
}) {
  const { t } = useI18n();

  if (!plan) {
    return (
      <Card>
        <EmptyState
          action={
            <Button onClick={onBackToUnderstand} variant="primary">
              {t("workArea.improve.continueUnderstanding")}
            </Button>
          }
          icon={Lightbulb}
          message={
            context.map.readiness.ready
              ? t("workArea.improve.readyButNoPlanText")
              : t("workArea.improve.notYetText")
          }
          title={t("workArea.improve.notYetTitle")}
        />
      </Card>
    );
  }

  const grouped = IMPROVEMENT_ORDER.map((category) => ({
    category,
    items: plan.opportunities.filter((opportunity) => opportunity.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="ip-stack">
      {plan.stale ? <StalePlanNote /> : null}

      {grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={Lightbulb}
            level={2}
            message={t("workArea.improve.emptyPlanText")}
            title={t("workArea.improve.emptyPlanTitle")}
          />
        </Card>
      ) : (
        grouped.map((group) => (
          <Block
            description={t(CATEGORY_TEXT[group.category])}
            key={group.category}
            title={t(CATEGORY_LABEL[group.category])}
          >
            <div className="ip-wa-items">
              {group.items.map((opportunity) => (
                <ImprovementItem key={opportunity.id} opportunity={opportunity} />
              ))}
            </div>
          </Block>
        ))
      )}
    </div>
  );
}

/**
 * One recommendation.
 *
 * Answers what is happening now, what should change, why, and what has to
 * happen first. Benefit is qualitative because the evidence is qualitative:
 * the backend only ever states a magnitude, so the UI must not turn that into
 * a euro figure it cannot support.
 */
export function ImprovementItem({ opportunity }: { opportunity: Opportunity }) {
  const { t } = useI18n();
  return (
    <article className="ip-wa-item">
      <header>
        <h3>{opportunity.title}</h3>
        {opportunity.category === "keep_manual" ? <KeepManualBadge /> : null}
      </header>

      <dl className="ip-wa-item__body">
        <div>
          <dt>{t("workArea.improvement.today")}</dt>
          <dd>{opportunity.currentProblem}</dd>
        </div>
        <div>
          <dt>{t("workArea.improvement.change")}</dt>
          <dd>{opportunity.recommendedChange}</dd>
        </div>
        {opportunity.why ? (
          <div>
            <dt>{t("workArea.improvement.why")}</dt>
            <dd>{opportunity.why}</dd>
          </div>
        ) : null}
      </dl>

      <Attributes
        items={[
          { labelKey: "workArea.improvement.benefit", value: opportunity.expectedBenefit },
          { labelKey: "workArea.improvement.effort", value: opportunity.effort },
          { labelKey: "workArea.improvement.risk", value: opportunity.risk },
        ]}
      />

      <Prerequisites items={opportunity.prerequisites} />
    </article>
  );
}

function StalePlanNote() {
  const { t } = useI18n();
  return <Note tone="attention">{t("workArea.improve.staleText")}</Note>;
}

/* ---------------------------------------------------------------- automate */

export function AutomateStage({
  context,
  onOpenImprove,
  plan,
}: {
  context: WorkAreaContext;
  onOpenImprove: () => void;
  plan: ImprovementPlan | null;
}) {
  const { t } = useI18n();

  if (!plan) {
    return (
      <Card>
        <EmptyState
          action={
            <Button onClick={onOpenImprove} variant="secondary">
              {t("workArea.automate.seeImprovements")}
            </Button>
          }
          icon={Sparkles}
          message={
            context.map.readiness.ready
              ? t("workArea.automate.noPlanYetText")
              : t("workArea.automate.understandFirstText")
          }
          title={t("workArea.automate.notYetTitle")}
        />
      </Card>
    );
  }

  const topics = plan.opportunities.filter((opportunity) =>
    isAutomationTopic(opportunity.automationReadiness),
  );
  const keptManual = plan.opportunities.filter(
    (opportunity) => opportunity.automationReadiness === "not_recommended",
  );

  return (
    <div className="ip-stack">
      {plan.stale ? <StalePlanNote /> : null}

      {topics.length === 0 ? (
        <Card>
          <EmptyState
            action={
              <Button onClick={onOpenImprove} variant="secondary">
                {t("workArea.automate.seeImprovements")}
              </Button>
            }
            icon={Sparkles}
            level={2}
            message={
              keptManual.length > 0
                ? t("workArea.automate.noneNeededText")
                : t("workArea.automate.improveFirstText")
            }
            title={
              keptManual.length > 0
                ? t("workArea.automate.noneNeededTitle")
                : t("workArea.automate.improveFirstTitle")
            }
          />
        </Card>
      ) : (
        <Block
          description={t("workArea.automate.worthAutomatingText")}
          title={t("workArea.automate.worthAutomating")}
        >
          <div className="ip-wa-items">
            {topics.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        </Block>
      )}

      {keptManual.length > 0 ? (
        <Block
          description={t("workArea.automate.keepManualText")}
          title={t("workArea.automate.keepManualTitle")}
        >
          <div className="ip-wa-items">
            {keptManual.map((opportunity) => (
              <ImprovementItem key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        </Block>
      ) : null}

      <Note tone="quiet">{t("workArea.automate.planningOnly")}</Note>
    </div>
  );
}

/**
 * One automation topic.
 *
 * There is no Run button, and there is nothing to approve. These are planning
 * findings; turning one into a working automation is a separate, deliberate
 * piece of work that InnPilot does not start from here.
 */
export function OpportunityCard({
  opportunity,
  where,
}: {
  opportunity: Opportunity;
  /** Shown on the Automations page, where opportunities from several areas mix. */
  where?: string;
}) {
  const { t } = useI18n();
  const readiness = opportunity.automationReadiness;

  return (
    <article className="ip-wa-item ip-wa-item--opportunity">
      <header>
        <h3>{opportunity.title}</h3>
        <Status label={t(READINESS_LABEL[readiness])} tone={READINESS_TONE[readiness]} />
      </header>

      {where ? <p className="ip-wa-item__where">{where}</p> : null}

      <p className="ip-wa-item__lead">{t(READINESS_TEXT[readiness])}</p>

      <dl className="ip-wa-item__body">
        <div>
          <dt>{t("workArea.improvement.today")}</dt>
          <dd>{opportunity.currentProblem}</dd>
        </div>
        <div>
          <dt>{t("workArea.improvement.change")}</dt>
          <dd>{opportunity.recommendedChange}</dd>
        </div>
      </dl>

      {/*
        Catalog presence is not compatibility. "May already support" is the
        strongest claim the backend supports, and overstating it here would be a
        commercial promise nothing has verified.
      */}
      {opportunity.capabilityMatch !== "no_match" ? (
        <p className="ip-wa-item__capability">{t(CAPABILITY_LABEL[opportunity.capabilityMatch])}</p>
      ) : null}

      <Attributes
        items={[
          { labelKey: "workArea.improvement.benefit", value: opportunity.expectedBenefit },
          { labelKey: "workArea.improvement.effort", value: opportunity.effort },
          { labelKey: "workArea.improvement.risk", value: opportunity.risk },
        ]}
      />

      <Prerequisites items={opportunity.prerequisites} />

      {opportunity.productGap === "needs_more_information" ? (
        <StillUnclear>{t("workArea.automate.needsMoreInformation")}</StillUnclear>
      ) : null}

      <p className="ip-wa-item__gap">{t(PRODUCT_GAP_LABEL[opportunity.productGap])}</p>
    </article>
  );
}
