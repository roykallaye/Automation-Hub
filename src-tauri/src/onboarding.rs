use crate::{config, preflight, runner_ledger, setup};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

const SCHEMA_NAME: &str = "innpilot.onboarding.v1";
const SCHEMA_VERSION: u32 = 1;
const STATE_RELATIVE_PATH: [&str; 2] = ["onboarding", "state.json"];
const MAX_STATE_BYTES: u64 = 512 * 1024;
const MAX_LEGACY_BYTES: usize = 256 * 1024;
const MAX_EVENTS: usize = 64;
const MAX_RECEIPTS: usize = 32;
const MAX_CREATED_FOLDERS: usize = 64;
const MAX_DEFERRED_ITEMS: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OnboardingState {
    NotStarted,
    BootstrapCreated,
    WaitingForAgent,
    AgentConnected,
    ScopeApprovalRequired,
    DiscoveryRunning,
    NeedsUserInput,
    ProposalReady,
    WaitingForApproval,
    Applying,
    Verifying,
    Ready,
    ReadyWithDeferredItems,
    FailedRecoverable,
    RolledBack,
    ReadyLegacy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum InstallationReadiness {
    NotStarted,
    Ready,
    ReadyWithDeferredItems,
    ReadyLegacy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OnboardingMode {
    Manual,
    AgentAssisted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum OnboardingOrigin {
    FreshInstall,
    LegacyReadyMigration,
    LegacyIncompleteMigration,
    LegacyDraftImport,
    ManualReview,
    ManualRestart,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum LegacyStorageMigration {
    NotSeen,
    Imported,
    DiscardedStale,
    DiscardedInvalid,
    AlreadyAuthoritative,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ManualSetupCheckpoint {
    pub(crate) draft: Value,
    pub(crate) step_key: String,
    pub(crate) show_advanced_workflows: bool,
    #[serde(default)]
    pub(crate) completed_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreatedFolderEvidence {
    path: String,
    workspace_base: String,
    recorded_at: String,
}

/// Durable identity for one approved setup application.
///
/// The exact target revision is recorded before configuration bytes are
/// changed. Startup can therefore distinguish "not applied", "the approved
/// candidate committed", and "an unrelated configuration won the race"
/// without replaying a write.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApplyIntent {
    pub(crate) operation_id: String,
    pub(crate) payload_digest: String,
    pub(crate) base_config_revision: String,
    pub(crate) target_config_revision: String,
    pub(crate) recovery_point_id: Option<String>,
    /// Backend-owned evidence that the approved workspace plan completed
    /// without folder failures. This disambiguates a legitimate no-op
    /// configuration apply from a crash before workspace initialization.
    #[serde(default)]
    pub(crate) workspace_initialized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OnboardingSession {
    id: String,
    state: OnboardingState,
    mode: OnboardingMode,
    origin: OnboardingOrigin,
    created_at: String,
    updated_at: String,
    base_config_revision: String,
    manual_progress: Option<ManualSetupCheckpoint>,
    #[serde(default)]
    created_folders: Vec<CreatedFolderEvidence>,
    failure_code: Option<String>,
    #[serde(default)]
    deferred_items: Vec<String>,
    #[serde(default)]
    verified_config_revision: Option<String>,
    #[serde(default)]
    apply_intent: Option<ApplyIntent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompletedSessionSummary {
    id: String,
    completed_at: String,
    resulting_config_revision: String,
    state: OnboardingState,
    #[serde(default)]
    operation_id: Option<String>,
    #[serde(default)]
    payload_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InstallationOnboarding {
    id: String,
    readiness: InstallationReadiness,
    created_at: String,
    updated_at: String,
    migrated_legacy_installation: bool,
    legacy_storage_migration: LegacyStorageMigration,
    last_completed_session: Option<CompletedSessionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OnboardingEvent {
    revision: u64,
    at: String,
    code: String,
    from_state: Option<OnboardingState>,
    to_state: OnboardingState,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestReceipt {
    request_id: String,
    operation: String,
    payload_digest: String,
    resulting_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OnboardingDocument {
    schema: String,
    schema_version: u32,
    revision: u64,
    installation: InstallationOnboarding,
    active_session: Option<OnboardingSession>,
    #[serde(default)]
    events: Vec<OnboardingEvent>,
    #[serde(default)]
    recent_request_receipts: Vec<RequestReceipt>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnboardingSnapshot {
    schema: String,
    schema_version: u32,
    revision: u64,
    state: OnboardingState,
    installation: InstallationOnboarding,
    active_session: Option<OnboardingSession>,
    events: Vec<OnboardingEvent>,
    recovered_from_backup: bool,
    etag: String,
}

impl OnboardingSnapshot {
    pub(crate) fn revision(&self) -> u64 {
        self.revision
    }

    pub(crate) fn state(&self) -> OnboardingState {
        self.state.clone()
    }

    pub(crate) fn is_ready(&self) -> bool {
        matches!(
            self.state,
            OnboardingState::Ready
                | OnboardingState::ReadyWithDeferredItems
                | OnboardingState::ReadyLegacy
        )
    }

    pub(crate) fn installation_id(&self) -> &str {
        &self.installation.id
    }

    pub(crate) fn readiness(&self) -> InstallationReadiness {
        self.installation.readiness.clone()
    }

    pub(crate) fn deferred_items(&self) -> Vec<String> {
        self.active_session
            .as_ref()
            .map(|session| session.deferred_items.clone())
            .unwrap_or_default()
    }

    pub(crate) fn user_action_required(&self) -> bool {
        !self.is_ready()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnboardingError {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) recoverable: bool,
    pub(crate) current_revision: Option<u64>,
}

impl std::fmt::Display for OnboardingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for OnboardingError {}

impl OnboardingError {
    fn new(code: &str, message: &str, recoverable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
            recoverable,
            current_revision: None,
        }
    }

    fn at_revision(mut self, revision: u64) -> Self {
        self.current_revision = Some(revision);
        self
    }
}

type OnboardingResult<T> = Result<T, OnboardingError>;

/// Purpose-specific filesystem repository for the durable onboarding record.
/// It deliberately knows only the installation config path and the derived
/// onboarding store; it is not an arbitrary filesystem capability.
#[derive(Debug, Clone)]
pub(crate) struct FileOnboardingRepository {
    config_path: PathBuf,
    paths: StorePaths,
}

impl FileOnboardingRepository {
    pub(crate) fn new(config_path: PathBuf) -> OnboardingResult<Self> {
        let paths = store_paths(&config_path)?;
        Ok(Self { config_path, paths })
    }

    /// `config::with_configuration_lock` predates typed workspace errors and
    /// accepts a string error. Keep that compatibility encoding contained in
    /// this filesystem adapter so the service/domain surface remains typed.
    fn with_locked<T>(
        &self,
        operation: impl FnOnce(&StorePaths, &Path) -> OnboardingResult<T>,
    ) -> OnboardingResult<T> {
        config::with_configuration_lock(&self.config_path, || {
            operation(&self.paths, &self.config_path)
                .map_err(|error| serde_json::to_string(&error).unwrap_or(error.message))
        })
        .map_err(decode_locked_error)
    }
}

/// Reusable onboarding application service. Tauri is only responsible for
/// resolving `config_path` and `runner_root`; all lifecycle decisions and
/// durable state access are available without an AppHandle.
#[derive(Debug, Clone)]
pub(crate) struct OnboardingService {
    repository: FileOnboardingRepository,
    runner_root: PathBuf,
}

impl OnboardingService {
    pub(crate) fn new(config_path: PathBuf, runner_root: PathBuf) -> OnboardingResult<Self> {
        Ok(Self {
            repository: FileOnboardingRepository::new(config_path)?,
            runner_root,
        })
    }

    pub(crate) fn reconcile_startup(
        &self,
        config_preexisted: bool,
    ) -> OnboardingResult<OnboardingSnapshot> {
        self.repository.with_locked(|paths, config_path| {
            if !paths.primary.exists() {
                if paths.backup.exists() {
                    return Err(OnboardingError::new(
                        "missing_primary",
                        "InnPilot onboarding state is missing but a recovery copy exists.",
                        true,
                    ));
                }
                let document = classify_installation(config_path, config_preexisted)?;
                persist_new(paths, &document)?;
                return snapshot(&document, false);
            }

            let (mut document, raw) = read_document(&paths.primary)?;
            let current = current_config_context(config_path)?;
            let changed = reconcile_document_after_restart(&mut document, &current)?;
            if changed {
                advance_revision(&mut document)?;
                persist(paths, &document, Some(raw))?;
            }
            snapshot(&document, false)
        })
    }

    pub(crate) fn get(&self) -> OnboardingResult<OnboardingSnapshot> {
        self.repository.with_locked(|paths, _| {
            let (document, _) = read_document(&paths.primary)?;
            snapshot(&document, false)
        })
    }

    pub(crate) fn begin_or_resume(
        &self,
        mode: OnboardingMode,
        expected_revision: u64,
        request_id: String,
    ) -> OnboardingResult<OnboardingSnapshot> {
        begin_or_resume_with_service(self, mode, expected_revision, request_id)
    }

    pub(crate) fn record_progress(
        &self,
        checkpoint: ManualSetupCheckpoint,
        expected_revision: u64,
        request_id: String,
    ) -> OnboardingResult<OnboardingSnapshot> {
        record_progress_with_service(self, checkpoint, expected_revision, request_id)
    }

    pub(crate) fn prepare_apply(
        &self,
        expected_revision: u64,
        expected_config_revision: String,
        approval_reference: String,
        request_id: String,
    ) -> OnboardingResult<OnboardingSnapshot> {
        prepare_apply_with_service(
            self,
            expected_revision,
            expected_config_revision,
            approval_reference,
            request_id,
        )
    }

    pub(crate) fn record_setup_saved(
        &self,
        expected_revision: u64,
        resulting_config_revision: String,
        request_id: String,
    ) -> OnboardingResult<OnboardingSnapshot> {
        record_setup_saved_with_service(
            self,
            expected_revision,
            resulting_config_revision,
            request_id,
        )
    }

    pub(crate) fn complete(
        &self,
        expected_revision: u64,
        resulting_config_revision: String,
        deferred_items: Vec<String>,
        request_id: String,
    ) -> OnboardingResult<OnboardingSnapshot> {
        complete_with_service(
            self,
            expected_revision,
            resulting_config_revision,
            deferred_items,
            request_id,
        )
    }

    pub(crate) fn mark_failed(
        &self,
        expected_revision: u64,
        failure_code: String,
        request_id: String,
    ) -> OnboardingResult<OnboardingSnapshot> {
        mark_failed_with_service(self, expected_revision, failure_code, request_id)
    }

    pub(crate) fn restart(
        &self,
        mode: OnboardingMode,
        expected_revision: u64,
        request_id: String,
    ) -> OnboardingResult<OnboardingSnapshot> {
        restart_with_service(self, mode, expected_revision, request_id)
    }

    pub(crate) fn import_legacy(
        &self,
        raw_json: String,
        expected_revision: u64,
        request_id: String,
    ) -> OnboardingResult<OnboardingSnapshot> {
        import_legacy_with_service(self, raw_json, expected_revision, request_id)
    }

    fn mutate<T: Serialize>(
        &self,
        expected_revision: u64,
        request_id: &str,
        operation_name: &str,
        payload: &T,
        operation: impl FnOnce(&mut OnboardingDocument, &CurrentConfigContext) -> OnboardingResult<()>,
    ) -> OnboardingResult<OnboardingSnapshot> {
        validate_request_id(request_id)?;
        let digest = request_digest(operation_name, payload)?;
        self.repository.with_locked(|paths, config_path| {
            mutate_locked(
                paths,
                config_path,
                expected_revision,
                request_id,
                operation_name,
                digest,
                operation,
            )
        })
    }

    pub(crate) fn find_apply_operation(
        &self,
        operation_id: &str,
        payload_digest: &str,
    ) -> OnboardingResult<Option<OnboardingSnapshot>> {
        validate_apply_identity(operation_id, payload_digest)?;
        self.repository.with_locked(|paths, _| {
            let (document, _) = read_document(&paths.primary)?;
            if apply_operation_matches(&document, operation_id, payload_digest)? {
                return snapshot(&document, false).map(Some);
            }
            Ok(None)
        })
    }

    pub(crate) fn prepare_apply_with_intent(
        &self,
        expected_revision: u64,
        expected_config_revision: String,
        target_config_revision: String,
        approval_reference: String,
        operation_id: String,
        payload_digest: String,
        recovery_point_id: Option<String>,
    ) -> OnboardingResult<OnboardingSnapshot> {
        validate_apply_identity(&operation_id, &payload_digest)?;
        validate_config_revision(&expected_config_revision)?;
        validate_config_revision(&target_config_revision)?;
        validate_recovery_point_id(recovery_point_id.as_deref())?;
        if approval_reference != "manual-ui-confirmation" {
            return Err(OnboardingError::new(
                "approval_required",
                "Manual setup requires an explicit InnPilot confirmation.",
                true,
            ));
        }
        let intent = ApplyIntent {
            operation_id: operation_id.clone(),
            payload_digest: payload_digest.clone(),
            base_config_revision: expected_config_revision.clone(),
            target_config_revision,
            recovery_point_id,
            workspace_initialized: false,
        };
        let receipt_payload = json!({
            "approvalReference": approval_reference,
            "intent": intent,
        });
        let receipt_digest = request_digest("prepareApplyWithIntent", &receipt_payload)?;

        self.repository.with_locked(|paths, config_path| {
            let (mut document, raw) = read_document(&paths.primary)?;
            if apply_operation_matches(&document, &operation_id, &payload_digest)? {
                return snapshot(&document, false);
            }
            if let Some(receipt) = document
                .recent_request_receipts
                .iter()
                .find(|receipt| receipt.request_id == operation_id)
            {
                if receipt.operation != "prepareApplyWithIntent"
                    || receipt.payload_digest != receipt_digest
                {
                    return Err(OnboardingError::new(
                        "request_conflict",
                        "This onboarding request identifier was already used for another operation.",
                        false,
                    )
                    .at_revision(document.revision));
                }
                return snapshot(&document, false);
            }
            if document.revision != expected_revision {
                return Err(OnboardingError::new(
                    "stale_revision",
                    "Onboarding changed after this screen was loaded. Refresh and try again.",
                    true,
                )
                .at_revision(document.revision));
            }
            let context = current_config_context(config_path)?;
            prepare_apply_intent_transition(
                &mut document,
                &context,
                expected_config_revision.as_str(),
                intent,
            )?;
            advance_revision(&mut document)?;
            document.installation.updated_at = now();
            document.recent_request_receipts.push(RequestReceipt {
                request_id: operation_id,
                operation: "prepareApplyWithIntent".to_string(),
                payload_digest: receipt_digest,
                resulting_revision: document.revision,
            });
            trim_history(&mut document);
            persist(paths, &document, Some(raw))?;
            snapshot(&document, false)
        })
    }

    pub(crate) fn recover(&self) -> OnboardingResult<OnboardingSnapshot> {
        self.repository
            .with_locked(|paths, _| recover_locked(paths))
    }

    pub(crate) fn initialize_workspace(
        &self,
        draft: setup::SetupDraft,
        confirmed: bool,
        expected_revision: u64,
        request_id: String,
    ) -> OnboardingResult<(setup::WorkspaceInitResult, Option<OnboardingSnapshot>)> {
        initialize_workspace_with_service(self, draft, confirmed, expected_revision, request_id)
    }

    pub(crate) fn cleanup_created_folders(
        &self,
        expected_revision: u64,
    ) -> OnboardingResult<(setup::SetupCleanupResult, OnboardingSnapshot)> {
        cleanup_created_folders_with_service(self, expected_revision)
    }
}

fn service_for_app(app: &AppHandle) -> OnboardingResult<OnboardingService> {
    let config_path = config::app_config_path(app).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not locate its private onboarding store.",
            true,
        )
    })?;
    let runner_root = config_path
        .parent()
        .map(|parent| parent.join("runner"))
        .ok_or_else(|| {
            OnboardingError::new(
                "persistence_failed",
                "InnPilot app data has no parent folder.",
                false,
            )
        })?;
    OnboardingService::new(config_path, runner_root)
}

pub(crate) fn reconcile_startup(
    app: &AppHandle,
    config_preexisted: bool,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.reconcile_startup(config_preexisted)
}

fn reconcile_document_after_restart(
    document: &mut OnboardingDocument,
    current: &CurrentConfigContext,
) -> OnboardingResult<bool> {
    let Some(state) = document
        .active_session
        .as_ref()
        .map(|session| session.state.clone())
    else {
        if document.installation.readiness != InstallationReadiness::NotStarted
            && !current.structurally_complete
        {
            // An explicit configuration restore can legitimately move the
            // installed pair behind the historically completed onboarding
            // record. Re-open a review session instead of routing the user to
            // Home with an incomplete restored configuration.
            let from = effective_state(document);
            let timestamp = now();
            document.active_session = Some(OnboardingSession {
                id: random_id("session")?,
                state: OnboardingState::BootstrapCreated,
                mode: OnboardingMode::Manual,
                origin: OnboardingOrigin::ManualReview,
                created_at: timestamp.clone(),
                updated_at: timestamp,
                base_config_revision: current.revision.clone(),
                manual_progress: None,
                created_folders: Vec::new(),
                failure_code: None,
                deferred_items: Vec::new(),
                verified_config_revision: None,
                apply_intent: None,
            });
            append_event(
                document,
                from,
                OnboardingState::BootstrapCreated,
                "configurationRestoreNeedsReview",
                "backend",
            )?;
            return Ok(true);
        }
        return Ok(false);
    };

    if state == OnboardingState::Applying {
        return reconcile_applying_after_restart(document, current);
    }

    let transition = match state {
        OnboardingState::DiscoveryRunning => Some((
            OnboardingState::FailedRecoverable,
            "interrupted_discovery",
            "interruptedDiscovery",
        )),
        OnboardingState::Verifying
            if document.active_session.as_ref().is_some_and(|session| {
                session.verified_config_revision.as_deref() == Some(current.revision.as_str())
            }) =>
        {
            finish_reconciled_session(document, current)?;
            return Ok(true);
        }
        OnboardingState::Verifying => Some((
            OnboardingState::FailedRecoverable,
            "verified_revision_changed",
            "verificationRevisionChanged",
        )),
        _ => None,
    };

    let Some((to, failure_code, reason)) = transition else {
        return Ok(false);
    };
    let session = document.active_session.as_mut().ok_or_else(|| {
        OnboardingError::new(
            "state_missing",
            "The onboarding session is no longer available.",
            true,
        )
    })?;
    let from = session.state.clone();
    session.state = to.clone();
    session.failure_code = Some(failure_code.to_string());
    session.updated_at = now();
    append_event(document, from, to, reason, "startup")?;
    Ok(true)
}

fn reconcile_applying_after_restart(
    document: &mut OnboardingDocument,
    current: &CurrentConfigContext,
) -> OnboardingResult<bool> {
    let (base_revision, intent) = document
        .active_session
        .as_ref()
        .map(|session| {
            (
                session.base_config_revision.clone(),
                session.apply_intent.clone(),
            )
        })
        .ok_or_else(|| {
            OnboardingError::new(
                "state_missing",
                "The onboarding session is no longer available.",
                true,
            )
        })?;

    if let Some(intent) = intent {
        if current.revision == intent.target_config_revision
            && intent.workspace_initialized
            && (intent.target_config_revision != intent.base_config_revision
                || current.structurally_complete)
        {
            let deferred = derive_deferred_items(&current.config);
            {
                let session = active_session_mut(document)?;
                session.state = OnboardingState::Verifying;
                session.failure_code = None;
                session.verified_config_revision = Some(current.revision.clone());
                session.deferred_items = deferred;
                session.updated_at = now();
            }
            append_event(
                document,
                OnboardingState::Applying,
                OnboardingState::Verifying,
                "approvedConfigurationCommitObserved",
                "startup",
            )?;
            finish_reconciled_session(document, current)?;
            return Ok(true);
        }

        if current.revision == intent.base_config_revision {
            let session = active_session_mut(document)?;
            session.state = OnboardingState::NeedsUserInput;
            session.failure_code = Some("interrupted_before_apply".to_string());
            session.updated_at = now();
            append_event(
                document,
                OnboardingState::Applying,
                OnboardingState::NeedsUserInput,
                "resumedBeforeApply",
                "startup",
            )?;
            return Ok(true);
        }

        let session = active_session_mut(document)?;
        session.state = OnboardingState::FailedRecoverable;
        session.failure_code = Some("configuration_conflict".to_string());
        session.updated_at = now();
        append_event(
            document,
            OnboardingState::Applying,
            OnboardingState::FailedRecoverable,
            "applyConfigurationConflict",
            "startup",
        )?;
        return Ok(true);
    }

    // Backward compatibility for Phase B records created before durable apply
    // intent existed. Without an exact target revision, a changed pair remains
    // ambiguous and must not be promoted or replayed.
    let (to, failure_code, reason) = if current.revision == base_revision {
        (
            OnboardingState::NeedsUserInput,
            "interrupted_before_apply",
            "resumedBeforeApply",
        )
    } else {
        (
            OnboardingState::FailedRecoverable,
            "apply_outcome_unknown",
            "applyOutcomeNeedsReview",
        )
    };
    let session = active_session_mut(document)?;
    session.state = to.clone();
    session.failure_code = Some(failure_code.to_string());
    session.updated_at = now();
    append_event(document, OnboardingState::Applying, to, reason, "startup")?;
    Ok(true)
}

pub(crate) fn get(app: &AppHandle) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.get()
}

pub(crate) fn begin_or_resume(
    app: &AppHandle,
    mode: OnboardingMode,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.begin_or_resume(mode, expected_revision, request_id)
}

fn begin_or_resume_with_service(
    service: &OnboardingService,
    mode: OnboardingMode,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    let payload_mode = mode.clone();
    service.mutate(
        expected_revision,
        &request_id,
        "beginOrResume",
        &payload_mode,
        |document, context| {
            if document.active_session.is_some() {
                let (from, to) = {
                    let session = document.active_session.as_mut().expect("checked above");
                    let from = session.state.clone();
                    if matches!(
                        session.state,
                        OnboardingState::FailedRecoverable | OnboardingState::RolledBack
                    ) {
                        session.state = OnboardingState::NeedsUserInput;
                        session.failure_code = None;
                        if session.base_config_revision != context.revision {
                            session.base_config_revision = context.revision.clone();
                            session.manual_progress = None;
                            session.verified_config_revision = None;
                            session.apply_intent = None;
                            session.deferred_items.clear();
                        }
                        session.updated_at = now();
                    }
                    (from, session.state.clone())
                };
                push_transition_event(document, from, to, "onboardingResumed", "ui")?;
                return Ok(());
            }

            if mode == OnboardingMode::AgentAssisted {
                return Err(OnboardingError::new(
                    "feature_unavailable",
                    "Agent-assisted onboarding is not enabled in this phase.",
                    true,
                ));
            }
            let origin = if document.installation.readiness == InstallationReadiness::NotStarted {
                OnboardingOrigin::FreshInstall
            } else {
                OnboardingOrigin::ManualReview
            };
            let timestamp = now();
            let from = effective_state(document);
            let session = OnboardingSession {
                id: random_id("session")?,
                state: OnboardingState::BootstrapCreated,
                mode,
                origin,
                created_at: timestamp.clone(),
                updated_at: timestamp,
                base_config_revision: context.revision.clone(),
                manual_progress: None,
                created_folders: Vec::new(),
                failure_code: None,
                deferred_items: Vec::new(),
                verified_config_revision: None,
                apply_intent: None,
            };
            document.active_session = Some(session);
            push_transition_event(
                document,
                from,
                OnboardingState::BootstrapCreated,
                "onboardingStarted",
                "ui",
            )
        },
    )
}

pub(crate) fn record_progress(
    app: &AppHandle,
    checkpoint: ManualSetupCheckpoint,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.record_progress(checkpoint, expected_revision, request_id)
}

fn record_progress_with_service(
    service: &OnboardingService,
    checkpoint: ManualSetupCheckpoint,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    let checkpoint = validate_checkpoint(checkpoint)?;
    let payload_checkpoint = checkpoint.clone();
    service.mutate(
        expected_revision,
        &request_id,
        "recordProgress",
        &payload_checkpoint,
        |document, context| {
            let (state, base_revision) = document
                .active_session
                .as_ref()
                .map(|session| (session.state.clone(), session.base_config_revision.clone()))
                .ok_or_else(|| {
                    OnboardingError::new(
                        "no_active_session",
                        "No onboarding session is active.",
                        true,
                    )
                    .at_revision(document.revision)
                })?;
            if context.revision != base_revision {
                return Err(OnboardingError::new(
                    "config_changed",
                    "InnPilot configuration changed after this onboarding session began.",
                    true,
                )
                .at_revision(document.revision));
            }
            if !matches!(
                state,
                OnboardingState::BootstrapCreated
                    | OnboardingState::NeedsUserInput
                    | OnboardingState::FailedRecoverable
                    | OnboardingState::RolledBack
            ) {
                return invalid_transition(document, &state, OnboardingState::NeedsUserInput);
            }
            let session = active_session_mut(document)?;
            let from = session.state.clone();
            session.state = OnboardingState::NeedsUserInput;
            session.updated_at = now();
            session.failure_code = None;
            session.manual_progress = Some(checkpoint);
            session.apply_intent = None;
            push_transition_event(
                document,
                from,
                OnboardingState::NeedsUserInput,
                "manualProgressSaved",
                "ui",
            )
        },
    )
}

pub(crate) fn prepare_apply(
    app: &AppHandle,
    expected_revision: u64,
    expected_config_revision: String,
    approval_reference: String,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.prepare_apply(
        expected_revision,
        expected_config_revision,
        approval_reference,
        request_id,
    )
}

fn prepare_apply_with_service(
    service: &OnboardingService,
    expected_revision: u64,
    expected_config_revision: String,
    approval_reference: String,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    if approval_reference != "manual-ui-confirmation" {
        return Err(OnboardingError::new(
            "approval_required",
            "Manual setup requires an explicit InnPilot confirmation.",
            true,
        ));
    }
    let payload = json!({
        "expectedConfigRevision": expected_config_revision,
        "approvalReference": approval_reference,
    });
    service.mutate(
        expected_revision,
        &request_id,
        "prepareApply",
        &payload,
        |document, context| {
            let (state, mode, has_progress, base_revision) = document
                .active_session
                .as_ref()
                .map(|session| {
                    (
                        session.state.clone(),
                        session.mode.clone(),
                        session.manual_progress.is_some(),
                        session.base_config_revision.clone(),
                    )
                })
                .ok_or_else(|| {
                    OnboardingError::new(
                        "no_active_session",
                        "No onboarding session is active.",
                        true,
                    )
                    .at_revision(document.revision)
                })?;
            if mode != OnboardingMode::Manual {
                return Err(OnboardingError::new(
                    "feature_unavailable",
                    "Agent-originated apply is not enabled.",
                    false,
                )
                .at_revision(document.revision));
            }
            if !has_progress {
                return Err(OnboardingError::new(
                    "progress_required",
                    "Save manual onboarding progress before applying it.",
                    true,
                )
                .at_revision(document.revision));
            }
            if context.revision != expected_config_revision
                || base_revision != expected_config_revision
            {
                return Err(OnboardingError::new(
                    "config_changed",
                    "InnPilot configuration changed before setup could be applied.",
                    true,
                )
                .at_revision(document.revision));
            }
            if state != OnboardingState::NeedsUserInput {
                return invalid_transition(document, &state, OnboardingState::Applying);
            }
            let session = active_session_mut(document)?;
            let from = session.state.clone();
            session.state = OnboardingState::Applying;
            session.updated_at = now();
            session.verified_config_revision = None;
            session.apply_intent = None;
            session.deferred_items.clear();
            push_transition_event(
                document,
                from,
                OnboardingState::Applying,
                "manualApplyApproved",
                "ui",
            )
        },
    )
}

/// Records evidence produced after the Phase A setup save. This is deliberately
/// backend-only: renderer claims are not sufficient to enter `verifying`.
pub(crate) fn record_setup_saved(
    app: &AppHandle,
    expected_revision: u64,
    resulting_config_revision: String,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.record_setup_saved(
        expected_revision,
        resulting_config_revision,
        request_id,
    )
}

fn record_setup_saved_with_service(
    service: &OnboardingService,
    expected_revision: u64,
    resulting_config_revision: String,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service.mutate(
        expected_revision,
        &request_id,
        "recordSetupSaved",
        &resulting_config_revision,
        |document, context| {
            if context.revision != resulting_config_revision {
                return Err(OnboardingError::new(
                    "config_changed",
                    "The setup-save receipt does not match the installed configuration.",
                    true,
                )
                .at_revision(document.revision));
            }
            let (state, base_revision, intended_target) = document
                .active_session
                .as_ref()
                .map(|session| {
                    (
                        session.state.clone(),
                        session.base_config_revision.clone(),
                        session
                            .apply_intent
                            .as_ref()
                            .map(|intent| intent.target_config_revision.clone()),
                    )
                })
                .ok_or_else(|| {
                    OnboardingError::new(
                        "no_active_session",
                        "No onboarding session is active.",
                        true,
                    )
                    .at_revision(document.revision)
                })?;
            if state != OnboardingState::Applying {
                return invalid_transition(document, &state, OnboardingState::Verifying);
            }
            if intended_target
                .as_deref()
                .is_some_and(|target| target != resulting_config_revision)
            {
                return Err(OnboardingError::new(
                    "configuration_conflict",
                    "The installed configuration does not match the approved setup candidate.",
                    true,
                )
                .at_revision(document.revision));
            }
            // An unchanged revision is a valid review only when the installed
            // pair already has the required structure. A fresh/default config
            // can never become ready through a no-op completion claim.
            if context.revision == base_revision && !context.structurally_complete {
                return Err(OnboardingError::new(
                    "validation_failed",
                    "The installed configuration is still incomplete.",
                    true,
                )
                .at_revision(document.revision));
            }
            let deferred = derive_deferred_items(&context.config);
            let session = active_session_mut(document)?;
            let from = session.state.clone();
            session.state = OnboardingState::Verifying;
            session.updated_at = now();
            session.verified_config_revision = Some(context.revision.clone());
            session.deferred_items = deferred;
            push_transition_event(
                document,
                from,
                OnboardingState::Verifying,
                "configurationSaveVerified",
                "backend",
            )
        },
    )
}

pub(crate) fn complete(
    app: &AppHandle,
    expected_revision: u64,
    resulting_config_revision: String,
    deferred_items: Vec<String>,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.complete(
        expected_revision,
        resulting_config_revision,
        deferred_items,
        request_id,
    )
}

fn complete_with_service(
    service: &OnboardingService,
    expected_revision: u64,
    resulting_config_revision: String,
    deferred_items: Vec<String>,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    if !deferred_items.is_empty() {
        return Err(OnboardingError::new(
            "validation_failed",
            "Deferred onboarding items are derived by InnPilot, not supplied by the interface.",
            true,
        ));
    }
    let payload = json!({
        "resultingConfigRevision": resulting_config_revision,
        "deferredItems": [],
    });
    service.mutate(
        expected_revision,
        &request_id,
        "complete",
        &payload,
        |document, context| {
            if context.revision != resulting_config_revision {
                return Err(OnboardingError::new(
                    "config_changed",
                    "The saved configuration revision does not match the installed revision.",
                    true,
                )
                .at_revision(document.revision));
            }
            let mut session = document.active_session.take().ok_or_else(|| {
                OnboardingError::new(
                    "no_active_session",
                    "No onboarding session is active.",
                    true,
                )
                .at_revision(document.revision)
            })?;
            if session.state != OnboardingState::Verifying
                || session.verified_config_revision.as_deref()
                    != Some(resulting_config_revision.as_str())
            {
                let state = session.state.clone();
                document.active_session = Some(session);
                return invalid_transition(document, &state, OnboardingState::Verifying);
            }
            let final_state = if session.deferred_items.is_empty() {
                OnboardingState::Ready
            } else {
                OnboardingState::ReadyWithDeferredItems
            };
            session.state = final_state.clone();
            session.updated_at = now();
            document.installation.readiness = if final_state == OnboardingState::Ready {
                InstallationReadiness::Ready
            } else {
                InstallationReadiness::ReadyWithDeferredItems
            };
            document.installation.updated_at = now();
            document.installation.last_completed_session = Some(CompletedSessionSummary {
                id: session.id.clone(),
                completed_at: now(),
                resulting_config_revision,
                state: final_state.clone(),
                operation_id: session
                    .apply_intent
                    .as_ref()
                    .map(|intent| intent.operation_id.clone()),
                payload_digest: session
                    .apply_intent
                    .as_ref()
                    .map(|intent| intent.payload_digest.clone()),
            });
            push_transition_event(
                document,
                OnboardingState::Verifying,
                final_state,
                "onboardingCompleted",
                "backend",
            )
        },
    )
}

pub(crate) fn mark_failed(
    app: &AppHandle,
    expected_revision: u64,
    failure_code: String,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.mark_failed(expected_revision, failure_code, request_id)
}

fn mark_failed_with_service(
    service: &OnboardingService,
    expected_revision: u64,
    failure_code: String,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    const ALLOWED: [&str; 5] = [
        "manual_apply_failed",
        "folder_initialization_failed",
        "validation_failed",
        "interrupted_apply",
        "persistence_failed",
    ];
    if !ALLOWED.contains(&failure_code.as_str()) {
        return Err(OnboardingError::new(
            "validation_failed",
            "The onboarding failure code is not supported.",
            true,
        ));
    }
    let payload_code = failure_code.clone();
    service.mutate(
        expected_revision,
        &request_id,
        "markFailed",
        &payload_code,
        |document, _| {
            let state = document
                .active_session
                .as_ref()
                .map(|session| session.state.clone())
                .ok_or_else(|| {
                    OnboardingError::new(
                        "no_active_session",
                        "No onboarding session is active.",
                        true,
                    )
                    .at_revision(document.revision)
                })?;
            if matches!(
                state,
                OnboardingState::Ready
                    | OnboardingState::ReadyLegacy
                    | OnboardingState::ReadyWithDeferredItems
            ) {
                return invalid_transition(document, &state, OnboardingState::FailedRecoverable);
            }
            let session = active_session_mut(document)?;
            let from = session.state.clone();
            session.state = OnboardingState::FailedRecoverable;
            session.failure_code = Some(failure_code);
            session.updated_at = now();
            push_transition_event(
                document,
                from,
                OnboardingState::FailedRecoverable,
                "onboardingFailed",
                "ui",
            )
        },
    )
}

pub(crate) fn restart(
    app: &AppHandle,
    mode: OnboardingMode,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.restart(mode, expected_revision, request_id)
}

fn restart_with_service(
    service: &OnboardingService,
    mode: OnboardingMode,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    let payload_mode = mode.clone();
    service.mutate(
        expected_revision,
        &request_id,
        "restart",
        &payload_mode,
        |document, context| {
            if mode == OnboardingMode::AgentAssisted {
                return Err(OnboardingError::new(
                    "feature_unavailable",
                    "Agent-assisted onboarding is not enabled in this phase.",
                    true,
                ));
            }
            if document.active_session.as_ref().is_some_and(|session| {
                matches!(
                    session.state,
                    OnboardingState::Applying | OnboardingState::Verifying
                )
            }) {
                return Err(OnboardingError::new(
                    "busy",
                    "Onboarding cannot restart while setup is being applied or verified.",
                    true,
                )
                .at_revision(document.revision));
            }
            let from = effective_state(document);
            let carried_created_folders = document
                .active_session
                .as_mut()
                .map(|session| std::mem::take(&mut session.created_folders))
                .unwrap_or_default();
            let timestamp = now();
            document.active_session = Some(OnboardingSession {
                id: random_id("session")?,
                state: OnboardingState::BootstrapCreated,
                mode,
                origin: OnboardingOrigin::ManualRestart,
                created_at: timestamp.clone(),
                updated_at: timestamp,
                base_config_revision: context.revision.clone(),
                manual_progress: None,
                created_folders: carried_created_folders,
                failure_code: None,
                deferred_items: Vec::new(),
                verified_config_revision: None,
                apply_intent: None,
            });
            push_transition_event(
                document,
                from,
                OnboardingState::BootstrapCreated,
                "onboardingRestarted",
                "ui",
            )
        },
    )
}

pub(crate) fn import_legacy(
    app: &AppHandle,
    raw_json: String,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.import_legacy(raw_json, expected_revision, request_id)
}

fn import_legacy_with_service(
    service: &OnboardingService,
    raw_json: String,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<OnboardingSnapshot> {
    let current = service.get()?;
    if current.installation.legacy_storage_migration != LegacyStorageMigration::NotSeen {
        return Ok(current);
    }
    // Never retain the untrusted browser payload in state or request receipts.
    // A bounded hash still makes retries idempotent without persisting paths or
    // email-routing data from the retired WebView record.
    let import_fingerprint = json!({
        "bytes": raw_json.len(),
        "sha256": format!("{:x}", Sha256::digest(raw_json.as_bytes())),
    });
    let legacy = if raw_json.len() > MAX_LEGACY_BYTES {
        Err(OnboardingError::new(
            "legacy_invalid",
            "Legacy setup progress is too large to import safely.",
            true,
        ))
    } else {
        parse_legacy_session(&raw_json)
    };
    service.mutate(
        expected_revision,
        &request_id,
        "importLegacy",
        &import_fingerprint,
        move |document, context| match legacy {
            Ok(legacy) => match apply_legacy_import(document, context, &legacy) {
                Ok(()) => Ok(()),
                Err(error)
                    if matches!(error.code.as_str(), "legacy_invalid" | "validation_failed") =>
                {
                    record_invalid_legacy_migration(document)
                }
                Err(error) => Err(error),
            },
            Err(error) if error.code == "legacy_invalid" => {
                record_invalid_legacy_migration(document)
            }
            Err(error) => Err(error),
        },
    )
}

fn record_invalid_legacy_migration(document: &mut OnboardingDocument) -> OnboardingResult<()> {
    document.installation.legacy_storage_migration = LegacyStorageMigration::DiscardedInvalid;
    push_same_state_event(
        document,
        effective_state(document),
        "legacyProgressDiscardedInvalid",
        "migration",
    )
}

fn apply_legacy_import(
    document: &mut OnboardingDocument,
    context: &CurrentConfigContext,
    legacy: &LegacyParsed,
) -> OnboardingResult<()> {
    if document.installation.legacy_storage_migration != LegacyStorageMigration::NotSeen {
        return Ok(());
    }
    if document.installation.readiness != InstallationReadiness::NotStarted {
        document.installation.legacy_storage_migration =
            LegacyStorageMigration::AlreadyAuthoritative;
        push_same_state_event(
            document,
            effective_state(document),
            "legacyProgressAlreadyAuthoritative",
            "migration",
        )?;
        return Ok(());
    }
    if document
        .active_session
        .as_ref()
        .is_some_and(|session| session.manual_progress.is_some())
    {
        document.installation.legacy_storage_migration =
            LegacyStorageMigration::AlreadyAuthoritative;
        push_same_state_event(
            document,
            effective_state(document),
            "legacyProgressAlreadyAuthoritative",
            "migration",
        )?;
        return Ok(());
    }
    if legacy.base_revision.as_deref() != Some(context.revision.as_str()) {
        document.installation.legacy_storage_migration = LegacyStorageMigration::DiscardedStale;
        push_same_state_event(
            document,
            effective_state(document),
            "legacyProgressDiscardedStale",
            "migration",
        )?;
        return Ok(());
    }

    let checkpoint = validate_checkpoint(ManualSetupCheckpoint {
        draft: legacy.draft.clone(),
        step_key: legacy.step_key.clone(),
        show_advanced_workflows: legacy.show_advanced_workflows,
        // Browser completion claims are deliberately not imported.
        completed_actions: Vec::new(),
    })?;
    let timestamp = now();
    let session = document.active_session.get_or_insert(OnboardingSession {
        id: random_id("session")?,
        state: OnboardingState::NeedsUserInput,
        mode: OnboardingMode::Manual,
        origin: OnboardingOrigin::LegacyDraftImport,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        base_config_revision: context.revision.clone(),
        manual_progress: None,
        created_folders: Vec::new(),
        failure_code: None,
        deferred_items: Vec::new(),
        verified_config_revision: None,
        apply_intent: None,
    });
    if session.base_config_revision != context.revision {
        document.installation.legacy_storage_migration = LegacyStorageMigration::DiscardedStale;
        push_same_state_event(
            document,
            effective_state(document),
            "legacyProgressDiscardedStale",
            "migration",
        )?;
        return Ok(());
    }
    let from = session.state.clone();
    session.state = OnboardingState::NeedsUserInput;
    session.updated_at = timestamp;
    session.manual_progress = Some(checkpoint);
    document.installation.legacy_storage_migration = LegacyStorageMigration::Imported;
    push_transition_event(
        document,
        from,
        OnboardingState::NeedsUserInput,
        "legacyProgressImported",
        "migration",
    )
}

pub(crate) fn initialize_workspace(
    app: &AppHandle,
    draft: setup::SetupDraft,
    confirmed: bool,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<(setup::WorkspaceInitResult, Option<OnboardingSnapshot>)> {
    service_for_app(app)?.initialize_workspace(draft, confirmed, expected_revision, request_id)
}

fn initialize_workspace_with_service(
    service: &OnboardingService,
    draft: setup::SetupDraft,
    confirmed: bool,
    expected_revision: u64,
    request_id: String,
) -> OnboardingResult<(setup::WorkspaceInitResult, Option<OnboardingSnapshot>)> {
    if !confirmed {
        return Err(OnboardingError::new(
            "confirmation_required",
            "Workspace initialization requires confirmation.",
            true,
        ));
    }
    validate_request_id(&request_id)?;
    let workspace_base = draft.workspace_base().to_string();
    let _workflow_lock =
        runner_ledger::ProcessLock::try_acquire_in_directory(&service.runner_root, "workflow")
            .map_err(|_| {
                OnboardingError::new(
                    "workspace_failed",
                    "InnPilot could not coordinate workspace initialization.",
                    true,
                )
            })?
            .ok_or_else(|| {
                OnboardingError::new(
                    "busy",
                    "Wait for the current automation or setup save before creating folders.",
                    true,
                )
            })?;
    service.repository.with_locked(|paths, _| {
        let (mut document, raw) = read_document(&paths.primary)?;
        if document.revision != expected_revision {
            return Err(OnboardingError::new(
                "stale_revision",
                "Onboarding changed before workspace initialization.",
                true,
            )
            .at_revision(document.revision));
        }
        let session = document.active_session.as_ref().ok_or_else(|| {
            OnboardingError::new(
                "no_active_session",
                "No onboarding session is active.",
                true,
            )
            .at_revision(document.revision)
        })?;
        if session.manual_progress.is_none() || session.state != OnboardingState::Applying {
            return invalid_transition(&document, &session.state, OnboardingState::Applying);
        }
        let workspace = setup::initialize_workspace(draft, true).map_err(|_| {
            OnboardingError::new(
                "workspace_failed",
                "InnPilot could not initialize the approved workspace.",
                true,
            )
            .at_revision(document.revision)
        })?;
        let initialization_succeeded = !workspace.has_failures();
        let created_paths = workspace.created_paths();
        if created_paths.len() > MAX_CREATED_FOLDERS
            || workspace_base.chars().count() > 4096
            || created_paths.iter().any(|path| path.chars().count() > 4096)
        {
            let _ = setup::remove_setup_created_empty_folders(workspace_base, created_paths, true);
            return Err(OnboardingError::new(
                "validation_failed",
                "Created-folder evidence exceeds the safe onboarding limit.",
                true,
            )
            .at_revision(document.revision));
        }
        let should_record_workspace_initialized = initialization_succeeded
            && document
                .active_session
                .as_ref()
                .and_then(|session| session.apply_intent.as_ref())
                .is_some_and(|intent| !intent.workspace_initialized);
        if created_paths.is_empty() && !should_record_workspace_initialized {
            return Ok((workspace, None));
        }
        let event_state = {
            let session = active_session_mut(&mut document)?;
            for path in &created_paths {
                if !session
                    .created_folders
                    .iter()
                    .any(|existing| existing.path == *path)
                {
                    session.created_folders.push(CreatedFolderEvidence {
                        path: path.clone(),
                        workspace_base: workspace_base.clone(),
                        recorded_at: now(),
                    });
                }
            }
            session.created_folders.truncate(MAX_CREATED_FOLDERS);
            if should_record_workspace_initialized {
                if let Some(intent) = session.apply_intent.as_mut() {
                    intent.workspace_initialized = true;
                }
            }
            session.updated_at = now();
            session.state.clone()
        };
        push_same_state_event(
            &mut document,
            event_state,
            if should_record_workspace_initialized {
                "workspaceInitializationRecorded"
            } else {
                "createdFoldersRecorded"
            },
            "backend",
        )?;
        advance_revision(&mut document)?;
        document.installation.updated_at = now();
        trim_history(&mut document);
        if let Err(error) = persist(paths, &document, Some(raw)) {
            let _ = setup::remove_setup_created_empty_folders(workspace_base, created_paths, true);
            return Err(error);
        }
        Ok((workspace, Some(snapshot(&document, false)?)))
    })
}

pub(crate) fn cleanup_created_folders(
    app: &AppHandle,
    expected_revision: u64,
) -> OnboardingResult<(setup::SetupCleanupResult, OnboardingSnapshot)> {
    service_for_app(app)?.cleanup_created_folders(expected_revision)
}

fn cleanup_created_folders_with_service(
    service: &OnboardingService,
    expected_revision: u64,
) -> OnboardingResult<(setup::SetupCleanupResult, OnboardingSnapshot)> {
    let _workflow_lock =
        runner_ledger::ProcessLock::try_acquire_in_directory(&service.runner_root, "workflow")
            .map_err(|_| {
                OnboardingError::new(
                    "cleanup_failed",
                    "InnPilot could not coordinate empty-folder cleanup.",
                    true,
                )
            })?
            .ok_or_else(|| {
                OnboardingError::new(
                    "busy",
                    "Wait for the current automation or setup save to finish before cleanup.",
                    true,
                )
            })?;
    service.repository.with_locked(|paths, _| {
        cleanup_created_folders_locked(paths, expected_revision, |workspace, paths| {
            setup::remove_setup_created_empty_folders(workspace, paths, true)
        })
    })
}

fn cleanup_created_folders_locked(
    paths: &StorePaths,
    expected_revision: u64,
    cleanup_operation: impl FnOnce(String, Vec<String>) -> Result<setup::SetupCleanupResult, String>,
) -> OnboardingResult<(setup::SetupCleanupResult, OnboardingSnapshot)> {
    let (mut document, raw) = read_document(&paths.primary)?;
    if document.revision != expected_revision {
        return Err(OnboardingError::new(
            "stale_revision",
            "Onboarding changed before empty-folder cleanup.",
            true,
        )
        .at_revision(document.revision));
    }
    let session = document.active_session.as_ref().ok_or_else(|| {
        OnboardingError::new(
            "no_active_session",
            "No onboarding session owns folders eligible for cleanup.",
            true,
        )
        .at_revision(document.revision)
    })?;
    if !matches!(
        session.state,
        OnboardingState::BootstrapCreated
            | OnboardingState::NeedsUserInput
            | OnboardingState::FailedRecoverable
            | OnboardingState::RolledBack
    ) {
        return Err(OnboardingError::new(
            "cleanup_unavailable",
            "Empty-folder cleanup is unavailable while setup is being applied or verified.",
            true,
        )
        .at_revision(document.revision));
    }
    let workspace = session
        .created_folders
        .first()
        .map(|item| item.workspace_base.clone())
        .ok_or_else(|| {
            OnboardingError::new(
                "cleanup_unavailable",
                "This onboarding session did not create any recorded folders.",
                true,
            )
            .at_revision(document.revision)
        })?;
    if session
        .created_folders
        .iter()
        .any(|item| item.workspace_base != workspace)
    {
        return Err(OnboardingError::new(
            "corrupt_state",
            "Created-folder evidence spans more than one workspace.",
            true,
        )
        .at_revision(document.revision));
    }
    let created_paths = session
        .created_folders
        .iter()
        .map(|item| item.path.clone())
        .collect();
    let cleanup = cleanup_operation(workspace, created_paths).map_err(|_| {
        OnboardingError::new(
            "cleanup_failed",
            "InnPilot could not safely clean up the recorded empty folders.",
            true,
        )
        .at_revision(document.revision)
    })?;

    // Consume the authority after one checked attempt. Skipped non-empty paths
    // must never remain eligible for deletion after user data appears.
    let event_state = {
        let session = active_session_mut(&mut document)?;
        session.created_folders.clear();
        session.updated_at = now();
        session.state.clone()
    };
    push_same_state_event(
        &mut document,
        event_state,
        "createdFoldersCleanupConsumed",
        "backend",
    )?;
    advance_revision(&mut document)?;
    document.installation.updated_at = now();
    trim_history(&mut document);
    persist(paths, &document, Some(raw))?;
    let snapshot = snapshot(&document, false)?;
    Ok((cleanup, snapshot))
}

pub(crate) fn recover(app: &AppHandle) -> OnboardingResult<OnboardingSnapshot> {
    service_for_app(app)?.recover()
}

fn recover_locked(paths: &StorePaths) -> OnboardingResult<OnboardingSnapshot> {
    if !paths.backup.exists() {
        return Err(OnboardingError::new(
            "recovery_unavailable",
            "No validated onboarding recovery copy is available.",
            true,
        ));
    }
    if paths.primary.exists() {
        match read_document(&paths.primary) {
            Ok(_) => {
                return Err(OnboardingError::new(
                    "recovery_not_needed",
                    "The current onboarding record is valid and was not replaced.",
                    true,
                ));
            }
            Err(error) if error.code == "future_schema" => return Err(error),
            Err(_) => {}
        }
    }
    let (mut recovered, _) = read_document(&paths.backup)?;
    if paths.primary.exists() {
        let corrupt_path = paths.directory.join(format!(
            "state.corrupt.{}.json",
            Utc::now().format("%Y%m%dT%H%M%S%.3fZ")
        ));
        fs::copy(&paths.primary, &corrupt_path).map_err(|_| {
            OnboardingError::new(
                "persistence_failed",
                "InnPilot could not preserve the damaged onboarding record.",
                true,
            )
        })?;
    }
    let from = effective_state(&recovered);
    // `persist` always installs the exact N-1 predecessor as the backup before
    // activating primary revision N. Recovery must therefore advance beyond
    // both generations. Advancing only once would recreate revision N with
    // rolled-back content and let a stale renderer snapshot at N pass CAS.
    advance_revision(&mut recovered)?;
    advance_revision(&mut recovered)?;
    let to = effective_state(&recovered);
    recovered.events.push(OnboardingEvent {
        revision: recovered.revision,
        at: now(),
        code: "onboardingRecovered".to_string(),
        from_state: Some(from),
        to_state: to,
        source: "support".to_string(),
    });
    trim_history(&mut recovered);
    let bytes = serialize_document(&recovered)?;
    // Seed the backup with the recovered generation before activation. This
    // prevents revision ABA across consecutive recoveries when no ordinary
    // mutation has refreshed the predecessor in between.
    config::atomic_replace_configuration_bytes(&paths.backup, &bytes).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not refresh the onboarding recovery copy.",
            true,
        )
    })?;
    config::atomic_replace_configuration_bytes(&paths.primary, &bytes).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not activate the recovered onboarding record.",
            true,
        )
    })?;
    snapshot(&recovered, true)
}

#[derive(Debug, Clone)]
struct StorePaths {
    directory: PathBuf,
    primary: PathBuf,
    backup: PathBuf,
}

#[derive(Debug)]
struct CurrentConfigContext {
    revision: String,
    config: config::HubConfig,
    structurally_complete: bool,
}

fn decode_locked_error(value: String) -> OnboardingError {
    serde_json::from_str::<OnboardingErrorWire>(&value)
        .map(OnboardingErrorWire::into_error)
        .unwrap_or_else(|_| {
            OnboardingError::new(
                "busy",
                "InnPilot onboarding state is being updated by another process.",
                true,
            )
        })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnboardingErrorWire {
    code: String,
    message: String,
    recoverable: bool,
    current_revision: Option<u64>,
}

impl OnboardingErrorWire {
    fn into_error(self) -> OnboardingError {
        OnboardingError {
            code: self.code,
            message: self.message,
            recoverable: self.recoverable,
            current_revision: self.current_revision,
        }
    }
}

fn store_paths(config_path: &Path) -> OnboardingResult<StorePaths> {
    let app_data = config_path.parent().ok_or_else(|| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot app data has no parent folder.",
            false,
        )
    })?;
    let directory = app_data.join(STATE_RELATIVE_PATH[0]);
    Ok(StorePaths {
        primary: directory.join(STATE_RELATIVE_PATH[1]),
        backup: directory.join("state.json.bak"),
        directory,
    })
}

fn mutate_locked(
    paths: &StorePaths,
    config_path: &Path,
    expected_revision: u64,
    request_id: &str,
    operation_name: &str,
    digest: String,
    operation: impl FnOnce(&mut OnboardingDocument, &CurrentConfigContext) -> OnboardingResult<()>,
) -> OnboardingResult<OnboardingSnapshot> {
    let (mut document, raw) = read_document(&paths.primary)?;
    if let Some(receipt) = document
        .recent_request_receipts
        .iter()
        .find(|receipt| receipt.request_id == request_id)
    {
        if receipt.operation != operation_name || receipt.payload_digest != digest {
            return Err(OnboardingError::new(
                "request_conflict",
                "This onboarding request identifier was already used for another operation.",
                false,
            )
            .at_revision(document.revision));
        }
        return snapshot(&document, false);
    }
    if document.revision != expected_revision {
        return Err(OnboardingError::new(
            "stale_revision",
            "Onboarding changed after this screen was loaded. Refresh and try again.",
            true,
        )
        .at_revision(document.revision));
    }
    let context = current_config_context(config_path)?;
    operation(&mut document, &context)?;
    advance_revision(&mut document)?;
    document.installation.updated_at = now();
    document.recent_request_receipts.push(RequestReceipt {
        request_id: request_id.to_string(),
        operation: operation_name.to_string(),
        payload_digest: digest,
        resulting_revision: document.revision,
    });
    trim_history(&mut document);
    persist(paths, &document, Some(raw))?;
    snapshot(&document, false)
}

fn classify_installation(
    config_path: &Path,
    config_preexisted: bool,
) -> OnboardingResult<OnboardingDocument> {
    let context = current_config_context(config_path)?;
    let timestamp = now();
    let installation_id = random_id("installation")?;
    if !config_preexisted {
        return Ok(OnboardingDocument {
            schema: SCHEMA_NAME.to_string(),
            schema_version: SCHEMA_VERSION,
            revision: 0,
            installation: InstallationOnboarding {
                id: installation_id,
                readiness: InstallationReadiness::NotStarted,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                migrated_legacy_installation: false,
                legacy_storage_migration: LegacyStorageMigration::NotSeen,
                last_completed_session: None,
            },
            active_session: None,
            events: vec![OnboardingEvent {
                revision: 0,
                at: timestamp,
                code: "freshInstallationDetected".to_string(),
                from_state: None,
                to_state: OnboardingState::NotStarted,
                source: "startup".to_string(),
            }],
            recent_request_receipts: Vec::new(),
        });
    }

    if context.structurally_complete {
        Ok(OnboardingDocument {
            schema: SCHEMA_NAME.to_string(),
            schema_version: SCHEMA_VERSION,
            revision: 0,
            installation: InstallationOnboarding {
                id: installation_id,
                readiness: InstallationReadiness::ReadyLegacy,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                migrated_legacy_installation: true,
                legacy_storage_migration: LegacyStorageMigration::NotSeen,
                last_completed_session: None,
            },
            active_session: None,
            events: vec![OnboardingEvent {
                revision: 0,
                at: timestamp,
                code: "legacyReadyInstallationAdopted".to_string(),
                from_state: None,
                to_state: OnboardingState::ReadyLegacy,
                source: "startup".to_string(),
            }],
            recent_request_receipts: Vec::new(),
        })
    } else {
        let session = OnboardingSession {
            id: random_id("session")?,
            state: OnboardingState::NeedsUserInput,
            mode: OnboardingMode::Manual,
            origin: OnboardingOrigin::LegacyIncompleteMigration,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
            base_config_revision: context.revision,
            manual_progress: None,
            created_folders: Vec::new(),
            failure_code: None,
            deferred_items: Vec::new(),
            verified_config_revision: None,
            apply_intent: None,
        };
        Ok(OnboardingDocument {
            schema: SCHEMA_NAME.to_string(),
            schema_version: SCHEMA_VERSION,
            revision: 0,
            installation: InstallationOnboarding {
                id: installation_id,
                readiness: InstallationReadiness::NotStarted,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                migrated_legacy_installation: true,
                legacy_storage_migration: LegacyStorageMigration::NotSeen,
                last_completed_session: None,
            },
            active_session: Some(session),
            events: vec![OnboardingEvent {
                revision: 0,
                at: timestamp,
                code: "legacyIncompleteInstallationResumable".to_string(),
                from_state: None,
                to_state: OnboardingState::NeedsUserInput,
                source: "startup".to_string(),
            }],
            recent_request_receipts: Vec::new(),
        })
    }
}

fn current_config_context(config_path: &Path) -> OnboardingResult<CurrentConfigContext> {
    let app_bytes = fs::read(config_path).map_err(|_| {
        OnboardingError::new(
            "configuration_unavailable",
            "InnPilot configuration is unavailable during onboarding.",
            true,
        )
    })?;
    let app_text = std::str::from_utf8(&app_bytes).map_err(|_| {
        OnboardingError::new(
            "configuration_invalid",
            "InnPilot configuration is not valid UTF-8.",
            true,
        )
    })?;
    let (app_config, _) = config::parse_config_with_migration_at_path(app_text, config_path)
        .map_err(|_| {
            OnboardingError::new(
                "configuration_invalid",
                "InnPilot configuration could not be validated for onboarding.",
                true,
            )
        })?;
    let automation_path = PathBuf::from(&app_config.automation.automation_config_path);
    let automation_bytes = fs::read(&automation_path).ok();
    let automation_value = automation_bytes
        .as_ref()
        .and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok());
    let configured_hotel = {
        let name = app_config.client.display_name.trim();
        !name.is_empty() && !name.eq_ignore_ascii_case("Your Hotel")
    };
    let automation_has_required_paths = automation_value.as_ref().is_some_and(|value| {
        let path = |key: &str| {
            value
                .pointer(&format!("/paths/{key}"))
                .and_then(Value::as_str)
                .is_some_and(|path| !path.trim().is_empty())
        };
        path("invoiceInputDir")
            && path("invoiceOutputDir")
            && value.get("invoice").is_some_and(Value::is_object)
            && value.get("safety").is_some_and(Value::is_object)
    });
    let structurally_complete = configured_hotel
        && !app_config
            .automation
            .automation_root_folder
            .trim()
            .is_empty()
        && !app_config
            .automation
            .automation_config_path
            .trim()
            .is_empty()
        && !app_config.scripts.invoice_workflow_script.trim().is_empty()
        && !app_config.folders.invoice_input_folder.trim().is_empty()
        && !app_config.folders.invoice_output_folder.trim().is_empty()
        && automation_has_required_paths;
    let revision = setup::configuration_revision(&app_bytes, automation_bytes.as_deref());
    Ok(CurrentConfigContext {
        revision,
        config: app_config,
        structurally_complete,
    })
}

fn finish_reconciled_session(
    document: &mut OnboardingDocument,
    context: &CurrentConfigContext,
) -> OnboardingResult<()> {
    let mut session = document.active_session.take().ok_or_else(|| {
        OnboardingError::new(
            "no_active_session",
            "No interrupted onboarding session was found.",
            true,
        )
    })?;
    let from = session.state.clone();
    if session.verified_config_revision.as_deref() != Some(context.revision.as_str()) {
        return Err(OnboardingError::new(
            "config_changed",
            "The configuration changed after onboarding verification.",
            true,
        )
        .at_revision(document.revision));
    }
    let deferred = session.deferred_items.clone();
    let final_state = if deferred.is_empty() {
        OnboardingState::Ready
    } else {
        OnboardingState::ReadyWithDeferredItems
    };
    session.state = final_state.clone();
    session.updated_at = now();
    document.installation.readiness = if final_state == OnboardingState::Ready {
        InstallationReadiness::Ready
    } else {
        InstallationReadiness::ReadyWithDeferredItems
    };
    let operation_id = session
        .apply_intent
        .as_ref()
        .map(|intent| intent.operation_id.clone());
    let payload_digest = session
        .apply_intent
        .as_ref()
        .map(|intent| intent.payload_digest.clone());
    document.installation.last_completed_session = Some(CompletedSessionSummary {
        id: session.id,
        completed_at: now(),
        resulting_config_revision: context.revision.clone(),
        state: final_state.clone(),
        operation_id,
        payload_digest,
    });
    push_transition_event(
        document,
        from,
        final_state,
        "interruptedApplyReconciled",
        "startup",
    )
}

fn derive_deferred_items(config: &config::HubConfig) -> Vec<String> {
    let mut deferred = preflight::build_preflight_report(config)
        .deferred_workflow_keys()
        .into_iter()
        .filter(|code| valid_code(code))
        .take(MAX_DEFERRED_ITEMS)
        .collect::<Vec<_>>();
    deferred.sort();
    deferred.dedup();
    deferred
}

fn read_document(path: &Path) -> OnboardingResult<(OnboardingDocument, Vec<u8>)> {
    let metadata = fs::metadata(path).map_err(|_| {
        OnboardingError::new(
            "state_missing",
            "InnPilot onboarding state is not available.",
            true,
        )
    })?;
    if metadata.len() > MAX_STATE_BYTES {
        return Err(OnboardingError::new(
            "state_oversized",
            "InnPilot onboarding state exceeds its safe size limit.",
            true,
        ));
    }
    let bytes = fs::read(path).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not read onboarding state.",
            true,
        )
    })?;
    let raw: Value = serde_json::from_slice(&bytes).map_err(|_| {
        OnboardingError::new(
            "corrupt_state",
            "InnPilot onboarding state is damaged and was preserved for recovery.",
            true,
        )
    })?;
    let version = raw
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            OnboardingError::new(
                "corrupt_state",
                "InnPilot onboarding state has no supported schema version.",
                true,
            )
        })?;
    if version > u64::from(SCHEMA_VERSION) {
        return Err(OnboardingError::new(
            "future_schema",
            "This onboarding state was created by a newer InnPilot version.",
            false,
        ));
    }
    if raw.get("schema").and_then(Value::as_str) != Some(SCHEMA_NAME) {
        return Err(OnboardingError::new(
            "corrupt_state",
            "InnPilot onboarding state has an unsupported schema identifier.",
            true,
        ));
    }
    let document: OnboardingDocument = serde_json::from_value(raw).map_err(|_| {
        OnboardingError::new(
            "corrupt_state",
            "InnPilot onboarding state failed semantic validation.",
            true,
        )
    })?;
    validate_document(&document)?;
    Ok((document, bytes))
}

