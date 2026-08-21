/*
  Phase H-A — Work Area persistence and application service.

  Aggregate boundary
  ------------------
  One protected document per Work Area:

      work-areas/<workAreaId>/state.dpapi
      work-areas/<workAreaId>/.area.lock

  Not one company-wide file, and not a forest of tiny per-entity files. The
  reasoning:

    * A Work Area is the unit the manager actually works on and the unit every
      invariant is scoped to (readiness, map revision, plan binding). Making it
      the transactional unit means no operation ever spans two documents, so
      there is nothing to two-phase commit.
    * Every collection inside a record is bounded by the domain constants, so a
      single area cannot grow without limit. MAX_RECORD_BYTES is enforced on
      both read and write.
    * Listing scans the directory and reads each record. With MAX_WORK_AREAS
      capped that is a bounded, cheap operation, and it removes the need for a
      separate index file — which would otherwise be a second source of truth
      that can disagree with the records it describes.

  SQLite was considered and rejected: the runner ledger already justifies its
  own database because it is append-heavy and queried across time, whereas this
  is a small set of independently-locked documents read whole. Adding a second
  database would buy nothing and widen the migration surface.

  Protection reuses the Phase D/F approach exactly: magic prefix, DPAPI to the
  current user, size bound, schema and installation binding, atomic replace.
  Business-process detail is sensitive, so records are protected at rest for the
  same reason grants and approvals are.
*/

// Increment 2 of Phase H-A: persistence and the application service land
// before the Tauri adapters, MCP planning tools and UI that call them.
#![allow(dead_code)]

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::domain::{
    RetryDirective, SafeErrorDetails, WorkspaceError, WorkspaceErrorCategory, WorkspaceErrorCode,
    WorkspaceResource, WorkspaceResult,
};
use crate::runner_identity::{protect_for_current_user, unprotect_for_current_user};
use crate::work_area::{
    record_readiness, validate_and_normalize, AnswerValue, ManagerAnswer, MapReadiness,
    OperationalMap, QuestionStatus, RecordDefect, WorkArea, WorkAreaRecord, WorkAreaState,
    WorkAreaTemplate, MAX_WORK_AREAS, WORK_AREA_SCHEMA,
};

const RECORD_MAGIC: &[u8] = b"INNPILOT-WORKAREA-V1\0";
const MAX_RECORD_BYTES: usize = 512 * 1024;
const MAX_ID_CHARS: usize = 64;
const MAX_RECEIPTS: usize = 32;

/* --------------------------------------------------------------- errors */

fn store_error(diagnostic: impl Into<String>) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::PersistenceFailed,
        WorkspaceErrorCategory::Persistence,
        "InnPilot could not update its local work area records.",
        RetryDirective::Retry,
    )
    .with_diagnostic(diagnostic)
}

fn corrupt_record(defect: RecordDefect) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::CorruptState,
        WorkspaceErrorCategory::Persistence,
        "InnPilot found a damaged work area record and left it untouched.",
        RetryDirective::Recovery,
    )
    .with_diagnostic(format!("work area record defect: {defect:?}"))
}

fn not_found(work_area_id: &str) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::StateMissing,
        WorkspaceErrorCategory::Lifecycle,
        "That work area no longer exists.",
        RetryDirective::Refresh,
    )
    .with_diagnostic(format!("work area not found: {work_area_id}"))
}

fn stale_revision(current: u64) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::StaleRevision,
        WorkspaceErrorCategory::Concurrency,
        "This work area changed while you were working. Refresh and try again.",
        RetryDirective::Refresh,
    )
    .with_details(SafeErrorDetails::Revision {
        resource: WorkspaceResource::Workspace,
        current: current.to_string(),
    })
}

fn invalid_request(summary: &str, field_codes: Vec<String>) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::InvalidRequest,
        WorkspaceErrorCategory::Validation,
        summary.to_string(),
        RetryDirective::UserAction,
    )
    .with_details(SafeErrorDetails::Validation { field_codes })
}

fn conflicting_receipt() -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::PersistenceConflict,
        WorkspaceErrorCategory::Concurrency,
        "That request was already used for different content.",
        RetryDirective::Never,
    )
}

fn busy() -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::OperationBusy,
        WorkspaceErrorCategory::Concurrency,
        "InnPilot is already updating this work area.",
        RetryDirective::Retry,
    )
}

/* ------------------------------------------------------------- repository */

/// Narrow persistence boundary. It exposes Work Area records only — never
/// generic path or file access.
pub(crate) struct WorkAreaRepository {
    root: PathBuf,
    installation_id: String,
}

