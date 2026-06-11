use crate::{redaction::redact_line, workflows::RunSummary};
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const MAX_HISTORY_RECORDS: usize = 100;
const MAX_DETAIL_LINES: usize = 12;
const MAX_DETAIL_CHARS: usize = 240;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ActivityStatus {
    Success,
    NeedsAttention,
    Failed,
    Cancelled,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ActivityMode {
    DryRun,
    Execute,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityRecord {
    pub(crate) id: String,
    pub(crate) workflow_command_name: String,
    pub(crate) workflow_title: String,
    pub(crate) started_at: String,
    pub(crate) finished_at: String,
    pub(crate) status: ActivityStatus,
    pub(crate) mode: ActivityMode,
    pub(crate) summary: BTreeMap<String, u64>,
    pub(crate) warnings_count: usize,
    pub(crate) errors_count: usize,
    pub(crate) warnings: Vec<String>,
    pub(crate) errors: Vec<String>,
    pub(crate) report_path: Option<String>,
    pub(crate) log_path: Option<String>,
    pub(crate) created_at: String,
    pub(crate) technical_snippet: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct StepReport {
    pub(crate) path: PathBuf,
}

pub(crate) fn activity_reports_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = activity_dir(app)?.join("reports");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create activity reports folder: {error}"))?;
    Ok(dir)
}

pub(crate) fn report_path_for_step(
    reports_dir: &Path,
    command_name: &str,
    step_name: &str,
) -> PathBuf {
    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f");
    reports_dir.join(format!(
        "{}_{}_{}.json",
        timestamp,
        safe_file_part(command_name),
        safe_file_part(step_name)
    ))
}

pub(crate) fn append_run_activity(
    app: &AppHandle,
    summary: &RunSummary,
    reports: &[StepReport],
) -> Result<Option<ActivityRecord>, String> {
    let record = activity_from_run(summary, reports)?;
    append_activity_record(&history_path(app)?, &record, MAX_HISTORY_RECORDS)?;
    Ok(Some(record))
}

pub(crate) fn get_activity_history(app: &AppHandle) -> Result<Vec<ActivityRecord>, String> {
    read_activity_history(&history_path(app)?)
}

pub(crate) fn get_activity_detail(
    app: &AppHandle,
    id: &str,
) -> Result<Option<ActivityRecord>, String> {
    Ok(get_activity_history(app)?
        .into_iter()
        .find(|record| record.id == id))
}

pub(crate) fn is_activity_report_path(app: &AppHandle, path: &str) -> Result<bool, String> {
    let reports_dir = activity_reports_dir(app)?;
    let reports_dir = reports_dir
        .canonicalize()
        .map_err(|error| format!("Could not check activity reports folder: {error}"))?;
    let path = Path::new(path);
    if !path.is_file() {
        return Ok(false);
    }
    let path = path
        .canonicalize()
        .map_err(|error| format!("Could not check activity report path: {error}"))?;
    Ok(path.starts_with(reports_dir))
}

fn activity_from_run(
    summary: &RunSummary,
    reports: &[StepReport],
) -> Result<ActivityRecord, String> {
    let parsed_reports = reports
        .iter()
        .filter_map(|report| parse_standard_report(&report.path).transpose())
        .collect::<Result<Vec<_>, String>>()?;

    let status = if parsed_reports.is_empty() {
        status_from_run_summary(summary)
    } else {
        aggregate_status(parsed_reports.iter().map(|report| report.status.clone()))
    };
    let mode = aggregate_mode(parsed_reports.iter().map(|report| report.mode.clone()));
    let mut summary_counts = BTreeMap::new();
    for report in &parsed_reports {
        for (key, value) in &report.summary {
            *summary_counts.entry(key.clone()).or_insert(0) += *value;
        }
    }
    if summary_counts.is_empty() {
        summary_counts.insert("failed".to_string(), u64::from(summary.exit_code != 0));
    }

    let warnings = parsed_reports
        .iter()
        .flat_map(|report| report.warnings.iter())
        .map(|line| sanitize_detail_line(line))
        .take(MAX_DETAIL_LINES)
        .collect::<Vec<_>>();
    let errors = parsed_reports
        .iter()
        .flat_map(|report| report.errors.iter())
        .map(|line| sanitize_detail_line(line))
        .take(MAX_DETAIL_LINES)
        .collect::<Vec<_>>();

    let warnings_count = parsed_reports
        .iter()
        .map(|report| report.warnings_count)
        .sum::<usize>();
    let errors_count = parsed_reports
        .iter()
        .map(|report| report.errors_count)
        .sum::<usize>();
    let report_path = parsed_reports
        .iter()
        .find_map(|report| report.report_path.clone())
        .or_else(|| {
            reports
                .first()
                .map(|report| report.path.to_string_lossy().to_string())
        });
    let log_path = parsed_reports
        .iter()
        .find_map(|report| report.log_path.clone());

    Ok(ActivityRecord {
        id: format!(
            "{}_{}",
            Local::now().timestamp_millis(),
            safe_file_part(&summary.command_name)
        ),
        workflow_command_name: summary.command_name.clone(),
        workflow_title: summary.automation_name.clone(),
        started_at: summary.start_time.clone(),
        finished_at: summary.end_time.clone(),
        status,
        mode,
        summary: summary_counts,
        warnings_count,
        errors_count,
        warnings,
        errors,
        report_path,
        log_path,
        created_at: Local::now().to_rfc3339(),
        technical_snippet: Vec::new(),
    })
}

#[derive(Debug)]
struct ParsedReport {
    status: ActivityStatus,
    mode: ActivityMode,
    summary: BTreeMap<String, u64>,
    warnings_count: usize,
    errors_count: usize,
    warnings: Vec<String>,
    errors: Vec<String>,
    report_path: Option<String>,
    log_path: Option<String>,
}

fn parse_standard_report(path: &Path) -> Result<Option<ParsedReport>, String> {
    if !path.is_file() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read activity report {}: {error}", path.display()))?;
    let value: Value = serde_json::from_str(&contents).map_err(|error| {
        format!(
            "Could not parse activity report {}: {error}",
            path.display()
        )
    })?;

    let summary = value
        .get("summary")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| value.as_u64().map(|count| (key.clone(), count)))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let warnings = string_array(value.get("warnings"));
    let errors = string_array(value.get("errors"));

    Ok(Some(ParsedReport {
        status: status_from_report(value.get("status").and_then(Value::as_str)),
        mode: mode_from_report(value.get("mode").and_then(Value::as_str)),
        summary,
        warnings_count: warnings.len(),
        errors_count: errors.len(),
        warnings,
        errors,
        report_path: value
            .pointer("/outputs/reportPath")
            .and_then(Value::as_str)
            .map(str::to_string),
        log_path: value
            .pointer("/outputs/logPath")
            .and_then(Value::as_str)
            .map(str::to_string),
    }))
}

fn append_activity_record(
    path: &Path,
    record: &ActivityRecord,
    max_records: usize,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create activity folder: {error}"))?;
    }

    let mut records = read_activity_history(path)?;
    records.push(record.clone());
    if records.len() > max_records {
        records = records.split_off(records.len() - max_records);
    }

    let temp_path = path.with_extension("jsonl.tmp");
    {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| format!("Could not write activity history: {error}"))?;
        for record in records {
            let line = serde_json::to_string(&record)
                .map_err(|error| format!("Could not serialize activity history: {error}"))?;
            writeln!(file, "{line}")
                .map_err(|error| format!("Could not write activity history: {error}"))?;
        }
    }
    fs::rename(&temp_path, path)
        .map_err(|error| format!("Could not save activity history: {error}"))?;
    Ok(())
}