fn persist_new(paths: &StorePaths, document: &OnboardingDocument) -> OnboardingResult<()> {
    if paths.primary.exists() || paths.backup.exists() {
        return Err(OnboardingError::new(
            "persistence_conflict",
            "InnPilot onboarding state appeared while it was being initialized.",
            true,
        ));
    }
    fs::create_dir_all(&paths.directory).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not prepare its private onboarding folder.",
            true,
        )
    })?;
    let bytes = serialize_document(document)?;
    config::atomic_replace_configuration_bytes(&paths.primary, &bytes).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not initialize durable onboarding state.",
            true,
        )
    })
}

fn persist(
    paths: &StorePaths,
    document: &OnboardingDocument,
    current_bytes: Option<Vec<u8>>,
) -> OnboardingResult<()> {
    validate_document(document)?;
    fs::create_dir_all(&paths.directory).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not prepare its private onboarding folder.",
            true,
        )
    })?;
    let next = serialize_document(document)?;
    if let Some(bytes) = current_bytes {
        // The exact validated predecessor is installed before the new primary.
        config::atomic_replace_configuration_bytes(&paths.backup, &bytes).map_err(|_| {
            OnboardingError::new(
                "persistence_failed",
                "InnPilot could not update the onboarding recovery copy.",
                true,
            )
        })?;
    }
    config::atomic_replace_configuration_bytes(&paths.primary, &next).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not atomically update onboarding state.",
            true,
        )
    })
}

