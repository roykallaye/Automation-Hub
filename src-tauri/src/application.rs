use crate::{
    config,
    domain::{
        RetryDirective, SafeErrorDetails, WorkspaceError, WorkspaceErrorCategory,
        WorkspaceErrorCode, WorkspaceResource, WorkspaceResult,
    },
    onboarding::{OnboardingError, OnboardingService, OnboardingSnapshot, OnboardingState},
    platform::{BuildInfo, InstallationPaths},
    preflight,
    recovery::{RecoveryActionResult, RecoveryEnvironment, RecoveryService, RecoveryStatus},
    setup::{
        ConfigurationCandidateError, ConfigurationService, SaveSetupResult, SetupCleanupResult,
        SetupPatch, SetupPreview, SetupSnapshot, WorkspaceInitResult,
    },
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Adapter-neutral proof that the manager approved a local setup change.
/// Additional approval sources can be added deliberately in later phases;
/// model identity is never treated as approval.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ApprovalEvidence {
    ManualUi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApplyApprovedSetupRequest {
    pub(crate) patch: SetupPatch,
    pub(crate) expected_config_revision: String,
    pub(crate) expected_onboarding_revision: u64,
    pub(crate) approval: ApprovalEvidence,
    pub(crate) request_id: String,
    pub(crate) confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ApplySetupOutcome {
    Completed,
    Replayed,
    WorkspaceNeedsAttention,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyApprovedSetupResult {
    pub(crate) outcome: ApplySetupOutcome,
    pub(crate) workspace: Option<WorkspaceInitResult>,
    pub(crate) save: Option<SaveSetupResult>,
    pub(crate) onboarding: OnboardingSnapshot,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HealthCheckMode {
    Fast,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HealthCheckRequest {
    pub(crate) mode: HealthCheckMode,
}

/// Tauri-independent health boundary. It exposes InnPilot readiness concepts,
/// never a generic path or process API.
#[derive(Debug, Clone)]
pub(crate) struct HealthService {
    configuration: ConfigurationService,
}

impl HealthService {
    pub(crate) fn new(configuration: ConfigurationService) -> Self {
        Self { configuration }
    }

    pub(crate) fn check(
        &self,
        request: HealthCheckRequest,
    ) -> WorkspaceResult<preflight::AppConfigStatus> {
        self.configuration
            .health(request.mode == HealthCheckMode::Full)
            .map_err(|diagnostic| {
                workspace_error(
                    WorkspaceErrorCode::ConfigurationUnavailable,
                    WorkspaceErrorCategory::Configuration,
                    "InnPilot configuration is unavailable for the safety check.",
                    RetryDirective::Retry,
                    diagnostic,
                )
            })
    }

    pub(crate) fn validate(&self) -> WorkspaceResult<preflight::PreflightReport> {
        self.configuration.validate().map_err(|diagnostic| {
            workspace_error(
                WorkspaceErrorCode::PreflightBlocked,
                WorkspaceErrorCategory::Preflight,
                "InnPilot could not complete the configuration safety check.",
                RetryDirective::Retry,
                diagnostic,
            )
        })
    }

    /// Metadata-only health projection for a local assistant. It does not run
    /// processes, enumerate folders, write permission probes, or read token,
    /// credential, document, or automation-config contents.
    pub(crate) fn check_redacted_read_only(
        &self,
    ) -> WorkspaceResult<preflight::SafePreflightSummary> {
        let (config, _) = self.configuration.read_existing().map_err(|diagnostic| {
            workspace_error(
                WorkspaceErrorCode::ConfigurationUnavailable,
                WorkspaceErrorCategory::Configuration,
                "InnPilot configuration is unavailable for the safety check.",
                RetryDirective::Retry,
                diagnostic,
            )
        })?;
        Ok(preflight::build_redacted_read_only_summary(&config))
    }
}

/// Typed recovery facade. The filesystem/recovery implementation remains
/// purpose-specific and path-bound; adapters do not interpret error prose.
pub(crate) struct RecoveryApplicationService {
    recovery: RecoveryService,
}

impl RecoveryApplicationService {
    pub(crate) fn new(recovery: RecoveryService) -> Self {
        Self { recovery }
    }

    pub(crate) fn status(&self) -> WorkspaceResult<RecoveryStatus> {
        self.recovery.status().map_err(|diagnostic| {
            workspace_error(
                WorkspaceErrorCode::RecoveryUnavailable,
                WorkspaceErrorCategory::Recovery,
                "InnPilot could not read the available recovery points.",
                RetryDirective::Retry,
                diagnostic,
            )
        })
    }

    pub(crate) fn create(&self) -> WorkspaceResult<RecoveryActionResult> {
        self.recovery.create().map_err(|diagnostic| {
            workspace_error(
                WorkspaceErrorCode::RecoveryUnavailable,
                WorkspaceErrorCategory::Recovery,
                "InnPilot could not create a configuration recovery point.",
                RetryDirective::Retry,
                diagnostic,
            )
        })
    }
}

/// Owns operations that must keep the onboarding record, configuration pair,
/// recovery evidence, and workspace provenance consistent.
///
/// It contains no Tauri/AppHandle dependency. The UI and any future local
/// adapter receive the same typed operation and cannot manufacture the
/// backend-only setup-saved/completion evidence.
pub(crate) struct SetupApplicationService {
    paths: InstallationPaths,
    configuration: ConfigurationService,
    onboarding: OnboardingService,
    recovery: RecoveryService,
}

impl SetupApplicationService {
    pub(crate) fn new(paths: InstallationPaths, build: BuildInfo) -> WorkspaceResult<Self> {
        let repository = config::ConfigurationRepository::new(
            paths.config_file.clone(),
            paths.packaged_worker.clone(),
        );
        let configuration = ConfigurationService::new(repository);
        let onboarding =
            OnboardingService::new(paths.config_file.clone(), paths.runner_root.clone())
                .map_err(map_onboarding_error)?;
        let recovery = RecoveryService::new(RecoveryEnvironment::from_installation(&paths, &build));
        Ok(Self {
            paths,
            configuration,
            onboarding,
            recovery,
        })
    }

    pub(crate) fn configuration(&self) -> &ConfigurationService {
        &self.configuration
    }

    pub(crate) fn onboarding(&self) -> &OnboardingService {
        &self.onboarding
    }

    pub(crate) fn recovery(&self) -> &RecoveryService {
        &self.recovery
    }

    pub(crate) fn setup_snapshot(&self) -> WorkspaceResult<SetupSnapshot> {
        self.configuration.snapshot().map_err(map_config_read_error)
    }

    pub(crate) fn preview_setup(
        &self,
        patch: &SetupPatch,
        expected_revision: &str,
    ) -> WorkspaceResult<SetupPreview> {
        self.configuration
            .preview(patch, expected_revision)
            .map_err(map_candidate_error)
    }

    pub(crate) fn restore_configuration(
        &self,
        point_id: &str,
        confirmed: bool,
    ) -> WorkspaceResult<RecoveryActionResult> {
        if !confirmed {
            return Err(WorkspaceError::new(
                WorkspaceErrorCode::ConfirmationRequired,
                WorkspaceErrorCategory::Capability,
                "Configuration restore requires confirmation.",
                RetryDirective::UserAction,
            ));
        }
        let restored = self
            .recovery
            .restore_configuration(point_id, true)
            .map_err(|diagnostic| {
                workspace_error(
                    WorkspaceErrorCode::RecoveryFailed,
                    WorkspaceErrorCategory::Recovery,
                    "InnPilot could not restore the selected configuration recovery point.",
                    RetryDirective::Recovery,
                    diagnostic,
                )
                .with_details(SafeErrorDetails::Recovery {
                    point_id: safe_recovery_point_id(point_id),
                })
            })?;
        self.onboarding.reconcile_startup(true).map_err(|error| {
            map_onboarding_error(error).with_diagnostic(
                "Configuration restore succeeded, but onboarding reconciliation needs a restart.",
            )
        })?;
        Ok(restored)
    }

    pub(crate) fn apply_approved_setup(
        &self,
        request: ApplyApprovedSetupRequest,
    ) -> WorkspaceResult<ApplyApprovedSetupResult> {
        if !request.confirmed || request.approval != ApprovalEvidence::ManualUi {
            return Err(WorkspaceError::new(
                WorkspaceErrorCode::ConfirmationRequired,
                WorkspaceErrorCategory::Capability,
                "Setup changes require explicit manager confirmation.",
                RetryDirective::UserAction,
            ));
        }

        let payload_digest = apply_payload_digest(&request)?;
        if let Some(existing) = self
            .onboarding
            .find_apply_operation(&request.request_id, &payload_digest)
            .map_err(map_onboarding_error)?
        {
            if existing.is_ready() {
                return Ok(replayed(existing));
            }
            let reconciled = self
                .onboarding
                .reconcile_startup(false)
                .map_err(map_onboarding_error)?;
            if reconciled.is_ready() {
                return Ok(replayed(reconciled));
            }
            return Err(WorkspaceError::new(
                WorkspaceErrorCode::RecoveryRequired,
                WorkspaceErrorCategory::Lifecycle,
                "The previous setup attempt is incomplete. Review it before starting another apply.",
                RetryDirective::UserAction,
            ));
        }

        let candidate = self
            .configuration
            .prepare_candidate(&request.patch, &request.expected_config_revision)
            .map_err(map_candidate_error)?;
        let target_revision = candidate.target_revision().to_string();
        let workspace_draft = candidate.effective_draft();
        let recovery_point_id = self
            .configuration
            .stage_recovery_point(&candidate, &self.recovery)
            .map_err(|diagnostic| {
                workspace_error(
                    WorkspaceErrorCode::RecoveryUnavailable,
                    WorkspaceErrorCategory::Recovery,
                    "InnPilot could not establish the required setup recovery point.",
                    RetryDirective::Retry,
                    diagnostic,
                )
            })?;

        let prepared = self
            .onboarding
            .prepare_apply_with_intent(
                request.expected_onboarding_revision,
                request.expected_config_revision.clone(),
                target_revision.clone(),
                "manual-ui-confirmation".to_string(),
                request.request_id.clone(),
                payload_digest,
                recovery_point_id.clone(),
            )
            .map_err(map_onboarding_error)?;

        let (workspace, workspace_snapshot) = self
            .onboarding
            .initialize_workspace(
                workspace_draft,
                true,
                prepared.revision(),
                child_request_id(&request.request_id, "workspace"),
            )
            .map_err(map_onboarding_error)?;
        let applying = workspace_snapshot.unwrap_or(prepared);
        if workspace.has_failures() {
            let failed = self
                .onboarding
                .mark_failed(
                    applying.revision(),
                    "workspace_initialization_failed".to_string(),
                    child_request_id(&request.request_id, "workspace-failed"),
                )
                .map_err(map_onboarding_error)?;
            return Ok(ApplyApprovedSetupResult {
                outcome: ApplySetupOutcome::WorkspaceNeedsAttention,
                workspace: Some(workspace),
                save: None,
                onboarding: failed,
            });
        }

        let save = match self.configuration.commit_candidate_with_recovery_point(
            candidate,
            recovery_point_id,
            &self.paths.runner_root,
        ) {
            Ok(save) => save,
            Err(diagnostic) => {
                // The apply intent makes this deterministic: base means no
                // commit; target means committed; a third revision conflicts.
                if let Ok(reconciled) = self.onboarding.reconcile_startup(false) {
                    if reconciled.is_ready() {
                        return Ok(ApplyApprovedSetupResult {
                            outcome: ApplySetupOutcome::Replayed,
                            workspace: Some(workspace),
                            save: None,
                            onboarding: reconciled,
                        });
                    }
                    if reconciled.state() == OnboardingState::FailedRecoverable {
                        return Err(WorkspaceError::new(
                            WorkspaceErrorCode::ConfigurationConflict,
                            WorkspaceErrorCategory::Configuration,
                            "Configuration changed before the approved setup could be committed.",
                            RetryDirective::Refresh,
                        ));
                    }
                }
                return Err(workspace_error(
                    WorkspaceErrorCode::PersistenceFailed,
                    WorkspaceErrorCategory::Persistence,
                    "InnPilot could not commit the approved setup change.",
                    RetryDirective::Retry,
                    diagnostic,
                ));
            }
        };

        let verifying = match self.onboarding.record_setup_saved(
            applying.revision(),
            save.revision().to_string(),
            child_request_id(&request.request_id, "saved"),
        ) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                return self.finish_from_authoritative_configuration(
                    error,
                    workspace,
                    save,
                    ApplySetupOutcome::Completed,
                );
            }
        };
        let completed = match self.onboarding.complete(
            verifying.revision(),
            save.revision().to_string(),
            Vec::new(),
            child_request_id(&request.request_id, "complete"),
        ) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                return self.finish_from_authoritative_configuration(
                    error,
                    workspace,
                    save,
                    ApplySetupOutcome::Completed,
                );
            }
        };

        Ok(ApplyApprovedSetupResult {
            outcome: ApplySetupOutcome::Completed,
            workspace: Some(workspace),
            save: Some(save),
            onboarding: completed,
        })
    }

    pub(crate) fn cleanup_created_folders(
        &self,
        expected_onboarding_revision: u64,
        confirmed: bool,
    ) -> WorkspaceResult<(SetupCleanupResult, OnboardingSnapshot)> {
        if !confirmed {
            return Err(WorkspaceError::new(
                WorkspaceErrorCode::ConfirmationRequired,
                WorkspaceErrorCategory::Capability,
                "Empty-folder cleanup requires confirmation.",
                RetryDirective::UserAction,
            )
            .with_details(SafeErrorDetails::Revision {
                resource: WorkspaceResource::Onboarding,
                current: expected_onboarding_revision.to_string(),
            }));
        }
        self.onboarding
            .cleanup_created_folders(expected_onboarding_revision)
            .map_err(map_onboarding_error)
    }

    fn finish_from_authoritative_configuration(
        &self,
        original_error: OnboardingError,
        workspace: WorkspaceInitResult,
        save: SaveSetupResult,
        outcome: ApplySetupOutcome,
    ) -> WorkspaceResult<ApplyApprovedSetupResult> {
        let reconciled = self
            .onboarding
            .reconcile_startup(false)
            .map_err(|reconcile_error| {
                map_onboarding_error(reconcile_error).with_diagnostic(format!(
                    "post-commit onboarding error: {}; reconciliation also failed: {}",
                    original_error.code, original_error.message
                ))
            })?;
        if !reconciled.is_ready() {
            return Err(map_onboarding_error(original_error));
        }
        Ok(ApplyApprovedSetupResult {
            outcome,
            workspace: Some(workspace),
            save: Some(save),
            onboarding: reconciled,
        })
    }
}

fn replayed(onboarding: OnboardingSnapshot) -> ApplyApprovedSetupResult {
    ApplyApprovedSetupResult {
        outcome: ApplySetupOutcome::Replayed,
        workspace: None,
        save: None,
        onboarding,
    }
}

fn apply_payload_digest(request: &ApplyApprovedSetupRequest) -> WorkspaceResult<String> {
    let value = serde_json::json!({
        "patch": &request.patch,
        "expectedConfigRevision": &request.expected_config_revision,
        "approval": &request.approval,
        "confirmed": request.confirmed,
    });
    let bytes = serde_json::to_vec(&value).map_err(|error| {
        workspace_error(
            WorkspaceErrorCode::InvalidRequest,
            WorkspaceErrorCategory::Validation,
            "The setup request could not be validated.",
            RetryDirective::UserAction,
            error.to_string(),
        )
    })?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn child_request_id(operation_id: &str, stage: &str) -> String {
    let digest = Sha256::digest(format!("{operation_id}:{stage}").as_bytes());
    format!("phasec-{stage}-{:x}", digest)[..(stage.len() + 40)].to_string()
}

fn map_config_read_error(diagnostic: String) -> WorkspaceError {
    workspace_error(
        WorkspaceErrorCode::ConfigurationUnavailable,
        WorkspaceErrorCategory::Configuration,
        "InnPilot configuration is unavailable.",
        RetryDirective::Retry,
        diagnostic,
    )
}

fn map_candidate_error(error: ConfigurationCandidateError) -> WorkspaceError {
    match error {
        ConfigurationCandidateError::Stale { current_revision } => WorkspaceError::new(
            WorkspaceErrorCode::StaleRevision,
            WorkspaceErrorCategory::Concurrency,
            "Configuration changed after this screen was loaded. Refresh before continuing.",
            RetryDirective::Refresh,
        )
        .with_details(SafeErrorDetails::Revision {
            resource: WorkspaceResource::Configuration,
            current: current_revision,
        }),
        ConfigurationCandidateError::Unavailable { diagnostic } => workspace_error(
            WorkspaceErrorCode::ConfigurationUnavailable,
            WorkspaceErrorCategory::Configuration,
            "InnPilot configuration is unavailable.",
            RetryDirective::Retry,
            diagnostic,
        ),
        ConfigurationCandidateError::Invalid { diagnostic } => workspace_error(
            WorkspaceErrorCode::ConfigurationInvalid,
            WorkspaceErrorCategory::Configuration,
            "The proposed setup change is not valid.",
            RetryDirective::UserAction,
            diagnostic,
        ),
    }
}

fn map_onboarding_error(error: OnboardingError) -> WorkspaceError {
    let (code, category, retry) = match error.code.as_str() {
        "stale_revision" | "config_changed" => (
            WorkspaceErrorCode::StaleRevision,
            WorkspaceErrorCategory::Concurrency,
            RetryDirective::Refresh,
        ),
        "invalid_transition" => (
            WorkspaceErrorCode::InvalidTransition,
            WorkspaceErrorCategory::Lifecycle,
            RetryDirective::UserAction,
        ),
        "approval_required" | "confirmation_required" => (
            WorkspaceErrorCode::ConfirmationRequired,
            WorkspaceErrorCategory::Capability,
            RetryDirective::UserAction,
        ),
        "feature_unavailable" => (
            WorkspaceErrorCode::CapabilityUnavailable,
            WorkspaceErrorCategory::Capability,
            RetryDirective::Never,
        ),
        "future_schema" | "unsupported_schema" => (
            WorkspaceErrorCode::UnsupportedSchema,
            WorkspaceErrorCategory::Persistence,
            RetryDirective::Recovery,
        ),
        "corrupt_state" | "state_oversized" => (
            WorkspaceErrorCode::CorruptState,
            WorkspaceErrorCategory::Persistence,
            RetryDirective::Recovery,
        ),
        "state_missing" | "missing_primary" | "no_active_session" => (
            WorkspaceErrorCode::StateMissing,
            WorkspaceErrorCategory::Lifecycle,
            RetryDirective::Refresh,
        ),
        "request_conflict" => (
            WorkspaceErrorCode::PersistenceConflict,
            WorkspaceErrorCategory::Concurrency,
            RetryDirective::Never,
        ),
        "configuration_conflict" => (
            WorkspaceErrorCode::ConfigurationConflict,
            WorkspaceErrorCategory::Configuration,
            RetryDirective::Refresh,
        ),
        "workspace_failed" => (
            WorkspaceErrorCode::PathUnavailable,
            WorkspaceErrorCategory::Path,
            RetryDirective::UserAction,
        ),
        "busy" => (
            WorkspaceErrorCode::OperationBusy,
            WorkspaceErrorCategory::Concurrency,
            RetryDirective::Retry,
        ),
        "persistence_failed" => (
            WorkspaceErrorCode::PersistenceFailed,
            WorkspaceErrorCategory::Persistence,
            RetryDirective::Retry,
        ),
        "validation_failed" | "legacy_invalid" | "progress_required" => (
            WorkspaceErrorCode::InvalidRequest,
            WorkspaceErrorCategory::Validation,
            RetryDirective::UserAction,
        ),
        _ => (
            WorkspaceErrorCode::Internal,
            WorkspaceErrorCategory::Internal,
            if error.recoverable {
                RetryDirective::Retry
            } else {
                RetryDirective::Never
            },
        ),
    };
    let mut mapped = WorkspaceError::new(code, category, error.message, retry)
        .with_diagnostic(format!("onboarding error code: {}", error.code));
    if let Some(revision) = error.current_revision {
        mapped = mapped.with_details(SafeErrorDetails::Revision {
            resource: WorkspaceResource::Onboarding,
            current: revision.to_string(),
        });
    }
    mapped
}

fn workspace_error(
    code: WorkspaceErrorCode,
    category: WorkspaceErrorCategory,
    summary: &str,
    retry: RetryDirective,
    diagnostic: String,
) -> WorkspaceError {
    WorkspaceError::new(code, category, summary, retry).with_diagnostic(diagnostic)
}

fn safe_recovery_point_id(value: &str) -> Option<String> {
    (!value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')))
    .then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onboarding::{ManualSetupCheckpoint, OnboardingMode};
    use std::{fs, path::PathBuf};

    fn unique_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "innpilot-phase-c-{name}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ))
    }

    #[test]
    fn typed_health_service_runs_without_tauri() {
        let root = unique_root("health");
        let paths = InstallationPaths::from_app_data(&root, None);
        let repository = config::ConfigurationRepository::new(paths.config_file.clone(), None);
        let health = HealthService::new(ConfigurationService::new(repository));

        let status = health
            .check(HealthCheckRequest {
                mode: HealthCheckMode::Fast,
            })
            .unwrap();

        assert!(serde_json::to_value(status).unwrap().is_object());
        assert!(paths.config_file.is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_configuration_maps_to_a_stable_typed_error() {
        let root = unique_root("stale");
        let paths = InstallationPaths::from_app_data(&root, None);
        let service =
            SetupApplicationService::new(paths, BuildInfo::from_version("phase-c-test")).unwrap();
        service.setup_snapshot().unwrap();
        let patch: SetupPatch = serde_json::from_value(serde_json::json!({})).unwrap();

        let error = service
            .preview_setup(&patch, "sha256:deadbeef")
            .unwrap_err();

        assert_eq!(error.code(), WorkspaceErrorCode::StaleRevision);
        assert_eq!(error.retry(), RetryDirective::Refresh);
        assert!(error.refresh_required());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn request_digest_is_stable_and_excludes_operation_identity() {
        let base = ApplyApprovedSetupRequest {
            patch: serde_json::from_value(serde_json::json!({})).unwrap(),
            expected_config_revision: format!("sha256:{}", "a".repeat(64)),
            expected_onboarding_revision: 1,
            approval: ApprovalEvidence::ManualUi,
            request_id: "operation-00000001".to_string(),
            confirmed: true,
        };
        let mut replay = base.clone();
        replay.request_id = "operation-00000002".to_string();

        assert_eq!(
            apply_payload_digest(&base).unwrap(),
            apply_payload_digest(&replay).unwrap()
        );
    }

    #[test]
    fn apply_request_rejects_an_independent_workspace_draft() {
        let error = serde_json::from_value::<ApplyApprovedSetupRequest>(serde_json::json!({
            "patch": {},
            "draft": { "workspaceBase": "C:\\untrusted" },
            "expectedConfigRevision": format!("sha256:{}", "a".repeat(64)),
            "expectedOnboardingRevision": 1,
            "approval": "manualUi",
            "requestId": "phasec-apply-contract-0001",
            "confirmed": true
        }))
        .unwrap_err();

        assert!(error.to_string().contains("unknown field `draft`"));
    }

    #[test]
    fn mapped_errors_do_not_serialize_diagnostics() {
        let mapped = workspace_error(
            WorkspaceErrorCode::PersistenceFailed,
            WorkspaceErrorCategory::Persistence,
            "InnPilot could not persist the change.",
            RetryDirective::Retry,
            r"C:\private\hotel\gmail_token.json".to_string(),
        );
        let encoded = serde_json::to_string(&mapped).unwrap();
        assert!(!encoded.contains("gmail_token"));
        assert!(encoded.contains("persistence_failed"));
    }

    #[test]
    fn coordinator_applies_once_and_replays_without_tauri() {
        let root = unique_root("coordinator");
        let workspace = root.join("hotel-workspace");
        let paths = InstallationPaths::from_app_data(&root, None);
        let service =
            SetupApplicationService::new(paths.clone(), BuildInfo::from_version("phase-c-test"))
                .unwrap();
        let setup_snapshot = service.setup_snapshot().unwrap();
        let mut draft_value = serde_json::to_value(setup_snapshot.draft()).unwrap();
        let object = draft_value.as_object_mut().unwrap();
        let path = |parts: &[&str]| {
            parts
                .iter()
                .fold(workspace.clone(), |value, part| value.join(part))
                .to_string_lossy()
                .to_string()
        };
        object.insert("setupMode".to_string(), serde_json::json!("newWorkspace"));
        object.insert(
            "hotelDisplayName".to_string(),
            serde_json::json!("Synthetic Phase C Hotel"),
        );
        object.insert(
            "workspaceBase".to_string(),
            serde_json::json!(workspace.to_string_lossy()),
        );
        for (key, value) in [
            ("invoiceInputFolder", path(&["invoices", "input"])),
            ("invoiceOutputFolder", path(&["invoices", "output"])),
            ("invoiceArchiveFolder", path(&["invoices", "archive"])),
            ("invoiceLogFolder", path(&["invoices", "logs"])),
            (
                "gmailCredentialsFile",
                path(&["gmail", "gmail_credentials.json"]),
            ),
            ("gmailTokenFile", path(&["gmail", "gmail_token.json"])),
            ("sharedScanFolder", path(&["scans", "incoming"])),
            ("scansLocalCacheFolder", path(&["scans", "cache"])),
            ("ocrTextOutputFolder", path(&["scans", "text"])),
            (
                "signedContractsOutputFolder",
                path(&["contracts", "signed"]),
            ),
            ("contractLogFolder", path(&["contracts", "logs"])),
        ] {
            object.insert(key.to_string(), serde_json::json!(value));
        }
        let patch: SetupPatch = serde_json::from_value(serde_json::json!({
            "setupMode": "newWorkspace",
            "hotelDisplayName": "Synthetic Phase C Hotel",
            "workspaceBase": workspace.to_string_lossy(),
            "invoiceInputFolder": path(&["invoices", "input"]),
            "invoiceOutputFolder": path(&["invoices", "output"]),
            "invoiceArchiveFolder": path(&["invoices", "archive"]),
            "invoiceLogFolder": path(&["invoices", "logs"]),
            "gmailCredentialsFile": path(&["gmail", "gmail_credentials.json"]),
            "gmailTokenFile": path(&["gmail", "gmail_token.json"]),
            "sharedScanFolder": path(&["scans", "incoming"]),
            "scansLocalCacheFolder": path(&["scans", "cache"]),
            "ocrTextOutputFolder": path(&["scans", "text"]),
            "signedContractsOutputFolder": path(&["contracts", "signed"]),
            "contractLogFolder": path(&["contracts", "logs"])
        }))
        .unwrap();

        let initial = service.onboarding().reconcile_startup(false).unwrap();
        let begun = service
            .onboarding()
            .begin_or_resume(
                OnboardingMode::Manual,
                initial.revision(),
                "phasec-begin-00000001".to_string(),
            )
            .unwrap();
        let progress = service
            .onboarding()
            .record_progress(
                ManualSetupCheckpoint {
                    draft: draft_value,
                    step_key: "finish".to_string(),
                    show_advanced_workflows: false,
                    completed_actions: Vec::new(),
                },
                begun.revision(),
                "phasec-progress-00000001".to_string(),
            )
            .unwrap();
        let request = ApplyApprovedSetupRequest {
            patch,
            expected_config_revision: setup_snapshot.revision().to_string(),
            expected_onboarding_revision: progress.revision(),
            approval: ApprovalEvidence::ManualUi,
            request_id: "phasec-apply-00000001".to_string(),
            confirmed: true,
        };
        let preview = service
            .preview_setup(&request.patch, &request.expected_config_revision)
            .unwrap();

        let applied = service.apply_approved_setup(request.clone()).unwrap();
        assert_eq!(applied.outcome, ApplySetupOutcome::Completed);
        assert!(applied.onboarding.is_ready());
        assert!(applied.save.is_some());
        let installed_revision = service.setup_snapshot().unwrap().revision().to_string();
        assert_eq!(
            applied.save.as_ref().unwrap().revision(),
            installed_revision
        );
        assert_eq!(preview.target_revision(), installed_revision);
        let app_bytes = fs::read(&paths.config_file).unwrap();

        let replayed = service.apply_approved_setup(request).unwrap();
        assert_eq!(replayed.outcome, ApplySetupOutcome::Replayed);
        assert!(replayed.onboarding.is_ready());
        assert!(replayed.save.is_none());
        assert_eq!(fs::read(&paths.config_file).unwrap(), app_bytes);

        let _ = fs::remove_dir_all(root);
    }
}