impl WorkAreaRepository {
    pub(crate) fn new(root: PathBuf, installation_id: String) -> Self {
        Self {
            root,
            installation_id,
        }
    }

    fn area_dir(&self, work_area_id: &str) -> PathBuf {
        self.root.join(work_area_id)
    }

    fn record_path(&self, work_area_id: &str) -> PathBuf {
        self.area_dir(work_area_id).join("state.dpapi")
    }

    /// Exclusive per-area lock. Scoped to one area so mapping Reception never
    /// blocks mapping Administration.
    fn with_area_lock<T>(
        &self,
        work_area_id: &str,
        operation: impl FnOnce() -> WorkspaceResult<T>,
    ) -> WorkspaceResult<T> {
        let dir = self.area_dir(work_area_id);
        fs::create_dir_all(&dir).map_err(|error| store_error(error.to_string()))?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            // Lock file only: never truncate, the contents are never used.
            .truncate(false)
            .open(dir.join(".area.lock"))
            .map_err(|error| store_error(error.to_string()))?;
        lock.try_lock_exclusive().map_err(|_| busy())?;
        let result = operation();
        let _ = FileExt::unlock(&lock);
        result
    }

    pub(crate) fn exists(&self, work_area_id: &str) -> bool {
        self.record_path(work_area_id).is_file()
    }

    /// Read one record, revalidating it rather than trusting the bytes.
    pub(crate) fn load(&self, work_area_id: &str) -> WorkspaceResult<WorkAreaRecord> {
        let path = self.record_path(work_area_id);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Err(not_found(work_area_id))
            }
            Err(error) => return Err(store_error(error.to_string())),
        };
        if bytes.len() > MAX_RECORD_BYTES || !bytes.starts_with(RECORD_MAGIC) {
            return Err(corrupt_record(RecordDefect::OversizedText));
        }
        let clear = unprotect_for_current_user(&bytes[RECORD_MAGIC.len()..])
            .map_err(|_| corrupt_record(RecordDefect::WrongInstallation))?;
        let mut record: WorkAreaRecord = serde_json::from_slice(&clear)
            .map_err(|_| corrupt_record(RecordDefect::UnsupportedSchema))?;
        validate_and_normalize(&mut record, &self.installation_id).map_err(corrupt_record)?;
        if record.area.id != work_area_id {
            return Err(corrupt_record(RecordDefect::DuplicateId));
        }
        Ok(record)
    }

    fn save(&self, record: &WorkAreaRecord) -> WorkspaceResult<()> {
        let clear = serde_json::to_vec(record).map_err(|error| store_error(error.to_string()))?;
        if clear.len() > MAX_RECORD_BYTES {
            return Err(invalid_request(
                "This work area holds more detail than InnPilot can store.",
                vec!["record_size".to_string()],
            ));
        }
        let protected =
            protect_for_current_user(&clear).map_err(|error| store_error(error.to_string()))?;
        let mut bytes = RECORD_MAGIC.to_vec();
        bytes.extend_from_slice(&protected);
        let dir = self.area_dir(&record.area.id);
        fs::create_dir_all(&dir).map_err(|error| store_error(error.to_string()))?;
        crate::config::atomic_replace_configuration_bytes(&dir.join("state.dpapi"), &bytes)
            .map_err(|error| store_error(error.to_string()))
    }

    /// Ids of every stored area. Directory scan: the records are the only
    /// source of truth, so there is no index that can disagree with them.
    pub(crate) fn list_ids(&self) -> WorkspaceResult<Vec<String>> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(store_error(error.to_string())),
        };
        let mut ids = Vec::new();
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let Some(id) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if self.record_path(&id).is_file() {
                ids.push(id);
            }
        }
        ids.sort();
        Ok(ids)
    }
}

/* ----------------------------------------------------------------- service */