fn read_activity_history(path: &Path) -> Result<Vec<ActivityRecord>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read activity history: {error}"))?;
    let mut records = Vec::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(record) = serde_json::from_str::<ActivityRecord>(line) {
            records.push(record);
        }
    }
    Ok(records)
}

fn activity_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?;
    let dir = app_data_dir.join("activity");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create activity folder: {error}"))?;
    Ok(dir)
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(activity_dir(app)?.join("activity_history.jsonl"))
}

fn status_from_run_summary(summary: &RunSummary) -> ActivityStatus {
    match summary.status.as_str() {
        "success" => ActivityStatus::Success,
        "warning" => ActivityStatus::NeedsAttention,
        "error" => ActivityStatus::Failed,
        _ => ActivityStatus::Unknown,
    }
}

fn status_from_report(value: Option<&str>) -> ActivityStatus {
    match value {
        Some("success") => ActivityStatus::Success,
        Some("needs_attention") => ActivityStatus::NeedsAttention,
        Some("failed") => ActivityStatus::Failed,
        Some("cancelled") => ActivityStatus::Cancelled,
        _ => ActivityStatus::Unknown,
    }
}

fn mode_from_report(value: Option<&str>) -> ActivityMode {
    match value {
        Some("dry_run") => ActivityMode::DryRun,
        Some("execute") => ActivityMode::Execute,
        _ => ActivityMode::Unknown,
    }
}

fn aggregate_status(statuses: impl Iterator<Item = ActivityStatus>) -> ActivityStatus {
    let mut result = ActivityStatus::Success;
    for status in statuses {
        match status {
            ActivityStatus::Failed => return ActivityStatus::Failed,
            ActivityStatus::NeedsAttention if result == ActivityStatus::Success => {
                result = ActivityStatus::NeedsAttention;
            }
            ActivityStatus::Unknown if result == ActivityStatus::Success => {
                result = ActivityStatus::Unknown;
            }
            ActivityStatus::Cancelled if result == ActivityStatus::Success => {
                result = ActivityStatus::Cancelled;
            }
            _ => {}
        }
    }
    result
}