fn serialize_document(document: &OnboardingDocument) -> OnboardingResult<Vec<u8>> {
    let bytes = serde_json::to_vec_pretty(document).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not encode onboarding state.",
            true,
        )
    })?;
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err(OnboardingError::new(
            "state_oversized",
            "InnPilot onboarding state exceeds its safe size limit.",
            true,
        ));
    }
    Ok(bytes)
}

fn snapshot(
    document: &OnboardingDocument,
    recovered: bool,
) -> OnboardingResult<OnboardingSnapshot> {
    validate_document(document)?;
    let canonical = serde_json::to_vec(document).map_err(|_| {
        OnboardingError::new(
            "persistence_failed",
            "InnPilot could not prepare the onboarding snapshot.",
            true,
        )
    })?;
    Ok(OnboardingSnapshot {
        schema: document.schema.clone(),
        schema_version: document.schema_version,
        revision: document.revision,
        state: effective_state(document),
        installation: document.installation.clone(),
        active_session: document.active_session.clone(),
        events: document.events.clone(),
        recovered_from_backup: recovered,
        etag: format!("sha256:{:x}", Sha256::digest(canonical)),
    })
}

fn effective_state(document: &OnboardingDocument) -> OnboardingState {
    if let Some(session) = &document.active_session {
        return session.state.clone();
    }
    match document.installation.readiness {
        InstallationReadiness::NotStarted => OnboardingState::NotStarted,
        InstallationReadiness::Ready => OnboardingState::Ready,
        InstallationReadiness::ReadyWithDeferredItems => OnboardingState::ReadyWithDeferredItems,
        InstallationReadiness::ReadyLegacy => OnboardingState::ReadyLegacy,
    }
}

