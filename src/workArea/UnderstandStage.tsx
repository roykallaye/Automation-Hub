/*
  Understand — how this area works today.

  Three views, one dominant question each:

    overview   what does InnPilot currently understand?
    map        how does this area appear to work?
    workflow   what happens, step by step?

  Nothing here is a future state. A proposed redesign lives in Improve and is
  labelled as a suggestion wherever it appears; the current-state map never
  borrows from it.
*/

import {
  ArrowLeft,
  Check,
  CircleHelp,
  FileStack,
  Notebook,
  Users,
  Workflow as WorkflowIcon,
  Wrench,
} from "lucide-react";
import { useState } from "react";

import { Button, Card, Note, Rows, TechnicalDetails } from "../components/ui";
import { useI18n, type Translate } from "../i18n";
import {
  Block,
  CoverageRow,
  FactList,
  StillUnclear,
  WorkflowFlow,
} from "./components";
import { GAP_LABEL, MEDIUM_LABEL, workflowStatus } from "./vocabulary";
import type { MappedWorkflow, WorkAreaContext } from "./types";

export type UnderstandView =
  | { kind: "overview" }
  | { kind: "map" }
  | { kind: "workflow"; workflowId: string };

export function UnderstandStage({
  busy = false,
  context,
  onAnswerQuestions,
  onConfirm,
  onView,
  view,
}: {
  busy?: boolean;
  context: WorkAreaContext;
  onAnswerQuestions: () => void;
  /** Manager confirmation. Absent in read-only previews. */
  onConfirm?: (targetId: string) => void;
  onView: (view: UnderstandView) => void;
  view: UnderstandView;
}) {
  const { t } = useI18n();

  if (view.kind === "workflow") {
    const workflow = context.map.workflows.find((entry) => entry.id === view.workflowId);
    if (!workflow) {
      return (
        <Note tone="attention">
          {t("workArea.workflow.gone")}
          <Button onClick={() => onView({ kind: "map" })} variant="ghost">
            {t("common.back")}
          </Button>
        </Note>
      );
    }
    return (
      <WorkflowDetail
        busy={busy}
        onBack={() => onView({ kind: "map" })}
        onConfirm={onConfirm}
        workflow={workflow}
      />
    );
  }

  if (view.kind === "map") {
    return (
      <OperationalMapPanel
        busy={busy}
        context={context}
        onBack={() => onView({ kind: "overview" })}
        onConfirm={onConfirm}
        onOpenWorkflow={onView}
      />
    );
  }

  return (
    <UnderstandOverview
      context={context}
      onAnswerQuestions={onAnswerQuestions}
      onOpenMap={() => onView({ kind: "map" })}
    />
  );
}

/* --------------------------------------------------------------- overview */