/// Summary row for the overview, without loading full maps into the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkAreaSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) template: WorkAreaTemplate,
    pub(crate) state: WorkAreaState,
    pub(crate) revision: u64,
    pub(crate) workflows_mapped: usize,
    pub(crate) open_blocking_questions: usize,
    pub(crate) map_ready: bool,
    pub(crate) plan_stale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateWorkAreaRequest {
    pub(crate) name: String,
    pub(crate) template: WorkAreaTemplate,
    pub(crate) description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SubmitAnswerRequest {
    pub(crate) work_area_id: String,
    pub(crate) question_id: String,
    pub(crate) value: AnswerValue,
    pub(crate) expected_revision: u64,
    pub(crate) request_id: String,
}

/// Typed application service. Every operation expresses product meaning; there
/// is deliberately no generic `update_work_area(json)`.
pub(crate) struct WorkAreaService {
    repository: WorkAreaRepository,
}

impl WorkAreaService {
    pub(crate) fn new(repository: WorkAreaRepository) -> Self {
        Self { repository }
    }

    pub(crate) fn list(&self) -> WorkspaceResult<Vec<WorkAreaSummary>> {
        let mut summaries = Vec::new();
        for id in self.repository.list_ids()? {
            let record = self.repository.load(&id)?;
            let readiness = record_readiness(&record);
            summaries.push(WorkAreaSummary {
                id: record.area.id.clone(),
                name: record.area.name.clone(),
                template: record.area.template,
                state: record.area.state,
                revision: record.revision,
                workflows_mapped: readiness.workflows_mapped,
                open_blocking_questions: readiness.open_blocking_questions,
                map_ready: readiness.ready,
                plan_stale: record
                    .plan
                    .as_ref()
                    .is_some_and(|plan| plan.is_stale(record.map.revision)),
            });
        }
        Ok(summaries)
    }

    pub(crate) fn get(&self, work_area_id: &str) -> WorkspaceResult<WorkAreaRecord> {
        self.repository.load(work_area_id)
    }

    pub(crate) fn readiness(&self, work_area_id: &str) -> WorkspaceResult<MapReadiness> {
        Ok(record_readiness(&self.repository.load(work_area_id)?))
    }

    pub(crate) fn create(
        &self,
        request: CreateWorkAreaRequest,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        let name = request.name.trim().to_string();
        if name.is_empty() {
            return Err(invalid_request(
                "A work area needs a name.",
                vec!["name".to_string()],
            ));
        }
        if self.repository.list_ids()?.len() >= MAX_WORK_AREAS {
            return Err(invalid_request(
                "InnPilot is already tracking as many work areas as it supports.",
                vec!["work_area_count".to_string()],
            ));
        }
        let id = derive_id(&name, now);
        if self.repository.exists(&id) {
            return Err(invalid_request(
                "A work area with that name already exists.",
                vec!["name".to_string()],
            ));
        }
        let record = WorkAreaRecord {
            schema_version: WORK_AREA_SCHEMA,
            installation_id: self.repository.installation_id.clone(),
            revision: 1,
            area: WorkArea {
                id: id.clone(),
                name,
                template: request.template,
                description: request.description,
                scope_included: Vec::new(),
                scope_excluded: Vec::new(),
                state: WorkAreaState::NotStarted,
                created_at: now.to_string(),
                updated_at: now.to_string(),
                archived_at: None,
            },
            questions: Vec::new(),
            answers: Vec::new(),
            map: OperationalMap::default(),
            plan: None,
            receipts: Vec::new(),
        };
        self.repository
            .with_area_lock(&id, || self.repository.save(&record))?;
        Ok(record)
    }

    /// Scope is a mapped fact about the area, so changing it advances the map
    /// revision and makes any existing plan stale.
    pub(crate) fn set_scope(
        &self,
        work_area_id: &str,
        included: Vec<String>,
        excluded: Vec<String>,
        expected_revision: u64,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        self.repository.with_area_lock(work_area_id, || {
            let mut record = self.repository.load(work_area_id)?;
            require_revision(&record, expected_revision)?;
            record.area.scope_included = included;
            record.area.scope_excluded = excluded;
            record.area.updated_at = now.to_string();
            if record.area.state == WorkAreaState::NotStarted {
                record.area.state = WorkAreaState::ScopeDefined;
            }
            record.map.revision += 1;
            record.revision += 1;
            self.repository.save(&record)?;
            Ok(record)
        })
    }

    /// A rename is cosmetic: it must not disturb the map or invalidate a plan.
    pub(crate) fn rename(
        &self,
        work_area_id: &str,
        name: String,
        expected_revision: u64,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(invalid_request(
                "A work area needs a name.",
                vec!["name".to_string()],
            ));
        }
        self.repository.with_area_lock(work_area_id, || {
            let mut record = self.repository.load(work_area_id)?;
            require_revision(&record, expected_revision)?;
            record.area.name = name.clone();
            record.area.updated_at = now.to_string();
            // Deliberately no map.revision bump: nothing about how the area
            // works has changed, so downstream artifacts stay valid.
            record.revision += 1;
            self.repository.save(&record)?;
            Ok(record)
        })
    }

    pub(crate) fn archive(
        &self,
        work_area_id: &str,
        expected_revision: u64,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        self.repository.with_area_lock(work_area_id, || {
            let mut record = self.repository.load(work_area_id)?;
            require_revision(&record, expected_revision)?;
            record.area.state = WorkAreaState::Archived;
            record.area.archived_at = Some(now.to_string());
            record.area.updated_at = now.to_string();
            record.revision += 1;
            self.repository.save(&record)?;
            Ok(record)
        })
    }

    /// Record a manager answer.
    ///
    /// This is the only path by which an answer enters the system, and it is
    /// reachable from local UI authority alone — deliberately never exposed as
    /// an MCP tool. The assistant may prepare a question; only the manager can
    /// resolve one.
    pub(crate) fn submit_manager_answer(
        &self,
        request: SubmitAnswerRequest,
        now: &str,
    ) -> WorkspaceResult<WorkAreaRecord> {
        if request.request_id.trim().is_empty() || request.request_id.chars().count() > MAX_ID_CHARS
        {
            return Err(invalid_request(
                "That request could not be identified.",
                vec!["request_id".to_string()],
            ));
        }
        if !request.value.within_bounds() {
            return Err(invalid_request(
                "That answer is longer than InnPilot can store.",
                vec!["answer".to_string()],
            ));
        }

        let digest = answer_digest(&request);
        self.repository.with_area_lock(&request.work_area_id, || {
            let mut record = self.repository.load(&request.work_area_id)?;

            // Idempotency before CAS: a retry of an already-applied request must
            // succeed rather than fail as stale, because the caller may simply
            // not have seen the first response.
            if let Some(receipt) = record
                .receipts
                .iter()
                .find(|receipt| receipt.request_id == request.request_id)
            {
                if receipt.payload_digest == digest {
                    return Ok(record);
                }
                return Err(conflicting_receipt());
            }

            require_revision(&record, request.expected_revision)?;

            let question = record
                .questions
                .iter()
                .find(|question| question.question_id == request.question_id)
                .cloned()
                .ok_or_else(|| {
                    invalid_request(
                        "That question is no longer part of this work area.",
                        vec!["question_id".to_string()],
                    )
                })?;
            if question.status != QuestionStatus::Open {
                return Err(invalid_request(
                    "That question has already been resolved.",
                    vec!["question_status".to_string()],
                ));
            }
            if !request.value.matches(&question.response_type) {
                return Err(invalid_request(
                    "That answer does not match the question.",
                    vec!["answer_type".to_string()],
                ));
            }

            record.answers.push(ManagerAnswer {
                question_id: request.question_id.clone(),
                value: request.value.clone(),
                answered_at: now.to_string(),
                at_revision: record.revision + 1,
            });
            if let Some(stored) = record
                .questions
                .iter_mut()
                .find(|candidate| candidate.question_id == request.question_id)
            {
                stored.status = QuestionStatus::Answered;
            }

            // A manager answer is a business fact, so the map moves and any
            // plan derived from the previous map becomes stale.
            record.map.revision += 1;
            record.map.confirmed = false;
            record.revision += 1;
            record.area.updated_at = now.to_string();
            record.area.state = next_state_after_answer(&record);

            record.receipts.push(crate::work_area::OperationReceipt {
                request_id: request.request_id.clone(),
                payload_digest: digest.clone(),
                resulting_revision: record.revision,
                recorded_at: now.to_string(),
            });
            if record.receipts.len() > MAX_RECEIPTS {
                let excess = record.receipts.len() - MAX_RECEIPTS;
                record.receipts.drain(0..excess);
            }

            self.repository.save(&record)?;
            Ok(record)
        })
    }
}