fn advance_revision(document: &mut OnboardingDocument) -> OnboardingResult<()> {
    document.revision = document.revision.checked_add(1).ok_or_else(|| {
        OnboardingError::new(
            "revision_overflow",
            "InnPilot onboarding revision cannot advance safely.",
            false,
        )
    })?;
    for event in document
        .events
        .iter_mut()
        .rev()
        .take_while(|event| event.revision == u64::MAX)
    {
        event.revision = document.revision;
    }
    Ok(())
}

fn push_transition_event(
    document: &mut OnboardingDocument,
    from: OnboardingState,
    to: OnboardingState,
    code: &str,
    source: &str,
) -> OnboardingResult<()> {
    if !allowed_transition(&from, &to) && from != to {
        return invalid_transition(document, &from, to);
    }
    document.events.push(OnboardingEvent {
        revision: u64::MAX,
        at: now(),
        code: code.to_string(),
        from_state: Some(from),
        to_state: to,
        source: source.to_string(),
    });
    Ok(())
}

fn push_same_state_event(
    document: &mut OnboardingDocument,
    state: OnboardingState,
    code: &str,
    source: &str,
) -> OnboardingResult<()> {
    push_transition_event(document, state.clone(), state, code, source)
}

fn append_event(
    document: &mut OnboardingDocument,
    from: OnboardingState,
    to: OnboardingState,
    code: &str,
    source: &str,
) -> OnboardingResult<()> {
    push_transition_event(document, from, to, code, source)
}

