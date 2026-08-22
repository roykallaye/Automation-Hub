/*
  Activity — a clean operations timeline.

  Events read as sentences a manager would say out loud ("Invoices completed"),
  not as tool method names or log lines. The raw snippet, report path and log
  path stay available per entry, one disclosure away.
*/

import { Building2, History, RefreshCw } from "lucide-react";

import {
  Button,
  Card,
  DetailList,
  EmptyState,
  IconButton,
  PageHead,
  Row,
  Rows,
  Section,
  TechnicalDetails,
} from "../components/ui";
import { useI18n, type Translate } from "../i18n";
import { activityTone, formatWhen } from "../statusMapping";
import { areaStage, STAGE_LABEL, STAGE_TONE } from "../workArea/vocabulary";
import type { WorkAreaSummary } from "../workArea/types";
import type { ActivityRecord, AppConfigStatus, LatestLog } from "../types";

export function ActivityPage({
  activityHistory,
  configStatus,
  latestLogs,
  onOpenActivityReport,
  onOpenPath,
  onOpenWorkArea,
  onRefresh,
  workAreas,
}: {
  activityHistory: ActivityRecord[];
  configStatus: AppConfigStatus | null;
  latestLogs: LatestLog[];
  onOpenActivityReport: (path?: string | null) => void;
  onOpenPath: (path?: string | null) => void;
  onOpenWorkArea: (workAreaId: string) => void;
  onRefresh: () => void;
  workAreas: WorkAreaSummary[];
}) {
  const { language, t } = useI18n();
  const records = [...activityHistory].reverse();

  return (
    <>
      <PageHead
        actions={<IconButton icon={RefreshCw} label={t("common.refresh")} onClick={onRefresh} />}
        description={t("activity.description")}
        title={t("activity.title")}
      />

      <div className="ip-stack">
        <WorkAreaProgress onOpenWorkArea={onOpenWorkArea} workAreas={workAreas} />

        <Section description={t("activity.runsText")} title={t("activity.runs")}>
          {records.length === 0 ? (
            <Card>
              <EmptyState
                icon={History}
                level={3}
                message={t("activity.emptyText")}
                title={t("activity.emptyTitle")}
              />
            </Card>
          ) : (
            <Card>
              <Rows>
              {records.map((record) => (
                <Row
                  key={record.id}
                  meta={[
                    formatWhen(record.finishedAt, language, t("common.never")),
                    itemsHandled(record, t),
                    record.mode === "dry_run" ? t("activity.safeMode") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  status={{ tone: activityTone(record.status), label: statusWord(record, t) }}
                  title={eventSentence(record, t)}
                />
              ))}
              </Rows>
            </Card>
          )}
        </Section>

        {records.length > 0 ? (
          <TechnicalDetails label={t("activity.technical")}>
            <DetailList
              items={records.slice(0, 12).flatMap((record) => [
                {
                  label: record.workflowTitle,
                  value: [
                    record.workflowCommandName,
                    `${record.startedAt} → ${record.finishedAt}`,
                    `warnings ${record.warningsCount} · errors ${record.errorsCount}`,
                    record.reportPath ?? "",
                    record.logPath ?? "",
                    ...record.technicalSnippet,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                  mono: true,
                },
              ])}
            />
            {latestLogs.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <DetailList
                  items={latestLogs.map((log) => ({
                    label: log.label,
                    value: log.path ?? "—",
                    mono: true,
                  }))}
                />
                <div className="ip-actions" style={{ marginTop: 12 }}>
                  {latestLogs
                    .filter((log) => log.path)
                    .slice(0, 3)
                    .map((log) => (
                      <Button key={log.key} onClick={() => onOpenPath(log.path)} variant="secondary">
                        {log.label}
                      </Button>
                    ))}
                  {records[0]?.reportPath ? (
                    <Button
                      onClick={() => onOpenActivityReport(records[0].reportPath)}
                      variant="secondary"
                    >
                      {t("activity.openReport")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {configStatus ? (
              <div style={{ marginTop: 14 }}>
                <DetailList
                  items={[
                    { label: "Configuration", value: configStatus.configPath, mono: true },
                    { label: "Checked at", value: configStatus.preflight.checkedAt, mono: true },
                  ]}
                />
              </div>
            ) : null}
          </TechnicalDetails>
        ) : null}
      </div>
    </>
  );
}

/*
  Business understanding.

  There is deliberately no event log behind this. Work Area operations write
  idempotency receipts, not activity records, and turning those into a global
  feed would mean storing more than the aggregate needs. So this reports the
  current standing of each area from the same summaries the overview uses.

  Manager answers never appear here. What a manager told InnPilot about their
  business belongs inside the area, not in a timeline that exists to explain
  what the software did.
*/
function WorkAreaProgress({
  onOpenWorkArea,
  workAreas,
}: {
  onOpenWorkArea: (workAreaId: string) => void;
  workAreas: WorkAreaSummary[];
}) {
  const { t } = useI18n();
  const active = workAreas.filter((area) => area.state !== "archived");
  if (active.length === 0) return null;

  return (
    <Section description={t("activity.understandingText")} title={t("activity.understanding")}>
      <Card>
        <Rows>
          {active.map((area) => {
            const stage = areaStage(area);
            return (
              <Row
                icon={Building2}
                key={area.id}
                meta={[
                  area.workflowsMapped > 0
                    ? t("workArea.workflowsMapped", { count: area.workflowsMapped })
                    : null,
                  area.openBlockingQuestions > 0
                    ? t("workArea.questionsRemaining", { count: area.openBlockingQuestions })
                    : null,
                  area.planStale ? t("workArea.planNeedsUpdate") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onOpen={() => onOpenWorkArea(area.id)}
                openLabel={`${area.name} — ${t("workArea.open")}`}
                status={{ tone: STAGE_TONE[stage], label: t(STAGE_LABEL[stage]) }}
                title={area.name}
              />
            );
          })}
        </Rows>
      </Card>
      <p className="ip-fineprint" style={{ marginTop: 10 }}>
        {t("activity.answersPrivate")}
      </p>
    </Section>
  );
}

/** Turns a record into the sentence a manager would use. */
function eventSentence(record: ActivityRecord, t: Translate) {
  const workflow = record.workflowTitle;
  switch (record.status) {
    case "success":
      return t("activity.completed", { workflow });
    case "needs_attention":
      return t("activity.needsAttention", { workflow });
    case "failed":
      return t("activity.failed", { workflow });
    case "cancelled":
      return t("activity.cancelled", { workflow });
    default:
      return t("activity.unknown", { workflow });
  }
}

function statusWord(record: ActivityRecord, t: Translate) {
  switch (record.status) {
    case "success":
      return t("status.ready");
    case "needs_attention":
      return t("status.attention");
    case "failed":
      return t("status.problem");
    default:
      return t("status.checking");
  }
}

function itemsHandled(record: ActivityRecord, t: Translate) {
  const count =
    record.summary.processed ??
    record.summary.created ??
    record.summary.moved ??
    record.summary.found ??
    0;
  return count > 0 ? t("activity.itemsHandled", { count }) : t("activity.noItems");
}