fn aggregate_mode(modes: impl Iterator<Item = ActivityMode>) -> ActivityMode {
    let mut result = ActivityMode::Unknown;
    for mode in modes {
        if result == ActivityMode::Unknown {
            result = mode;
        } else if mode != result && mode != ActivityMode::Unknown {
            return ActivityMode::Unknown;
        }
    }
    result
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn sanitize_detail_line(line: &str) -> String {
    let lower = line.to_lowercase();
    if lower.contains("credential")
        || lower.contains("token")
        || lower.contains("client_secret")
        || lower.contains("secret")
    {
        return "[redacted sensitive detail]".to_string();
    }

    let redacted = redact_line(line);
    if redacted.chars().count() > MAX_DETAIL_CHARS {
        redacted.chars().take(MAX_DETAIL_CHARS).collect()
    } else {
        redacted
    }
}

fn safe_file_part(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn append_activity_record_caps_history_size() {
        let path = temp_path("activity_history.jsonl");
        for index in 0..5 {
            let mut record = fake_record(index);
            record.id = format!("record-{index}");
            append_activity_record(&path, &record, 3).unwrap();
        }

        let records = read_activity_history(&path).unwrap();
        assert_eq!(records.len(), 3);
        assert_eq!(records[0].id, "record-2");
        assert_eq!(records[2].id, "record-4");
    }

    #[test]
    fn corrupted_history_lines_are_ignored() {
        let path = temp_path("corrupt_history.jsonl");
        fs::write(
            &path,
            format!(
                "not json\n{}\n",
                serde_json::to_string(&fake_record(1)).unwrap()
            ),
        )
        .unwrap();

        let records = read_activity_history(&path).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, "record-1");
    }

    #[test]
    fn standardized_report_is_parsed_into_safe_summary() {
        let path = temp_path("report.json");
        fs::write(
            &path,
            serde_json::json!({
                "workflow": "gmail_drafts",
                "mode": "dry_run",
                "startedAt": "2026-01-01T10:00:00+01:00",
                "finishedAt": "2026-01-01T10:00:01+01:00",
                "status": "needs_attention",
                "summary": {
                    "found": 2,
                    "planned": 2,
                    "failed": 0,
                    "warnings": 1
                },
                "items": [{"body": "not stored"}],
                "warnings": ["Review [email protected]"],
                "errors": [],
                "outputs": {
                    "reportPath": path.to_string_lossy(),
                    "logPath": "test.log"
                }
            })
            .to_string(),
        )
        .unwrap();

        let parsed = parse_standard_report(&path).unwrap().unwrap();
        assert_eq!(parsed.status, ActivityStatus::NeedsAttention);
        assert_eq!(parsed.mode, ActivityMode::DryRun);
        assert_eq!(parsed.summary["found"], 2);
        assert_eq!(parsed.warnings_count, 1);
    }

    #[test]
    fn activity_record_does_not_store_sensitive_report_details() {
        let path = temp_path("secret_report.json");
        fs::write(
            &path,
            serde_json::json!({
                "workflow": "gmail_drafts",
                "mode": "dry_run",
                "startedAt": "2026-01-01T10:00:00+01:00",
                "finishedAt": "2026-01-01T10:00:01+01:00",
                "status": "failed",
                "summary": {"failed": 1},
                "items": [{"token": "secret-token-value"}],
                "warnings": ["credential secret-token-value"],
                "errors": ["token secret-token-value"],
                "outputs": {"reportPath": path.to_string_lossy(), "logPath": null}
            })
            .to_string(),
        )
        .unwrap();
        let summary = fake_run_summary();
        let activity = activity_from_run(&summary, &[StepReport { path: path.clone() }]).unwrap();
        let stored = serde_json::to_string(&activity).unwrap();

        assert!(!stored.contains("secret-token-value"));
        assert!(!stored.contains("\"items\""));
        assert!(stored.contains("[redacted sensitive detail]"));
    }

    fn fake_record(index: usize) -> ActivityRecord {
        ActivityRecord {
            id: format!("record-{index}"),
            workflow_command_name: "test_command".to_string(),
            workflow_title: "Test Command".to_string(),
            started_at: "2026-01-01T10:00:00+01:00".to_string(),
            finished_at: "2026-01-01T10:00:01+01:00".to_string(),
            status: ActivityStatus::Success,
            mode: ActivityMode::DryRun,
            summary: BTreeMap::new(),
            warnings_count: 0,
            errors_count: 0,
            warnings: Vec::new(),
            errors: Vec::new(),
            report_path: None,
            log_path: None,
            created_at: "2026-01-01T10:00:02+01:00".to_string(),
            technical_snippet: Vec::new(),
        }
    }

    fn fake_run_summary() -> RunSummary {
        RunSummary {
            automation_name: "Gmail Drafts".to_string(),
            command_name: "reconnect_gmail".to_string(),
            start_time: "2026-01-01T10:00:00+01:00".to_string(),
            end_time: "2026-01-01T10:00:01+01:00".to_string(),
            duration_ms: 1000,
            exit_code: 1,
            status: "error".to_string(),
            steps: Vec::new(),
            last_output_lines: vec!["token secret-token-value".to_string()],
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "flowhost_activity_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root.join(name)
    }
}