/* ------------------------------------------------------------------ helpers */

fn require_revision(record: &WorkAreaRecord, expected: u64) -> WorkspaceResult<()> {
    if record.revision != expected {
        return Err(stale_revision(record.revision));
    }
    Ok(())
}

/// Lifecycle is derived from stored facts, never set by a caller.
fn next_state_after_answer(record: &WorkAreaRecord) -> WorkAreaState {
    if record.area.state == WorkAreaState::Archived {
        return WorkAreaState::Archived;
    }
    let readiness = record_readiness(record);
    if readiness.ready {
        WorkAreaState::MapReady
    } else if readiness.open_blocking_questions > 0 {
        WorkAreaState::NeedsInput
    } else {
        WorkAreaState::Mapping
    }
}

fn answer_digest(request: &SubmitAnswerRequest) -> String {
    let mut hasher = Sha256::new();
    hasher.update(request.work_area_id.as_bytes());
    hasher.update([0]);
    hasher.update(request.question_id.as_bytes());
    hasher.update([0]);
    hasher.update(serde_json::to_vec(&request.value).unwrap_or_default());
    format!("{:x}", hasher.finalize())
}

/// Stable, filesystem-safe id. Collisions are rejected by the caller rather
/// than silently merged.
fn derive_id(name: &str, now: &str) -> String {
    let slug: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    let mut hasher = Sha256::new();
    hasher.update(name.as_bytes());
    hasher.update(now.as_bytes());
    let suffix = format!("{:x}", hasher.finalize());
    let head: String = slug.chars().take(32).collect();
    format!("wa-{head}-{}", &suffix[..8])
}

