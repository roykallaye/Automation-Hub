/*
  One work area.

  The header states what this is and where it stands; the stage navigation
  states the sequence — understand it, then improve it, then decide what is
  worth automating. Everything below is a rendering of the stored area. React
  holds no opinion about readiness, staleness or eligibility.
*/

import { ArrowLeft, Archive } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button, DetailList, Note, PageHead, Status, TechnicalDetails } from "../components/ui";
import { useI18n } from "../i18n";
import { StageNav, type WorkAreaStage } from "../workArea/components";
import { AutomateStage, ImproveStage } from "../workArea/ImproveAutomate";
import { QuestionFlow } from "../workArea/QuestionFlow";
import { UnderstandStage, type UnderstandView } from "../workArea/UnderstandStage";
import {
  areaStage,
  openQuestions,
  STAGE_LABEL,
  STAGE_TEXT,
  STAGE_TONE,
  TEMPLATE_LABEL,
} from "../workArea/vocabulary";
import type { AnswerValue, WorkAreaDetail } from "../workArea/types";

export function WorkAreaDetailPage({
  busy,
  detail,
  error,
  evidenceUnavailable = false,
  onAnswer,
  onArchive,
  onBack,
  onOpenAssistant,
  reconnectPrompt,
}: {
  busy: boolean;
  detail: WorkAreaDetail;
  error: string | null;
  /** True when structural evidence this area cites is no longer readable. */
  evidenceUnavailable?: boolean;
  onAnswer: (input: {
    questionId: string;
    value: AnswerValue;
    requestId: string;
  }) => Promise<void>;
  onArchive: () => Promise<void>;
  onBack: () => void;
  onOpenAssistant: () => void;
  reconnectPrompt?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [stage, setStage] = useState<WorkAreaStage>("understand");
  const [understandView, setUnderstandView] = useState<UnderstandView>({ kind: "overview" });
  const [answering, setAnswering] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const { context, plan } = detail;
  const pending = openQuestions(context);
  const mappingStage = areaStage(context);

  // Leaving the question flow when the backend reports nothing left to answer
  // keeps the manager from staring at a screen with no question on it.
  useEffect(() => {
    if (answering && pending.length === 0) setAnswering(false);
  }, [answering, pending.length]);

  if (answering) {
    return (
      <>
        <div style={{ marginBottom: 8 }}>
          <Button icon={ArrowLeft} onClick={() => setAnswering(false)} variant="ghost">
            {t("workArea.questions.backToArea")}
          </Button>
        </div>
        <PageHead description={t("workArea.questions.description")} title={context.name} />
        <QuestionFlow
          busy={busy}
          context={context}
          error={error}
          onAnswer={onAnswer}
          onDone={() => setAnswering(false)}
        />
      </>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Button icon={ArrowLeft} onClick={onBack} variant="ghost">
          {t("workArea.allAreas")}
        </Button>
      </div>

      <PageHead
        actions={
          <Status label={t(STAGE_LABEL[mappingStage])} tone={STAGE_TONE[mappingStage]} />
        }
        description={t("workArea.headerDescription", { name: context.name })}
        title={context.name}
      />

      <div className="ip-stack">
        {error ? <Note tone="problem">{error}</Note> : null}
        {reconnectPrompt}

        {/*
          Evidence revocation is a real condition with a real remedy: the map
          was partly built from folder structure the assistant may no longer
          read. Say so plainly rather than letting the map look current.
        */}
        {evidenceUnavailable ? (
          <Note tone="attention">
            {t("workArea.evidenceUnavailable")}{" "}
            <Button onClick={onOpenAssistant} variant="ghost">
              {t("workArea.reviewFolderAccess")}
            </Button>
          </Note>
        ) : null}

        <p className="ip-wa-stage-state">{t(STAGE_TEXT[mappingStage])}</p>

        <StageNav
          current={stage}
          onSelect={(next) => {
            setStage(next);
            setUnderstandView({ kind: "overview" });
          }}
          unlocked={{
            understand: true,
            // Improve and Automate exist only once the backend produced a plan.
            improve: plan !== null,
            automate: plan !== null,
          }}
        />

        {pending.length > 0 && stage === "understand" ? (
          <Note tone="attention">
            {t("workArea.questionsWaiting", { count: pending.length })}
          </Note>
        ) : null}

        {stage === "understand" ? (
          <UnderstandStage
            context={context}
            onAnswerQuestions={() => setAnswering(true)}
            onView={setUnderstandView}
            view={understandView}
          />
        ) : null}

        {stage === "improve" ? (
          <ImproveStage
            context={context}
            onBackToUnderstand={() => setStage("understand")}
            plan={plan}
          />
        ) : null}

        {stage === "automate" ? (
          <AutomateStage
            context={context}
            onOpenImprove={() => setStage("improve")}
            plan={plan}
          />
        ) : null}

        <TechnicalDetails label={t("workArea.technicalDetails")}>
          <DetailList
            items={[
              { label: t("workArea.detail.identifier"), value: context.id, mono: true },
              { label: t("workArea.detail.type"), value: t(TEMPLATE_LABEL[context.template]) },
              { label: t("workArea.detail.backendState"), value: context.state, mono: true },
              { label: t("workArea.detail.revision"), value: String(context.revision) },
              {
                label: t("workArea.detail.mapRevision"),
                value: String(context.map.mapRevision),
              },
              {
                label: t("workArea.detail.mapPrepared"),
                value: context.map.preparedAt ?? "—",
              },
              {
                label: t("workArea.detail.planRevision"),
                value: plan ? `${plan.revision} (${t("workArea.detail.fromMap")} ${plan.sourceMapRevision})` : "—",
              },
              {
                label: t("workArea.detail.evidence"),
                value: context.linkedEvidence.join(", ") || "—",
                mono: true,
              },
            ]}
          />
          <div className="ip-actions" style={{ marginTop: 14 }}>
            <Button icon={Archive} onClick={() => setConfirmingArchive(true)} variant="secondary">
              {t("workArea.archive")}
            </Button>
          </div>
        </TechnicalDetails>
      </div>

      {confirmingArchive ? (
        <ConfirmDialog
          cancelLabel={t("common.cancel")}
          confirmLabel={t("workArea.archive")}
          message={t("workArea.archiveText")}
          onCancel={() => setConfirmingArchive(false)}
          onConfirm={() => {
            setConfirmingArchive(false);
            void onArchive();
          }}
          title={t("workArea.archiveTitle")}
        />
      ) : null}
    </>
  );
}
