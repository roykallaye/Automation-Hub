/*
  Work areas — the parts of the business InnPilot is learning about.

  This page answers one question: which area do I want to open? Everything
  else, including anything resembling a process schema, lives inside an area.

  The empty state is the first impression of the whole H-A idea, so it says
  what mapping is for and states the boundary once: planning does not touch
  files and does not run automations.
*/

import { Building2, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Note,
  PageHead,
  Row,
  Rows,
} from "../components/ui";
import { useI18n } from "../i18n";
import { PlanningOnlyNote } from "../workArea/components";
import {
  areaStage,
  STAGE_LABEL,
  STAGE_TONE,
  TEMPLATE_LABEL,
  TEMPLATE_ORDER,
} from "../workArea/vocabulary";

import type { CreateWorkAreaCommand, WorkAreaSummary, WorkAreaTemplate } from "../workArea/types";

export function WorkAreasPage({
  areas,
  busy,
  error,
  initialCreating = false,
  loading,
  onCreate,
  onOpen,
  onRefresh,
  reconnectPrompt,
}: {
  areas: WorkAreaSummary[];
  busy: boolean;
  error: string | null;
  /** Opens straight into the create form. Used by the preview harness. */
  initialCreating?: boolean;
  loading: boolean;
  /** Resolves true once the backend has actually stored the new area. */
  onCreate: (command: CreateWorkAreaCommand) => Promise<boolean>;
  onOpen: (workAreaId: string) => void;
  onRefresh: () => void;
  /** Rendered when the assistant connection predates Work Area mapping. */
  reconnectPrompt?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(initialCreating);

  // Archived areas are business history, not current work. They stay on disk.
  const active = areas.filter((area) => area.state !== "archived");

  if (creating) {
    return (
      <CreateWorkArea
        busy={busy}
        error={error}
        onCancel={() => setCreating(false)}
        onCreate={async (command) => {
          // The panel closes only if the backend stored the area, so a rejected
          // name leaves the manager on the form with their input intact.
          if (await onCreate(command)) setCreating(false);
        }}
      />
    );
  }

  return (
    <>
      <PageHead
        actions={
          <>
            <IconButton
              busy={loading}
              icon={RefreshCw}
              label={t("common.refresh")}
              onClick={onRefresh}
            />
            {active.length > 0 ? (
              <Button icon={Plus} onClick={() => setCreating(true)} variant="primary">
                {t("workArea.add")}
              </Button>
            ) : null}
          </>
        }
        description={t("workArea.description")}
        title={t("workArea.title")}
      />

      <div className="ip-stack">
        {error ? <Note tone="problem">{error}</Note> : null}
        {reconnectPrompt}

        {active.length === 0 ? (
          <>
            <Card>
              <EmptyState
                action={
                  <Button icon={Plus} onClick={() => setCreating(true)} variant="primary">
                    {t("workArea.add")}
                  </Button>
                }
                icon={Building2}
                message={t("workArea.emptyText")}
                title={t("workArea.emptyTitle")}
              />
            </Card>
            <PlanningOnlyNote />
          </>
        ) : (
          <>
            <Card>
              <Rows>
                {active.map((area) => (
                  <Row
                    icon={Building2}
                    key={area.id}
                    meta={summaryLine(area, t)}
                    onOpen={() => onOpen(area.id)}
                    openLabel={`${area.name} — ${t("workArea.open")}`}
                    status={{
                      tone: STAGE_TONE[areaStage(area)],
                      label: t(STAGE_LABEL[areaStage(area)]),
                    }}
                    title={area.name}
                  />
                ))}
              </Rows>
            </Card>
            <PlanningOnlyNote />
          </>
        )}
      </div>
    </>
  );
}

/**
 * The one line under an area name.
 *
 * Only ever built from counts the backend computed. Anything that would need a
 * frontend judgement — a score, a completeness percentage — is deliberately
 * absent, because InnPilot cannot honestly produce one.
 */
function summaryLine(area: WorkAreaSummary, t: ReturnType<typeof useI18n>["t"]) {
  const parts: string[] = [];
  if (area.openBlockingQuestions > 0) {
    parts.push(t("workArea.questionsRemaining", { count: area.openBlockingQuestions }));
  }
  if (area.workflowsMapped > 0) {
    parts.push(t("workArea.workflowsMapped", { count: area.workflowsMapped }));
  }
  if (area.planStale) {
    parts.push(t("workArea.planNeedsUpdate"));
  }
  if (parts.length === 0) {
    // A brand new area has no counts yet, and repeating its own type back at
    // the manager tells them nothing.
    parts.push(t("workArea.notMappedYet"));
  }
  return parts.join(" · ");
}

/*
  Adding an area.

  Two questions, both answerable without preparation: which part of the
  business, and what does it mainly handle. Responsibilities become the area's
  scope — the one part of the map the assistant may not infer, because deciding
  what a department is responsible for is a business decision, not a reading of
  the filesystem.
*/
function CreateWorkArea({
  busy,
  error,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onCreate: (command: CreateWorkAreaCommand) => Promise<void>;
}) {
  const { t } = useI18n();
  const [template, setTemplate] = useState<WorkAreaTemplate>("reception");
  const [name, setName] = useState(t("workArea.template.reception"));
  const [responsibilities, setResponsibilities] = useState("");

  function choose(next: WorkAreaTemplate) {
    setTemplate(next);
    // The name stays editable; picking a suggestion just fills it in.
    setName(next === "custom" ? "" : t(TEMPLATE_LABEL[next]));
  }

  async function submit() {
    await onCreate({
      name: name.trim(),
      template,
      description: null,
      responsibilities: responsibilities
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    });
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Button onClick={onCancel} variant="ghost">
          {t("common.back")}
        </Button>
      </div>

      <PageHead description={t("workArea.createDescription")} title={t("workArea.createTitle")} />

      <div className="ip-stack">
        {error ? <Note tone="problem">{error}</Note> : null}

        <Card pad>
          <fieldset className="ip-wa-choices">
            <legend>{t("workArea.createWhich")}</legend>
            {TEMPLATE_ORDER.map((option) => (
              <label className="ip-wa-choice" key={option}>
                <input
                  checked={template === option}
                  name="work-area-template"
                  onChange={() => choose(option)}
                  type="radio"
                  value={option}
                />
                <span>{t(TEMPLATE_LABEL[option])}</span>
              </label>
            ))}
          </fieldset>

          <div className="ip-field" style={{ marginTop: 18 }}>
            <label htmlFor="work-area-name">{t("workArea.createName")}</label>
            <input
              id="work-area-name"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              type="text"
              value={name}
            />
          </div>

          <div className="ip-field" style={{ marginTop: 14 }}>
            <label htmlFor="work-area-responsibilities">{t("workArea.createHandles")}</label>
            <p className="ip-field__hint" id="work-area-responsibilities-hint">
              {t("workArea.createHandlesHint")}
            </p>
            <textarea
              aria-describedby="work-area-responsibilities-hint"
              id="work-area-responsibilities"
              onChange={(event) => setResponsibilities(event.target.value)}
              rows={4}
              value={responsibilities}
            />
          </div>

          <div className="ip-actions" style={{ marginTop: 18 }}>
            <Button
              busy={busy}
              disabled={name.trim().length === 0}
              icon={Plus}
              onClick={() => void submit()}
              variant="primary"
            >
              {t("workArea.add")}
            </Button>
            <Button onClick={onCancel} variant="ghost">
              {t("common.cancel")}
            </Button>
          </div>
        </Card>

        <PlanningOnlyNote />
      </div>
    </>
  );
}