fn allowed_transition(from: &OnboardingState, to: &OnboardingState) -> bool {
    use OnboardingState::*;
    matches!(
        (from, to),
        (NotStarted, BootstrapCreated)
            | (
                BootstrapCreated,
                WaitingForAgent | NeedsUserInput | FailedRecoverable
            )
            | (
                WaitingForAgent,
                AgentConnected | NeedsUserInput | FailedRecoverable | BootstrapCreated
            )
            | (
                AgentConnected,
                ScopeApprovalRequired
                    | WaitingForAgent
                    | NeedsUserInput
                    | FailedRecoverable
                    | BootstrapCreated
            )
            | (
                ScopeApprovalRequired,
                DiscoveryRunning
                    | WaitingForAgent
                    | NeedsUserInput
                    | FailedRecoverable
                    | BootstrapCreated
            )
            | (
                DiscoveryRunning,
                NeedsUserInput
                    | ScopeApprovalRequired
                    | ProposalReady
                    | FailedRecoverable
                    | BootstrapCreated
            )
            | (
                NeedsUserInput,
                DiscoveryRunning
                    | ScopeApprovalRequired
                    | ProposalReady
                    | Applying
                    | FailedRecoverable
                    | BootstrapCreated
            )
            | (
                ProposalReady,
                WaitingForApproval
                    | DiscoveryRunning
                    | NeedsUserInput
                    | FailedRecoverable
                    | BootstrapCreated
            )
            | (
                WaitingForApproval,
                Applying | ProposalReady | FailedRecoverable | BootstrapCreated
            )
            | (
                Applying,
                Verifying | FailedRecoverable | RolledBack | NeedsUserInput
            )
            | (
                Verifying,
                Ready | ReadyWithDeferredItems | FailedRecoverable | RolledBack
            )
            | (
                FailedRecoverable,
                NeedsUserInput | BootstrapCreated | RolledBack
            )
            | (
                RolledBack,
                NeedsUserInput
                    | BootstrapCreated
                    | ScopeApprovalRequired
                    | ProposalReady
                    | FailedRecoverable
            )
            | (Ready, BootstrapCreated)
            | (ReadyWithDeferredItems, BootstrapCreated)
            | (ReadyLegacy, BootstrapCreated)
    ) || from == to
}

fn invalid_transition<T>(
    document: &OnboardingDocument,
    _from: &OnboardingState,
    _to: OnboardingState,
) -> OnboardingResult<T> {
    Err(OnboardingError::new(
        "invalid_transition",
        "That onboarding transition is not allowed from the current state.",
        true,
    )
    .at_revision(document.revision))
}

fn active_session_mut(
    document: &mut OnboardingDocument,
) -> OnboardingResult<&mut OnboardingSession> {
    let revision = document.revision;
    document.active_session.as_mut().ok_or_else(|| {
        OnboardingError::new(
            "no_active_session",
            "No onboarding session is active.",
            true,
        )
        .at_revision(revision)
    })
}

fn prepare_apply_intent_transition(
    document: &mut OnboardingDocument,
    context: &CurrentConfigContext,
    expected_config_revision: &str,
    intent: ApplyIntent,
) -> OnboardingResult<()> {
    let (state, mode, has_progress, base_revision) = document
        .active_session
        .as_ref()
        .map(|session| {
            (
                session.state.clone(),
                session.mode.clone(),
                session.manual_progress.is_some(),
                session.base_config_revision.clone(),
            )
        })
        .ok_or_else(|| {
            OnboardingError::new(
                "no_active_session",
                "No onboarding session is active.",
                true,
            )
            .at_revision(document.revision)
        })?;
    if mode != OnboardingMode::Manual {
        return Err(OnboardingError::new(
            "feature_unavailable",
            "Agent-originated apply is not enabled.",
            false,
        )
        .at_revision(document.revision));
    }
    if !has_progress {
        return Err(OnboardingError::new(
            "progress_required",
            "Save manual onboarding progress before applying it.",
            true,
        )
        .at_revision(document.revision));
    }
    if context.revision != expected_config_revision
        || base_revision != expected_config_revision
        || intent.base_config_revision != expected_config_revision
    {
        return Err(OnboardingError::new(
            "config_changed",
            "InnPilot configuration changed before setup could be applied.",
            true,
        )
        .at_revision(document.revision));
    }
    if intent.target_config_revision == intent.base_config_revision
        && !context.structurally_complete
    {
        return Err(OnboardingError::new(
            "validation_failed",
            "The installed configuration is still incomplete.",
            true,
        )
        .at_revision(document.revision));
    }
    if state != OnboardingState::NeedsUserInput {
        return invalid_transition(document, &state, OnboardingState::Applying);
    }
    let session = active_session_mut(document)?;
    session.state = OnboardingState::Applying;
    session.updated_at = now();
    session.failure_code = None;
    session.verified_config_revision = None;
    session.deferred_items.clear();
    session.apply_intent = Some(intent);
    push_transition_event(
        document,
        state,
        OnboardingState::Applying,
        "approvedApplyIntentRecorded",
        "backend",
    )
}

fn apply_operation_matches(
    document: &OnboardingDocument,
    operation_id: &str,
    payload_digest: &str,
) -> OnboardingResult<bool> {
    let active = document
        .active_session
        .as_ref()
        .and_then(|session| session.apply_intent.as_ref())
        .map(|intent| (&intent.operation_id, &intent.payload_digest));
    let completed = document
        .installation
        .last_completed_session
        .as_ref()
        .and_then(|session| {
            session
                .operation_id
                .as_ref()
                .zip(session.payload_digest.as_ref())
        });
    for (saved_id, saved_digest) in active.into_iter().chain(completed) {
        if saved_id == operation_id {
            if saved_digest != payload_digest {
                return Err(OnboardingError::new(
                    "request_conflict",
                    "This setup operation identifier was already used for another candidate.",
                    false,
                )
                .at_revision(document.revision));
            }
            return Ok(true);
        }
    }
    Ok(false)
}

fn trim_history(document: &mut OnboardingDocument) {
    if document.events.len() > MAX_EVENTS {
        document.events.drain(0..document.events.len() - MAX_EVENTS);
    }
    if document.recent_request_receipts.len() > MAX_RECEIPTS {
        document
            .recent_request_receipts
            .drain(0..document.recent_request_receipts.len() - MAX_RECEIPTS);
    }
}

fn validate_document(document: &OnboardingDocument) -> OnboardingResult<()> {
    if document.schema != SCHEMA_NAME || document.schema_version != SCHEMA_VERSION {
        return Err(OnboardingError::new(
            "corrupt_state",
            "InnPilot onboarding state has inconsistent schema metadata.",
            true,
        ));
    }
    if document.installation.id.is_empty() || document.installation.id.len() > 96 {
        return Err(OnboardingError::new(
            "corrupt_state",
            "InnPilot onboarding state has an invalid installation identifier.",
            true,
        ));
    }
    if document.events.len() > MAX_EVENTS || document.recent_request_receipts.len() > MAX_RECEIPTS {
        return Err(OnboardingError::new(
            "corrupt_state",
            "InnPilot onboarding history exceeds its safe bounds.",
            true,
        ));
    }
    if let Some(session) = &document.active_session {
        if session.id.is_empty()
            || session.id.len() > 96
            || session.base_config_revision.len() > 80
            || session.created_folders.len() > MAX_CREATED_FOLDERS
            || session.deferred_items.len() > MAX_DEFERRED_ITEMS
            || matches!(
                session.state,
                OnboardingState::Ready
                    | OnboardingState::ReadyLegacy
                    | OnboardingState::ReadyWithDeferredItems
            )
        {
            return Err(OnboardingError::new(
                "corrupt_state",
                "InnPilot onboarding session violates its state invariants.",
                true,
            ));
        }
        if let Some(checkpoint) = &session.manual_progress {
            validate_checkpoint(checkpoint.clone())?;
        }
        if let Some(intent) = &session.apply_intent {
            if intent.base_config_revision != session.base_config_revision
                || validate_apply_identity(&intent.operation_id, &intent.payload_digest).is_err()
                || validate_config_revision(&intent.base_config_revision).is_err()
                || validate_config_revision(&intent.target_config_revision).is_err()
                || validate_recovery_point_id(intent.recovery_point_id.as_deref()).is_err()
            {
                return Err(OnboardingError::new(
                    "corrupt_state",
                    "InnPilot onboarding state has invalid setup-application evidence.",
                    true,
                ));
            }
        }
    }
    if let Some(completed) = &document.installation.last_completed_session {
        match (&completed.operation_id, &completed.payload_digest) {
            (Some(operation_id), Some(payload_digest))
                if validate_apply_identity(operation_id, payload_digest).is_ok() => {}
            (None, None) => {}
            _ => {
                return Err(OnboardingError::new(
                    "corrupt_state",
                    "InnPilot completed onboarding evidence has an invalid operation identity.",
                    true,
                ));
            }
        }
    }
    for event in &document.events {
        if !valid_code(&event.code)
            || !valid_code(&event.source)
            || event.revision > document.revision
        {
            return Err(OnboardingError::new(
                "corrupt_state",
                "InnPilot onboarding history contains invalid metadata.",
                true,
            ));
        }
    }
    Ok(())
}

