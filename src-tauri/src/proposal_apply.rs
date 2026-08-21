//! Trusted local Phase F proposal approval, apply, verification and rollback.
//!
//! MCP never constructs this service and no approval material is exposed by
//! its tools.  The manager identifies one proposal in the desktop UI; this
//! service reloads the protected proposal, records a DPAPI-bound one-operation
//! approval, commits one opaque validated candidate through the existing setup
//! services, verifies it deterministically, and restores the verified
//! predecessor when required checks fail.

use crate::{
    application::{HealthService, SetupApplicationService},
    domain::{
        RetryDirective, SafeErrorDetails, WorkspaceError, WorkspaceErrorCategory,
        WorkspaceErrorCode, WorkspaceResource, WorkspaceResult,
    },
    environment_discovery::{
        DiscoveryEnvironment, DiscoveryService, EligibleLocalProposal, ProposalService,
    },
    onboarding::{OnboardingError, OnboardingSnapshot, OnboardingState},
    platform::{BuildInfo, InstallationPaths},
    runner_identity::{protect_for_current_user, unprotect_for_current_user},
    runner_ledger::{ProcessLock, ProcessLockKind},
    setup::{
        ApprovedProposalJournalContext, ConfigurationCandidateError, SaveSetupResult,
        ValidatedSetupCandidate,
    },
};
use chrono::{Duration, Utc};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    path::Path,
};