function UnderstandOverview({
  context,
  onAnswerQuestions,
  onOpenMap,
}: {
  context: WorkAreaContext;
  onAnswerQuestions: () => void;
  onOpenMap: () => void;
}) {
  const { t } = useI18n();
  const { map } = context;
  const readiness = map.readiness;
  const openQuestions = context.questions.filter((question) => question.status === "open");
  const mapped = map.workflows.filter((workflow) => workflow.phase === "current");

  return (
    <div className="ip-stack">
      <Block
        description={t("workArea.understand.knowsText")}
        title={t("workArea.understand.knowsTitle")}
      >
        <Rows>
          <CoverageRow
            coverage={readiness.roles}
            count={t("workArea.count.known", { count: map.roles.length })}
            icon={Users}
            title={t("workArea.section.people")}
          />
          <CoverageRow
            coverage={readiness.systems}
            count={t("workArea.count.known", { count: map.systems.length })}
            icon={Wrench}
            title={t("workArea.section.tools")}
          />
          <CoverageRow
            coverage={readiness.informationSources}
            count={t("workArea.count.sources", { count: map.informationSources.length })}
            icon={FileStack}
            title={t("workArea.section.information")}
          />
          <CoverageRow
            count={t("workArea.count.items", { count: map.physicalInformation.length })}
            icon={Notebook}
            title={t("workArea.section.manual")}
          />
          <CoverageRow
            count={t("workArea.count.mapped", { count: mapped.length })}
            icon={WorkflowIcon}
            onOpen={mapped.length > 0 ? onOpenMap : undefined}
            openLabel={t("workArea.understand.openMap")}
            title={t("workArea.section.workflows")}
          />
          <CoverageRow
            count={
              openQuestions.length > 0
                ? t("workArea.count.remaining", { count: openQuestions.length })
                : t("workArea.count.none")
            }
            icon={CircleHelp}
            title={t("workArea.section.questions")}
          />
        </Rows>
      </Block>

      {/* One dominant action, chosen from what the backend says is outstanding. */}
      <div className="ip-actions">
        {openQuestions.length > 0 ? (
          <Button onClick={onAnswerQuestions} variant="primary">
            {t("workArea.action.answerQuestionsCount", { count: openQuestions.length })}
          </Button>
        ) : readiness.ready ? (
          <Button onClick={onOpenMap} variant="primary">
            {t("workArea.action.reviewMap")}
          </Button>
        ) : (
          <Button onClick={onOpenMap} variant="secondary">
            {t("workArea.action.seeWhatIsKnown")}
          </Button>
        )}
      </div>

      {!readiness.ready ? (
        <Note tone="quiet">{t("workArea.understand.notReadyYet")}</Note>
      ) : null}

      {map.physicalInformation.length > 0 ? (
        <Block
          description={t("workArea.manual.text")}
          title={t("workArea.manual.title")}
        >
          <FactList empty={t("workArea.manual.none")} facts={map.physicalInformation} />
          <Note tone="quiet">{t("workArea.manual.note")}</Note>
        </Block>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- operational map */

function OperationalMapPanel({
  busy,
  context,
  onBack,
  onConfirm,
  onOpenWorkflow,
}: {
  busy: boolean;
  context: WorkAreaContext;
  onBack: () => void;
  onConfirm?: (targetId: string) => void;
  onOpenWorkflow: (view: UnderstandView) => void;
}) {
  const { t } = useI18n();
  const { map } = context;
  const current = map.workflows.filter((workflow) => workflow.phase === "current");

  return (
    <div className="ip-stack">
      <div>
        <Button icon={ArrowLeft} onClick={onBack} variant="ghost">
          {t("common.back")}
        </Button>
      </div>

      {context.state === "map_needs_review" ? (
        <Note tone="attention">{t("workArea.map.needsAnotherCheck")}</Note>
      ) : null}

      <Block description={t("workArea.map.purposeText")} title={t("workArea.map.purpose")}>
        {context.scopeIncluded.length === 0 ? (
          <p className="ip-wa-empty-line">{t("workArea.map.purposeUnknown")}</p>
        ) : (
          <ul className="ip-wa-plain">
            {context.scopeIncluded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </Block>

      <Block title={t("workArea.section.people")}>
        <FactList
          busy={busy}
          empty={t("workArea.map.noneYet")}
          facts={map.roles}
          onConfirm={onConfirm}
        />
      </Block>

      <Block title={t("workArea.section.tools")}>
        <FactList
          busy={busy}
          empty={t("workArea.map.noneYet")}
          facts={map.systems}
          onConfirm={onConfirm}
        />
      </Block>

      <Block title={t("workArea.section.information")}>
        <FactList
          busy={busy}
          empty={t("workArea.map.noneYet")}
          facts={map.informationSources}
          onConfirm={onConfirm}
        />
        {map.documentTypes.length > 0 ? (
          <>
            <h3 className="ip-wa-subhead">{t("workArea.section.documents")}</h3>
            <FactList empty={t("workArea.map.noneYet")} facts={map.documentTypes} />
            {/* Structure only. InnPilot has not read any document contents. */}
            <Note tone="quiet">{t("workArea.map.structureOnly")}</Note>
          </>
        ) : null}
      </Block>

      <Block description={t("workArea.manual.text")} title={t("workArea.section.manual")}>
        <FactList empty={t("workArea.manual.none")} facts={map.physicalInformation} />
      </Block>

      <Block title={t("workArea.section.workflows")}>
        {current.length === 0 ? (
          <p className="ip-wa-empty-line">{t("workArea.map.noWorkflows")}</p>
        ) : (
          <Rows>
            {current.map((workflow) => {
              const status = workflowStatus(workflow);
              return (
                <button
                  aria-label={`${workflow.name} — ${t("workArea.workflow.open")}`}
                  className="ip-row"
                  key={workflow.id}
                  onClick={() => onOpenWorkflow({ kind: "workflow", workflowId: workflow.id })}
                  type="button"
                >
                  <span className="ip-row__body">
                    <span className="ip-row__title">{workflow.name}</span>
                    <span className="ip-row__meta">{shortFlow(workflow, t)}</span>
                  </span>
                  <span className="ip-row__aside">
                    <span className={`ip-status ip-status--${status.tone}`}>{t(status.label)}</span>
                  </span>
                </button>
              );
            })}
          </Rows>
        )}
      </Block>

      {map.dependencies.length > 0 ? (
        <Block title={t("workArea.section.dependencies")}>
          <FactList empty={t("workArea.map.noneYet")} facts={map.dependencies} />
        </Block>
      ) : null}

      {map.painPoints.length > 0 ? (
        <Block title={t("workArea.section.painPoints")}>
          <FactList empty={t("workArea.map.noneYet")} facts={map.painPoints} />
        </Block>
      ) : null}

      <Block title={t("workArea.section.stillUnclear")}>
        {map.unknowns.length === 0 ? (
          <p className="ip-wa-empty-line">{t("workArea.map.nothingOutstanding")}</p>
        ) : (
          <ul className="ip-wa-plain">
            {map.unknowns.map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}

/**
 * A one-line reading of a workflow: where it starts, who handles it, what comes
 * out. Built only from fields the backend actually filled in.
 */
function shortFlow(workflow: MappedWorkflow, t: Translate) {
  const parts = [workflow.trigger, workflow.steps[0]?.description, workflow.output].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" → ") : t("workArea.workflow.notDescribedYet");
}

/* ------------------------------------------------------- workflow detail */

function WorkflowDetail({
  busy,
  onBack,
  onConfirm,
  workflow,
}: {
  busy: boolean;
  onBack: () => void;
  onConfirm?: (targetId: string) => void;
  workflow: MappedWorkflow;
}) {
  const { t } = useI18n();
  const status = workflowStatus(workflow);
  const manualSteps = workflow.steps.filter((step) => step.medium !== "digital");

  return (
    <div className="ip-stack">
      <div>
        <Button icon={ArrowLeft} onClick={onBack} variant="ghost">
          {t("common.back")}
        </Button>
      </div>

      <Block
        description={workflow.purpose ?? undefined}
        status={{ tone: status.tone, label: t(status.label) }}
        title={workflow.name}
      >
        <WorkflowFlow steps={workflow.steps} title={t("workArea.workflow.today")} />

        {/*
          The one question only the manager can settle. Until it is answered,
          this workflow cannot become an automation candidate, however complete
          the description looks.
        */}
        {onConfirm && workflow.phase === "current" && !workflow.currentStateConfirmed ? (
          <div className="ip-wa-confirm-ask">
            <p>{t("workArea.confirm.workflowAsk")}</p>
            <Button busy={busy} icon={Check} onClick={() => onConfirm(workflow.id)} variant="primary">
              {t("workArea.confirm.workflowAction")}
            </Button>
          </div>
        ) : null}
      </Block>

      {/*
        Missing exception information is not the same as "there are no
        exceptions". The domain treats silence as an unknown, so the UI says
        that plainly instead of leaving a reassuring blank.
      */}
      <Block title={t("workArea.workflow.exceptions")}>
        {workflow.exceptions.length === 0 ? (
          <StillUnclear>{t("workArea.workflow.exceptionsUnknown")}</StillUnclear>
        ) : (
          <ul className="ip-wa-plain">
            {workflow.exceptions.map((exception) => (
              <li key={exception}>{exception}</li>
            ))}
          </ul>
        )}
      </Block>

      {manualSteps.length > 0 ? (
        <Block description={t("workArea.workflow.manualStepsText")} title={t("workArea.workflow.manualSteps")}>
          <ul className="ip-wa-plain">
            {manualSteps.map((step) => (
              <li key={step.id}>
                {step.description}
                <span className="ip-wa-chip">{t(MEDIUM_LABEL[step.medium])}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {workflow.unknowns.length > 0 ? (
        <Block title={t("workArea.section.stillUnclear")}>
          <ul className="ip-wa-plain">
            {workflow.unknowns.map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ul>
        </Block>
      ) : null}

      {/*
        Why this workflow is not yet an automation candidate, in the backend's
        own words. It is a read of `workflow_automation_gate`, not a second
        opinion about it.
      */}
      {workflow.automationGaps.length > 0 ? (
        <Card pad>
          <h3 className="ip-wa-subhead" style={{ marginTop: 0 }}>
            {t("workArea.workflow.beforeAutomation")}
          </h3>
          <ul className="ip-wa-plain">
            {workflow.automationGaps.map((gap) => (
              <li key={gap}>{t(GAP_LABEL[gap])}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <TechnicalDetails label={t("workArea.technicalDetails")}>
        <dl className="ip-detail-list">
          <div>
            <dt>{t("workArea.workflow.trigger")}</dt>
            <dd>{workflow.trigger ?? t("workArea.map.unknownValue")}</dd>
          </div>
          <div>
            <dt>{t("workArea.workflow.inputs")}</dt>
            <dd>{workflow.inputs.join(", ") || t("workArea.map.unknownValue")}</dd>
          </div>
          <div>
            <dt>{t("workArea.workflow.output")}</dt>
            <dd>{workflow.output ?? t("workArea.map.unknownValue")}</dd>
          </div>
          <div>
            <dt>{t("workArea.workflow.destination")}</dt>
            <dd>{workflow.destination ?? t("workArea.map.unknownValue")}</dd>
          </div>
          <div>
            <dt>{t("workArea.workflow.frequency")}</dt>
            <dd>{workflow.frequency ?? t("workArea.map.unknownValue")}</dd>
          </div>
          <div>
            <dt>{t("workArea.workflow.identifier")}</dt>
            <dd className="ip-mono">{workflow.id}</dd>
          </div>
        </dl>
      </TechnicalDetails>
    </div>
  );
}