fn validate_checkpoint(
    mut checkpoint: ManualSetupCheckpoint,
) -> OnboardingResult<ManualSetupCheckpoint> {
    const STEP_KEYS: [&str; 11] = [
        "welcome",
        "mode",
        "profile",
        "workspace",
        "folders",
        "gmail",
        "invoices",
        "contracts",
        "safety",
        "review",
        "finish",
    ];
    const ACTIONS: [&str; 4] = ["preview", "initialize", "save", "validate"];
    const DRAFT_KEYS: [&str; 28] = [
        "setupMode",
        "hotelDisplayName",
        "emailSignatureName",
        "workspaceBase",
        "pythonExecutable",
        "invoiceDeliveryMode",
        "invoiceFileSelectionMode",
        "gmailSubject",
        "ccEmail",
        "gmailCredentialsFile",
        "gmailTokenFile",
        "invoiceInputFolder",
        "invoiceOutputFolder",
        "invoiceArchiveFolder",
        "invoiceLogFolder",
        "invoiceInputPatterns",
        "recipientRules",
        "contractYear",
        "scannerFilenamePrefixes",
        "contractMarkerTexts",
        "sharedScanFolder",
        "scansLocalCacheFolder",
        "ocrTextOutputFolder",
        "signedContractsOutputFolder",
        "contractLogFolder",
        "safeMode",
        "archiveOriginals",
        "redactLogs",
    ];
    if !STEP_KEYS.contains(&checkpoint.step_key.as_str()) {
        return Err(OnboardingError::new(
            "validation_failed",
            "The saved onboarding step is not recognized.",
            true,
        ));
    }
    if checkpoint.completed_actions.len() > ACTIONS.len()
        || checkpoint
            .completed_actions
            .iter()
            .any(|action| !ACTIONS.contains(&action.as_str()))
    {
        return Err(OnboardingError::new(
            "validation_failed",
            "The saved onboarding action list is invalid.",
            true,
        ));
    }
    checkpoint.completed_actions.sort();
    checkpoint.completed_actions.dedup();
    let object = checkpoint.draft.as_object().ok_or_else(|| {
        OnboardingError::new(
            "validation_failed",
            "The manual setup checkpoint must contain a typed draft.",
            true,
        )
    })?;
    let allowed = DRAFT_KEYS.into_iter().collect::<BTreeSet<_>>();
    if object.keys().any(|key| !allowed.contains(key.as_str())) {
        return Err(OnboardingError::new(
            "validation_failed",
            "The manual setup checkpoint contains an unsupported field.",
            true,
        ));
    }
    let recipient_rules = object
        .get("recipientRules")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            OnboardingError::new(
                "validation_failed",
                "The manual setup checkpoint has invalid recipient rules.",
                true,
            )
        })?;
    if recipient_rules.iter().any(|rule| {
        rule.get("id")
            .and_then(Value::as_str)
            .is_none_or(|id| id.is_empty() || id.len() > 128)
    }) {
        return Err(OnboardingError::new(
            "validation_failed",
            "Every saved recipient rule must have a stable identifier.",
            true,
        ));
    }
    if contains_forbidden_checkpoint_content(&checkpoint.draft) {
        return Err(OnboardingError::new(
            "validation_failed",
            "The manual setup checkpoint appears to contain credentials or raw diagnostics.",
            true,
        ));
    }
    validate_json_bounds(&checkpoint.draft, 0)?;
    let typed: setup::SetupDraft = serde_json::from_value(checkpoint.draft).map_err(|_| {
        OnboardingError::new(
            "validation_failed",
            "The manual setup checkpoint contains invalid values.",
            true,
        )
    })?;
    checkpoint.draft = serde_json::to_value(typed).map_err(|_| {
        OnboardingError::new(
            "validation_failed",
            "The manual setup checkpoint could not be normalized.",
            true,
        )
    })?;
    let bytes = serde_json::to_vec(&checkpoint).map_err(|_| {
        OnboardingError::new(
            "validation_failed",
            "The manual setup checkpoint could not be measured.",
            true,
        )
    })?;
    if bytes.len() > MAX_LEGACY_BYTES {
        return Err(OnboardingError::new(
            "validation_failed",
            "The manual setup checkpoint exceeds its safe size limit.",
            true,
        ));
    }
    Ok(checkpoint)
}

fn contains_forbidden_checkpoint_content(value: &Value) -> bool {
    const FORBIDDEN_MARKERS: [&str; 7] = [
        "\"refresh_token\"",
        "\"access_token\"",
        "\"client_secret\"",
        "\"private_key\"",
        "\"password\"",
        "-----begin private key",
        "traceback (most recent call last)",
    ];
    match value {
        Value::String(value) => {
            let lower = value.to_ascii_lowercase();
            FORBIDDEN_MARKERS
                .iter()
                .any(|marker| lower.contains(marker))
        }
        Value::Array(values) => values.iter().any(contains_forbidden_checkpoint_content),
        Value::Object(values) => values.values().any(contains_forbidden_checkpoint_content),
        _ => false,
    }
}

