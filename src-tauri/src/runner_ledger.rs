use crate::{
    domain::{
        RetryDirective, WorkspaceError, WorkspaceErrorCategory, WorkspaceErrorCode, WorkspaceResult,
    },
    platform::InstallationPaths,
};
use fs2::FileExt;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior, MAIN_DB};
use std::{
    fs::{self, File, OpenOptions},
    path::Path,
    time::Duration,
};
use tauri::AppHandle;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LeasedJob {
    pub(crate) job_id: String,
    pub(crate) idempotency_key: String,
    pub(crate) workflow: String,
    pub(crate) mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JobCounters {
    pub(crate) input_count: u32,
    pub(crate) success_count: u32,
    pub(crate) warning_count: u32,
    pub(crate) failure_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PendingTerminalUpdate {
    pub(crate) job_id: String,
    pub(crate) state: String,
    pub(crate) counters: JobCounters,
    pub(crate) error_code: Option<String>,
    pub(crate) summary_code: Option<String>,
}

pub(crate) struct RunnerLedger {
    connection: Connection,
}

impl RunnerLedger {
    pub(crate) fn open(app: &AppHandle) -> Result<Self, String> {
        let paths = InstallationPaths::resolve(app).map_err(|error| error.to_string())?;
        Self::open_at_path(&paths.runner_db).map_err(|error| error.to_string())
    }

    pub(crate) fn open_at_path(path: &Path) -> WorkspaceResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                persistence_error(
                    "InnPilot could not prepare its private runner ledger folder.",
                    format!("runner ledger parent creation failed: {error}"),
                )
            })?;
        }
        let connection = Connection::open(path).map_err(|error| {
            persistence_error(
                "InnPilot could not open its private runner ledger.",
                format!("runner ledger open failed: {error}"),
            )
        })?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| {
                persistence_error(
                    "InnPilot could not configure its private runner ledger.",
                    format!("runner ledger busy-timeout configuration failed: {error}"),
                )
            })?;
        connection
            .execute_batch(
                "
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = FULL;
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS runner_jobs (
                  job_id TEXT PRIMARY KEY,
                  idempotency_key TEXT NOT NULL UNIQUE,
                  workflow TEXT NOT NULL CHECK (
                    workflow IN ('invoices', 'scan_import', 'signed_contracts')
                  ),
                  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'execute')),
                  state TEXT NOT NULL CHECK (
                    state IN ('leased', 'running', 'succeeded', 'attention', 'failed', 'cancelled')
                  ),
                  input_count INTEGER NOT NULL DEFAULT 0 CHECK (input_count >= 0),
                  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
                  warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
                  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
                  error_code TEXT,
                  summary_code TEXT,
                  cloud_reported INTEGER NOT NULL DEFAULT 0 CHECK (cloud_reported IN (0, 1)),
                  created_at TEXT NOT NULL,
                  started_at TEXT,
                  finished_at TEXT
                );
                CREATE INDEX IF NOT EXISTS runner_jobs_pending_report_idx
                  ON runner_jobs (cloud_reported, finished_at)
                  WHERE state IN ('succeeded', 'attention', 'failed', 'cancelled');
                PRAGMA user_version = 1;
                ",
            )
            .map_err(|error| {
                persistence_error(
                    "InnPilot could not initialize its private runner ledger.",
                    format!("runner ledger schema initialization failed: {error}"),
                )
            })?;
        Ok(Self { connection })
    }

    pub(crate) fn record_lease(&mut self, job: &LeasedJob) -> Result<String, String> {
        validate_leased_job(job)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Could not start a runner ledger transaction: {error}"))?;
        transaction
            .execute(
                "
                INSERT INTO runner_jobs (
                  job_id, idempotency_key, workflow, mode, state, created_at
                )
                VALUES (?1, ?2, ?3, ?4, 'leased', ?5)
                ON CONFLICT(job_id) DO NOTHING
                ",
                params![
                    job.job_id,
                    job.idempotency_key,
                    job.workflow,
                    job.mode,
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .map_err(|error| format!("Could not persist the leased runner job: {error}"))?;
        let stored = transaction
            .query_row(
                "
                SELECT idempotency_key, workflow, mode, state
                FROM runner_jobs
                WHERE job_id = ?1
                ",
                [&job.job_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .map_err(|error| format!("Could not verify the leased runner job: {error}"))?;
        if stored.0 != job.idempotency_key || stored.1 != job.workflow || stored.2 != job.mode {
            return Err("The cloud job conflicts with durable local evidence.".to_string());
        }
        transaction
            .commit()
            .map_err(|error| format!("Could not commit the runner job lease: {error}"))?;
        Ok(stored.3)
    }

    pub(crate) fn mark_running(&self, job_id: &str) -> Result<(), String> {
        let changed = self
            .connection
            .execute(
                "
                UPDATE runner_jobs
                SET state = 'running',
                    started_at = COALESCE(started_at, ?2),
                    cloud_reported = 0
                WHERE job_id = ?1 AND state = 'leased'
                ",
                params![job_id, chrono::Utc::now().to_rfc3339()],
            )
            .map_err(|error| format!("Could not mark the runner job as started: {error}"))?;
        if changed == 0 && self.state(job_id)?.as_deref() != Some("running") {
            return Err("The runner job cannot transition to running.".to_string());
        }
        Ok(())
    }

    pub(crate) fn recover_interrupted_jobs(&self) -> Result<usize, String> {
        self.connection
            .execute(
                "
                UPDATE runner_jobs
                SET state = 'attention',
                    warning_count = MAX(warning_count, 1),
                    error_code = 'RUNNER_RESTARTED',
                    summary_code = 'recovery_required',
                    cloud_reported = 0,
                    finished_at = ?1
                WHERE state = 'running'
                ",
                [chrono::Utc::now().to_rfc3339()],
            )
            .map_err(|error| format!("Could not reconcile interrupted runner jobs: {error}"))
    }

    pub(crate) fn mark_terminal(
        &self,
        job_id: &str,
        state: &str,
        counters: &JobCounters,
        error_code: Option<&str>,
        summary_code: Option<&str>,
    ) -> Result<(), String> {
        if !matches!(state, "succeeded" | "attention" | "failed" | "cancelled") {
            return Err("The terminal runner job state is invalid.".to_string());
        }
        validate_counters(counters)?;
        validate_code(error_code, true)?;
        validate_code(summary_code, false)?;
        let changed = self
            .connection
            .execute(
                "
                UPDATE runner_jobs
                SET state = ?2,
                    input_count = ?3,
                    success_count = ?4,
                    warning_count = ?5,
                    failure_count = ?6,
                    error_code = ?7,
                    summary_code = ?8,
                    cloud_reported = 0,
                    finished_at = ?9
                WHERE job_id = ?1
                  AND state IN ('leased', 'running')
                ",
                params![
                    job_id,
                    state,
                    counters.input_count,
                    counters.success_count,
                    counters.warning_count,
                    counters.failure_count,
                    error_code,
                    summary_code,
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .map_err(|error| format!("Could not finish the runner job in the ledger: {error}"))?;
        if changed == 0 {
            let current = self.state(job_id)?;
            if current.as_deref() != Some(state) {
                return Err("The runner job cannot transition to its final state.".to_string());
            }
        }
        Ok(())
    }

    pub(crate) fn pending_terminal_update(&self) -> Result<Option<PendingTerminalUpdate>, String> {
        self.connection
            .query_row(
                "
                SELECT
                  job_id, state, input_count, success_count, warning_count,
                  failure_count, error_code, summary_code
                FROM runner_jobs
                WHERE cloud_reported = 0
                  AND state IN ('succeeded', 'attention', 'failed', 'cancelled')
                ORDER BY finished_at
                LIMIT 1
                ",
                [],
                |row| {
                    Ok(PendingTerminalUpdate {
                        job_id: row.get(0)?,
                        state: row.get(1)?,
                        counters: JobCounters {
                            input_count: row.get(2)?,
                            success_count: row.get(3)?,
                            warning_count: row.get(4)?,
                            failure_count: row.get(5)?,
                        },
                        error_code: row.get(6)?,
                        summary_code: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Could not read pending runner evidence: {error}"))
    }

    pub(crate) fn mark_cloud_reported(&self, job_id: &str) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE runner_jobs SET cloud_reported = 1 WHERE job_id = ?1",
                [job_id],
            )
            .map_err(|error| format!("Could not mark runner evidence as synchronized: {error}"))?;
        Ok(())
    }

    pub(crate) fn state(&self, job_id: &str) -> Result<Option<String>, String> {
        self.connection
            .query_row(
                "SELECT state FROM runner_jobs WHERE job_id = ?1",
                [job_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Could not read the runner job state: {error}"))
    }
}

pub(crate) struct ProcessLock {
    file: File,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProcessLockKind {
    Workflow,
    Service,
}

impl ProcessLockKind {
    fn file_stem(self) -> &'static str {
        match self {
            Self::Workflow => "workflow",
            Self::Service => "service",
        }
    }
}

impl ProcessLock {
    pub(crate) fn try_acquire(app: &AppHandle, name: &str) -> Result<Option<Self>, String> {
        let paths = InstallationPaths::resolve(app).map_err(|error| error.to_string())?;
        Self::try_acquire_named_at(&paths.runner_root, name).map_err(|error| error.to_string())
    }

    pub(crate) fn try_acquire_at(
        runner_root: &Path,
        kind: ProcessLockKind,
    ) -> WorkspaceResult<Option<Self>> {
        Self::try_acquire_named_at(runner_root, kind.file_stem())
    }

    /// Transitional path-based wrapper for existing application services.
    /// New typed callers should prefer `try_acquire_at` with `ProcessLockKind`.
    pub(crate) fn try_acquire_in_directory(
        runner_root: &Path,
        name: &str,
    ) -> Result<Option<Self>, String> {
        Self::try_acquire_named_at(runner_root, name).map_err(|error| error.to_string())
    }

    fn try_acquire_named_at(runner_root: &Path, name: &str) -> WorkspaceResult<Option<Self>> {
        if !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return Err(WorkspaceError::new(
                WorkspaceErrorCode::InvalidRequest,
                WorkspaceErrorCategory::Validation,
                "The runner coordination lock is invalid.",
                RetryDirective::Never,
            ));
        }
        fs::create_dir_all(runner_root).map_err(|error| {
            persistence_error(
                "InnPilot could not prepare local operation coordination.",
                format!("runner lock directory creation failed: {error}"),
            )
        })?;
        let path = runner_root.join(format!("{name}.lock"));
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|error| {
                persistence_error(
                    "InnPilot could not open local operation coordination.",
                    format!("runner lock open failed: {error}"),
                )
            })?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(Self { file })),
            Err(error) if is_lock_contention(&error) => Ok(None),
            Err(error) => Err(persistence_error(
                "InnPilot could not coordinate the local operation.",
                format!("runner lock acquisition failed: {error}"),
            )),
        }
    }
}

fn is_lock_contention(error: &std::io::Error) -> bool {
    if error.kind() == std::io::ErrorKind::WouldBlock {
        return true;
    }
    #[cfg(windows)]
    {
        // `LockFileEx` reports sharing/lock violations as raw Windows errors
        // rather than consistently mapping them to `WouldBlock`.
        matches!(error.raw_os_error(), Some(32 | 33))
    }
    #[cfg(not(windows))]
    {
        false
    }
}

impl Drop for ProcessLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}
pub(crate) fn backup_database(app: &AppHandle, destination: &Path) -> Result<(), String> {
    let paths = InstallationPaths::resolve(app).map_err(|error| error.to_string())?;
    backup_database_at(&paths.runner_db, destination).map_err(|error| error.to_string())
}

pub(crate) fn backup_database_at(database_path: &Path, destination: &Path) -> WorkspaceResult<()> {
    let ledger = RunnerLedger::open_at_path(database_path)?;
    backup_connection(&ledger.connection, destination)
}

fn backup_connection(source: &Connection, destination: &Path) -> WorkspaceResult<()> {
    if destination.exists() {
        return Err(WorkspaceError::new(
            WorkspaceErrorCode::PersistenceConflict,
            WorkspaceErrorCategory::Persistence,
            "InnPilot will not overwrite an existing runner-ledger recovery copy.",
            RetryDirective::UserAction,
        ));
    }
    source.backup(MAIN_DB, destination, None).map_err(|error| {
        WorkspaceError::new(
            WorkspaceErrorCode::RecoveryFailed,
            WorkspaceErrorCategory::Recovery,
            "InnPilot could not create the runner-ledger recovery copy.",
            RetryDirective::Retry,
        )
        .with_diagnostic(format!("online runner ledger backup failed: {error}"))
    })?;
    let verification = Connection::open(destination).map_err(|error| {
        WorkspaceError::new(
            WorkspaceErrorCode::RecoveryIntegrityFailed,
            WorkspaceErrorCategory::Recovery,
            "InnPilot could not verify the runner-ledger recovery copy.",
            RetryDirective::Retry,
        )
        .with_diagnostic(format!(
            "runner ledger backup verification open failed: {error}"
        ))
    })?;
    let integrity: String = verification
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| {
            WorkspaceError::new(
                WorkspaceErrorCode::RecoveryIntegrityFailed,
                WorkspaceErrorCategory::Recovery,
                "InnPilot could not verify the runner-ledger recovery copy.",
                RetryDirective::Retry,
            )
            .with_diagnostic(format!("runner ledger backup quick-check failed: {error}"))
        })?;
    if integrity != "ok" {
        let _ = fs::remove_file(destination);
        return Err(WorkspaceError::new(
            WorkspaceErrorCode::RecoveryIntegrityFailed,
            WorkspaceErrorCategory::Recovery,
            "The runner-ledger recovery copy failed its integrity check.",
            RetryDirective::Retry,
        )
        .with_diagnostic(format!(
            "runner ledger backup quick-check returned {integrity}"
        )));
    }
    Ok(())
}

fn persistence_error(summary: &str, diagnostic: String) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::PersistenceFailed,
        WorkspaceErrorCategory::Persistence,
        summary,
        RetryDirective::Retry,
    )
    .with_diagnostic(diagnostic)
}

fn validate_leased_job(job: &LeasedJob) -> Result<(), String> {
    if !is_uuid(&job.job_id)
        || !is_uuid(&job.idempotency_key)
        || !matches!(
            job.workflow.as_str(),
            "invoices" | "scan_import" | "signed_contracts"
        )
        || !matches!(job.mode.as_str(), "dry_run" | "execute")
    {
        return Err("The leased cloud job is invalid.".to_string());
    }
    Ok(())
}

fn validate_counters(counters: &JobCounters) -> Result<(), String> {
    if [
        counters.input_count,
        counters.success_count,
        counters.warning_count,
        counters.failure_count,
    ]
    .into_iter()
    .any(|count| count > 1_000_000)
    {
        return Err("The runner counters exceed the allowed range.".to_string());
    }
    Ok(())
}

fn validate_code(value: Option<&str>, uppercase: bool) -> Result<(), String> {
    if let Some(value) = value {
        if value.is_empty()
            || value.len() > 80
            || !value.chars().all(|character| {
                character.is_ascii_digit()
                    || character == '_'
                    || if uppercase {
                        character.is_ascii_uppercase()
                    } else {
                        character.is_ascii_lowercase()
                    }
            })
        {
            return Err("The runner result code is invalid.".to_string());
        }
    }
    Ok(())
}

fn is_uuid(value: &str) -> bool {
    let expected_hyphens = [8, 13, 18, 23];
    value.len() == 36
        && value.chars().enumerate().all(|(index, character)| {
            if expected_hyphens.contains(&index) {
                character == '-'
            } else {
                character.is_ascii_hexdigit()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn ledger() -> (RunnerLedger, PathBuf) {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("innpilot-ledger-{stamp}"));
        fs::create_dir_all(&root).unwrap();
        (
            RunnerLedger::open_at_path(&root.join("runner.db")).unwrap(),
            root,
        )
    }

    fn fake_job() -> LeasedJob {
        LeasedJob {
            job_id: "123e4567-e89b-12d3-a456-426614174000".to_string(),
            idempotency_key: "123e4567-e89b-12d3-a456-426614174001".to_string(),
            workflow: "invoices".to_string(),
            mode: "dry_run".to_string(),
        }
    }

    #[test]
    fn duplicate_lease_is_idempotent_but_conflicts_fail_closed() {
        let (mut ledger, root) = ledger();
        let job = fake_job();
        assert_eq!(ledger.record_lease(&job).unwrap(), "leased");
        assert_eq!(ledger.record_lease(&job).unwrap(), "leased");
        let mut conflicting = job.clone();
        conflicting.workflow = "scan_import".to_string();
        assert!(ledger.record_lease(&conflicting).is_err());
        drop(ledger);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn terminal_result_remains_pending_until_cloud_acknowledges_it() {
        let (mut ledger, root) = ledger();
        let job = fake_job();
        ledger.record_lease(&job).unwrap();
        ledger.mark_running(&job.job_id).unwrap();
        let counters = JobCounters {
            input_count: 3,
            success_count: 2,
            warning_count: 1,
            failure_count: 0,
        };
        ledger
            .mark_terminal(
                &job.job_id,
                "attention",
                &counters,
                None,
                Some("completed_with_warnings"),
            )
            .unwrap();
        assert_eq!(
            ledger.pending_terminal_update().unwrap().unwrap().counters,
            counters
        );
        ledger.mark_cloud_reported(&job.job_id).unwrap();
        assert!(ledger.pending_terminal_update().unwrap().is_none());
        drop(ledger);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_running_job_is_recovered_without_reexecution() {
        let (mut ledger, root) = ledger();
        let job = fake_job();
        ledger.record_lease(&job).unwrap();
        ledger.mark_running(&job.job_id).unwrap();
        assert_eq!(ledger.recover_interrupted_jobs().unwrap(), 1);
        let pending = ledger.pending_terminal_update().unwrap().unwrap();
        assert_eq!(pending.job_id, job.job_id);
        assert_eq!(pending.state, "attention");
        assert_eq!(pending.error_code.as_deref(), Some("RUNNER_RESTARTED"));
        assert_eq!(pending.summary_code.as_deref(), Some("recovery_required"));
        assert_eq!(ledger.recover_interrupted_jobs().unwrap(), 0);
        drop(ledger);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn execute_mode_is_recorded_but_never_implied_by_dry_run() {
        let (mut ledger, root) = ledger();
        let mut job = fake_job();
        job.mode = "execute".to_string();
        assert_eq!(ledger.record_lease(&job).unwrap(), "leased");
        drop(ledger);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn online_backup_is_consistent_and_never_overwrites_an_existing_target() {
        let (mut ledger, root) = ledger();
        ledger.record_lease(&fake_job()).unwrap();
        let backup = root.join("backup.db");

        backup_connection(&ledger.connection, &backup).unwrap();
        let copy = Connection::open(&backup).unwrap();
        let count: i64 = copy
            .query_row("SELECT COUNT(*) FROM runner_jobs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert!(backup_connection(&ledger.connection, &backup).is_err());

        drop(copy);
        drop(ledger);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn path_based_open_prepares_only_the_ledger_parent() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("innpilot-ledger-path-{stamp}"));
        let database = root.join("runner").join("runner.db");

        let ledger = RunnerLedger::open_at_path(&database).unwrap();
        assert!(database.is_file());

        drop(ledger);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn typed_process_locks_are_path_based_and_exclusive() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("innpilot-runner-lock-{stamp}"));

        let workflow = ProcessLock::try_acquire_at(&root, ProcessLockKind::Workflow)
            .unwrap()
            .expect("first workflow lock");
        assert!(
            ProcessLock::try_acquire_at(&root, ProcessLockKind::Workflow)
                .unwrap()
                .is_none()
        );
        let service = ProcessLock::try_acquire_at(&root, ProcessLockKind::Service)
            .unwrap()
            .expect("independent service lock");

        drop(service);
        drop(workflow);
        assert!(
            ProcessLock::try_acquire_at(&root, ProcessLockKind::Workflow)
                .unwrap()
                .is_some()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn path_based_backup_returns_a_verified_database() {
        let (mut ledger, root) = ledger();
        ledger.record_lease(&fake_job()).unwrap();
        drop(ledger);
        let source = root.join("runner.db");
        let backup = root.join("path-backup.db");

        backup_database_at(&source, &backup).unwrap();
        let copy = Connection::open(&backup).unwrap();
        let count: i64 = copy
            .query_row("SELECT COUNT(*) FROM runner_jobs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        drop(copy);
        fs::remove_dir_all(root).unwrap();
    }
}
