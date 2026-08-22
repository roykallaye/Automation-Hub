/*
  Answering InnPilot's questions.

  The assistant may prepare questions. Only the manager, in this window, can
  answer one — there is no MCP tool that could. So this screen is where manager
  truth actually enters the system, and it behaves accordingly:

    - one question at a time, because a wall of inputs invites guessing;
    - the input shape comes from the question's declared response type, not from
      how the prompt is worded, so an assistant cannot influence which control
      appears;
    - nothing is marked answered until the backend says so;
    - only questions the backend still reports as open are answerable, so a
      question superseded by a changed area cannot be answered late.
*/

import { useEffect, useMemo, useState } from "react";

import { Button, Card, Note } from "../components/ui";
import { useI18n } from "../i18n";
import { newRequestId } from "./api";
import type { AnswerValue, WorkAreaContext, WorkAreaQuestion } from "./types";

export function QuestionFlow({
  busy,
  context,
  error,
  onAnswer,
  onDone,
}: {
  busy: boolean;
  context: WorkAreaContext;
  error: string | null;
  onAnswer: (input: {
    questionId: string;
    value: AnswerValue;
    requestId: string;
  }) => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useI18n();

  // Superseded questions are not part of the count: they are no longer things
  // the manager is being asked.
  const relevant = context.questions.filter((question) => question.status !== "superseded");
  const open = relevant.filter((question) => question.status === "open");
  const current = open[0] ?? null;
  const answered = relevant.length - open.length;

  if (!current) {
    return (
      <Card pad>
        <h2 className="ip-wa-question__prompt">{t("workArea.questions.allDoneTitle")}</h2>
        <p className="ip-wa-question__why">{t("workArea.questions.allDoneText")}</p>
        <div className="ip-actions" style={{ marginTop: 16 }}>
          <Button onClick={onDone} variant="primary">
            {t("workArea.questions.backToArea")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <QuestionCard
      busy={busy}
      error={error}
      key={current.questionId}
      onAnswer={onAnswer}
      onSkipToArea={onDone}
      position={answered + 1}
      question={current}
      total={relevant.length}
    />
  );
}

function QuestionCard({
  busy,
  error,
  onAnswer,
  onSkipToArea,
  position,
  question,
  total,
}: {
  busy: boolean;
  error: string | null;
  onAnswer: (input: {
    questionId: string;
    value: AnswerValue;
    requestId: string;
  }) => Promise<void>;
  onSkipToArea: () => void;
  position: number;
  question: WorkAreaQuestion;
  total: number;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());

  // One request id per question. A retry after a failure reuses it, so the
  // backend treats the second attempt as the same operation rather than a new
  // answer, and the manager cannot accidentally record two.
  const requestId = useMemo(() => newRequestId("answer"), [question.questionId]);

  useEffect(() => {
    setDraft(emptyDraft());
  }, [question.questionId]);

  const value = toAnswerValue(question, draft);

  return (
    <Card pad>
      <p className="ip-wa-question__progress">
        {t("workArea.questions.progress", { position, total })}
      </p>
      <h2 className="ip-wa-question__prompt">{question.prompt}</h2>

      {question.whyItMatters ? (
        <p className="ip-wa-question__why">
          <strong>{t("workArea.questions.whyItMatters")}</strong> {question.whyItMatters}
        </p>
      ) : null}

      {error ? <Note tone="problem">{error}</Note> : null}

      <div className="ip-wa-question__input">
        <AnswerInput draft={draft} onChange={setDraft} question={question} />
      </div>

      <div className="ip-actions" style={{ marginTop: 18 }}>
        <Button
          busy={busy}
          disabled={value === null}
          onClick={() => {
            if (value) void onAnswer({ questionId: question.questionId, value, requestId });
          }}
          variant="primary"
        >
          {t("common.continue")}
        </Button>
        <Button onClick={onSkipToArea} variant="ghost">
          {t("workArea.questions.answerLater")}
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ inputs */

type Draft = { choice: string; choices: string[]; text: string; yesNo: boolean | null };

function emptyDraft(): Draft {
  return { choice: "", choices: [], text: "", yesNo: null };
}

/**
 * The control is chosen by the question's response type alone.
 *
 * This is the reason the backend puts `responseType` in the projection: a
 * model-authored prompt cannot conjure a different widget, and whatever this
 * renders is exactly what `AnswerValue::matches` will accept.
 */
function AnswerInput({
  draft,
  onChange,
  question,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  question: WorkAreaQuestion;
}) {
  const { t } = useI18n();
  const response = question.responseType;
  const groupName = `answer-${question.questionId}`;

  switch (response.kind) {
    case "yes_no":
      return (
        <fieldset className="ip-wa-choices ip-wa-choices--stack">
          <legend className="ip-visually-hidden">{question.prompt}</legend>
          {[true, false].map((option) => (
            <label className="ip-wa-choice" key={String(option)}>
              <input
                checked={draft.yesNo === option}
                name={groupName}
                onChange={() => onChange({ ...draft, yesNo: option })}
                type="radio"
              />
              <span>{option ? t("common.yes") : t("common.no")}</span>
            </label>
          ))}
        </fieldset>
      );

    case "single_choice":
      return (
        <fieldset className="ip-wa-choices ip-wa-choices--stack">
          <legend className="ip-visually-hidden">{question.prompt}</legend>
          {response.choices.map((choice) => (
            <label className="ip-wa-choice" key={choice}>
              <input
                checked={draft.choice === choice}
                name={groupName}
                onChange={() => onChange({ ...draft, choice })}
                type="radio"
              />
              <span>{choice}</span>
            </label>
          ))}
        </fieldset>
      );

    case "multiple_choice":
      return (
        <fieldset className="ip-wa-choices ip-wa-choices--stack">
          <legend className="ip-visually-hidden">{question.prompt}</legend>
          {response.choices.map((choice) => (
            <label className="ip-wa-choice" key={choice}>
              <input
                checked={draft.choices.includes(choice)}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    choices: event.target.checked
                      ? [...draft.choices, choice]
                      : draft.choices.filter((entry) => entry !== choice),
                  })
                }
                type="checkbox"
              />
              <span>{choice}</span>
            </label>
          ))}
        </fieldset>
      );

    default:
      return (
        <div className="ip-field">
          <label htmlFor={groupName}>{t(FREE_LABEL[response.kind])}</label>
          <input
            id={groupName}
            inputMode={response.kind === "number" ? "decimal" : undefined}
            maxLength={600}
            onChange={(event) => onChange({ ...draft, text: event.target.value })}
            placeholder={t(FREE_HINT[response.kind])}
            type={response.kind === "number" ? "number" : "text"}
            value={draft.text}
          />
        </div>
      );
  }
}

const FREE_LABEL = {
  short_text: "workArea.questions.yourAnswer",
  number: "workArea.questions.yourAnswer",
  duration: "workArea.questions.howLong",
  frequency: "workArea.questions.howOften",
} as const;

const FREE_HINT = {
  short_text: "workArea.questions.textHint",
  number: "workArea.questions.numberHint",
  duration: "workArea.questions.durationHint",
  frequency: "workArea.questions.frequencyHint",
} as const;

/**
 * Build the typed answer, or null while the draft is not yet a valid answer.
 *
 * Returning null is what disables Continue. The backend re-checks the same
 * pairing, so this is a courtesy, not the guarantee.
 */
function toAnswerValue(question: WorkAreaQuestion, draft: Draft): AnswerValue | null {
  const response = question.responseType;
  switch (response.kind) {
    case "yes_no":
      return draft.yesNo === null ? null : { kind: "yes_no", value: draft.yesNo };
    case "single_choice":
      return draft.choice ? { kind: "choice", value: draft.choice } : null;
    case "multiple_choice":
      return draft.choices.length > 0 ? { kind: "choices", values: draft.choices } : null;
    case "short_text":
      return draft.text.trim() ? { kind: "text", value: draft.text.trim() } : null;
    case "number": {
      const parsed = Number(draft.text);
      return draft.text.trim() && Number.isFinite(parsed)
        ? { kind: "number", value: parsed }
        : null;
    }
    case "duration":
      return draft.text.trim() ? { kind: "duration", value: draft.text.trim() } : null;
    case "frequency":
      return draft.text.trim() ? { kind: "frequency", value: draft.text.trim() } : null;
    default:
      return null;
  }
}