/* -------------------------------------------------------------------- tests */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_area::{
        ImprovementPlan, MappedFact, Provenance, Question, QuestionCategory, ResponseType,
        StepMedium, TruthStatus, Workflow, WorkflowPhase, WorkflowStep,
    };

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let unique = format!(
                "innpilot-wa-{label}-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let path = std::env::temp_dir().join(unique);
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn service(root: &TempRoot) -> WorkAreaService {
        WorkAreaService::new(WorkAreaRepository::new(
            root.0.clone(),
            "inst-1".to_string(),
        ))
    }

    fn create(service: &WorkAreaService) -> WorkAreaRecord {
        service
            .create(
                CreateWorkAreaRequest {
                    name: "Reception".to_string(),
                    template: WorkAreaTemplate::Reception,
                    description: None,
                },
                "2026-08-21T10:00:00Z",
            )
            .unwrap()
    }

    fn question(id: &str, blocking: bool) -> Question {
        Question {
            question_id: id.to_string(),
            category: QuestionCategory::Workflow,
            prompt: "How do guest requests arrive?".to_string(),
            why_it_matters: None,
            response_type: ResponseType::SingleChoice {
                choices: vec!["Email".to_string(), "Phone".to_string()],
            },
            required: true,
            blocking,
            status: QuestionStatus::Open,
            source: Provenance::AgentInference,
            revision: 1,
        }
    }

    fn seed_question(
        service: &WorkAreaService,
        record: &WorkAreaRecord,
        question: Question,
    ) -> WorkAreaRecord {
        // Questions arrive through the planning service in a later increment;
        // here they are seeded directly through the repository.
        let mut stored = record.clone();
        stored.questions.push(question);
        stored.revision += 1;
        service.repository.save(&stored).unwrap();
        stored
    }

    fn answer(record: &WorkAreaRecord, question_id: &str, request_id: &str) -> SubmitAnswerRequest {
        SubmitAnswerRequest {
            work_area_id: record.area.id.clone(),
            question_id: question_id.to_string(),
            value: AnswerValue::Choice {
                value: "Email".to_string(),
            },
            expected_revision: record.revision,
            request_id: request_id.to_string(),
        }
    }

    /* ---- persistence ---- */

    #[test]
    fn create_then_load_round_trips() {
        let root = TempRoot::new("roundtrip");
        let service = service(&root);
        let created = create(&service);
        let loaded = service.get(&created.area.id).unwrap();
        assert_eq!(loaded, created);
        assert_eq!(loaded.revision, 1);
        assert_eq!(loaded.area.state, WorkAreaState::NotStarted);
    }

    #[test]
    fn records_survive_a_new_service_instance() {
        let root = TempRoot::new("restart");
        let id = {
            let service = service(&root);
            create(&service).area.id
        };
        // A fresh service is the closest unit-level analogue of an app restart.
        let reopened = service(&root);
        assert_eq!(reopened.get(&id).unwrap().area.name, "Reception");
        assert_eq!(reopened.list().unwrap().len(), 1);
    }

    #[test]
    fn missing_work_area_is_not_found() {
        let root = TempRoot::new("missing");
        let error = service(&root).get("wa-nope-00000000").unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::StateMissing);
    }

    #[test]
    fn corrupt_bytes_fail_closed() {
        let root = TempRoot::new("corrupt");
        let service = service(&root);
        let created = create(&service);
        let path = service.repository.record_path(&created.area.id);
        fs::write(&path, b"not an innpilot record").unwrap();
        let error = service.get(&created.area.id).unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::CorruptState);
    }

    #[test]
    fn record_from_another_installation_is_rejected() {
        let root = TempRoot::new("installation");
        let created = create(&service(&root));
        let foreign = WorkAreaService::new(WorkAreaRepository::new(
            root.0.clone(),
            "inst-other".to_string(),
        ));
        let error = foreign.get(&created.area.id).unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::CorruptState);
    }

    #[test]
    fn listing_is_empty_before_anything_is_created() {
        let root = TempRoot::new("empty");
        assert!(service(&root).list().unwrap().is_empty());
    }

    /* ---- CAS ---- */

    #[test]
    fn stale_revision_is_rejected() {
        let root = TempRoot::new("cas");
        let service = service(&root);
        let created = create(&service);
        service
            .set_scope(
                &created.area.id,
                vec!["Front desk".to_string()],
                Vec::new(),
                created.revision,
                "2026-08-21T10:05:00Z",
            )
            .unwrap();
        // Second write still using the original revision.
        let error = service
            .set_scope(
                &created.area.id,
                vec!["Other".to_string()],
                Vec::new(),
                created.revision,
                "2026-08-21T10:06:00Z",
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::StaleRevision);
    }

    #[test]
    fn stale_answer_submission_is_rejected() {
        let root = TempRoot::new("cas-answer");
        let service = service(&root);
        let created = create(&service);
        let seeded = seed_question(&service, &created, question("q1", true));
        let mut request = answer(&seeded, "q1", "req-1");
        request.expected_revision = seeded.revision - 1;
        let error = service
            .submit_manager_answer(request, "2026-08-21T10:07:00Z")
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::StaleRevision);
    }

    /* ---- idempotency ---- */

    #[test]
    fn repeating_the_same_answer_request_returns_the_stored_outcome() {
        let root = TempRoot::new("idempotent");
        let service = service(&root);
        let created = create(&service);
        let seeded = seed_question(&service, &created, question("q1", true));

        let first = service
            .submit_manager_answer(answer(&seeded, "q1", "req-1"), "2026-08-21T10:08:00Z")
            .unwrap();
        // The retry carries the now-stale revision, exactly as a real retry
        // would, and must still succeed.
        let replay = service
            .submit_manager_answer(answer(&seeded, "q1", "req-1"), "2026-08-21T10:09:00Z")
            .unwrap();

        assert_eq!(first.revision, replay.revision);
        assert_eq!(replay.answers.len(), 1);
    }

    #[test]
    fn reusing_a_request_id_for_different_content_is_a_conflict() {
        let root = TempRoot::new("conflict");
        let service = service(&root);
        let created = create(&service);
        let mut seeded = seed_question(&service, &created, question("q1", true));
        seeded = seed_question(&service, &seeded, question("q2", false));

        service
            .submit_manager_answer(answer(&seeded, "q1", "req-1"), "2026-08-21T10:10:00Z")
            .unwrap();
        let mut different = answer(&seeded, "q2", "req-1");
        different.expected_revision = seeded.revision + 1;
        let error = service
            .submit_manager_answer(different, "2026-08-21T10:11:00Z")
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::PersistenceConflict);
    }

    /* ---- manager answer authority and validation ---- */

    #[test]
    fn answer_must_match_the_question_response_type() {
        let root = TempRoot::new("answer-type");
        let service = service(&root);
        let created = create(&service);
        let seeded = seed_question(&service, &created, question("q1", true));
        let mut request = answer(&seeded, "q1", "req-1");
        request.value = AnswerValue::YesNo { value: true };
        let error = service
            .submit_manager_answer(request, "2026-08-21T10:12:00Z")
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn choice_answer_outside_the_offered_choices_is_rejected() {
        let root = TempRoot::new("answer-choice");
        let service = service(&root);
        let created = create(&service);
        let seeded = seed_question(&service, &created, question("q1", true));
        let mut request = answer(&seeded, "q1", "req-1");
        request.value = AnswerValue::Choice {
            value: "Carrier pigeon".to_string(),
        };
        let error = service
            .submit_manager_answer(request, "2026-08-21T10:13:00Z")
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn oversized_answer_is_rejected() {
        let root = TempRoot::new("answer-size");
        let service = service(&root);
        let created = create(&service);
        let mut asked = question("q1", true);
        asked.response_type = ResponseType::ShortText;
        let seeded = seed_question(&service, &created, asked);
        let mut request = answer(&seeded, "q1", "req-1");
        request.value = AnswerValue::Text {
            value: "x".repeat(5_000),
        };
        let error = service
            .submit_manager_answer(request, "2026-08-21T10:14:00Z")
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn answering_an_unknown_question_is_rejected() {
        let root = TempRoot::new("answer-unknown");
        let service = service(&root);
        let created = create(&service);
        let error = service
            .submit_manager_answer(answer(&created, "nope", "req-1"), "2026-08-21T10:15:00Z")
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn a_question_cannot_be_answered_twice() {
        let root = TempRoot::new("answer-twice");
        let service = service(&root);
        let created = create(&service);
        let seeded = seed_question(&service, &created, question("q1", true));
        let applied = service
            .submit_manager_answer(answer(&seeded, "q1", "req-1"), "2026-08-21T10:16:00Z")
            .unwrap();
        let mut second = answer(&applied, "q1", "req-2");
        second.expected_revision = applied.revision;
        let error = service
            .submit_manager_answer(second, "2026-08-21T10:17:00Z")
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn answering_records_manager_provenance_and_advances_the_map() {
        let root = TempRoot::new("answer-provenance");
        let service = service(&root);
        let created = create(&service);
        let seeded = seed_question(&service, &created, question("q1", true));
        let before_map = seeded.map.revision;

        let applied = service
            .submit_manager_answer(answer(&seeded, "q1", "req-1"), "2026-08-21T10:18:00Z")
            .unwrap();

        assert_eq!(applied.answers.len(), 1);
        assert_eq!(applied.answers[0].question_id, "q1");
        assert!(applied.map.revision > before_map);
        assert_eq!(applied.questions[0].status, QuestionStatus::Answered);
    }

    /* ---- staleness ---- */

    fn plan(source_map_revision: u64) -> ImprovementPlan {
        ImprovementPlan {
            revision: 1,
            source_map_revision,
            opportunities: Vec::new(),
            prepared_at: "2026-08-21T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn a_manager_answer_makes_an_existing_plan_stale() {
        let root = TempRoot::new("stale-plan");
        let service = service(&root);
        let created = create(&service);
        let mut seeded = seed_question(&service, &created, question("q1", true));
        seeded.plan = Some(plan(seeded.map.revision));
        seeded.revision += 1;
        service.repository.save(&seeded).unwrap();

        let applied = service
            .submit_manager_answer(answer(&seeded, "q1", "req-1"), "2026-08-21T10:19:00Z")
            .unwrap();

        let stored_plan = applied.plan.expect("plan retained");
        assert!(stored_plan.is_stale(applied.map.revision));
    }

    #[test]
    fn renaming_does_not_invalidate_the_map_or_plan() {
        let root = TempRoot::new("rename");
        let service = service(&root);
        let created = create(&service);
        let mut seeded = created.clone();
        seeded.map.revision = 7;
        seeded.plan = Some(plan(7));
        seeded.revision += 1;
        service.repository.save(&seeded).unwrap();

        let renamed = service
            .rename(
                &seeded.area.id,
                "Front desk".to_string(),
                seeded.revision,
                "2026-08-21T10:20:00Z",
            )
            .unwrap();

        assert_eq!(renamed.area.name, "Front desk");
        assert_eq!(renamed.map.revision, 7);
        assert!(!renamed.plan.unwrap().is_stale(renamed.map.revision));
    }

    #[test]
    fn scope_change_does_invalidate_the_plan() {
        let root = TempRoot::new("scope-stale");
        let service = service(&root);
        let created = create(&service);
        let mut seeded = created.clone();
        seeded.map.revision = 3;
        seeded.plan = Some(plan(3));
        seeded.revision += 1;
        service.repository.save(&seeded).unwrap();

        let scoped = service
            .set_scope(
                &seeded.area.id,
                vec!["Check-in".to_string()],
                Vec::new(),
                seeded.revision,
                "2026-08-21T10:21:00Z",
            )
            .unwrap();

        assert!(scoped.plan.unwrap().is_stale(scoped.map.revision));
        assert_eq!(scoped.area.state, WorkAreaState::ScopeDefined);
    }

    /* ---- readiness persists across load ---- */

    fn complete_workflow() -> Workflow {
        Workflow {
            id: "wf1".to_string(),
            phase: WorkflowPhase::Current,
            name: "Contract processing".to_string(),
            purpose: Some("File signed contracts".to_string()),
            trigger: Some("Contract arrives".to_string()),
            inputs: vec!["Signed PDF".to_string()],
            role_ids: vec!["r1".to_string()],
            system_ids: vec!["s1".to_string()],
            steps: vec![WorkflowStep {
                id: "st1".to_string(),
                description: "Save to folder".to_string(),
                actor_role_id: Some("r1".to_string()),
                system_id: Some("s1".to_string()),
                medium: StepMedium::Digital,
                is_decision: false,
                provenance: Provenance::ManagerAnswer,
            }],
            output: Some("Filed contract".to_string()),
            destination: Some("Contracts".to_string()),
            frequency: None,
            exceptions: vec!["Unsigned".to_string()],
            pain_point_ids: Vec::new(),
            unknowns: Vec::new(),
            current_state_confirmed: true,
            evidence_refs: Vec::new(),
            provenance: Provenance::ManagerAnswer,
        }
    }

    fn settled(id: &str) -> MappedFact {
        MappedFact {
            id: id.to_string(),
            label: id.to_string(),
            detail: None,
            provenance: Provenance::ManagerAnswer,
            status: TruthStatus::Stated,
            evidence_refs: Vec::new(),
        }
    }

    #[test]
    fn readiness_is_recomputed_from_the_stored_record() {
        let root = TempRoot::new("readiness");
        let service = service(&root);
        let created = create(&service);
        let mut seeded = created.clone();
        seeded.area.scope_included = vec!["Front desk".to_string()];
        seeded.map.roles = vec![settled("r1")];
        seeded.map.systems = vec![settled("s1")];
        seeded.map.information_sources = vec![settled("i1")];
        seeded.map.workflows = vec![complete_workflow()];
        seeded.revision += 1;
        service.repository.save(&seeded).unwrap();

        let readiness = service.readiness(&seeded.area.id).unwrap();
        assert!(readiness.ready);
        assert_eq!(readiness.workflows_mapped, 1);

        let summary = &service.list().unwrap()[0];
        assert!(summary.map_ready);
    }

    #[test]
    fn an_inferred_fact_cannot_load_as_confirmed() {
        let root = TempRoot::new("normalize");
        let service = service(&root);
        let created = create(&service);
        let mut seeded = created.clone();
        seeded.map.roles = vec![MappedFact {
            id: "r1".to_string(),
            label: "Receptionist".to_string(),
            detail: None,
            provenance: Provenance::AgentInference,
            status: TruthStatus::Confirmed,
            evidence_refs: Vec::new(),
        }];
        seeded.revision += 1;
        service.repository.save(&seeded).unwrap();

        // Written as confirmed, but normalization on load forces it back.
        let loaded = service.get(&seeded.area.id).unwrap();
        assert_eq!(loaded.map.roles[0].status, TruthStatus::Inferred);
    }

    #[test]
    fn a_plan_ahead_of_its_map_is_treated_as_corrupt() {
        let root = TempRoot::new("plan-ahead");
        let service = service(&root);
        let created = create(&service);
        let mut seeded = created.clone();
        seeded.map.revision = 2;
        seeded.plan = Some(plan(9));
        seeded.revision += 1;
        service.repository.save(&seeded).unwrap();

        let error = service.get(&seeded.area.id).unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::CorruptState);
    }

    /* ---- limits ---- */

    #[test]
    fn work_area_count_is_bounded() {
        let root = TempRoot::new("limit");
        let service = service(&root);
        for index in 0..MAX_WORK_AREAS {
            service
                .create(
                    CreateWorkAreaRequest {
                        name: format!("Area {index}"),
                        template: WorkAreaTemplate::Custom,
                        description: None,
                    },
                    "2026-08-21T10:00:00Z",
                )
                .unwrap();
        }
        let error = service
            .create(
                CreateWorkAreaRequest {
                    name: "One too many".to_string(),
                    template: WorkAreaTemplate::Custom,
                    description: None,
                },
                "2026-08-21T10:00:00Z",
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn an_unnamed_work_area_is_rejected() {
        let root = TempRoot::new("unnamed");
        let error = service(&root)
            .create(
                CreateWorkAreaRequest {
                    name: "   ".to_string(),
                    template: WorkAreaTemplate::Custom,
                    description: None,
                },
                "2026-08-21T10:00:00Z",
            )
            .unwrap_err();
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    /* ---- privacy ---- */

    #[test]
    fn stored_bytes_are_protected_not_plaintext() {
        let root = TempRoot::new("protected");
        let service = service(&root);
        let mut created = create(&service);
        created.area.description = Some("Guest complaint handling".to_string());
        created.revision += 1;
        service.repository.save(&created).unwrap();

        let raw = fs::read(service.repository.record_path(&created.area.id)).unwrap();
        assert!(raw.starts_with(RECORD_MAGIC));
        // On Windows the payload is DPAPI-protected, so the business text must
        // not be readable in the stored bytes.
        if cfg!(windows) {
            let needle = b"Guest complaint handling";
            assert!(
                !raw.windows(needle.len()).any(|window| window == needle),
                "business detail found in plaintext on disk"
            );
        }
    }
}