const APPROVAL_SCHEMA: u32 = 1;
const APPROVAL_MAGIC: &[u8] = b"INNPILOT-PROPOSAL-APPROVAL-DPAPI-V1\n";
const MAX_APPROVAL_BYTES: usize = 1024 * 1024;
const MAX_RECORDS: usize = 32;
const MAX_EVENTS: usize = 96;
const APPROVAL_LIFETIME_MINUTES: i64 = 15;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApproveAndApplyProposalRequest {
    pub(crate) proposal_id: String,
    pub(crate) proposal_revision: u64,
    pub(crate) proposal_digest: String,
    pub(crate) request_id: String,
    pub(crate) confirmed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProposalApplyOutcome {
    Ready,
    ReadyWithDeferredItems,
    RolledBack,
    FailedRecoverable,
    Replayed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalApplyResult {
    pub(crate) outcome: ProposalApplyOutcome,
    pub(crate) proposal_id: String,
    pub(crate) operation_id: String,
    pub(crate) target_configuration_revision: String,
    pub(crate) active_configuration_revision: String,
    pub(crate) deferred_items: Vec<String>,
    pub(crate) blocker_keys: Vec<String>,
    pub(crate) onboarding: OnboardingSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagerProposalApplySummary {
    pub(crate) proposal_id: String,
    pub(crate) operation_id: String,
    pub(crate) status: String,
    pub(crate) approved_at: String,
    pub(crate) completed_at: Option<String>,
    pub(crate) base_configuration_revision: String,
    pub(crate) target_configuration_revision: String,
    pub(crate) active_configuration_revision: Option<String>,
    pub(crate) deferred_items: Vec<String>,
    pub(crate) blocker_keys: Vec<String>,
    pub(crate) safe_failure_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovalDocument {
    schema_version: u32,
    installation_id: String,
    records: Vec<ApprovalApplyRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApprovalApplyRecord {
    schema_version: u32,
    installation_id: String,
    approval_id: String,
    operation_id: String,
    request_id: String,
    status: ApplyStatus,
    proposal_id: String,
    proposal_revision: u64,
    proposal_schema_version: u32,
    proposal_digest: String,
    originating_profile_digest: String,
    base_configuration_revision: String,
    target_configuration_revision: String,
    onboarding_revision: u64,
    snapshot_digest: String,
    normalized_candidate_digest: String,
    changed_fields_digest: String,
    warning_count: usize,
    approving_user_context_digest: String,
    approved_at: String,
    expires_at: String,
    recovery_point_id: Option<String>,
    workspace_prepared: bool,
    configuration_committed: bool,
    verification_started: bool,
    verification_completed: bool,
    rollback_started: bool,
    rollback_completed: bool,
    rollback_attempts: u8,
    completed_at: Option<String>,
    active_configuration_revision: Option<String>,
    deferred_items: Vec<String>,
    blocker_keys: Vec<String>,
    safe_failure_code: Option<String>,
    events: Vec<ApplyAuditEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ApplyStatus {
    Approved,
    Applying,
    Verifying,
    VerificationFailed,
    RollbackStarted,
    Succeeded,
    RolledBack,
    FailedRecoverable,
    Invalidated,
}

impl ApplyStatus {
    fn terminal(&self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::RolledBack | Self::FailedRecoverable | Self::Invalidated
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApplyAuditEvent {
    at: String,
    event: String,
    safe_code: Option<String>,
    configuration_revision: Option<String>,
}

pub(crate) struct ProposalApplyService {
    paths: InstallationPaths,
    setup: SetupApplicationService,
    discovery: DiscoveryService,
    proposals: ProposalService,
}

impl ProposalApplyService {
    pub(crate) fn new(paths: InstallationPaths, build: BuildInfo) -> WorkspaceResult<Self> {
        let setup = SetupApplicationService::new(paths.clone(), build)?;
        let environment = DiscoveryEnvironment {
            discovery_root: paths.discovery_root.clone(),
            proposal_root: paths.proposal_root.clone(),
        };
        Ok(Self {
            paths,
            setup,
            discovery: DiscoveryService::new(environment.clone()),
            proposals: ProposalService::new(environment),
        })
    }

    pub(crate) fn latest_summary(
        &self,
        installation_id: &str,
        proposal_id: &str,
    ) -> WorkspaceResult<Option<ManagerProposalApplySummary>> {
        self.with_store(installation_id, |document| {
            Ok(document
                .records
                .iter()
                .rev()
                .find(|record| record.proposal_id == proposal_id)
                .map(record_summary))
        })
    }

    pub(crate) fn approve_and_apply(
        &self,
        profile_id: &str,
        grant_active: bool,
        request: ApproveAndApplyProposalRequest,
    ) -> WorkspaceResult<ProposalApplyResult> {
        self.approve_and_apply_with_hook(profile_id, grant_active, request, || {})
    }

    fn approve_and_apply_with_hook<F>(
        &self,
        profile_id: &str,
        grant_active: bool,
        request: ApproveAndApplyProposalRequest,
        after_approval: F,
    ) -> WorkspaceResult<ProposalApplyResult>
    where
        F: FnOnce(),
    {
        validate_request(&request)?;
        let onboarding = self.setup.onboarding().get().map_err(map_onboarding)?;
        let installation_id = onboarding.installation_id().to_string();
        let operation_lock = ProcessLock::try_acquire_at(
            &self.paths.proposal_approval_root,
            ProcessLockKind::Service,
        )
        .map_err(|error| store_error(error.to_string()))?;
        if operation_lock.is_none() {
            if let Some(record) = self.find_request_record(&installation_id, &request)? {
                return Ok(result_from_record(
                    record,
                    onboarding,
                    ProposalApplyOutcome::Replayed,
                ));
            }
            return Err(WorkspaceError::new(
                WorkspaceErrorCode::OperationBusy,
                WorkspaceErrorCategory::Concurrency,
                "Another proposal approval is already being processed.",
                RetryDirective::Retry,
            ));
        }
        let _operation_lock = operation_lock.expect("checked above");
        if let Some(record) = self.find_request_record(&installation_id, &request)? {
            return self.reconcile_record(record);
        }
        let (_, current_revision) = self
            .setup
            .configuration()
            .read_existing()
            .map_err(config_unavailable)?;
        let eligible = self.proposals.eligible_for_local_approval(
            &self.discovery,
            &installation_id,
            profile_id,
            &current_revision,
            onboarding.revision(),
            grant_active,
            &request.proposal_id,
            request.proposal_revision,
            &request.proposal_digest,
        )?;
        if eligible.target_configuration_revision == eligible.base_configuration_revision {
            return Err(invalid(
                "The proposal no longer changes the installed configuration.",
            ));
        }

        let mut record = new_record(&installation_id, &eligible, &request)?;
        push_event(&mut record, "proposal_approval_requested", None, None);
        push_event(&mut record, "proposal_approved_locally", None, None);
        self.insert_record(&installation_id, record.clone())?;
        after_approval();

        // Approval and application are separate trust steps. Reload every
        // authority after the durable approval exists, then build one opaque
        // candidate and pass that same value to commit.
        let onboarding = self.setup.onboarding().get().map_err(map_onboarding)?;
        let (_, current_revision) = self
            .setup
            .configuration()
            .read_existing()
            .map_err(config_unavailable)?;
        let eligible = match self.proposals.eligible_for_local_approval(
            &self.discovery,
            &installation_id,
            profile_id,
            &current_revision,
            onboarding.revision(),
            grant_active,
            &request.proposal_id,
            request.proposal_revision,
            &request.proposal_digest,
        ) {
            Ok(proposal) => proposal,
            Err(error) => {
                self.close_invalidated(
                    &installation_id,
                    &record.operation_id,
                    "approval_freshness_changed",
                )?;
                return Err(error);
            }
        };
        self.assert_record_binding(&installation_id, &record, &eligible)?;
        let patch = eligible.setup_patch()?;
        let candidate = self
            .setup
            .configuration()
            .prepare_candidate(&patch, &eligible.base_configuration_revision)
            .map_err(map_candidate)?;
        if candidate.target_revision() != eligible.target_configuration_revision
            || !candidate.has_changes()
        {
            self.close_invalidated(&installation_id, &record.operation_id, "candidate_mismatch")?;
            return Err(stale(
                "The reviewed proposal no longer builds the exact approved candidate.",
            ));
        }

        let recovery_point_id = self
            .setup
            .configuration()
            .stage_verified_recovery_point(&candidate, self.setup.recovery())
            .map_err(|diagnostic| {
                WorkspaceError::new(
                    WorkspaceErrorCode::RecoveryUnavailable,
                    WorkspaceErrorCategory::Recovery,
                    "InnPilot could not verify a predecessor recovery point. Nothing changed.",
                    RetryDirective::Retry,
                )
                .with_diagnostic(diagnostic)
            })?
            .ok_or_else(|| {
                invalid("The approved proposal did not contain a configuration mutation.")
            })?;
        record.recovery_point_id = Some(recovery_point_id.clone());
        record.status = ApplyStatus::Applying;
        push_event(&mut record, "proposal_apply_started", None, None);
        self.replace_record(&installation_id, record.clone())?;

        self.apply_candidate(record, candidate, recovery_point_id)
    }

    /// Startup reconciliation is deliberately outcome-based. It never applies
    /// an approved-but-not-started proposal. A committed target is verified;
    /// a base revision is closed safely; rollback is attempted at most once
    /// more after an interrupted first attempt.
    pub(crate) fn reconcile_startup(&self) -> WorkspaceResult<()> {
        let onboarding = match self.setup.onboarding().get() {
            Ok(value) => value,
            Err(_) => return Ok(()),
        };
        let installation_id = onboarding.installation_id().to_string();
        let records = self.with_store(&installation_id, |document| {
            Ok(document
                .records
                .iter()
                .filter(|record| !record.status.terminal())
                .cloned()
                .collect::<Vec<_>>())
        })?;
        for record in records {
            let _ = self.reconcile_record(record)?;
        }
        Ok(())
    }

    fn apply_candidate(
        &self,
        mut record: ApprovalApplyRecord,
        candidate: ValidatedSetupCandidate,
        recovery_point_id: String,
    ) -> WorkspaceResult<ProposalApplyResult> {
        let payload_digest = operation_payload_digest(&record);
        let prepared = self
            .setup
            .onboarding()
            .prepare_proposal_apply_with_intent(
                record.onboarding_revision,
                record.base_configuration_revision.clone(),
                record.target_configuration_revision.clone(),
                record.approval_id.clone(),
                record.operation_id.clone(),
                payload_digest,
                recovery_point_id.clone(),
            )
            .map_err(map_onboarding)?;
        let candidate_draft = candidate.effective_draft();
        let (workspace, workspace_snapshot) = self
            .setup
            .onboarding()
            .initialize_workspace(
                candidate_draft,
                true,
                prepared.revision(),
                child_id(&record.operation_id, "workspace"),
            )
            .map_err(map_onboarding)?;
        if workspace.has_failures() {
            let failed = self
                .setup
                .onboarding()
                .mark_failed(
                    workspace_snapshot.as_ref().unwrap_or(&prepared).revision(),
                    "folder_initialization_failed".to_string(),
                    child_id(&record.operation_id, "workspace-failed"),
                )
                .map_err(map_onboarding)?;
            record.status = ApplyStatus::FailedRecoverable;
            record.safe_failure_code = Some("workspace_initialization_failed".to_string());
            record.completed_at = Some(now());
            push_event(
                &mut record,
                "setup_failed_recoverable",
                Some("workspace_initialization_failed"),
                None,
            );
            self.replace_record(&record.installation_id, record.clone())?;
            return Ok(result_from_record(
                record,
                failed,
                ProposalApplyOutcome::FailedRecoverable,
            ));
        }
        let applying = workspace_snapshot.unwrap_or(prepared);
        record.workspace_prepared = true;
        self.replace_record(&record.installation_id, record.clone())?;

        let save = self
            .setup
            .configuration()
            .commit_approved_proposal_candidate(
                candidate,
                recovery_point_id,
                &self.paths.runner_root,
                ApprovedProposalJournalContext {
                    proposal_id: record.proposal_id.clone(),
                    proposal_digest: record.proposal_digest.clone(),
                    approval_id: record.approval_id.clone(),
                    operation_id: record.operation_id.clone(),
                    workspace_prepared: true,
                },
            )
            .map_err(|diagnostic| {
                WorkspaceError::new(
                    WorkspaceErrorCode::PersistenceFailed,
                    WorkspaceErrorCategory::Persistence,
                    "InnPilot could not commit the approved proposal.",
                    RetryDirective::Retry,
                )
                .with_diagnostic(diagnostic)
            })?;
        record.configuration_committed = true;
        record.active_configuration_revision = Some(save.revision().to_string());
        push_event(
            &mut record,
            "configuration_committed",
            None,
            Some(save.revision()),
        );
        self.replace_record(&record.installation_id, record.clone())?;
        let verifying = self
            .setup
            .onboarding()
            .record_setup_saved(
                applying.revision(),
                save.revision().to_string(),
                child_id(&record.operation_id, "saved"),
            )
            .map_err(map_onboarding)?;
        record.status = ApplyStatus::Verifying;
        record.verification_started = true;
        push_event(
            &mut record,
            "verification_started",
            None,
            Some(save.revision()),
        );
        self.replace_record(&record.installation_id, record.clone())?;
        self.verify_or_rollback(record, verifying, Some(save))
    }

    fn verify_or_rollback(
        &self,
        mut record: ApprovalApplyRecord,
        onboarding: OnboardingSnapshot,
        _save: Option<SaveSetupResult>,
    ) -> WorkspaceResult<ProposalApplyResult> {
        let (_, active_revision) = self
            .setup
            .configuration()
            .read_existing()
            .map_err(config_unavailable)?;
        if active_revision != record.target_configuration_revision {
            record.blocker_keys = vec!["target_configuration_revision".to_string()];
            return self.rollback_after_failure(record, onboarding, "target_revision_mismatch");
        }
        let report = match HealthService::new(self.setup.configuration().clone()).validate() {
            Ok(report) => report,
            Err(_) => {
                record.blocker_keys = vec!["verification_unavailable".to_string()];
                return self.rollback_after_failure(record, onboarding, "verification_unavailable");
            }
        };
        let blockers = report.required_setup_blocker_keys();
        let deferred = report.optional_deferred_workflow_keys();
        if !blockers.is_empty() {
            record.blocker_keys = blockers;
            record.deferred_items = deferred;
            return self.rollback_after_failure(record, onboarding, "required_preflight_failed");
        }
        record.verification_completed = true;
        record.deferred_items = deferred.clone();
        push_event(
            &mut record,
            "verification_passed",
            None,
            Some(&active_revision),
        );
        let completed = self
            .setup
            .onboarding()
            .complete(
                onboarding.revision(),
                active_revision.clone(),
                Vec::new(),
                child_id(&record.operation_id, "complete"),
            )
            .map_err(map_onboarding)?;
        record.status = ApplyStatus::Succeeded;
        record.completed_at = Some(now());
        record.active_configuration_revision = Some(active_revision);
        let completed_revision = record.active_configuration_revision.clone();
        push_event(
            &mut record,
            "setup_completed",
            None,
            completed_revision.as_deref(),
        );
        self.replace_record(&record.installation_id, record.clone())?;
        let outcome = if deferred.is_empty() {
            ProposalApplyOutcome::Ready
        } else {
            ProposalApplyOutcome::ReadyWithDeferredItems
        };
        Ok(result_from_record(record, completed, outcome))
    }

    fn rollback_after_failure(
        &self,
        mut record: ApprovalApplyRecord,
        onboarding: OnboardingSnapshot,
        failure_code: &str,
    ) -> WorkspaceResult<ProposalApplyResult> {
        record.status = ApplyStatus::VerificationFailed;
        record.safe_failure_code = Some(failure_code.to_string());
        push_event(&mut record, "verification_failed", Some(failure_code), None);
        record.status = ApplyStatus::RollbackStarted;
        record.rollback_started = true;
        record.rollback_attempts = record.rollback_attempts.saturating_add(1);
        push_event(&mut record, "rollback_started", Some(failure_code), None);
        self.replace_record(&record.installation_id, record.clone())?;
        self.perform_rollback(record, onboarding)
    }

    fn perform_rollback(
        &self,
        mut record: ApprovalApplyRecord,
        onboarding: OnboardingSnapshot,
    ) -> WorkspaceResult<ProposalApplyResult> {
        let point_id = record.recovery_point_id.clone().ok_or_else(|| {
            WorkspaceError::new(
                WorkspaceErrorCode::RecoveryRequired,
                WorkspaceErrorCategory::Recovery,
                "The approved apply has no recovery evidence.",
                RetryDirective::Recovery,
            )
        })?;
        let restored = self.setup.recovery().restore_configuration(&point_id, true);
        let verified_revision = restored.and_then(|_| {
            self.setup
                .configuration()
                .read_existing()
                .map(|(_, revision)| revision)
        });
        let Ok(restored_revision) = verified_revision else {
            let failed = self
                .setup
                .onboarding()
                .mark_failed(
                    onboarding.revision(),
                    "phase_f_rollback_failed".to_string(),
                    child_id(&record.operation_id, "rollback-failed"),
                )
                .unwrap_or(onboarding);
            record.status = ApplyStatus::FailedRecoverable;
            record.safe_failure_code = Some("rollback_unverified".to_string());
            record.completed_at = Some(now());
            push_event(
                &mut record,
                "setup_failed_recoverable",
                Some("rollback_unverified"),
                None,
            );
            self.replace_record(&record.installation_id, record.clone())?;
            return Ok(result_from_record(
                record,
                failed,
                ProposalApplyOutcome::FailedRecoverable,
            ));
        };
        if restored_revision != record.base_configuration_revision {
            let failed = self
                .setup
                .onboarding()
                .mark_failed(
                    onboarding.revision(),
                    "phase_f_rollback_failed".to_string(),
                    child_id(&record.operation_id, "rollback-integrity-failed"),
                )
                .unwrap_or(onboarding);
            record.status = ApplyStatus::FailedRecoverable;
            record.safe_failure_code = Some("rollback_revision_mismatch".to_string());
            record.completed_at = Some(now());
            push_event(
                &mut record,
                "setup_failed_recoverable",
                Some("rollback_revision_mismatch"),
                Some(&restored_revision),
            );
            self.replace_record(&record.installation_id, record.clone())?;
            return Ok(result_from_record(
                record,
                failed,
                ProposalApplyOutcome::FailedRecoverable,
            ));
        }
        let rolled_back = self
            .setup
            .onboarding()
            .record_verified_rollback(
                onboarding.revision(),
                restored_revision.clone(),
                record
                    .safe_failure_code
                    .clone()
                    .unwrap_or_else(|| "phase_f_verification_failed".to_string()),
                child_id(&record.operation_id, "rollback-verified"),
            )
            .map_err(map_onboarding)?;
        record.status = ApplyStatus::RolledBack;
        record.rollback_completed = true;
        record.completed_at = Some(now());
        record.active_configuration_revision = Some(restored_revision.clone());
        push_event(
            &mut record,
            "rollback_verified",
            None,
            Some(&restored_revision),
        );
        self.replace_record(&record.installation_id, record.clone())?;
        Ok(result_from_record(
            record,
            rolled_back,
            ProposalApplyOutcome::RolledBack,
        ))
    }

    fn reconcile_record(
        &self,
        mut record: ApprovalApplyRecord,
    ) -> WorkspaceResult<ProposalApplyResult> {
        if record.approving_user_context_digest != approving_context_digest(&record.installation_id)
        {
            record.status = ApplyStatus::FailedRecoverable;
            record.safe_failure_code = Some("approving_context_changed".to_string());
            record.completed_at = Some(now());
            self.replace_record(&record.installation_id, record.clone())?;
        }
        let onboarding = self.setup.onboarding().get().map_err(map_onboarding)?;
        let (_, current) = self
            .setup
            .configuration()
            .read_existing()
            .map_err(config_unavailable)?;
        if current == record.target_configuration_revision && onboarding.is_ready() {
            let observed_revision = current.clone();
            record.status = ApplyStatus::Succeeded;
            record.configuration_committed = true;
            record.verification_started = true;
            record.verification_completed = true;
            record.completed_at = Some(now());
            record.active_configuration_revision = Some(current);
            push_event(
                &mut record,
                "setup_completion_reconciled",
                None,
                Some(&observed_revision),
            );
            self.replace_record(&record.installation_id, record.clone())?;
            return Ok(result_from_record(
                record,
                onboarding,
                ProposalApplyOutcome::Replayed,
            ));
        }
        if current == record.base_configuration_revision
            && onboarding.state() == OnboardingState::RolledBack
            && matches!(
                record.status,
                ApplyStatus::VerificationFailed | ApplyStatus::RollbackStarted
            )
        {
            let observed_revision = current.clone();
            record.status = ApplyStatus::RolledBack;
            record.rollback_completed = true;
            record.completed_at = Some(now());
            record.active_configuration_revision = Some(current);
            push_event(
                &mut record,
                "rollback_completion_reconciled",
                None,
                Some(&observed_revision),
            );
            self.replace_record(&record.installation_id, record.clone())?;
            return Ok(result_from_record(
                record,
                onboarding,
                ProposalApplyOutcome::RolledBack,
            ));
        }
        match record.status {
            ApplyStatus::Succeeded => Ok(result_from_record(
                record,
                onboarding,
                ProposalApplyOutcome::Replayed,
            )),
            ApplyStatus::RolledBack => Ok(result_from_record(
                record,
                onboarding,
                ProposalApplyOutcome::Replayed,
            )),
            ApplyStatus::FailedRecoverable | ApplyStatus::Invalidated => Ok(result_from_record(
                record,
                onboarding,
                ProposalApplyOutcome::FailedRecoverable,
            )),
            ApplyStatus::Approved if current == record.base_configuration_revision => {
                record.status = ApplyStatus::Invalidated;
                record.safe_failure_code = Some("interrupted_before_apply".to_string());
                record.completed_at = Some(now());
                push_event(
                    &mut record,
                    "approval_closed_without_apply",
                    Some("interrupted_before_apply"),
                    Some(&current),
                );
                self.replace_record(&record.installation_id, record.clone())?;
                Ok(result_from_record(
                    record,
                    onboarding,
                    ProposalApplyOutcome::FailedRecoverable,
                ))
            }
            ApplyStatus::Applying | ApplyStatus::Verifying | ApplyStatus::VerificationFailed
                if current == record.target_configuration_revision =>
            {
                let verifying = if onboarding.state() == OnboardingState::Applying {
                    self.setup
                        .onboarding()
                        .record_setup_saved(
                            onboarding.revision(),
                            current,
                            child_id(&record.operation_id, "restart-saved"),
                        )
                        .map_err(map_onboarding)?
                } else {
                    onboarding
                };
                record.status = ApplyStatus::Verifying;
                record.verification_started = true;
                self.replace_record(&record.installation_id, record.clone())?;
                self.verify_or_rollback(record, verifying, None)
            }
            ApplyStatus::RollbackStarted if current == record.base_configuration_revision => {
                let rolled = self
                    .setup
                    .onboarding()
                    .record_verified_rollback(
                        onboarding.revision(),
                        current,
                        record
                            .safe_failure_code
                            .clone()
                            .unwrap_or_else(|| "phase_f_verification_failed".to_string()),
                        child_id(&record.operation_id, "restart-rollback-verified"),
                    )
                    .map_err(map_onboarding)?;
                record.status = ApplyStatus::RolledBack;
                record.rollback_completed = true;
                record.completed_at = Some(now());
                self.replace_record(&record.installation_id, record.clone())?;
                Ok(result_from_record(
                    record,
                    rolled,
                    ProposalApplyOutcome::RolledBack,
                ))
            }
            ApplyStatus::RollbackStarted if record.rollback_attempts < 2 => {
                record.rollback_attempts += 1;
                self.replace_record(&record.installation_id, record.clone())?;
                self.perform_rollback(record, onboarding)
            }
            _ => {
                record.status = ApplyStatus::FailedRecoverable;
                record.safe_failure_code = Some("transaction_state_conflict".to_string());
                record.completed_at = Some(now());
                push_event(
                    &mut record,
                    "setup_failed_recoverable",
                    Some("transaction_state_conflict"),
                    Some(&current),
                );
                self.replace_record(&record.installation_id, record.clone())?;
                Ok(result_from_record(
                    record,
                    onboarding,
                    ProposalApplyOutcome::FailedRecoverable,
                ))
            }
        }
    }

    fn assert_record_binding(
        &self,
        installation_id: &str,
        record: &ApprovalApplyRecord,
        proposal: &EligibleLocalProposal,
    ) -> WorkspaceResult<()> {
        let authoritative = self.with_store(installation_id, |document| {
            document
                .records
                .iter()
                .find(|candidate| candidate.operation_id == record.operation_id)
                .cloned()
                .ok_or_else(|| stale("The local approval record is unavailable."))
        })?;
        if authoritative.status != ApplyStatus::Approved
            || authoritative.proposal_id != proposal.proposal_id
            || authoritative.proposal_revision != proposal.revision
            || authoritative.proposal_digest != proposal.proposal_digest
            || authoritative.proposal_schema_version != proposal.schema_version
            || authoritative.base_configuration_revision != proposal.base_configuration_revision
            || authoritative.target_configuration_revision != proposal.target_configuration_revision
            || authoritative.onboarding_revision != proposal.onboarding_revision
            || authoritative.snapshot_digest != proposal.snapshot_digest
            || authoritative.changed_fields_digest != sha256(&proposal.changed_fields.join("\n"))
            || authoritative.warning_count != proposal.warnings.len()
            || authoritative.approving_user_context_digest
                != approving_context_digest(installation_id)
            || expired(&authoritative.expires_at)
        {
            return Err(stale(
                "The local approval is stale or does not match this proposal.",
            ));
        }
        Ok(())
    }

    fn find_request_record(
        &self,
        installation_id: &str,
        request: &ApproveAndApplyProposalRequest,
    ) -> WorkspaceResult<Option<ApprovalApplyRecord>> {
        self.with_store(installation_id, |document| {
            if let Some(record) = document
                .records
                .iter()
                .find(|record| record.request_id == request.request_id)
            {
                if record.proposal_id != request.proposal_id
                    || record.proposal_revision != request.proposal_revision
                    || record.proposal_digest != request.proposal_digest
                {
                    return Err(WorkspaceError::new(
                        WorkspaceErrorCode::PersistenceConflict,
                        WorkspaceErrorCategory::Concurrency,
                        "This approval request identifier was already used for another proposal.",
                        RetryDirective::Never,
                    ));
                }
                return Ok(Some(record.clone()));
            }
            Ok(None)
        })
    }

    fn insert_record(
        &self,
        installation_id: &str,
        record: ApprovalApplyRecord,
    ) -> WorkspaceResult<()> {
        self.with_store_mut(installation_id, |document| {
            if document
                .records
                .iter()
                .any(|existing| existing.request_id == record.request_id)
            {
                return Err(stale("The approval request was already recorded."));
            }
            document.records.push(record);
            if document.records.len() > MAX_RECORDS {
                let remove = document.records.len() - MAX_RECORDS;
                document.records.drain(0..remove);
            }
            Ok(())
        })
    }

    fn replace_record(
        &self,
        installation_id: &str,
        record: ApprovalApplyRecord,
    ) -> WorkspaceResult<()> {
        self.with_store_mut(installation_id, |document| {
            let slot = document
                .records
                .iter_mut()
                .find(|existing| existing.operation_id == record.operation_id)
                .ok_or_else(|| stale("The approval operation is unavailable."))?;
            *slot = record;
            Ok(())
        })
    }

    fn close_invalidated(
        &self,
        installation_id: &str,
        operation_id: &str,
        code: &str,
    ) -> WorkspaceResult<()> {
        self.with_store_mut(installation_id, |document| {
            let record = document
                .records
                .iter_mut()
                .find(|record| record.operation_id == operation_id)
                .ok_or_else(|| stale("The approval operation is unavailable."))?;
            record.status = ApplyStatus::Invalidated;
            record.safe_failure_code = Some(code.to_string());
            record.completed_at = Some(now());
            push_event(record, "approval_invalidated", Some(code), None);
            Ok(())
        })
    }

    fn with_store<T>(
        &self,
        installation_id: &str,
        operation: impl FnOnce(&ApprovalDocument) -> WorkspaceResult<T>,
    ) -> WorkspaceResult<T> {
        let (_lock, document) = self.load_locked(installation_id)?;
        operation(&document)
    }

    fn with_store_mut<T>(
        &self,
        installation_id: &str,
        operation: impl FnOnce(&mut ApprovalDocument) -> WorkspaceResult<T>,
    ) -> WorkspaceResult<T> {
        let (_lock, mut document) = self.load_locked(installation_id)?;
        let result = operation(&mut document)?;
        save_document(&self.paths.proposal_approval_root, &document)?;
        Ok(result)
    }

    fn load_locked(&self, installation_id: &str) -> WorkspaceResult<(fs::File, ApprovalDocument)> {
        fs::create_dir_all(&self.paths.proposal_approval_root).map_err(store_error)?;
        let lock_path = self.paths.proposal_approval_root.join("state.lock");
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            // Lock file only: never truncate, the contents are never used.
            .truncate(false)
            .open(lock_path)
            .map_err(store_error)?;
        lock.try_lock_exclusive().map_err(|_| {
            WorkspaceError::new(
                WorkspaceErrorCode::OperationBusy,
                WorkspaceErrorCategory::Concurrency,
                "Another proposal approval operation is in progress.",
                RetryDirective::Retry,
            )
        })?;
        let document = load_document(&self.paths.proposal_approval_root, installation_id)?;
        Ok((lock, document))
    }
}

fn new_record(
    installation_id: &str,
    proposal: &EligibleLocalProposal,
    request: &ApproveAndApplyProposalRequest,
) -> WorkspaceResult<ApprovalApplyRecord> {
    let approved = Utc::now();
    let operation_id = random_id("phasef-operation")?;
    let approval_id = random_id("approval")?;
    let mut record = ApprovalApplyRecord {
        schema_version: APPROVAL_SCHEMA,
        installation_id: installation_id.to_string(),
        approval_id,
        operation_id,
        request_id: request.request_id.clone(),
        status: ApplyStatus::Approved,
        proposal_id: proposal.proposal_id.clone(),
        proposal_revision: proposal.revision,
        proposal_schema_version: proposal.schema_version,
        proposal_digest: proposal.proposal_digest.clone(),
        originating_profile_digest: sha256(&proposal.originating_profile_id),
        base_configuration_revision: proposal.base_configuration_revision.clone(),
        target_configuration_revision: proposal.target_configuration_revision.clone(),
        onboarding_revision: proposal.onboarding_revision,
        snapshot_digest: proposal.snapshot_digest.clone(),
        normalized_candidate_digest: proposal.target_configuration_revision.clone(),
        changed_fields_digest: sha256(&proposal.changed_fields.join("\n")),
        warning_count: proposal.warnings.len(),
        approving_user_context_digest: approving_context_digest(installation_id),
        approved_at: approved.to_rfc3339(),
        expires_at: (approved + Duration::minutes(APPROVAL_LIFETIME_MINUTES)).to_rfc3339(),
        recovery_point_id: None,
        workspace_prepared: false,
        configuration_committed: false,
        verification_started: false,
        verification_completed: false,
        rollback_started: false,
        rollback_completed: false,
        rollback_attempts: 0,
        completed_at: None,
        active_configuration_revision: None,
        deferred_items: Vec::new(),
        blocker_keys: Vec::new(),
        safe_failure_code: None,
        events: Vec::new(),
    };
    push_event(&mut record, "proposal_review_opened", None, None);
    Ok(record)
}

fn result_from_record(
    record: ApprovalApplyRecord,
    onboarding: OnboardingSnapshot,
    outcome: ProposalApplyOutcome,
) -> ProposalApplyResult {
    ProposalApplyResult {
        outcome,
        proposal_id: record.proposal_id,
        operation_id: record.operation_id,
        target_configuration_revision: record.target_configuration_revision,
        active_configuration_revision: record
            .active_configuration_revision
            .unwrap_or(record.base_configuration_revision),
        deferred_items: record.deferred_items,
        blocker_keys: record.blocker_keys,
        onboarding,
    }
}

fn record_summary(record: &ApprovalApplyRecord) -> ManagerProposalApplySummary {
    ManagerProposalApplySummary {
        proposal_id: record.proposal_id.clone(),
        operation_id: record.operation_id.clone(),
        status: match record.status {
            ApplyStatus::Approved => "approved",
            ApplyStatus::Applying => "applying",
            ApplyStatus::Verifying => "verifying",
            ApplyStatus::VerificationFailed => "verification_failed",
            ApplyStatus::RollbackStarted => "rollback_started",
            ApplyStatus::Succeeded => "succeeded",
            ApplyStatus::RolledBack => "rolled_back",
            ApplyStatus::FailedRecoverable => "failed_recoverable",
            ApplyStatus::Invalidated => "invalidated",
        }
        .to_string(),
        approved_at: record.approved_at.clone(),
        completed_at: record.completed_at.clone(),
        base_configuration_revision: record.base_configuration_revision.clone(),
        target_configuration_revision: record.target_configuration_revision.clone(),
        active_configuration_revision: record.active_configuration_revision.clone(),
        deferred_items: record.deferred_items.clone(),
        blocker_keys: record.blocker_keys.clone(),
        safe_failure_code: record.safe_failure_code.clone(),
    }
}

fn load_document(root: &Path, installation_id: &str) -> WorkspaceResult<ApprovalDocument> {
    let path = root.join("state.dpapi");
    if !path.is_file() {
        return Ok(ApprovalDocument {
            schema_version: APPROVAL_SCHEMA,
            installation_id: installation_id.to_string(),
            records: Vec::new(),
        });
    }
    let bytes = fs::read(&path).map_err(store_error)?;
    if bytes.len() > MAX_APPROVAL_BYTES || !bytes.starts_with(APPROVAL_MAGIC) {
        return Err(corrupt_store());
    }
    let clear =
        unprotect_for_current_user(&bytes[APPROVAL_MAGIC.len()..]).map_err(|_| corrupt_store())?;
    let document: ApprovalDocument = serde_json::from_slice(&clear).map_err(|_| corrupt_store())?;
    if document.schema_version != APPROVAL_SCHEMA || document.installation_id != installation_id {
        return Err(corrupt_store());
    }
    Ok(document)
}

fn save_document(root: &Path, document: &ApprovalDocument) -> WorkspaceResult<()> {
    let clear = serde_json::to_vec(document).map_err(|_| corrupt_store())?;
    if clear.len() > MAX_APPROVAL_BYTES {
        return Err(corrupt_store());
    }
    let protected = protect_for_current_user(&clear).map_err(|_| corrupt_store())?;
    let mut bytes = APPROVAL_MAGIC.to_vec();
    bytes.extend_from_slice(&protected);
    crate::config::atomic_replace_configuration_bytes(&root.join("state.dpapi"), &bytes)
        .map_err(store_error)
}

fn validate_request(request: &ApproveAndApplyProposalRequest) -> WorkspaceResult<()> {
    if !request.confirmed {
        return Err(WorkspaceError::new(
            WorkspaceErrorCode::ConfirmationRequired,
            WorkspaceErrorCategory::Capability,
            "Approve and finish setup requires explicit local confirmation.",
            RetryDirective::UserAction,
        ));
    }
    if request.proposal_revision == 0
        || !valid_id(&request.proposal_id)
        || !valid_id(&request.request_id)
        || request
            .proposal_digest
            .strip_prefix("sha256:")
            .is_none_or(|digest| digest.len() != 64)
        || !request
            .proposal_digest
            .trim_start_matches("sha256:")
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid("The proposal approval request is invalid."));
    }
    Ok(())
}

fn valid_id(value: &str) -> bool {
    (8..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn push_event(
    record: &mut ApprovalApplyRecord,
    event: &str,
    safe_code: Option<&str>,
    revision: Option<&str>,
) {
    record.events.push(ApplyAuditEvent {
        at: now(),
        event: event.to_string(),
        safe_code: safe_code.map(str::to_string),
        configuration_revision: revision.map(str::to_string),
    });
    if record.events.len() > MAX_EVENTS {
        let remove = record.events.len() - MAX_EVENTS;
        record.events.drain(0..remove);
    }
}

fn operation_payload_digest(record: &ApprovalApplyRecord) -> String {
    format!(
        "sha256:{}",
        sha256(&format!(
            "{}:{}:{}:{}:{}",
            record.installation_id,
            record.proposal_digest,
            record.base_configuration_revision,
            record.target_configuration_revision,
            record.approval_id
        ))
    )
}

fn approving_context_digest(installation_id: &str) -> String {
    let domain = std::env::var("USERDOMAIN").unwrap_or_default();
    let user = std::env::var("USERNAME").unwrap_or_default();
    sha256(&format!(
        "{installation_id}:{domain}:{user}:dpapi-current-user"
    ))
}

fn child_id(operation_id: &str, stage: &str) -> String {
    format!(
        "phasef-{}-{}",
        stage,
        &sha256(&format!("{operation_id}:{stage}"))[..32]
    )
}

fn random_id(prefix: &str) -> WorkspaceResult<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|_| invalid("InnPilot could not create a local operation identity."))?;
    Ok(format!(
        "{prefix}-{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

fn sha256(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn expired(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .is_none_or(|value| value.with_timezone(&Utc) <= Utc::now())
}

fn map_candidate(error: ConfigurationCandidateError) -> WorkspaceError {
    match error {
        ConfigurationCandidateError::Stale { current_revision } => stale(&format!(
            "Configuration changed ({current_revision}). Review the proposal again."
        )),
        ConfigurationCandidateError::Unavailable { diagnostic } => config_unavailable(diagnostic),
        ConfigurationCandidateError::Invalid { diagnostic } => WorkspaceError::new(
            WorkspaceErrorCode::InvalidRequest,
            WorkspaceErrorCategory::Validation,
            "The reviewed proposal is no longer valid.",
            RetryDirective::UserAction,
        )
        .with_diagnostic(diagnostic),
    }
}

fn map_onboarding(error: OnboardingError) -> WorkspaceError {
    let code = if matches!(error.code.as_str(), "stale_revision" | "config_changed") {
        WorkspaceErrorCode::StaleRevision
    } else if error.code == "invalid_transition" {
        WorkspaceErrorCode::InvalidTransition
    } else {
        WorkspaceErrorCode::PersistenceFailed
    };
    let mut mapped = WorkspaceError::new(
        code,
        WorkspaceErrorCategory::Lifecycle,
        error.message,
        if code == WorkspaceErrorCode::StaleRevision {
            RetryDirective::Refresh
        } else {
            RetryDirective::Retry
        },
    );
    if let Some(revision) = error.current_revision {
        mapped = mapped.with_details(SafeErrorDetails::Revision {
            resource: WorkspaceResource::Onboarding,
            current: revision.to_string(),
        });
    }
    mapped.with_diagnostic(format!("onboarding code: {}", error.code))
}

fn config_unavailable(diagnostic: String) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::ConfigurationUnavailable,
        WorkspaceErrorCategory::Configuration,
        "InnPilot configuration is unavailable.",
        RetryDirective::Retry,
    )
    .with_diagnostic(diagnostic)
}

fn store_error(error: impl ToString) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::PersistenceFailed,
        WorkspaceErrorCategory::Persistence,
        "InnPilot could not update the protected local approval record.",
        RetryDirective::Retry,
    )
    .with_diagnostic(error.to_string())
}

fn corrupt_store() -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::CorruptState,
        WorkspaceErrorCategory::Persistence,
        "The protected local approval record needs recovery.",
        RetryDirective::Recovery,
    )
}

fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::InvalidRequest,
        WorkspaceErrorCategory::Validation,
        message,
        RetryDirective::UserAction,
    )
}

fn stale(message: &str) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::StaleRevision,
        WorkspaceErrorCategory::Concurrency,
        message,
        RetryDirective::Refresh,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{self, InvoiceDeliveryMode},
        environment_discovery::{
            ApproveDiscoveryScopeRequest, DeterministicProposalValidation,
            DiscoverEnvironmentRequest, DiscoveryProposalChanges, PrepareDiscoveryProposalRequest,
            PROPOSAL_CONTRACT,
        },
        onboarding::OnboardingMode,
    };
    use std::path::PathBuf;

    struct Fixture {
        root: PathBuf,
        service: ProposalApplyService,
        profile_id: String,
        proposal_id: String,
        proposal_revision: u64,
        proposal_digest: String,
        original_app: Vec<u8>,
        original_automation: Vec<u8>,
    }

    fn fixture(name: &str, make_verification_fail: bool) -> Fixture {
        let root = std::env::temp_dir().join(format!(
            "innpilot-phase-f-{name}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&root).unwrap();
        let paths = InstallationPaths::from_app_data(&root, None);
        let workspace = root.join("hotel-workspace");
        let automation = root.join("automation");
        let automation_config = automation.join("config.local.json");
        let invoice_script = automation.join("run_invoices.cmd");
        for directory in [
            workspace.join("invoices/in"),
            workspace.join("invoices/out"),
            workspace.join("invoices/archive"),
            workspace.join("logs/invoices"),
            workspace.join("scans/shared"),
            workspace.join("scans/cache"),
            workspace.join("scans/text"),
            workspace.join("contracts/out"),
            workspace.join("contracts/logs"),
            workspace.join("gmail"),
            automation.clone(),
        ] {
            fs::create_dir_all(directory).unwrap();
        }
        fs::write(&invoice_script, b"@echo off\r\nexit /b 0\r\n").unwrap();
        let original_automation = b"{}".to_vec();
        fs::write(&automation_config, &original_automation).unwrap();
        let mut config = config::default_config_for_config_path(&paths.config_file);
        config.client.display_name = "Synthetic Hotel".to_string();
        config.invoice_delivery_mode = InvoiceDeliveryMode::PrepareOnly;
        config.automation.automation_root_folder = automation.to_string_lossy().to_string();
        config.automation.automation_config_path = automation_config.to_string_lossy().to_string();
        config.automation.python_executable.clear();
        config.scripts.invoice_workflow_script = invoice_script.to_string_lossy().to_string();
        config.folders.invoice_input_folder =
            workspace.join("invoices/in").to_string_lossy().to_string();
        config.folders.invoice_output_folder =
            workspace.join("invoices/out").to_string_lossy().to_string();
        config.folders.invoice_archive_folder = workspace
            .join("invoices/archive")
            .to_string_lossy()
            .to_string();
        config.folders.invoice_log_folder = workspace
            .join("logs/invoices")
            .to_string_lossy()
            .to_string();
        config.folders.scansioni_network_share =
            workspace.join("scans/shared").to_string_lossy().to_string();
        config.folders.scansioni_local_cache_folder =
            workspace.join("scans/cache").to_string_lossy().to_string();
        config.folders.ocr_text_output_folder =
            workspace.join("scans/text").to_string_lossy().to_string();
        config.folders.contracts_output_folder = workspace
            .join("contracts/out")
            .to_string_lossy()
            .to_string();
        config.folders.contract_log_folder = workspace
            .join("contracts/logs")
            .to_string_lossy()
            .to_string();
        config.gmail.token_path = workspace
            .join("gmail/token.json")
            .to_string_lossy()
            .to_string();
        config.safety.dry_run_default = false;
        let original_app = serde_json::to_vec_pretty(&config).unwrap();
        config::atomic_replace_configuration_bytes(&paths.config_file, &original_app).unwrap();

        let service =
            ProposalApplyService::new(paths.clone(), BuildInfo::from_version("test")).unwrap();
        let onboarding = service.setup.onboarding().reconcile_startup(true).unwrap();
        let (_, configuration_revision) = service.setup.configuration().read_existing().unwrap();
        let discovery_root = workspace.join("approved-discovery");
        fs::create_dir_all(discovery_root.join("existing-layout")).unwrap();
        let installation_id = onboarding.installation_id().to_string();
        let profile_id = "profile_phase_f_synthetic_01".to_string();
        let scope = service
            .discovery
            .approve_scope(
                &installation_id,
                &profile_id,
                ApproveDiscoveryScopeRequest {
                    roots: vec![discovery_root.to_string_lossy().to_string()],
                    confirmed: true,
                },
            )
            .unwrap()
            .scope
            .unwrap();
        let snapshot = service
            .discovery
            .discover(
                &installation_id,
                &profile_id,
                DiscoverEnvironmentRequest {
                    scope_id: scope.scope_id.clone(),
                    scope_revision: scope.revision,
                    root_ids: vec![scope.roots[0].root_id.clone()],
                    max_depth: Some(2),
                    max_directories: Some(32),
                    max_files: Some(32),
                },
            )
            .unwrap();
        let proposal_id = format!("proposal_phase_f_{name}_01");
        let changes = if make_verification_fail {
            DiscoveryProposalChanges {
                safe_mode: Some(true),
                ..Default::default()
            }
        } else {
            DiscoveryProposalChanges {
                hotel_display_name: Some("Synthetic Ready Hotel".to_string()),
                ..Default::default()
            }
        };
        let proposal = service
            .proposals
            .prepare(
                &service.discovery,
                &installation_id,
                &profile_id,
                &configuration_revision,
                onboarding.revision(),
                PrepareDiscoveryProposalRequest {
                    request_id: format!("request_phase_f_{name}_01"),
                    proposal_id: proposal_id.clone(),
                    contract_version: PROPOSAL_CONTRACT.to_string(),
                    base_configuration_revision: configuration_revision.clone(),
                    onboarding_revision: onboarding.revision(),
                    scope_id: scope.scope_id,
                    scope_revision: scope.revision,
                    snapshot_id: snapshot.snapshot_id,
                    snapshot_digest: snapshot.digest,
                    changes: changes.clone(),
                    evidence_refs: Vec::new(),
                    unresolved_questions: Vec::new(),
                    agent_confidence: Some(0.9),
                    parent_proposal_id: None,
                },
                |resolved| {
                    let mut patch = crate::setup::SetupPatch::default();
                    if let Some(value) = resolved.safe_changes.hotel_display_name.clone() {
                        patch.set_hotel_display_name(value);
                    }
                    if let Some(value) = resolved.safe_changes.safe_mode {
                        patch.set_safe_mode(value);
                    }
                    let preview = service
                        .setup
                        .configuration()
                        .preview(&patch, &configuration_revision)
                        .map_err(map_candidate)?;
                    Ok(DeterministicProposalValidation {
                        target_configuration_revision: preview.target_revision().to_string(),
                        changed_fields: if make_verification_fail {
                            vec!["safeMode".to_string()]
                        } else {
                            vec!["hotelDisplayName".to_string()]
                        },
                        warnings: Vec::new(),
                    })
                },
            )
            .unwrap();

        Fixture {
            root,
            service,
            profile_id,
            proposal_id,
            proposal_revision: proposal.revision,
            proposal_digest: proposal.proposal_digest,
            original_app,
            original_automation,
        }
    }

    fn request(fixture: &Fixture, suffix: &str) -> ApproveAndApplyProposalRequest {
        ApproveAndApplyProposalRequest {
            proposal_id: fixture.proposal_id.clone(),
            proposal_revision: fixture.proposal_revision,
            proposal_digest: fixture.proposal_digest.clone(),
            request_id: format!("phasef-ui-request-{suffix}-0001"),
            confirmed: true,
        }
    }

    #[test]
    fn synthetic_proposal_approval_applies_exact_candidate_and_verifies_ready() {
        let fixture = fixture("success", false);
        let result = fixture
            .service
            .approve_and_apply(&fixture.profile_id, true, request(&fixture, "success"))
            .unwrap();
        assert!(matches!(
            result.outcome,
            ProposalApplyOutcome::Ready | ProposalApplyOutcome::ReadyWithDeferredItems
        ));
        assert_eq!(
            result.active_configuration_revision,
            result.target_configuration_revision
        );
        assert!(result.onboarding.is_ready());
        let summary = fixture
            .service
            .latest_summary(result.onboarding.installation_id(), &fixture.proposal_id)
            .unwrap()
            .unwrap();
        assert_eq!(summary.status, "succeeded");
        assert!(!fixture
            .service
            .setup
            .recovery()
            .status()
            .unwrap()
            .points
            .is_empty());
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn required_verification_failure_restores_exact_predecessor_bytes() {
        let fixture = fixture("rollback", true);
        let result = fixture
            .service
            .approve_and_apply(&fixture.profile_id, true, request(&fixture, "rollback"))
            .unwrap();
        assert_eq!(result.outcome, ProposalApplyOutcome::RolledBack);
        assert_eq!(
            fs::read(fixture.service.paths.config_file.clone()).unwrap(),
            fixture.original_app
        );
        let automation_path = fixture.root.join("automation/config.local.json");
        assert_eq!(
            fs::read(automation_path).unwrap(),
            fixture.original_automation
        );
        assert_eq!(result.onboarding.state(), OnboardingState::RolledBack);
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn wrong_digest_revision_and_missing_confirmation_fail_before_approval() {
        let fixture = fixture("tamper", false);
        let mut wrong = request(&fixture, "tamper");
        wrong.proposal_digest = format!("sha256:{}", "0".repeat(64));
        assert_eq!(
            fixture
                .service
                .approve_and_apply(&fixture.profile_id, true, wrong)
                .unwrap_err()
                .code(),
            WorkspaceErrorCode::StaleRevision
        );
        let mut wrong_revision = request(&fixture, "wrong-revision");
        wrong_revision.proposal_revision += 1;
        assert_eq!(
            fixture
                .service
                .approve_and_apply(&fixture.profile_id, true, wrong_revision)
                .unwrap_err()
                .code(),
            WorkspaceErrorCode::StaleRevision
        );
        let mut unconfirmed = request(&fixture, "unconfirmed");
        unconfirmed.confirmed = false;
        assert_eq!(
            fixture
                .service
                .approve_and_apply(&fixture.profile_id, true, unconfirmed)
                .unwrap_err()
                .code(),
            WorkspaceErrorCode::ConfirmationRequired
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn identical_request_replays_terminal_outcome_without_second_commit() {
        let fixture = fixture("replay", false);
        let replay_request = request(&fixture, "replay");
        let first = fixture
            .service
            .approve_and_apply(&fixture.profile_id, true, replay_request.clone())
            .unwrap();
        let bytes = fs::read(fixture.service.paths.config_file.clone()).unwrap();
        let replay = fixture
            .service
            .approve_and_apply(&fixture.profile_id, true, replay_request)
            .unwrap();
        assert_eq!(replay.outcome, ProposalApplyOutcome::Replayed);
        assert_eq!(replay.operation_id, first.operation_id);
        assert_eq!(
            fs::read(fixture.service.paths.config_file.clone()).unwrap(),
            bytes
        );
        let mut conflicting = request(&fixture, "replay");
        conflicting.proposal_id = "different-proposal-00000001".to_string();
        assert_eq!(
            fixture
                .service
                .approve_and_apply(&fixture.profile_id, true, conflicting)
                .unwrap_err()
                .code(),
            WorkspaceErrorCode::PersistenceConflict
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn renderer_cannot_supply_an_approval_claim_or_receipt() {
        for extra in [
            serde_json::json!({ "approved": true }),
            serde_json::json!({ "approvalId": "forged-approval-00000001" }),
            serde_json::json!({ "recoveryPointId": "forged-point-00000001" }),
        ] {
            let mut request = serde_json::json!({
                "proposalId": "proposal-contract-00000001",
                "proposalRevision": 1,
                "proposalDigest": format!("sha256:{}", "a".repeat(64)),
                "requestId": "phasef-ui-contract-00000001",
                "confirmed": true
            });
            request
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            assert!(serde_json::from_value::<ApproveAndApplyProposalRequest>(request).is_err());
        }
    }

    #[test]
    fn protected_record_contains_only_bounded_identifiers_and_digests() {
        let fixture = fixture("privacy", false);
        let result = fixture
            .service
            .approve_and_apply(&fixture.profile_id, true, request(&fixture, "privacy"))
            .unwrap();
        let document = load_document(
            &fixture.service.paths.proposal_approval_root,
            result.onboarding.installation_id(),
        )
        .unwrap();
        let clear = serde_json::to_string(&document).unwrap();
        for forbidden in [
            "hotel-workspace",
            "run_invoices.cmd",
            "gmail/token.json",
            "Synthetic Ready Hotel",
            "gmail_credentials",
        ] {
            assert!(!clear.contains(forbidden), "leaked {forbidden}");
        }
        assert!(clear.len() < MAX_APPROVAL_BYTES);
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn protected_record_tampering_fails_closed() {
        let fixture = fixture("store-tamper", false);
        let onboarding = fixture.service.setup.onboarding().get().unwrap();
        fs::create_dir_all(&fixture.service.paths.proposal_approval_root).unwrap();
        fs::write(
            fixture
                .service
                .paths
                .proposal_approval_root
                .join("state.dpapi"),
            b"forged approval=true",
        )
        .unwrap();
        assert_eq!(
            fixture
                .service
                .latest_summary(onboarding.installation_id(), &fixture.proposal_id)
                .unwrap_err()
                .code(),
            WorkspaceErrorCode::CorruptState
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn configuration_race_after_approval_fails_closed_before_commit() {
        let fixture = fixture("config-race", false);
        let config_path = fixture.service.paths.config_file.clone();
        let original_automation_path = fixture.root.join("automation/config.local.json");
        let result = fixture.service.approve_and_apply_with_hook(
            &fixture.profile_id,
            true,
            request(&fixture, "config-race"),
            || {
                let mut config: config::HubConfig =
                    serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
                config.language = "it".to_string();
                config::atomic_replace_configuration_bytes(
                    &config_path,
                    &serde_json::to_vec_pretty(&config).unwrap(),
                )
                .unwrap();
            },
        );
        assert_eq!(
            result.unwrap_err().code(),
            WorkspaceErrorCode::StaleRevision
        );
        assert_eq!(
            fs::read(original_automation_path).unwrap(),
            fixture.original_automation
        );
        let summary = fixture
            .service
            .latest_summary(
                fixture
                    .service
                    .setup
                    .onboarding()
                    .get()
                    .unwrap()
                    .installation_id(),
                &fixture.proposal_id,
            )
            .unwrap()
            .unwrap();
        assert_eq!(summary.status, "invalidated");
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn onboarding_race_after_approval_fails_closed_before_commit() {
        let fixture = fixture("onboarding-race", false);
        let paths = fixture.service.paths.clone();
        let result = fixture.service.approve_and_apply_with_hook(
            &fixture.profile_id,
            true,
            request(&fixture, "onboarding-race"),
            move || {
                let setup =
                    SetupApplicationService::new(paths, BuildInfo::from_version("test")).unwrap();
                let onboarding = setup.onboarding().get().unwrap();
                setup
                    .onboarding()
                    .begin_or_resume(
                        OnboardingMode::Manual,
                        onboarding.revision(),
                        "phasef-race-onboarding-00000001".to_string(),
                    )
                    .unwrap();
            },
        );
        assert_eq!(
            result.unwrap_err().code(),
            WorkspaceErrorCode::StaleRevision
        );
        assert_eq!(
            fs::read(fixture.service.paths.config_file.clone()).unwrap(),
            fixture.original_app
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn discovery_scope_revoked_after_approval_fails_closed_before_commit() {
        let fixture = fixture("scope-race", false);
        let paths = fixture.service.paths.clone();
        let installation_id = fixture
            .service
            .setup
            .onboarding()
            .get()
            .unwrap()
            .installation_id()
            .to_string();
        let profile_id = fixture.profile_id.clone();
        let result = fixture.service.approve_and_apply_with_hook(
            &fixture.profile_id,
            true,
            request(&fixture, "scope-race"),
            move || {
                DiscoveryService::new(DiscoveryEnvironment {
                    discovery_root: paths.discovery_root,
                    proposal_root: paths.proposal_root,
                })
                .revoke_scope(&installation_id, &profile_id)
                .unwrap();
            },
        );
        assert_eq!(
            result.unwrap_err().code(),
            WorkspaceErrorCode::StaleRevision
        );
        assert_eq!(
            fs::read(fixture.service.paths.config_file.clone()).unwrap(),
            fixture.original_app
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn revoked_originating_grant_cannot_create_approval() {
        let fixture = fixture("revoked-grant", false);
        let result = fixture.service.approve_and_apply(
            &fixture.profile_id,
            false,
            request(&fixture, "revoked"),
        );
        assert_eq!(
            result.unwrap_err().code(),
            WorkspaceErrorCode::StaleRevision
        );
        assert!(!fixture
            .service
            .paths
            .proposal_approval_root
            .join("state.dpapi")
            .is_file());
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn recovery_creation_failure_aborts_before_configuration_mutation() {
        let fixture = fixture("recovery-fail", false);
        let original = fs::read(fixture.service.paths.config_file.clone()).unwrap();
        fs::write(&fixture.service.paths.recovery_root, b"not a directory").unwrap();
        let result = fixture.service.approve_and_apply(
            &fixture.profile_id,
            true,
            request(&fixture, "recovery-fail"),
        );
        assert_eq!(
            result.unwrap_err().code(),
            WorkspaceErrorCode::RecoveryUnavailable
        );
        assert_eq!(
            fs::read(fixture.service.paths.config_file.clone()).unwrap(),
            original
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn protected_approval_record_is_bound_to_installation_identity() {
        let fixture = fixture("cross-install", false);
        let result = fixture
            .service
            .approve_and_apply(
                &fixture.profile_id,
                true,
                request(&fixture, "cross-install"),
            )
            .unwrap();
        let other_root = fixture.root.join("other-installation");
        let other_paths = InstallationPaths::from_app_data(&other_root, None);
        fs::create_dir_all(&other_paths.proposal_approval_root).unwrap();
        fs::copy(
            fixture
                .service
                .paths
                .proposal_approval_root
                .join("state.dpapi"),
            other_paths.proposal_approval_root.join("state.dpapi"),
        )
        .unwrap();
        let other =
            ProposalApplyService::new(other_paths, BuildInfo::from_version("test")).unwrap();
        assert_eq!(
            other
                .latest_summary("installation-other-00000001", &result.proposal_id)
                .unwrap_err()
                .code(),
            WorkspaceErrorCode::CorruptState
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn restart_closes_approval_recorded_before_apply_without_mutating_config() {
        let fixture = fixture("restart-approved", false);
        let onboarding = fixture.service.setup.onboarding().get().unwrap();
        let (_, revision) = fixture
            .service
            .setup
            .configuration()
            .read_existing()
            .unwrap();
        let eligible = fixture
            .service
            .proposals
            .eligible_for_local_approval(
                &fixture.service.discovery,
                onboarding.installation_id(),
                &fixture.profile_id,
                &revision,
                onboarding.revision(),
                true,
                &fixture.proposal_id,
                fixture.proposal_revision,
                &fixture.proposal_digest,
            )
            .unwrap();
        let request = request(&fixture, "restart-approved");
        let record = new_record(onboarding.installation_id(), &eligible, &request).unwrap();
        fixture
            .service
            .insert_record(onboarding.installation_id(), record)
            .unwrap();
        fixture.service.reconcile_startup().unwrap();
        assert_eq!(
            fs::read(fixture.service.paths.config_file.clone()).unwrap(),
            fixture.original_app
        );
        let summary = fixture
            .service
            .latest_summary(onboarding.installation_id(), &fixture.proposal_id)
            .unwrap()
            .unwrap();
        assert_eq!(summary.status, "invalidated");
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn restart_reconciles_ready_record_after_response_loss() {
        let fixture = fixture("restart-ready", false);
        let result = fixture
            .service
            .approve_and_apply(
                &fixture.profile_id,
                true,
                request(&fixture, "restart-ready"),
            )
            .unwrap();
        let installation = result.onboarding.installation_id().to_string();
        fixture
            .service
            .with_store_mut(&installation, |document| {
                let record = document.records.last_mut().unwrap();
                record.status = ApplyStatus::Verifying;
                record.verification_completed = false;
                record.completed_at = None;
                Ok(())
            })
            .unwrap();
        fixture.service.reconcile_startup().unwrap();
        assert_eq!(
            fixture
                .service
                .latest_summary(&installation, &fixture.proposal_id)
                .unwrap()
                .unwrap()
                .status,
            "succeeded"
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }

    #[test]
    fn restart_reconciles_verified_rollback_after_response_loss() {
        let fixture = fixture("restart-rollback", true);
        let result = fixture
            .service
            .approve_and_apply(
                &fixture.profile_id,
                true,
                request(&fixture, "restart-rollback"),
            )
            .unwrap();
        let installation = result.onboarding.installation_id().to_string();
        fixture
            .service
            .with_store_mut(&installation, |document| {
                let record = document.records.last_mut().unwrap();
                record.status = ApplyStatus::RollbackStarted;
                record.rollback_completed = false;
                record.completed_at = None;
                Ok(())
            })
            .unwrap();
        fixture.service.reconcile_startup().unwrap();
        assert_eq!(
            fixture
                .service
                .latest_summary(&installation, &fixture.proposal_id)
                .unwrap()
                .unwrap()
                .status,
            "rolled_back"
        );
        fs::remove_dir_all(fixture.root).unwrap();
    }
}