fn validate_json_bounds(value: &Value, depth: usize) -> OnboardingResult<()> {
    if depth > 8 {
        return Err(OnboardingError::new(
            "validation_failed",
            "The manual setup checkpoint is too deeply nested.",
            true,
        ));
    }
    match value {
        Value::String(value) if value.chars().count() > 4096 => Err(OnboardingError::new(
            "validation_failed",
            "A manual setup value exceeds its safe length limit.",
            true,
        )),
        Value::Array(values) if values.len() > 256 => Err(OnboardingError::new(
            "validation_failed",
            "A manual setup list exceeds its safe item limit.",
            true,
        )),
        Value::Array(values) => {
            for value in values {
                validate_json_bounds(value, depth + 1)?;
            }
            Ok(())
        }
        Value::Object(values) if values.len() > 64 => Err(OnboardingError::new(
            "validation_failed",
            "A manual setup object exceeds its safe field limit.",
            true,
        )),
        Value::Object(values) => {
            for value in values.values() {
                validate_json_bounds(value, depth + 1)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

#[derive(Debug, Serialize)]
struct LegacyParsed {
    draft: Value,
    base_revision: Option<String>,
    step_key: String,
    show_advanced_workflows: bool,
    digest_source: Value,
}

fn parse_legacy_session(raw: &str) -> OnboardingResult<LegacyParsed> {
    const TOP_LEVEL: [&str; 7] = [
        "version",
        "draft",
        "baseRevision",
        "showAdvancedWorkflows",
        "stepKey",
        "completedActions",
        "createdFolderPaths",
    ];
    let value: Value = serde_json::from_str(raw).map_err(|_| {
        OnboardingError::new(
            "legacy_invalid",
            "Legacy setup progress is not valid JSON.",
            true,
        )
    })?;
    let object = value.as_object().ok_or_else(|| {
        OnboardingError::new(
            "legacy_invalid",
            "Legacy setup progress must be a JSON object.",
            true,
        )
    })?;
    let allowed = TOP_LEVEL.into_iter().collect::<BTreeSet<_>>();
    if object.keys().any(|key| !allowed.contains(key.as_str()))
        || object.get("version").and_then(Value::as_u64) != Some(1)
    {
        return Err(OnboardingError::new(
            "legacy_invalid",
            "Legacy setup progress has an unsupported schema.",
            true,
        ));
    }
    let draft = object.get("draft").cloned().ok_or_else(|| {
        OnboardingError::new(
            "legacy_invalid",
            "Legacy setup progress has no manual draft.",
            true,
        )
    })?;
    let base_revision = match object.get("baseRevision") {
        Some(Value::String(value)) if value.len() <= 80 => Some(value.clone()),
        Some(Value::Null) | None => None,
        _ => {
            return Err(OnboardingError::new(
                "legacy_invalid",
                "Legacy setup progress has an invalid configuration revision.",
                true,
            ))
        }
    };
    let step_key = object
        .get("stepKey")
        .and_then(Value::as_str)
        .unwrap_or("welcome")
        .to_string();
    let show_advanced_workflows = object
        .get("showAdvancedWorkflows")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    // Deliberately exclude browser completion and created-path claims from the
    // digest/imported data. Their presence is tolerated for v1 compatibility.
    let digest_source = json!({
        "version": 1,
        "draft": draft,
        "baseRevision": base_revision,
        "showAdvancedWorkflows": show_advanced_workflows,
        "stepKey": step_key,
    });
    Ok(LegacyParsed {
        draft: digest_source["draft"].clone(),
        base_revision: digest_source["baseRevision"].as_str().map(str::to_string),
        step_key: digest_source["stepKey"]
            .as_str()
            .unwrap_or("welcome")
            .to_string(),
        show_advanced_workflows,
        digest_source,
    })
}

fn valid_code(value: &str) -> bool {
    let length = value.len();
    (1..=96).contains(&length)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn validate_request_id(value: &str) -> OnboardingResult<()> {
    if value.len() < 8
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(OnboardingError::new(
            "validation_failed",
            "The onboarding request identifier is invalid.",
            true,
        ));
    }
    Ok(())
}

fn validate_apply_identity(operation_id: &str, payload_digest: &str) -> OnboardingResult<()> {
    validate_request_id(operation_id)?;
    validate_config_revision(payload_digest).map_err(|_| {
        OnboardingError::new(
            "validation_failed",
            "The setup operation payload digest is invalid.",
            true,
        )
    })
}

fn validate_config_revision(value: &str) -> OnboardingResult<()> {
    let Some(digest) = value.strip_prefix("sha256:") else {
        return Err(OnboardingError::new(
            "validation_failed",
            "The configuration revision is invalid.",
            true,
        ));
    };
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(OnboardingError::new(
            "validation_failed",
            "The configuration revision is invalid.",
            true,
        ));
    }
    Ok(())
}

fn validate_recovery_point_id(value: Option<&str>) -> OnboardingResult<()> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.len() < 20
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(OnboardingError::new(
            "validation_failed",
            "The setup recovery point identifier is invalid.",
            true,
        ));
    }
    Ok(())
}

fn request_digest<T: Serialize>(operation: &str, payload: &T) -> OnboardingResult<String> {
    let payload = serde_json::to_vec(payload).map_err(|_| {
        OnboardingError::new(
            "validation_failed",
            "The onboarding request payload could not be validated.",
            true,
        )
    })?;
    let mut digest = Sha256::new();
    digest.update(b"innpilot-onboarding-request-v1\0");
    digest.update(operation.as_bytes());
    digest.update([0]);
    digest.update(payload);
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn random_id(prefix: &str) -> OnboardingResult<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        OnboardingError::new(
            "random_unavailable",
            "InnPilot could not create a secure onboarding identifier.",
            true,
        )
    })?;
    Ok(format!(
        "{prefix}-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "innpilot_onboarding_{label}_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn configured_store(label: &str, complete: bool) -> (PathBuf, PathBuf, StorePaths) {
        let root = temp_root(label);
        let config_path = root.join("config.json");
        let automation_root = root.join("automation");
        let automation_path = automation_root.join("config.local.json");
        fs::create_dir_all(&automation_root).unwrap();

        let mut hub = config::default_config();
        hub.client.display_name = if complete {
            "Fixture Hotel".to_string()
        } else {
            "Your Hotel".to_string()
        };
        hub.automation.automation_root_folder = automation_root.to_string_lossy().to_string();
        hub.automation.automation_config_path = automation_path.to_string_lossy().to_string();
        hub.scripts.invoice_workflow_script = root
            .join("scripts")
            .join("invoice.py")
            .to_string_lossy()
            .to_string();
        hub.folders.invoice_input_folder =
            root.join("invoices/input").to_string_lossy().to_string();
        hub.folders.invoice_output_folder =
            root.join("invoices/output").to_string_lossy().to_string();
        fs::write(&config_path, serde_json::to_vec_pretty(&hub).unwrap()).unwrap();

        if complete {
            fs::write(
                &automation_path,
                serde_json::to_vec_pretty(&json!({
                    "paths": {
                        "invoiceInputDir": hub.folders.invoice_input_folder,
                        "invoiceOutputDir": hub.folders.invoice_output_folder
                    },
                    "invoice": { "recipientRules": [] },
                    "safety": { "dryRunDefault": true }
                }))
                .unwrap(),
            )
            .unwrap();
        }
        let paths = store_paths(&config_path).unwrap();
        (root, config_path, paths)
    }

    fn manual_draft(root: &Path) -> Value {
        let path = |suffix: &str| root.join(suffix).to_string_lossy().to_string();
        json!({
            "setupMode": "existingFolders",
            "hotelDisplayName": "Fixture Hotel",
            "emailSignatureName": "Fixture Team",
            "workspaceBase": path("workspace"),
            "pythonExecutable": path("python.exe"),
            "invoiceDeliveryMode": "gmailDrafts",
            "invoiceFileSelectionMode": "filenamePatterns",
            "gmailSubject": "Fixture invoices",
            "ccEmail": "copy@fixture.invalid",
            "gmailCredentialsFile": path("credentials.json"),
            "gmailTokenFile": path("token.json"),
            "invoiceInputFolder": path("invoices/input"),
            "invoiceOutputFolder": path("invoices/output"),
            "invoiceArchiveFolder": path("invoices/archive"),
            "invoiceLogFolder": path("invoices/logs"),
            "invoiceInputPatterns": ["*.pdf", "INV-*.pdf"],
            "recipientRules": [{
                "id": "installed-rule-0",
                "matchText": "fixture partner",
                "email": "partner@fixture.invalid"
            }],
            "contractYear": "2026",
            "scannerFilenamePrefixes": ["Fixture Scanner"],
            "contractMarkerTexts": ["Fixture contract"],
            "sharedScanFolder": path("scans/shared"),
            "scansLocalCacheFolder": path("scans/cache"),
            "ocrTextOutputFolder": path("scans/text"),
            "signedContractsOutputFolder": path("contracts/signed"),
            "contractLogFolder": path("contracts/logs"),
            "safeMode": true,
            "archiveOriginals": true,
            "redactLogs": true
        })
    }

    fn checkpoint(root: &Path) -> ManualSetupCheckpoint {
        ManualSetupCheckpoint {
            draft: manual_draft(root),
            step_key: "workspace".to_string(),
            show_advanced_workflows: false,
            completed_actions: Vec::new(),
        }
    }

    fn active_session(context: &CurrentConfigContext, state: OnboardingState) -> OnboardingSession {
        OnboardingSession {
            id: "session-fixture-0001".to_string(),
            state,
            mode: OnboardingMode::Manual,
            origin: OnboardingOrigin::FreshInstall,
            created_at: now(),
            updated_at: now(),
            base_config_revision: context.revision.clone(),
            manual_progress: None,
            created_folders: Vec::new(),
            failure_code: None,
            deferred_items: Vec::new(),
            verified_config_revision: None,
            apply_intent: None,
        }
    }

    fn path_service(root: &Path, config_path: &Path) -> OnboardingService {
        OnboardingService::new(config_path.to_path_buf(), root.join("runner")).unwrap()
    }

    fn fixture_revision(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }

    fn fixture_intent(base_config_revision: String, target_config_revision: String) -> ApplyIntent {
        ApplyIntent {
            operation_id: "apply-operation-0001".to_string(),
            payload_digest: fixture_revision('a'),
            base_config_revision,
            target_config_revision,
            recovery_point_id: Some("20260818T000000000Z-abcd".to_string()),
            workspace_initialized: false,
        }
    }

    #[test]
    fn fresh_installation_is_classified_without_touching_configuration() {
        let (_root, config_path, paths) = configured_store("fresh", true);
        let before = fs::read(&config_path).unwrap();
        let document = classify_installation(&config_path, false).unwrap();
        assert_eq!(
            document.installation.readiness,
            InstallationReadiness::NotStarted
        );
        assert!(document.active_session.is_none());

        persist_new(&paths, &document).unwrap();
        let (reloaded, _) = read_document(&paths.primary).unwrap();
        assert_eq!(reloaded.revision, 0);
        assert_eq!(effective_state(&reloaded), OnboardingState::NotStarted);
        assert_eq!(fs::read(&config_path).unwrap(), before);
    }

    #[test]
    fn persisted_state_reloads_with_same_identity_and_revision() {
        let (_root, config_path, paths) = configured_store("reload", true);
        let document = classify_installation(&config_path, false).unwrap();
        let installation_id = document.installation.id.clone();
        persist_new(&paths, &document).unwrap();

        let (first, bytes) = read_document(&paths.primary).unwrap();
        let (second, second_bytes) = read_document(&paths.primary).unwrap();
        assert_eq!(first.installation.id, installation_id);
        assert_eq!(first.revision, second.revision);
        assert_eq!(bytes, second_bytes);
    }

    #[test]
    fn existing_ready_and_incomplete_installations_are_distinguished() {
        let (_ready_root, ready_config, _) = configured_store("ready_legacy", true);
        let ready = classify_installation(&ready_config, true).unwrap();
        assert_eq!(
            ready.installation.readiness,
            InstallationReadiness::ReadyLegacy
        );
        assert_eq!(effective_state(&ready), OnboardingState::ReadyLegacy);
        assert!(ready.active_session.is_none());

        let (_incomplete_root, incomplete_config, _) = configured_store("incomplete", false);
        let incomplete = classify_installation(&incomplete_config, true).unwrap();
        assert_eq!(
            incomplete.installation.readiness,
            InstallationReadiness::NotStarted
        );
        let session = incomplete.active_session.unwrap();
        assert_eq!(session.state, OnboardingState::NeedsUserInput);
        assert_eq!(session.origin, OnboardingOrigin::LegacyIncompleteMigration);
    }

    #[test]
    fn restored_incomplete_configuration_reopens_review_for_ready_installation() {
        let (root, config_path, paths) = configured_store("restored_incomplete", true);
        let document = classify_installation(&config_path, true).unwrap();
        assert_eq!(
            document.installation.readiness,
            InstallationReadiness::ReadyLegacy
        );
        persist_new(&paths, &document).unwrap();
        fs::remove_file(root.join("automation").join("config.local.json")).unwrap();

        let snapshot = path_service(&root, &config_path)
            .reconcile_startup(true)
            .unwrap();

        assert_eq!(snapshot.state(), OnboardingState::BootstrapCreated);
        assert!(snapshot.active_session.is_some());
        assert_eq!(
            snapshot.installation.readiness,
            InstallationReadiness::ReadyLegacy
        );
    }

    #[test]
    fn transition_graph_accepts_expected_edges_and_rejects_terminal_rewind() {
        use OnboardingState::*;
        let valid = [
            (NotStarted, BootstrapCreated),
            (BootstrapCreated, NeedsUserInput),
            (NeedsUserInput, Applying),
            (Applying, Verifying),
            (Verifying, Ready),
            (Ready, BootstrapCreated),
            (FailedRecoverable, RolledBack),
        ];
        for (from, to) in valid {
            assert!(allowed_transition(&from, &to), "{from:?} -> {to:?}");
        }
        assert!(!allowed_transition(&Ready, &NeedsUserInput));
        assert!(!allowed_transition(&ReadyLegacy, &Applying));
        assert!(!allowed_transition(&Verifying, &BootstrapCreated));
    }

    #[test]
    fn failed_session_can_resume_without_losing_checkpoint() {
        let (root, config_path, paths) = configured_store("resume", true);
        let context = current_config_context(&config_path).unwrap();
        let mut document = classify_installation(&config_path, false).unwrap();
        let mut session = active_session(&context, OnboardingState::FailedRecoverable);
        session.manual_progress = Some(validate_checkpoint(checkpoint(&root)).unwrap());
        session.failure_code = Some("validation_failed".to_string());
        document.active_session = Some(session);
        persist_new(&paths, &document).unwrap();

        let digest = request_digest("resumeTest", &"manual").unwrap();
        let snapshot = mutate_locked(
            &paths,
            &config_path,
            0,
            "request-resume-0001",
            "resumeTest",
            digest,
            |document, _| {
                let session = active_session_mut(document)?;
                let from = session.state.clone();
                session.state = OnboardingState::NeedsUserInput;
                session.failure_code = None;
                push_transition_event(
                    document,
                    from,
                    OnboardingState::NeedsUserInput,
                    "onboardingResumed",
                    "test",
                )
            },
        )
        .unwrap();
        assert_eq!(snapshot.state, OnboardingState::NeedsUserInput);
        assert!(snapshot.active_session.unwrap().manual_progress.is_some());
    }

    #[test]
    fn stale_revision_and_conflicting_duplicate_request_do_not_write() {
        let (_root, config_path, paths) = configured_store("cas", true);
        let document = classify_installation(&config_path, false).unwrap();
        persist_new(&paths, &document).unwrap();
        let digest = request_digest("testMutation", &"one").unwrap();
        let first = mutate_locked(
            &paths,
            &config_path,
            0,
            "request-cas-0001",
            "testMutation",
            digest.clone(),
            |document, _| {
                push_same_state_event(document, effective_state(document), "testMutation", "test")
            },
        )
        .unwrap();
        assert_eq!(first.revision, 1);
        let after_first = fs::read(&paths.primary).unwrap();

        let retry = mutate_locked(
            &paths,
            &config_path,
            0,
            "request-cas-0001",
            "testMutation",
            digest,
            |_document, _| panic!("idempotent retry must not execute"),
        )
        .unwrap();
        assert_eq!(retry.revision, 1);
        assert_eq!(fs::read(&paths.primary).unwrap(), after_first);

        let conflict = mutate_locked(
            &paths,
            &config_path,
            1,
            "request-cas-0001",
            "testMutation",
            request_digest("testMutation", &"different").unwrap(),
            |_document, _| Ok(()),
        )
        .unwrap_err();
        assert_eq!(conflict.code, "request_conflict");

        let stale = mutate_locked(
            &paths,
            &config_path,
            0,
            "request-cas-0002",
            "testMutation",
            request_digest("testMutation", &"two").unwrap(),
            |_document, _| Ok(()),
        )
        .unwrap_err();
        assert_eq!(stale.code, "stale_revision");
        assert_eq!(fs::read(&paths.primary).unwrap(), after_first);
    }

    fn legacy_json(root: &Path, revision: Option<&str>) -> String {
        serde_json::to_string(&json!({
            "version": 1,
            "draft": manual_draft(root),
            "baseRevision": revision,
            "showAdvancedWorkflows": true,
            "stepKey": "workspace",
            "completedActions": ["save"],
            "createdFolderPaths": [root.join("untrusted").to_string_lossy()]
        }))
        .unwrap()
    }

    #[test]
    fn valid_legacy_progress_imports_only_typed_resume_data() {
        let (root, config_path, _) = configured_store("legacy_valid", true);
        let context = current_config_context(&config_path).unwrap();
        let mut document = classify_installation(&config_path, false).unwrap();
        let legacy = parse_legacy_session(&legacy_json(&root, Some(&context.revision))).unwrap();

        apply_legacy_import(&mut document, &context, &legacy).unwrap();
        assert_eq!(
            document.installation.legacy_storage_migration,
            LegacyStorageMigration::Imported
        );
        let session = document.active_session.unwrap();
        assert_eq!(session.state, OnboardingState::NeedsUserInput);
        assert!(session.created_folders.is_empty());
        assert!(session
            .manual_progress
            .unwrap()
            .completed_actions
            .is_empty());
    }

    #[test]
    fn stale_legacy_progress_is_terminal_and_idempotent() {
        let (root, config_path, _) = configured_store("legacy_stale", true);
        let context = current_config_context(&config_path).unwrap();
        let mut document = classify_installation(&config_path, false).unwrap();
        let legacy = parse_legacy_session(&legacy_json(&root, Some("sha256:stale"))).unwrap();

        apply_legacy_import(&mut document, &context, &legacy).unwrap();
        assert_eq!(
            document.installation.legacy_storage_migration,
            LegacyStorageMigration::DiscardedStale
        );
        let events = document.events.len();
        apply_legacy_import(&mut document, &context, &legacy).unwrap();
        assert_eq!(document.events.len(), events);
        assert!(document.active_session.is_none());
    }

    #[test]
    fn malformed_and_oversized_legacy_progress_are_terminally_discarded() {
        let (_root, config_path, _) = configured_store("legacy_invalid", false);

        for raw in [
            "not-json".to_string(),
            json!({"version": 1, "draft": {}, "unexpected": true}).to_string(),
            "x".repeat(MAX_LEGACY_BYTES + 1),
        ] {
            let error = if raw.len() > MAX_LEGACY_BYTES {
                OnboardingError::new(
                    "legacy_invalid",
                    "Legacy setup progress is too large to import safely.",
                    true,
                )
            } else {
                parse_legacy_session(&raw).unwrap_err()
            };
            assert_eq!(error.code, "legacy_invalid");

            let mut document = classify_installation(&config_path, false).unwrap();
            record_invalid_legacy_migration(&mut document).unwrap();
            assert_eq!(
                document.installation.legacy_storage_migration,
                LegacyStorageMigration::DiscardedInvalid
            );
            assert_eq!(
                document.events.last().unwrap().code,
                "legacyProgressDiscardedInvalid"
            );

            // This mirrors import_legacy's authoritative terminal short-circuit:
            // once discarded, a retry returns the current snapshot unchanged.
            let event_count = document.events.len();
            if document.installation.legacy_storage_migration == LegacyStorageMigration::NotSeen {
                record_invalid_legacy_migration(&mut document).unwrap();
            }
            assert_eq!(document.events.len(), event_count);
        }
    }

    #[test]
    fn corrupt_primary_can_be_explicitly_recovered_from_exact_backup() {
        let (_root, config_path, paths) = configured_store("recover", true);
        let document = classify_installation(&config_path, false).unwrap();
        persist_new(&paths, &document).unwrap();
        let original = fs::read(&paths.primary).unwrap();
        let digest = request_digest("backupCreator", &true).unwrap();
        mutate_locked(
            &paths,
            &config_path,
            0,
            "request-backup-0001",
            "backupCreator",
            digest,
            |document, _| {
                push_same_state_event(document, effective_state(document), "backupCreated", "test")
            },
        )
        .unwrap();
        assert_eq!(fs::read(&paths.backup).unwrap(), original);
        fs::write(&paths.primary, b"{damaged").unwrap();

        let recovered = recover_locked(&paths).unwrap();
        assert!(recovered.recovered_from_backup);
        assert_eq!(recovered.revision, 2);
        assert_eq!(read_document(&paths.primary).unwrap().0.revision, 2);

        let stale = mutate_locked(
            &paths,
            &config_path,
            1,
            "request-after-recovery-stale-0001",
            "afterRecovery",
            request_digest("afterRecovery", &true).unwrap(),
            |_document, _| Ok(()),
        )
        .unwrap_err();
        assert_eq!(stale.code, "stale_revision");
        assert_eq!(stale.current_revision, Some(2));

        fs::write(&paths.primary, b"{damaged-again").unwrap();
        let recovered_again = recover_locked(&paths).unwrap();
        assert_eq!(recovered_again.revision, 4);
        assert_eq!(read_document(&paths.backup).unwrap().0.revision, 4);
        let stale_after_first_recovery = mutate_locked(
            &paths,
            &config_path,
            2,
            "request-after-second-recovery-stale-0001",
            "afterSecondRecovery",
            request_digest("afterSecondRecovery", &true).unwrap(),
            |_document, _| Ok(()),
        )
        .unwrap_err();
        assert_eq!(stale_after_first_recovery.code, "stale_revision");
        assert_eq!(stale_after_first_recovery.current_revision, Some(4));
    }

    #[test]
    fn cleanup_is_state_gated_and_consumes_server_folder_authority() {
        let (root, config_path, paths) = configured_store("cleanup_authority", true);
        let config_before = fs::read(&config_path).unwrap();
        let context = current_config_context(&config_path).unwrap();
        let workspace = root.join("workspace");
        let created = workspace.join("Invoices").join("Input");
        fs::create_dir_all(&created).unwrap();

        let mut document = classify_installation(&config_path, false).unwrap();
        let mut session = active_session(&context, OnboardingState::FailedRecoverable);
        session.created_folders.push(CreatedFolderEvidence {
            path: created.to_string_lossy().to_string(),
            workspace_base: workspace.to_string_lossy().to_string(),
            recorded_at: now(),
        });
        document.active_session = Some(session);
        persist_new(&paths, &document).unwrap();

        let (_cleanup, snapshot) =
            cleanup_created_folders_locked(&paths, 0, |workspace, created_paths| {
                setup::remove_setup_created_empty_folders(workspace, created_paths, true)
            })
            .unwrap();
        assert!(!created.exists());
        assert_eq!(snapshot.revision, 1);
        assert!(snapshot.active_session.unwrap().created_folders.is_empty());
        assert_eq!(fs::read(&config_path).unwrap(), config_before);

        let (blocked_root, blocked_config, blocked_paths) =
            configured_store("cleanup_blocked", true);
        let blocked_folder = blocked_root.join("blocked-workspace").join("Invoices");
        fs::create_dir_all(&blocked_folder).unwrap();
        let mut blocked = classify_installation(&blocked_config, false).unwrap();
        let blocked_context = current_config_context(&blocked_config).unwrap();
        let mut applying = active_session(&blocked_context, OnboardingState::Applying);
        applying.created_folders.push(CreatedFolderEvidence {
            path: blocked_folder.to_string_lossy().to_string(),
            workspace_base: blocked_root
                .join("blocked-workspace")
                .to_string_lossy()
                .to_string(),
            recorded_at: now(),
        });
        blocked.active_session = Some(applying);
        persist_new(&blocked_paths, &blocked).unwrap();
        let blocked_error =
            cleanup_created_folders_locked(&blocked_paths, 0, |_workspace, _paths| {
                panic!("cleanup must not run while applying")
            })
            .unwrap_err();
        assert_eq!(blocked_error.code, "cleanup_unavailable");
        assert!(blocked_folder.exists());
        assert_eq!(read_document(&blocked_paths.primary).unwrap().0.revision, 0);
    }

    #[test]
    fn future_schema_is_rejected_without_mutation() {
        let (_root, config_path, paths) = configured_store("future", true);
        let current = classify_installation(&config_path, false).unwrap();
        persist_new(&paths, &current).unwrap();
        fs::copy(&paths.primary, &paths.backup).unwrap();
        let bytes = serde_json::to_vec_pretty(&json!({
            "schema": "innpilot.onboarding.v2",
            "schemaVersion": 2,
            "revision": 99
        }))
        .unwrap();
        fs::write(&paths.primary, &bytes).unwrap();
        let error = read_document(&paths.primary).unwrap_err();
        assert_eq!(error.code, "future_schema");
        assert_eq!(fs::read(&paths.primary).unwrap(), bytes);

        let recovery_error = recover_locked(&paths).unwrap_err();
        assert_eq!(recovery_error.code, "future_schema");
        assert_eq!(fs::read(&paths.primary).unwrap(), bytes);
    }

    #[test]
    fn same_schema_unknown_fields_fail_closed_without_mutation() {
        let (_root, config_path, paths) = configured_store("extensions", true);
        let document = classify_installation(&config_path, false).unwrap();
        persist_new(&paths, &document).unwrap();
        let mut raw: Value = serde_json::from_slice(&fs::read(&paths.primary).unwrap()).unwrap();
        raw["unexpectedSensitiveExtension"] = json!({"rawLogs": ["must not persist"]});
        let extended = serde_json::to_vec_pretty(&raw).unwrap();
        fs::write(&paths.primary, &extended).unwrap();

        let error = mutate_locked(
            &paths,
            &config_path,
            0,
            "request-extension-0001",
            "extensionMutation",
            request_digest("extensionMutation", &true).unwrap(),
            |document, _| {
                push_same_state_event(
                    document,
                    effective_state(document),
                    "extensionMutation",
                    "test",
                )
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "corrupt_state");
        assert_eq!(fs::read(&paths.primary).unwrap(), extended);
    }

    #[test]
    fn checkpoint_privacy_and_size_bounds_reject_untyped_or_large_content() {
        let root = temp_root("privacy");
        let mut unsupported = manual_draft(&root);
        unsupported["rawLogs"] = json!(["private log line"]);
        let error = validate_checkpoint(ManualSetupCheckpoint {
            draft: unsupported,
            step_key: "welcome".to_string(),
            show_advanced_workflows: false,
            completed_actions: Vec::new(),
        })
        .unwrap_err();
        assert_eq!(error.code, "validation_failed");

        let mut credential_content = manual_draft(&root);
        credential_content["gmailSubject"] =
            Value::String(r#"{"refresh_token":"must-not-persist"}"#.to_string());
        assert_eq!(
            validate_checkpoint(ManualSetupCheckpoint {
                draft: credential_content,
                step_key: "welcome".to_string(),
                show_advanced_workflows: false,
                completed_actions: Vec::new(),
            })
            .unwrap_err()
            .code,
            "validation_failed"
        );

        let mut oversized = manual_draft(&root);
        oversized["hotelDisplayName"] = Value::String("x".repeat(4097));
        assert_eq!(
            validate_checkpoint(ManualSetupCheckpoint {
                draft: oversized,
                step_key: "welcome".to_string(),
                show_advanced_workflows: false,
                completed_actions: Vec::new(),
            })
            .unwrap_err()
            .code,
            "validation_failed"
        );
    }

    #[test]
    fn oversized_state_is_refused_before_json_parsing() {
        let (_root, _config_path, paths) = configured_store("oversized", true);
        fs::create_dir_all(&paths.directory).unwrap();
        fs::write(&paths.primary, vec![b' '; MAX_STATE_BYTES as usize + 1]).unwrap();
        assert_eq!(
            read_document(&paths.primary).unwrap_err().code,
            "state_oversized"
        );
    }

    #[test]
    fn restart_reconciliation_handles_applying_and_verifying_receipts() {
        let (_root, config_path, _) = configured_store("restart_receipts", true);
        let context = current_config_context(&config_path).unwrap();
        let mut applying = classify_installation(&config_path, false).unwrap();
        applying.active_session = Some(active_session(&context, OnboardingState::Applying));
        assert!(reconcile_document_after_restart(&mut applying, &context).unwrap());
        assert_eq!(
            applying.active_session.as_ref().unwrap().state,
            OnboardingState::NeedsUserInput
        );
        assert_eq!(
            applying
                .active_session
                .as_ref()
                .unwrap()
                .failure_code
                .as_deref(),
            Some("interrupted_before_apply")
        );

        let mut verifying = classify_installation(&config_path, false).unwrap();
        let mut session = active_session(&context, OnboardingState::Verifying);
        session.verified_config_revision = Some(context.revision.clone());
        verifying.active_session = Some(session);
        assert!(reconcile_document_after_restart(&mut verifying, &context).unwrap());
        assert!(verifying.active_session.is_none());
        assert_eq!(
            verifying.installation.readiness,
            InstallationReadiness::Ready
        );
    }

    #[test]
    fn onboarding_writes_never_change_app_or_automation_configuration_bytes() {
        let (_root, config_path, paths) = configured_store("config_immutable", true);
        let context = current_config_context(&config_path).unwrap();
        let automation_path = PathBuf::from(&context.config.automation.automation_config_path);
        let app_before = fs::read(&config_path).unwrap();
        let automation_before = fs::read(&automation_path).unwrap();
        let document = classify_installation(&config_path, false).unwrap();
        persist_new(&paths, &document).unwrap();
        mutate_locked(
            &paths,
            &config_path,
            0,
            "request-immutable-0001",
            "checkpointOnly",
            request_digest("checkpointOnly", &true).unwrap(),
            |document, _| {
                push_same_state_event(
                    document,
                    effective_state(document),
                    "checkpointOnly",
                    "test",
                )
            },
        )
        .unwrap();

        assert_eq!(fs::read(&config_path).unwrap(), app_before);
        assert_eq!(fs::read(&automation_path).unwrap(), automation_before);
    }

    #[test]
    fn path_service_runs_the_manual_lifecycle_without_tauri() {
        let (root, config_path, _) = configured_store("path_service", true);
        let service = path_service(&root, &config_path);

        let initial = service.reconcile_startup(false).unwrap();
        assert_eq!(initial.state(), OnboardingState::NotStarted);

        let started = service
            .begin_or_resume(
                OnboardingMode::Manual,
                initial.revision(),
                "request-begin-0001".to_string(),
            )
            .unwrap();
        assert_eq!(started.state(), OnboardingState::BootstrapCreated);

        let progressed = service
            .record_progress(
                checkpoint(&root),
                started.revision(),
                "request-progress-0001".to_string(),
            )
            .unwrap();
        assert_eq!(progressed.state(), OnboardingState::NeedsUserInput);
        assert_eq!(service.get().unwrap().revision(), progressed.revision());
    }

    #[test]
    fn restart_with_apply_intent_at_base_resumes_without_replaying_apply() {
        let (root, config_path, paths) = configured_store("intent_base", true);
        let context = current_config_context(&config_path).unwrap();
        let mut document = classify_installation(&config_path, false).unwrap();
        let mut session = active_session(&context, OnboardingState::Applying);
        session.apply_intent = Some(fixture_intent(
            context.revision.clone(),
            fixture_revision('b'),
        ));
        document.active_session = Some(session);
        persist_new(&paths, &document).unwrap();

        let service = path_service(&root, &config_path);
        let snapshot = service.reconcile_startup(false).unwrap();
        assert_eq!(snapshot.state(), OnboardingState::NeedsUserInput);
        let session = snapshot.active_session.as_ref().unwrap();
        assert_eq!(
            session.failure_code.as_deref(),
            Some("interrupted_before_apply")
        );
        assert!(session.apply_intent.is_some());

        let progressed = service
            .record_progress(
                checkpoint(&root),
                snapshot.revision(),
                "request-progress-after-interruption".to_string(),
            )
            .unwrap();
        let retried = service
            .prepare_apply_with_intent(
                progressed.revision(),
                context.revision.clone(),
                context.revision,
                "manual-ui-confirmation".to_string(),
                "apply-operation-retry-0002".to_string(),
                fixture_revision('d'),
                None,
            )
            .unwrap();
        assert_eq!(retried.state(), OnboardingState::Applying);
        assert_eq!(
            retried
                .active_session
                .unwrap()
                .apply_intent
                .unwrap()
                .operation_id,
            "apply-operation-retry-0002"
        );
    }

    #[test]
    fn restart_with_apply_intent_at_target_finalizes_and_replays_terminal_receipt() {
        let (root, config_path, paths) = configured_store("intent_target", true);
        let context = current_config_context(&config_path).unwrap();
        let mut document = classify_installation(&config_path, false).unwrap();
        let base_revision = fixture_revision('b');
        let mut intent = fixture_intent(base_revision.clone(), context.revision.clone());
        intent.workspace_initialized = true;
        let mut session = active_session(&context, OnboardingState::Applying);
        session.base_config_revision = base_revision;
        session.apply_intent = Some(intent.clone());
        document.active_session = Some(session);
        persist_new(&paths, &document).unwrap();

        let service = path_service(&root, &config_path);
        let reconciled = service.reconcile_startup(false).unwrap();
        assert!(reconciled.is_ready());
        assert!(reconciled.active_session.is_none());
        let completed = reconciled.installation.last_completed_session.unwrap();
        assert_eq!(
            completed.operation_id.as_deref(),
            Some(intent.operation_id.as_str())
        );
        assert_eq!(
            completed.payload_digest.as_deref(),
            Some(intent.payload_digest.as_str())
        );

        let replay = service
            .find_apply_operation(&intent.operation_id, &intent.payload_digest)
            .unwrap()
            .expect("completed operation remains replayable");
        assert!(replay.is_ready());
        let conflict = service
            .find_apply_operation(&intent.operation_id, &fixture_revision('c'))
            .unwrap_err();
        assert_eq!(conflict.code, "request_conflict");
    }

    #[test]
    fn restart_with_apply_intent_at_unrelated_revision_reports_config_conflict() {
        let (root, config_path, paths) = configured_store("intent_conflict", true);
        let context = current_config_context(&config_path).unwrap();
        let mut document = classify_installation(&config_path, false).unwrap();
        let base_revision = fixture_revision('b');
        let mut session = active_session(&context, OnboardingState::Applying);
        session.base_config_revision = base_revision.clone();
        session.apply_intent = Some(fixture_intent(base_revision, fixture_revision('c')));
        document.active_session = Some(session);
        persist_new(&paths, &document).unwrap();

        let snapshot = path_service(&root, &config_path)
            .reconcile_startup(false)
            .unwrap();
        assert_eq!(snapshot.state(), OnboardingState::FailedRecoverable);
        assert_eq!(
            snapshot.active_session.unwrap().failure_code.as_deref(),
            Some("configuration_conflict")
        );
    }

    #[test]
    fn no_op_apply_intent_without_workspace_evidence_resumes_for_input() {
        let (root, config_path, _) = configured_store("intent_prepare", true);
        let context = current_config_context(&config_path).unwrap();
        let service = path_service(&root, &config_path);
        let initial = service.reconcile_startup(false).unwrap();
        let started = service
            .begin_or_resume(
                OnboardingMode::Manual,
                initial.revision(),
                "request-begin-intent".to_string(),
            )
            .unwrap();
        let progressed = service
            .record_progress(
                checkpoint(&root),
                started.revision(),
                "request-progress-intent".to_string(),
            )
            .unwrap();
        let operation_id = "apply-operation-prepare".to_string();
        let payload_digest = fixture_revision('d');
        let applying = service
            .prepare_apply_with_intent(
                progressed.revision(),
                context.revision.clone(),
                context.revision.clone(),
                "manual-ui-confirmation".to_string(),
                operation_id.clone(),
                payload_digest.clone(),
                None,
            )
            .unwrap();
        assert_eq!(applying.state(), OnboardingState::Applying);

        let duplicate = service
            .prepare_apply_with_intent(
                0,
                context.revision.clone(),
                context.revision,
                "manual-ui-confirmation".to_string(),
                operation_id.clone(),
                payload_digest.clone(),
                None,
            )
            .unwrap();
        assert_eq!(duplicate.revision(), applying.revision());

        let resumed = service.reconcile_startup(false).unwrap();
        assert_eq!(resumed.state(), OnboardingState::NeedsUserInput);
        let active_intent = resumed
            .active_session
            .as_ref()
            .and_then(|session| session.apply_intent.as_ref())
            .expect("the interrupted operation identity remains available");
        assert!(!active_intent.workspace_initialized);
        let active_duplicate = service
            .find_apply_operation(&operation_id, &payload_digest)
            .unwrap()
            .expect("active replay identity");
        assert_eq!(active_duplicate.revision(), resumed.revision());
        assert!(!active_duplicate.is_ready());
    }

    #[test]
    fn no_op_apply_finalizes_after_zero_creation_workspace_evidence() {
        let (root, config_path, _) = configured_store("intent_noop_evidence", true);
        let context = current_config_context(&config_path).unwrap();
        let service = path_service(&root, &config_path);
        let initial = service.reconcile_startup(false).unwrap();
        let started = service
            .begin_or_resume(
                OnboardingMode::Manual,
                initial.revision(),
                "request-begin-noop".to_string(),
            )
            .unwrap();
        let progressed = service
            .record_progress(
                checkpoint(&root),
                started.revision(),
                "request-progress-noop".to_string(),
            )
            .unwrap();
        let operation_id = "apply-operation-noop".to_string();
        let payload_digest = fixture_revision('e');
        let applying = service
            .prepare_apply_with_intent(
                progressed.revision(),
                context.revision.clone(),
                context.revision,
                "manual-ui-confirmation".to_string(),
                operation_id.clone(),
                payload_digest.clone(),
                None,
            )
            .unwrap();

        let draft: setup::SetupDraft = serde_json::from_value(manual_draft(&root)).unwrap();
        let first_initialization = setup::initialize_workspace(draft.clone(), true).unwrap();
        assert!(!first_initialization.has_failures());
        assert!(!first_initialization.created_paths().is_empty());

        let (workspace, evidence_snapshot) = service
            .initialize_workspace(
                draft,
                true,
                applying.revision(),
                "workspace-evidence-0001".to_string(),
            )
            .unwrap();
        assert!(!workspace.has_failures());
        assert!(workspace.created_paths().is_empty());
        let evidence_snapshot = evidence_snapshot.expect("zero-creation evidence is persisted");
        assert!(evidence_snapshot
            .active_session
            .as_ref()
            .and_then(|session| session.apply_intent.as_ref())
            .is_some_and(|intent| intent.workspace_initialized));

        let completed = service.reconcile_startup(false).unwrap();
        assert!(completed.is_ready());
        let terminal_duplicate = service
            .find_apply_operation(&operation_id, &payload_digest)
            .unwrap()
            .expect("terminal replay receipt");
        assert_eq!(terminal_duplicate.revision(), completed.revision());
    }
}
