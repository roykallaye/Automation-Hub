#[cfg(test)]
use crate::platform::{BuildInfo, InstallationPaths};
use crate::{
    config::{
        self, AutomationConfig, ClientConfig, FolderPaths, GmailConfig, HubConfig,
        InvoiceDeliveryMode, InvoiceFileSelectionMode, SafetyConfig,
    },
    preflight, recovery, runner_ledger,
};
use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

static SETUP_BACKUP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetupDraft {
    #[serde(default = "default_setup_mode")]
    setup_mode: SetupMode,
    hotel_display_name: String,
    email_signature_name: String,
    workspace_base: String,
    #[serde(default)]
    python_executable: String,
    #[serde(default = "default_invoice_delivery_mode")]
    invoice_delivery_mode: InvoiceDeliveryMode,
    #[serde(default = "default_invoice_file_selection_mode")]
    invoice_file_selection_mode: InvoiceFileSelectionMode,
    gmail_subject: String,
    cc_email: String,
    gmail_credentials_file: String,
    gmail_token_file: String,
    #[serde(default)]
    invoice_input_folder: String,
    #[serde(default)]
    invoice_output_folder: String,
    #[serde(default)]
    invoice_archive_folder: String,
    #[serde(default)]
    invoice_log_folder: String,
    #[serde(
        default,
        alias = "invoiceInputPattern",
        deserialize_with = "deserialize_string_list"
    )]
    invoice_input_patterns: Vec<String>,
    recipient_rules: Vec<RecipientRuleDraft>,
    contract_year: String,
    #[serde(
        default,
        alias = "scannerFilenamePrefix",
        deserialize_with = "deserialize_string_list"
    )]
    scanner_filename_prefixes: Vec<String>,
    #[serde(
        default,
        alias = "contractMarkerText",
        deserialize_with = "deserialize_string_list"
    )]
    contract_marker_texts: Vec<String>,
    shared_scan_folder: String,
    #[serde(default)]
    scans_local_cache_folder: String,
    ocr_text_output_folder: String,
    signed_contracts_output_folder: String,
    #[serde(default)]
    contract_log_folder: String,
    safe_mode: bool,
    archive_originals: bool,
    redact_logs: bool,
}

impl SetupDraft {
    pub(crate) fn workspace_base(&self) -> &str {
        &self.workspace_base
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SetupMode {
    NewWorkspace,
    ExistingFolders,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecipientRuleDraft {
    id: Option<String>,
    match_text: String,
    email: String,
}

/// Explicit setup changes. A missing field always means "preserve the current
/// installed value"; an empty value is still an intentional update.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetupPatch {
    setup_mode: Option<SetupMode>,
    hotel_display_name: Option<String>,
    email_signature_name: Option<String>,
    workspace_base: Option<String>,
    python_executable: Option<String>,
    invoice_delivery_mode: Option<InvoiceDeliveryMode>,
    invoice_file_selection_mode: Option<InvoiceFileSelectionMode>,
    gmail_subject: Option<String>,
    cc_email: Option<String>,
    gmail_credentials_file: Option<String>,
    gmail_token_file: Option<String>,
    invoice_input_folder: Option<String>,
    invoice_output_folder: Option<String>,
    invoice_archive_folder: Option<String>,
    invoice_log_folder: Option<String>,
    invoice_input_patterns: Option<Vec<String>>,
    recipient_rules: Option<Vec<RecipientRuleDraft>>,
    contract_year: Option<String>,
    scanner_filename_prefixes: Option<Vec<String>>,
    contract_marker_texts: Option<Vec<String>>,
    shared_scan_folder: Option<String>,
    scans_local_cache_folder: Option<String>,
    ocr_text_output_folder: Option<String>,
    signed_contracts_output_folder: Option<String>,
    contract_log_folder: Option<String>,
    safe_mode: Option<bool>,
    archive_originals: Option<bool>,
    redact_logs: Option<bool>,
}

impl SetupPatch {
    pub(crate) fn set_hotel_display_name(&mut self, value: String) {
        self.hotel_display_name = Some(value);
    }

    pub(crate) fn set_invoice_delivery_mode(&mut self, value: InvoiceDeliveryMode) {
        self.invoice_delivery_mode = Some(value);
    }

    pub(crate) fn set_invoice_file_selection_mode(&mut self, value: InvoiceFileSelectionMode) {
        self.invoice_file_selection_mode = Some(value);
    }

    pub(crate) fn set_safe_mode(&mut self, value: bool) {
        self.safe_mode = Some(value);
    }

    pub(crate) fn set_archive_originals(&mut self, value: bool) {
        self.archive_originals = Some(value);
    }

    pub(crate) fn set_redact_logs(&mut self, value: bool) {
        self.redact_logs = Some(value);
    }

    pub(crate) fn set_invoice_input_folder(&mut self, value: String) {
        self.invoice_input_folder = Some(value);
    }

    pub(crate) fn set_invoice_output_folder(&mut self, value: String) {
        self.invoice_output_folder = Some(value);
    }

    pub(crate) fn set_invoice_archive_folder(&mut self, value: String) {
        self.invoice_archive_folder = Some(value);
    }

    pub(crate) fn set_invoice_log_folder(&mut self, value: String) {
        self.invoice_log_folder = Some(value);
    }

    pub(crate) fn set_shared_scan_folder(&mut self, value: String) {
        self.shared_scan_folder = Some(value);
    }

    pub(crate) fn set_scans_local_cache_folder(&mut self, value: String) {
        self.scans_local_cache_folder = Some(value);
    }

    pub(crate) fn set_ocr_text_output_folder(&mut self, value: String) {
        self.ocr_text_output_folder = Some(value);
    }

    pub(crate) fn set_signed_contracts_output_folder(&mut self, value: String) {
        self.signed_contracts_output_folder = Some(value);
    }

    pub(crate) fn set_contract_log_folder(&mut self, value: String) {
        self.contract_log_folder = Some(value);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupSnapshot {
    draft: SetupDraft,
    revision: String,
}

impl SetupSnapshot {
    pub(crate) fn draft(&self) -> SetupDraft {
        self.draft.clone()
    }

    pub(crate) fn revision(&self) -> &str {
        &self.revision
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupPreview {
    target_revision: String,
    workspace_base: String,
    folder_plan: Vec<FolderPlanItem>,
    app_config_preview: HubConfig,
    automation_config_preview: serde_json::Value,
    warnings: Vec<String>,
}

impl SetupPreview {
    pub(crate) fn target_revision(&self) -> &str {
        &self.target_revision
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderPlanItem {
    label: String,
    path: String,
    status: FolderPlanStatus,
    message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FolderPlanStatus {
    WouldCreate,
    ExistsEmpty,
    ExistsWithFiles,
    MissingParent,
    Invalid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceInitResult {
    folders: Vec<FolderActionResult>,
    warnings: Vec<String>,
    #[serde(skip)]
    created_paths: Vec<String>,
}

impl WorkspaceInitResult {
    pub(crate) fn created_paths(&self) -> Vec<String> {
        self.created_paths.clone()
    }

    pub(crate) fn has_failures(&self) -> bool {
        self.folders
            .iter()
            .any(|folder| folder.action == FolderAction::Failed)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupCleanupResult {
    removed: Vec<String>,
    skipped: Vec<String>,
    failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderActionResult {
    label: String,
    path: String,
    action: FolderAction,
    message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FolderAction {
    Created,
    AlreadyExists,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveSetupResult {
    app_config_path: String,
    automation_config_path: String,
    backups: Vec<String>,
    validation: preflight::PreflightReport,
    revision: String,
}

impl SaveSetupResult {
    pub(crate) fn revision(&self) -> &str {
        &self.revision
    }
}

#[derive(Debug, Clone)]
struct ConfigurationPair {
    app_config_path: PathBuf,
    app_bytes: Vec<u8>,
    app_value: serde_json::Value,
    app_config: HubConfig,
    automation_config_path: PathBuf,
    automation_bytes: Option<Vec<u8>>,
    automation_value: Option<serde_json::Value>,
    revision: String,
}

/// Opaque preservation-aware candidate produced from one exact installed
/// configuration snapshot.  Adapters can inspect its typed preview/revisions,
/// but only the configuration service can commit its bytes.
#[derive(Debug)]
pub(crate) struct ValidatedSetupCandidate {
    pair: ConfigurationPair,
    effective_draft: SetupDraft,
    preview: SetupPreview,
    next_app_bytes: Vec<u8>,
    next_automation_bytes: Vec<u8>,
    next_app_config: HubConfig,
    automation_path: PathBuf,
    app_changed: bool,
    automation_changed: bool,
    target_revision: String,
}

impl ValidatedSetupCandidate {
    pub(crate) fn base_revision(&self) -> &str {
        &self.pair.revision
    }

    pub(crate) fn target_revision(&self) -> &str {
        &self.target_revision
    }

    pub(crate) fn preview(&self) -> SetupPreview {
        self.preview.clone()
    }

    pub(crate) fn effective_draft(&self) -> SetupDraft {
        self.effective_draft.clone()
    }

    pub(crate) fn requires_pair_recovery(&self) -> bool {
        self.app_changed && self.automation_changed
    }

    pub(crate) fn has_changes(&self) -> bool {
        self.app_changed || self.automation_changed
    }
}

const SETUP_TRANSACTION_SCHEMA: u32 = 1;
const SETUP_TRANSACTION_FILE: &str = ".innpilot-setup-transaction.json";
const MAX_SETUP_TRANSACTION_BYTES: u64 = 64 * 1024;

/// Shared configuration application service used by Tauri today and by
/// future local adapters. It is deliberately path/repository based and has no
/// dependency on `AppHandle`.
#[derive(Debug, Clone)]
pub(crate) struct ConfigurationService {
    repository: config::ConfigurationRepository,
}

#[derive(Debug, Clone)]
pub(crate) struct ApprovedProposalJournalContext {
    pub(crate) proposal_id: String,
    pub(crate) proposal_digest: String,
    pub(crate) approval_id: String,
    pub(crate) operation_id: String,
    pub(crate) workspace_prepared: bool,
}

#[derive(Debug)]
pub(crate) enum ConfigurationCandidateError {
    Stale { current_revision: String },
    Unavailable { diagnostic: String },
    Invalid { diagnostic: String },
}

impl ConfigurationService {
    pub(crate) fn new(repository: config::ConfigurationRepository) -> Self {
        Self { repository }
    }

    pub(crate) fn ensure(&self) -> Result<HubConfig, String> {
        self.repository.ensure()
    }

    /// Loads the already-installed configuration pair without bootstrapping,
    /// migrating, recovering, or rewriting either file. Read-only adapters use
    /// this boundary so an observation can never become a configuration write.
    pub(crate) fn read_existing(&self) -> Result<(HubConfig, String), String> {
        self.repository.with_lock(|config_path| {
            let pair = load_configuration_pair(config_path)?;
            Ok((pair.app_config, pair.revision))
        })
    }

    pub(crate) fn snapshot(&self) -> Result<SetupSnapshot, String> {
        self.repository.ensure()?;
        self.repository.with_lock(|config_path| {
            let pair = load_configuration_pair(config_path)?;
            Ok(SetupSnapshot {
                draft: draft_from_installed(&pair.app_config, pair.automation_value.as_ref()),
                revision: pair.revision,
            })
        })
    }

    pub(crate) fn prepare_candidate(
        &self,
        patch: &SetupPatch,
        expected_revision: &str,
    ) -> Result<ValidatedSetupCandidate, ConfigurationCandidateError> {
        self.repository
            .with_lock(|config_path| {
                let pair = load_configuration_pair(config_path)?;
                Ok(pair)
            })
            .map_err(|diagnostic| ConfigurationCandidateError::Unavailable { diagnostic })
            .and_then(|pair| {
                if pair.revision != expected_revision {
                    return Err(ConfigurationCandidateError::Stale {
                        current_revision: pair.revision,
                    });
                }
                build_validated_candidate(pair, patch, expected_revision)
                    .map_err(|diagnostic| ConfigurationCandidateError::Invalid { diagnostic })
            })
    }

    pub(crate) fn preview(
        &self,
        patch: &SetupPatch,
        expected_revision: &str,
    ) -> Result<SetupPreview, ConfigurationCandidateError> {
        self.prepare_candidate(patch, expected_revision)
            .map(|candidate| candidate.preview())
    }

    pub(crate) fn assert_revision(&self, expected_revision: &str) -> Result<(), String> {
        self.repository.with_lock(|config_path| {
            let pair = load_configuration_pair(config_path)?;
            if pair.revision != expected_revision {
                return Err(
                    "The setup changed after this screen was opened. Refresh before continuing."
                        .to_string(),
                );
            }
            Ok(())
        })
    }

    pub(crate) fn commit_candidate(
        &self,
        candidate: ValidatedSetupCandidate,
        recovery_service: &recovery::RecoveryService,
        runner_root: &Path,
    ) -> Result<SaveSetupResult, String> {
        let recovery_point_id = self.stage_recovery_point(&candidate, recovery_service)?;
        self.commit_candidate_with_recovery_point(candidate, recovery_point_id, runner_root)
    }

    /// Stages the exact predecessor bytes before onboarding records an apply
    /// intent. Orphaned points are harmless and subject to normal retention;
    /// installed configuration is still protected by the commit-time CAS.
    pub(crate) fn stage_recovery_point(
        &self,
        candidate: &ValidatedSetupCandidate,
        recovery_service: &recovery::RecoveryService,
    ) -> Result<Option<String>, String> {
        if !candidate.requires_pair_recovery() {
            return Ok(None);
        }
        recovery_service
            .create_configuration_point_from_bytes(
                &candidate.pair.app_bytes,
                candidate.pair.automation_bytes.as_deref(),
            )
            .map(|point| Some(point.id))
    }

    /// Phase F approval requires a readable, byte-exact predecessor point for
    /// every mutation, including a one-file candidate.  Creation alone is not
    /// sufficient: read the protected manifest back and compare the exact
    /// configuration pair before returning authority to commit.
    pub(crate) fn stage_verified_recovery_point(
        &self,
        candidate: &ValidatedSetupCandidate,
        recovery_service: &recovery::RecoveryService,
    ) -> Result<Option<String>, String> {
        if !candidate.has_changes() {
            return Ok(None);
        }
        let point = recovery_service.create_configuration_point_from_bytes(
            &candidate.pair.app_bytes,
            candidate.pair.automation_bytes.as_deref(),
        )?;
        let (app_bytes, automation_bytes) =
            recovery_service.read_configuration_point_bytes(&point.id)?;
        if app_bytes != candidate.pair.app_bytes
            || automation_bytes != candidate.pair.automation_bytes
        {
            return Err(
                "The configuration recovery point did not verify against the installed predecessor."
                    .to_string(),
            );
        }
        Ok(Some(point.id))
    }

    pub(crate) fn commit_candidate_with_recovery_point(
        &self,
        candidate: ValidatedSetupCandidate,
        recovery_point_id: Option<String>,
        runner_root: &Path,
    ) -> Result<SaveSetupResult, String> {
        self.commit_candidate_with_context(candidate, recovery_point_id, runner_root, None)
    }

    /// The existing Phase A pair journal remains the sole authority for an
    /// interrupted two-file configuration activation. Phase F adds only safe
    /// identity/digest context; verification and approval consumption remain
    /// in the separate protected lifecycle record.
    pub(crate) fn commit_approved_proposal_candidate(
        &self,
        candidate: ValidatedSetupCandidate,
        recovery_point_id: String,
        runner_root: &Path,
        approval: ApprovedProposalJournalContext,
    ) -> Result<SaveSetupResult, String> {
        self.commit_candidate_with_context(
            candidate,
            Some(recovery_point_id),
            runner_root,
            Some(approval),
        )
    }

    fn commit_candidate_with_context(
        &self,
        candidate: ValidatedSetupCandidate,
        recovery_point_id: Option<String>,
        runner_root: &Path,
        approval: Option<ApprovedProposalJournalContext>,
    ) -> Result<SaveSetupResult, String> {
        if candidate.requires_pair_recovery() && recovery_point_id.is_none() {
            return Err(
                "InnPilot could not establish the required configuration recovery point."
                    .to_string(),
            );
        }
        let _workflow_lock = runner_ledger::ProcessLock::try_acquire_at(
            runner_root,
            runner_ledger::ProcessLockKind::Workflow,
        )
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "Wait for the current automation to finish before saving setup.".to_string()
        })?;
        self.repository.with_lock(|_| {
            let recovery_point_id = recovery_point_id.clone();
            commit_validated_candidate(candidate, |pair, next_app_bytes, next_automation_bytes| {
                let point_id = recovery_point_id.ok_or_else(|| {
                    "InnPilot configuration recovery evidence is missing.".to_string()
                })?;
                let journal = SetupTransactionJournal {
                    schema_version: SETUP_TRANSACTION_SCHEMA,
                    recovery_point_id: point_id.clone(),
                    app_config_path: pair.app_config_path.to_string_lossy().to_string(),
                    old_app_sha256: sha256_bytes(&pair.app_bytes),
                    new_app_sha256: sha256_bytes(next_app_bytes),
                    old_automation_path: pair.automation_config_path.to_string_lossy().to_string(),
                    new_automation_path: String::new(),
                    old_automation_existed: pair.automation_bytes.is_some(),
                    old_automation_sha256: pair
                        .automation_bytes
                        .as_ref()
                        .map(|bytes| sha256_bytes(bytes)),
                    new_automation_sha256: sha256_bytes(next_automation_bytes),
                    approved_proposal: approval.clone().map(|context| {
                        SetupJournalApprovedProposal {
                            proposal_id: context.proposal_id,
                            proposal_digest: context.proposal_digest,
                            approval_id: context.approval_id,
                            operation_id: context.operation_id,
                            base_configuration_revision: pair.revision.clone(),
                            target_configuration_revision: configuration_revision(
                                next_app_bytes,
                                Some(next_automation_bytes),
                            ),
                            workspace_prepared: context.workspace_prepared,
                        }
                    }),
                };
                Ok(Some((journal, point_id)))
            })
        })
    }

    pub(crate) fn health(&self, full: bool) -> Result<preflight::AppConfigStatus, String> {
        let config = self.repository.ensure()?;
        let path = self.repository.config_path().to_string_lossy().to_string();
        Ok(if full {
            preflight::AppConfigStatus::new(path, config)
        } else {
            preflight::AppConfigStatus::new_fast(path, config)
        })
    }

    pub(crate) fn validate(&self) -> Result<preflight::PreflightReport, String> {
        self.repository
            .ensure()
            .map(|config| preflight::build_preflight_report(&config))
    }

    pub(crate) fn reconcile_incomplete_commit(
        &self,
        recovery_service: &recovery::RecoveryService,
        runner_root: &Path,
    ) -> Result<(), String> {
        reconcile_incomplete_setup_at(self.repository.config_path(), recovery_service, runner_root)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupTransactionJournal {
    schema_version: u32,
    recovery_point_id: String,
    app_config_path: String,
    old_app_sha256: String,
    new_app_sha256: String,
    old_automation_path: String,
    new_automation_path: String,
    old_automation_existed: bool,
    old_automation_sha256: Option<String>,
    new_automation_sha256: String,
    #[serde(default)]
    approved_proposal: Option<SetupJournalApprovedProposal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetupJournalApprovedProposal {
    proposal_id: String,
    proposal_digest: String,
    approval_id: String,
    operation_id: String,
    base_configuration_revision: String,
    target_configuration_revision: String,
    workspace_prepared: bool,
}

fn preview_setup_patch(
    pair: &ConfigurationPair,
    patch: &SetupPatch,
    expected_revision: &str,
) -> Result<SetupPreview, String> {
    build_validated_candidate(pair.clone(), patch, expected_revision)
        .map(|candidate| candidate.preview)
}

#[cfg(test)]
fn preview_setup_draft(draft: SetupDraft) -> Result<SetupPreview, String> {
    let generated = GeneratedSetup::from_draft(&draft)?;
    let app_bytes = serde_json::to_vec_pretty(&generated.app_config)
        .map_err(|error| format!("Could not prepare setup preview: {error}"))?;
    let automation_bytes = serde_json::to_vec_pretty(&generated.automation_config)
        .map_err(|error| format!("Could not prepare setup preview: {error}"))?;
    Ok(SetupPreview {
        target_revision: configuration_revision(&app_bytes, Some(&automation_bytes)),
        workspace_base: generated.workspace_base.to_string_lossy().to_string(),
        folder_plan: folder_plan(&generated.folder_specs),
        app_config_preview: generated.app_config,
        automation_config_preview: generated.automation_config,
        warnings: generated.warnings,
    })
}

pub(crate) fn initialize_workspace(
    draft: SetupDraft,
    confirmed: bool,
) -> Result<WorkspaceInitResult, String> {
    if !confirmed {
        return Err(
            "This setup action needs confirmation before InnPilot can create folders.".to_string(),
        );
    }

    let generated = GeneratedSetup::from_draft(&draft)?;
    let mut results = Vec::new();
    let mut created_paths = Vec::new();
    for spec in &generated.folder_specs {
        let path = &spec.path;
        if let Err(error) = reject_existing_reparse_components(path) {
            results.push(FolderActionResult {
                label: spec.label.to_string(),
                path: path.to_string_lossy().to_string(),
                action: FolderAction::Failed,
                message: error,
            });
            continue;
        }
        let mut created_for_spec = Vec::new();
        match create_directory_tree_exact(path, &mut created_for_spec) {
            Ok(final_created) => {
                if let Err(error) = reject_existing_reparse_components(path) {
                    for created in created_for_spec.iter().rev() {
                        let _ = fs::remove_dir(created);
                    }
                    results.push(FolderActionResult {
                        label: spec.label.to_string(),
                        path: path.to_string_lossy().to_string(),
                        action: FolderAction::Failed,
                        message: error,
                    });
                    continue;
                }
                for created in created_for_spec {
                    let created = created.to_string_lossy().to_string();
                    if !created_paths.contains(&created) {
                        created_paths.push(created);
                    }
                }
                results.push(FolderActionResult {
                    label: spec.label.to_string(),
                    path: path.to_string_lossy().to_string(),
                    action: if final_created {
                        FolderAction::Created
                    } else {
                        FolderAction::AlreadyExists
                    },
                    message: if final_created {
                        "Folder created.".to_string()
                    } else if folder_has_entries(path) {
                        "Folder already exists and was left unchanged.".to_string()
                    } else {
                        "Empty folder already exists.".to_string()
                    },
                })
            }
            Err(error) => results.push(FolderActionResult {
                label: spec.label.to_string(),
                path: path.to_string_lossy().to_string(),
                action: FolderAction::Failed,
                message: format!("Could not create folder: {error}"),
            }),
        }
    }

    Ok(WorkspaceInitResult {
        folders: results,
        warnings: generated.warnings,
        created_paths,
    })
}

/// Creates each missing component with `create_dir` and records only calls
/// that atomically succeeded in this process. `AlreadyExists` is never treated
/// as InnPilot provenance, closing the exists/create race used by cleanup.
fn create_directory_tree_exact(path: &Path, created: &mut Vec<PathBuf>) -> std::io::Result<bool> {
    match fs::create_dir(path) {
        Ok(()) => {
            created.push(path.to_path_buf());
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if path.is_dir() {
                Ok(false)
            } else {
                Err(error)
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let Some(parent) = path.parent() else {
                return Err(error);
            };
            if parent == path {
                return Err(error);
            }
            create_directory_tree_exact(parent, created)?;
            match fs::create_dir(path) {
                Ok(()) => {
                    created.push(path.to_path_buf());
                    Ok(true)
                }
                Err(race) if race.kind() == std::io::ErrorKind::AlreadyExists && path.is_dir() => {
                    Ok(false)
                }
                Err(race) => Err(race),
            }
        }
        Err(error) => Err(error),
    }
}

fn reject_existing_reparse_components(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        let metadata = match fs::symlink_metadata(ancestor) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "Could not verify the setup path before creating folders: {error}"
                ))
            }
        };
        #[cfg(windows)]
        let is_reparse = metadata.file_attributes() & 0x400 != 0;
        #[cfg(not(windows))]
        let is_reparse = metadata.file_type().is_symlink();
        if is_reparse {
            return Err(
                "Setup will not create folders through a link or Windows reparse point."
                    .to_string(),
            );
        }
    }
    Ok(())
}

pub(crate) fn remove_setup_created_empty_folders(
    workspace_base: String,
    paths: Vec<String>,
    confirmed: bool,
) -> Result<SetupCleanupResult, String> {
    if !confirmed {
        return Err(
            "This setup action needs confirmation before InnPilot can remove empty folders."
                .to_string(),
        );
    }

    let workspace = clean_path(&workspace_base)?;
    validate_workspace_base(&workspace)?;
    let canonical_workspace = fs::canonicalize(&workspace)
        .map_err(|error| format!("Could not verify the setup workspace before cleanup: {error}"))?;
    let mut skipped = Vec::new();
    let mut ordered_paths = Vec::new();
    for path in paths {
        match clean_path(&path) {
            Ok(path) if !path.as_os_str().is_empty() => ordered_paths.push(path),
            Ok(_) => {}
            Err(_) => skipped.push(format!("{} - invalid setup path", path.trim())),
        }
    }
    ordered_paths.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

    let mut removed = Vec::new();
    let mut failed = Vec::new();

    for path in ordered_paths {
        let path_text = path.to_string_lossy().to_string();
        if !path_starts_with(&path, &workspace) {
            skipped.push(format!("{path_text} - outside the selected workspace"));
            continue;
        }
        if !path.exists() {
            skipped.push(format!("{path_text} - already missing"));
            continue;
        }
        if !path.is_dir() {
            skipped.push(format!("{path_text} - not a folder"));
            continue;
        }
        let canonical_path = match fs::canonicalize(&path) {
            Ok(path) => path,
            Err(error) => {
                failed.push(format!("{path_text} - could not verify folder: {error}"));
                continue;
            }
        };
        if !path_starts_with(&canonical_path, &canonical_workspace) {
            skipped.push(format!(
                "{path_text} - resolves outside the selected workspace"
            ));
            continue;
        }
        if folder_has_entries(&path) {
            skipped.push(format!("{path_text} - contains files or folders"));
            continue;
        }
        match fs::remove_dir(&path) {
            Ok(()) => removed.push(path_text),
            Err(error) => failed.push(format!("{path_text} - {error}")),
        }
    }

    Ok(SetupCleanupResult {
        removed,
        skipped,
        failed,
    })
}

#[cfg(test)]
fn apply_setup_patch_locked(
    app_config_path: &Path,
    patch: SetupPatch,
    expected_revision: &str,
) -> Result<SaveSetupResult, String> {
    apply_setup_patch_core(app_config_path, patch, expected_revision, |_, _, _| {
        Ok(None)
    })
}

fn apply_setup_patch_core<F>(
    app_config_path: &Path,
    patch: SetupPatch,
    expected_revision: &str,
    create_transaction: F,
) -> Result<SaveSetupResult, String>
where
    F: FnOnce(
        &ConfigurationPair,
        &[u8],
        &[u8],
    ) -> Result<Option<(SetupTransactionJournal, String)>, String>,
{
    let pair = load_configuration_pair(app_config_path)?;
    let candidate = build_validated_candidate(pair, &patch, expected_revision)?;
    commit_validated_candidate(candidate, create_transaction)
}

fn build_validated_candidate(
    pair: ConfigurationPair,
    patch: &SetupPatch,
    expected_revision: &str,
) -> Result<ValidatedSetupCandidate, String> {
    if pair.revision != expected_revision {
        return Err(format!(
            "The setup changed after this screen was opened. Refresh before continuing. Expected revision {expected_revision}, current revision {}.",
            pair.revision
        ));
    }

    let prepared = prepare_setup_patch(&pair, patch)?;
    let PreparedSetupPatch {
        draft: effective_draft,
        generated,
        next_automation_value,
    } = prepared;
    let mut app_config_preview = pair.app_config.clone();
    apply_app_config_patch(&mut app_config_preview, patch, &generated.app_config);
    let automation_config_preview = if pair.automation_value.is_some() {
        next_automation_value.clone()
    } else {
        generated.automation_config.clone()
    };
    let workspace_base = generated.workspace_base.to_string_lossy().to_string();
    let planned_folders = folder_plan(&generated.folder_specs);
    let warnings = generated.warnings.clone();
    let legacy_app =
        pair.app_value.get("schemaVersion").is_none() && pair.app_value.get("paths").is_some();
    let mut next_app_value = if legacy_app {
        // Normalize known legacy fields into the current schema before applying
        // a patch. Retain the complete original document as extensions so no
        // hotel-specific legacy or unknown value disappears.
        merge_json_preserving_extensions(
            pair.app_value.clone(),
            serde_json::to_value(&pair.app_config)
                .map_err(|error| format!("Could not migrate InnPilot setup: {error}"))?,
        )
    } else {
        pair.app_value.clone()
    };
    apply_app_patch(&mut next_app_value, patch, &generated.app_config)?;

    let app_changed = patch_changes_app(patch) && next_app_value != pair.app_value;
    let automation_changed = pair.automation_value.as_ref() != Some(&next_automation_value);

    let next_app_bytes = if app_changed {
        serde_json::to_vec_pretty(&next_app_value)
            .map_err(|error| format!("Could not prepare InnPilot setup: {error}"))?
    } else {
        pair.app_bytes.clone()
    };
    let next_automation_bytes = if automation_changed {
        serde_json::to_vec_pretty(&next_automation_value)
            .map_err(|error| format!("Could not prepare automation setup: {error}"))?
    } else {
        pair.automation_bytes
            .clone()
            .ok_or_else(|| "The current automation setup is missing.".to_string())?
    };

    let next_app_text = std::str::from_utf8(&next_app_bytes)
        .map_err(|_| "Prepared InnPilot settings are not valid UTF-8.".to_string())?;
    let (next_app_config, _) =
        config::parse_config_with_migration_at_path(next_app_text, &pair.app_config_path)?;
    let automation_path = PathBuf::from(&next_app_config.automation.automation_config_path);
    let automation_parent = automation_path
        .parent()
        .ok_or_else(|| "Automation setup file path is missing a parent folder.".to_string())?;
    if automation_path != pair.automation_config_path && automation_path.exists() {
        return Err("The proposed automation setup path already contains another file. InnPilot left both files unchanged.".to_string());
    }

    if !automation_parent.is_dir()
        && !(pair.automation_bytes.is_none() && automation_path == pair.automation_config_path)
    {
        return Err(
            "Automation setup folder is missing. Create the workspace folders before saving setup."
                .to_string(),
        );
    }

    let target_revision = configuration_revision(&next_app_bytes, Some(&next_automation_bytes));
    let preview = SetupPreview {
        target_revision: target_revision.clone(),
        workspace_base,
        folder_plan: planned_folders,
        app_config_preview,
        automation_config_preview,
        warnings,
    };

    Ok(ValidatedSetupCandidate {
        pair,
        effective_draft,
        preview,
        next_app_bytes,
        next_automation_bytes,
        next_app_config,
        automation_path,
        app_changed,
        automation_changed,
        target_revision,
    })
}

fn commit_validated_candidate<F>(
    candidate: ValidatedSetupCandidate,
    create_transaction: F,
) -> Result<SaveSetupResult, String>
where
    F: FnOnce(
        &ConfigurationPair,
        &[u8],
        &[u8],
    ) -> Result<Option<(SetupTransactionJournal, String)>, String>,
{
    let ValidatedSetupCandidate {
        pair,
        next_app_bytes,
        next_automation_bytes,
        next_app_config,
        automation_path,
        app_changed,
        automation_changed,
        target_revision,
        ..
    } = candidate;

    let current = load_configuration_pair(&pair.app_config_path)?;
    if current.revision != pair.revision {
        return Err(format!(
            "The setup changed after the approved candidate was prepared. Refresh before saving. Expected revision {}, current revision {}.",
            pair.revision, current.revision
        ));
    }

    let automation_parent = automation_path
        .parent()
        .ok_or_else(|| "Automation setup file path is missing a parent folder.".to_string())?;
    if !automation_parent.is_dir() {
        if pair.automation_bytes.is_none() && automation_path == pair.automation_config_path {
            fs::create_dir_all(automation_parent).map_err(|error| {
                format!("Could not prepare the configured automation setup folder: {error}")
            })?;
        } else {
            return Err(
                "Automation setup folder is missing. Create the workspace folders before saving setup."
                    .to_string(),
            );
        }
    }

    let pair_change = app_changed && automation_changed;
    let transaction = if pair_change {
        create_transaction(&pair, &next_app_bytes, &next_automation_bytes)?
    } else {
        None
    };
    let mut backups = transaction
        .as_ref()
        .map(|(_, point_id)| vec![point_id.clone()])
        .unwrap_or_default();
    if let Some((journal, _)) = &transaction {
        let mut journal = journal.clone();
        journal.new_automation_path = automation_path.to_string_lossy().to_string();
        write_setup_transaction_journal(&pair.app_config_path, &journal)?;
    }
    if transaction.is_none() {
        if app_changed {
            let path = create_exact_backup(&pair.app_config_path, &pair.app_bytes)?;
            backups.push(path.to_string_lossy().to_string());
        }
        if automation_changed {
            if let Some(bytes) = &pair.automation_bytes {
                let path = create_exact_backup(&pair.automation_config_path, bytes)?;
                backups.push(path.to_string_lossy().to_string());
            }
        }
    }

    if automation_changed {
        if let Err(error) =
            config::atomic_replace_configuration_bytes(&automation_path, &next_automation_bytes)
        {
            return Err(error);
        }
    }
    if app_changed {
        if let Err(error) =
            config::atomic_replace_configuration_bytes(&pair.app_config_path, &next_app_bytes)
        {
            let rollback = match (
                &pair.automation_bytes,
                automation_changed,
                automation_path == pair.automation_config_path,
            ) {
                (_, false, _) => Ok(()),
                (Some(bytes), true, true) => {
                    config::atomic_replace_configuration_bytes(&automation_path, bytes)
                }
                _ => fs::remove_file(&automation_path)
                    .or_else(|remove_error| {
                        (remove_error.kind() == std::io::ErrorKind::NotFound)
                            .then_some(())
                            .ok_or(remove_error)
                    })
                    .map_err(|remove_error| remove_error.to_string()),
            };
            return Err(match rollback {
                Ok(()) => format!("Setup save was rolled back because InnPilot could not replace its main settings: {error}"),
                Err(rollback_error) => format!("Setup save failed and automatic rollback also failed: {error}; {rollback_error}"),
            });
        }
    }
    if transaction.is_some() {
        clear_setup_transaction_journal(&pair.app_config_path)?;
    }

    Ok(SaveSetupResult {
        app_config_path: pair.app_config_path.to_string_lossy().to_string(),
        automation_config_path: automation_path.to_string_lossy().to_string(),
        backups,
        validation: preflight::build_preflight_report(&next_app_config),
        revision: target_revision,
    })
}

#[derive(Debug)]
struct GeneratedSetup {
    workspace_base: PathBuf,
    folder_specs: Vec<FolderSpec>,
    app_config: HubConfig,
    automation_config: serde_json::Value,
    warnings: Vec<String>,
}

struct PreparedSetupPatch {
    draft: SetupDraft,
    generated: GeneratedSetup,
    next_automation_value: serde_json::Value,
}

#[derive(Debug)]
struct FolderSpec {
    label: &'static str,
    path: PathBuf,
}

impl GeneratedSetup {
    fn from_draft(draft: &SetupDraft) -> Result<Self, String> {
        Self::from_draft_with_current(draft, &config::default_config())
    }

    fn from_draft_with_current(draft: &SetupDraft, current: &HubConfig) -> Result<Self, String> {
        let workspace_base = clean_path(&draft.workspace_base)?;
        validate_workspace_base(&workspace_base)?;

        let year = if draft.contract_year.trim().is_empty() {
            Local::now().format("%Y").to_string()
        } else {
            draft.contract_year.trim().to_string()
        };

        let invoice_input_default = workspace_base.join("Invoices").join("Input");
        let invoice_output_default = workspace_base.join("Invoices").join("ReadyToSend");
        let invoice_archive_default = workspace_base.join("Invoices").join("Archive");
        let invoice_logs_default = workspace_base.join("Invoices").join("Logs");
        let gmail_token_folder = workspace_base.join("Gmail").join("Token");
        let gmail_credentials_folder = workspace_base.join("Gmail").join("Credentials");
        let scans_cache_default = workspace_base.join("Scans").join("IncomingCache");
        let default_scans_text = workspace_base.join("Scans").join("TextOutput");
        let contracts_output_default = workspace_base.join("Contracts").join(&year).join("Signed");
        let contracts_logs_default = workspace_base.join("Contracts").join("Logs");
        let support_diagnostics = workspace_base.join("Support").join("Diagnostics");

        let invoice_input = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.invoice_input_folder,
            invoice_input_default,
        )?;
        let invoice_output = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.invoice_output_folder,
            invoice_output_default,
        )?;
        let invoice_archive = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.invoice_archive_folder,
            invoice_archive_default,
        )?;
        let invoice_logs = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.invoice_log_folder,
            invoice_logs_default,
        )?;
        let scans_cache = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.scans_local_cache_folder,
            scans_cache_default.clone(),
        )?;

        let ocr_text_output = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.ocr_text_output_folder,
            default_scans_text.clone(),
        )?;
        let signed_contracts_output = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.signed_contracts_output_folder,
            contracts_output_default.clone(),
        )?;
        let contracts_logs = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.contract_log_folder,
            contracts_logs_default,
        )?;
        let shared_scan_folder = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.shared_scan_folder,
            scans_cache_default.clone(),
        )?;
        let gmail_token_file = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.gmail_token_file,
            gmail_token_folder.join("gmail_token.json"),
        )?;
        let gmail_credentials_file = setup_path_for_mode(
            &draft.setup_mode,
            &workspace_base,
            &draft.gmail_credentials_file,
            gmail_credentials_folder.join("gmail_credentials.json"),
        )?;

        let mut folder_specs = Vec::new();
        push_folder(&mut folder_specs, "Invoices/Input", &invoice_input);
        push_folder(&mut folder_specs, "Invoices/ReadyToSend", &invoice_output);
        push_folder(&mut folder_specs, "Invoices/Archive", &invoice_archive);
        push_folder(&mut folder_specs, "Invoices/Logs", &invoice_logs);
        push_folder(
            &mut folder_specs,
            "Gmail/Token",
            &file_parent(&gmail_token_file),
        );
        push_folder(
            &mut folder_specs,
            "Gmail/Credentials",
            &file_parent(&gmail_credentials_file),
        );
        push_folder(&mut folder_specs, "Scans/IncomingCache", &scans_cache);
        push_folder(&mut folder_specs, "Scans/TextOutput", &ocr_text_output);
        push_folder(
            &mut folder_specs,
            "Contracts/<year>/Signed",
            &signed_contracts_output,
        );
        push_folder(&mut folder_specs, "Contracts/Logs", &contracts_logs);
        folder_specs.push(FolderSpec {
            label: "Support/Diagnostics",
            path: support_diagnostics,
        });
        for spec in &folder_specs {
            validate_setup_folder_path(&workspace_base, &spec.path)?;
        }

        let python_executable = setup_python_executable(&draft.python_executable, current);

        let app_config = HubConfig {
            schema_version: current.schema_version,
            language: current.language.clone(),
            client: ClientConfig {
                display_name: non_empty_or(&draft.hotel_display_name, "Your Hotel"),
                branding: current.client.branding.clone(),
            },
            invoice_delivery_mode: draft.invoice_delivery_mode.clone(),
            invoice_file_selection_mode: draft.invoice_file_selection_mode.clone(),
            automation: AutomationConfig {
                // The workspace is a data location. Changing it must never
                // silently relocate the installed/custom automation runtime.
                automation_root_folder: current.automation.automation_root_folder.clone(),
                automation_config_path: current.automation.automation_config_path.clone(),
                python_executable,
            },
            scripts: current.scripts.clone(),
            folders: FolderPaths {
                invoice_input_folder: path_text(&invoice_input),
                invoice_output_folder: path_text(&invoice_output),
                invoice_archive_folder: path_text(&invoice_archive),
                invoice_log_folder: path_text(&invoice_logs),
                scansioni_network_share: path_text(&shared_scan_folder),
                scansioni_local_cache_folder: path_text(&scans_cache),
                ocr_text_output_folder: path_text(&ocr_text_output),
                contracts_output_folder: path_text(&signed_contracts_output),
                contract_log_folder: path_text(&contracts_logs),
            },
            gmail: GmailConfig {
                token_path: path_text(&gmail_token_file),
            },
            safety: SafetyConfig {
                dry_run_default: draft.safe_mode,
                require_confirmation_for_file_moves: true,
                redact_logs: draft.redact_logs,
            },
            templates: current.templates.clone(),
        };

        let recipient_rules = draft
            .recipient_rules
            .iter()
            .filter(|rule| !rule.match_text.trim().is_empty() || !rule.email.trim().is_empty())
            .map(|rule| {
                serde_json::json!({
                    "match": rule.match_text.trim(),
                    "email": rule.email.trim(),
                })
            })
            .collect::<Vec<_>>();

        let invoice_input_patterns =
            normalized_list_or_default(&draft.invoice_input_patterns, "*.pdf");
        let scanner_filename_prefixes =
            normalized_list_or_default(&draft.scanner_filename_prefixes, "Sharp MFP");
        let contract_marker_texts = normalized_list_or_default(
            &draft.contract_marker_texts,
            "Oggetto: Contratto di lavoro subordinato a tempo determinato",
        );
        let first_invoice_input_pattern = invoice_input_patterns
            .first()
            .cloned()
            .unwrap_or_else(|| "*.pdf".to_string());
        let first_scanner_filename_prefix = scanner_filename_prefixes
            .first()
            .cloned()
            .unwrap_or_else(|| "Sharp MFP".to_string());
        let first_contract_marker_text =
            contract_marker_texts.first().cloned().unwrap_or_else(|| {
                "Oggetto: Contratto di lavoro subordinato a tempo determinato".to_string()
            });

        let automation_config = serde_json::json!({
            "client": {
                "displayName": non_empty_or(&draft.hotel_display_name, "Your Hotel"),
                "emailSignatureName": non_empty_or(&draft.email_signature_name, "Your Hotel Team"),
            },
            "paths": {
                "invoiceInputDir": app_config.folders.invoice_input_folder,
                "invoiceOutputDir": app_config.folders.invoice_output_folder,
                "invoiceArchiveDir": app_config.folders.invoice_archive_folder,
                "invoiceLogDir": app_config.folders.invoice_log_folder,
                "gmailCredentialsFile": path_text(&gmail_credentials_file),
                "gmailTokenFile": app_config.gmail.token_path,
                "scanSourceDir": app_config.folders.scansioni_network_share,
                "scanCacheDir": app_config.folders.scansioni_local_cache_folder,
                "contractInputShortcut": "",
                "contractInputDir": app_config.folders.scansioni_local_cache_folder,
                "contractDestinationDir": app_config.folders.contracts_output_folder,
                "contractOcrTextDir": app_config.folders.ocr_text_output_folder,
                "contractLogDir": app_config.folders.contract_log_folder,
            },
            "ocr": {
                "languages": ["ita", "eng", "deu"],
                "tessdataDir": "ocr\\tessdata",
                "maxPages": 20,
                "dpi": 300,
                "minEmbeddedChars": 24,
                "maxFileMb": 50,
            },
            "gmail": {
                "subject": draft.gmail_subject.trim(),
                "ccEmail": draft.cc_email.trim(),
            },
            "invoice": {
                "deliveryMode": draft.invoice_delivery_mode,
                "fileSelectionMode": draft.invoice_file_selection_mode,
                "inputGlob": first_invoice_input_pattern,
                "inputGlobs": invoice_input_patterns,
                "recipientRules": recipient_rules,
            },
            "contracts": {
                "scannerFilePrefix": first_scanner_filename_prefix,
                "scannerFilePrefixes": scanner_filename_prefixes,
                "contractMarker": first_contract_marker_text,
                "contractMarkers": contract_marker_texts,
                "year": year,
            },
            "safety": {
                "dryRunDefault": draft.safe_mode,
                "archiveSuccessfulOriginals": draft.archive_originals,
                "redactLogs": draft.redact_logs,
            }
        });

        let mut warnings = Vec::new();
        if draft.shared_scan_folder.trim().is_empty() {
            warnings.push("Shared scan folder is not set yet.".to_string());
        }
        if recipient_rules.is_empty() {
            warnings.push("No invoice recipient rules are set yet.".to_string());
        }

        Ok(Self {
            workspace_base,
            folder_specs,
            app_config,
            automation_config,
            warnings,
        })
    }
}

impl SetupPatch {
    fn is_empty(&self) -> bool {
        self.setup_mode.is_none()
            && self.hotel_display_name.is_none()
            && self.email_signature_name.is_none()
            && self.workspace_base.is_none()
            && self.python_executable.is_none()
            && self.invoice_delivery_mode.is_none()
            && self.invoice_file_selection_mode.is_none()
            && self.gmail_subject.is_none()
            && self.cc_email.is_none()
            && self.gmail_credentials_file.is_none()
            && self.gmail_token_file.is_none()
            && self.invoice_input_folder.is_none()
            && self.invoice_output_folder.is_none()
            && self.invoice_archive_folder.is_none()
            && self.invoice_log_folder.is_none()
            && self.invoice_input_patterns.is_none()
            && self.recipient_rules.is_none()
            && self.contract_year.is_none()
            && self.scanner_filename_prefixes.is_none()
            && self.contract_marker_texts.is_none()
            && self.shared_scan_folder.is_none()
            && self.scans_local_cache_folder.is_none()
            && self.ocr_text_output_folder.is_none()
            && self.signed_contracts_output_folder.is_none()
            && self.contract_log_folder.is_none()
            && self.safe_mode.is_none()
            && self.archive_originals.is_none()
            && self.redact_logs.is_none()
    }

    fn apply_to(&self, mut draft: SetupDraft) -> SetupDraft {
        macro_rules! apply {
            ($($field:ident),+ $(,)?) => {$(
                if let Some(value) = &self.$field {
                    draft.$field = value.clone();
                }
            )+};
        }
        apply!(
            setup_mode,
            hotel_display_name,
            email_signature_name,
            workspace_base,
            python_executable,
            invoice_delivery_mode,
            invoice_file_selection_mode,
            gmail_subject,
            cc_email,
            gmail_credentials_file,
            gmail_token_file,
            invoice_input_folder,
            invoice_output_folder,
            invoice_archive_folder,
            invoice_log_folder,
            invoice_input_patterns,
            recipient_rules,
            contract_year,
            scanner_filename_prefixes,
            contract_marker_texts,
            shared_scan_folder,
            scans_local_cache_folder,
            ocr_text_output_folder,
            signed_contracts_output_folder,
            contract_log_folder,
            safe_mode,
            archive_originals,
            redact_logs,
        );
        draft
    }
}

fn load_configuration_pair(app_config_path: &Path) -> Result<ConfigurationPair, String> {
    let app_bytes = fs::read(app_config_path)
        .map_err(|error| format!("Could not read the current InnPilot settings: {error}"))?;
    let app_text = std::str::from_utf8(&app_bytes)
        .map_err(|_| "The current InnPilot settings are not valid UTF-8.".to_string())?;
    let app_value: serde_json::Value = serde_json::from_slice(&app_bytes)
        .map_err(|error| format!("The current InnPilot settings are invalid: {error}"))?;
    let schema_version = app_value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if schema_version > u64::from(config::CONFIG_VERSION) {
        return Err(format!(
            "InnPilot cannot edit configuration schema version {schema_version}; this app supports up to version {}.",
            config::CONFIG_VERSION
        ));
    }
    let (app_config, _) = config::parse_config_with_migration_at_path(app_text, app_config_path)?;
    let automation_config_path = PathBuf::from(&app_config.automation.automation_config_path);
    let (automation_bytes, automation_value) = if automation_config_path.exists() {
        let bytes = fs::read(&automation_config_path)
            .map_err(|error| format!("Could not read the current automation setup: {error}"))?;
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("The current automation setup is invalid: {error}"))?;
        if !value.is_object() {
            return Err("The current automation setup must be a JSON object.".to_string());
        }
        (Some(bytes), Some(value))
    } else {
        (None, None)
    };
    let revision = configuration_revision(&app_bytes, automation_bytes.as_deref());
    Ok(ConfigurationPair {
        app_config_path: app_config_path.to_path_buf(),
        app_bytes,
        app_value,
        app_config,
        automation_config_path,
        automation_bytes,
        automation_value,
        revision,
    })
}

/// Stable revision for the installed app/automation configuration pair.
///
/// Onboarding and future proposal services use the same digest as setup so a
/// proposal can never be applied to a different configuration snapshot.
pub(crate) fn configuration_revision(app_bytes: &[u8], automation_bytes: Option<&[u8]>) -> String {
    let mut digest = Sha256::new();
    digest.update(b"innpilot-configuration-pair-v1\0");
    digest.update((app_bytes.len() as u64).to_be_bytes());
    digest.update(app_bytes);
    match automation_bytes {
        Some(bytes) => {
            digest.update([1]);
            digest.update((bytes.len() as u64).to_be_bytes());
            digest.update(bytes);
        }
        None => digest.update([0]),
    }
    format!("sha256:{:x}", digest.finalize())
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn setup_transaction_path(app_config_path: &Path) -> Result<PathBuf, String> {
    app_config_path
        .parent()
        .map(|parent| parent.join(SETUP_TRANSACTION_FILE))
        .ok_or_else(|| "The InnPilot settings path has no parent folder.".to_string())
}

fn read_setup_transaction_journal(
    app_config_path: &Path,
) -> Result<Option<SetupTransactionJournal>, String> {
    let path = setup_transaction_path(app_config_path)?;
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not inspect the setup transaction journal: {error}"
            ));
        }
    };
    if metadata.len() > MAX_SETUP_TRANSACTION_BYTES {
        return Err(
            "The setup transaction journal is too large and cannot be trusted.".to_string(),
        );
    }
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not read the setup transaction journal: {error}"
            ));
        }
    };
    let journal: SetupTransactionJournal = serde_json::from_slice(&bytes)
        .map_err(|_| "The setup transaction journal is damaged.".to_string())?;
    if journal.schema_version != SETUP_TRANSACTION_SCHEMA
        || PathBuf::from(&journal.app_config_path) != app_config_path
    {
        return Err(
            "The setup transaction journal is not valid for this InnPilot installation."
                .to_string(),
        );
    }
    Ok(Some(journal))
}

fn write_setup_transaction_journal(
    app_config_path: &Path,
    journal: &SetupTransactionJournal,
) -> Result<(), String> {
    let path = setup_transaction_path(app_config_path)?;
    let bytes = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("Could not prepare the setup transaction journal: {error}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| "The setup transaction journal has no parent folder.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare the setup transaction folder: {error}"))?;
    let temp = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        SETUP_TRANSACTION_FILE,
        std::process::id(),
        SETUP_BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|error| format!("Could not create the setup transaction journal: {error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("Could not write the setup transaction journal: {error}"))?;
        file.sync_all().map_err(|error| {
            format!("Could not safely flush the setup transaction journal: {error}")
        })?;
        drop(file);
        config::atomic_replace_configuration_bytes(&path, &bytes)
    })();
    let _ = fs::remove_file(&temp);
    result
}

fn clear_setup_transaction_journal(app_config_path: &Path) -> Result<(), String> {
    let path = setup_transaction_path(app_config_path)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not clear the completed setup transaction: {error}"
        )),
    }
}

fn read_optional_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Could not inspect setup transaction state: {error}"
        )),
    }
}

fn restore_recovery_bytes(
    bytes: &[u8],
    target: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    if sha256_bytes(&bytes) != expected_sha256 {
        return Err("The setup recovery point failed its integrity check.".to_string());
    }
    config::atomic_replace_configuration_bytes(target, bytes)
}

fn classify_setup_transaction_state(
    app_config_path: &Path,
    journal: &SetupTransactionJournal,
) -> Result<SetupTransactionState, String> {
    let old_automation_path = PathBuf::from(&journal.old_automation_path);
    let new_automation_path = PathBuf::from(&journal.new_automation_path);
    let app_state = read_optional_file(app_config_path)?
        .map(|bytes| sha256_bytes(&bytes))
        .ok_or_else(|| "InnPilot settings are missing during setup recovery.".to_string())?;
    let new_automation_state =
        read_optional_file(&new_automation_path)?.map(|bytes| sha256_bytes(&bytes));
    if app_state == journal.new_app_sha256
        && new_automation_state.as_deref() == Some(&journal.new_automation_sha256)
    {
        return Ok(SetupTransactionState::Committed);
    }
    let app_is_old = app_state == journal.old_app_sha256;
    let automation_is_old = if old_automation_path == new_automation_path {
        new_automation_state.as_deref() == journal.old_automation_sha256.as_deref()
    } else {
        let old_state = read_optional_file(&old_automation_path)?.map(|bytes| sha256_bytes(&bytes));
        old_state.as_deref() == journal.old_automation_sha256.as_deref()
            && new_automation_state.is_none()
    };
    if app_is_old && automation_is_old {
        Ok(SetupTransactionState::Unchanged)
    } else {
        Ok(SetupTransactionState::NeedsRollback)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SetupTransactionState {
    Committed,
    Unchanged,
    NeedsRollback,
}

fn reconcile_incomplete_setup_at(
    app_config_path: &Path,
    recovery_service: &recovery::RecoveryService,
    runner_root: &Path,
) -> Result<(), String> {
    let journal_path = setup_transaction_path(&app_config_path)?;
    if !journal_path.exists() {
        return Ok(());
    }
    let _workflow_lock = runner_ledger::ProcessLock::try_acquire_at(
        runner_root,
        runner_ledger::ProcessLockKind::Workflow,
    )
    .map_err(|error| error.to_string())?
    .ok_or_else(|| {
        "InnPilot cannot recover an incomplete setup while an automation is running.".to_string()
    })?;
    config::with_configuration_lock(&app_config_path, || {
        let journal = read_setup_transaction_journal(&app_config_path)?.ok_or_else(|| {
            "The setup transaction journal disappeared during recovery.".to_string()
        })?;

        let old_automation_path = PathBuf::from(&journal.old_automation_path);
        let new_automation_path = PathBuf::from(&journal.new_automation_path);
        let (recovery_app, recovery_automation) =
            recovery_service.read_configuration_point_bytes(&journal.recovery_point_id)?;
        let recovery_app_text = std::str::from_utf8(&recovery_app)
            .map_err(|_| "The setup recovery settings are not valid UTF-8.".to_string())?;
        let (recovery_config, _) =
            config::parse_config_with_migration_at_path(recovery_app_text, &app_config_path)?;
        let expected_automation_path =
            PathBuf::from(recovery_config.automation.automation_config_path);
        if old_automation_path != expected_automation_path
            || journal.old_automation_existed != recovery_automation.is_some()
        {
            return Err(
                "The setup transaction journal does not match its verified recovery point."
                    .to_string(),
            );
        }
        match classify_setup_transaction_state(&app_config_path, &journal)? {
            SetupTransactionState::Committed | SetupTransactionState::Unchanged => {
                return clear_setup_transaction_journal(&app_config_path);
            }
            SetupTransactionState::NeedsRollback => {}
        }

        restore_recovery_bytes(&recovery_app, &app_config_path, &journal.old_app_sha256)?;
        if journal.old_automation_existed {
            let expected = journal.old_automation_sha256.as_deref().ok_or_else(|| {
                "The setup transaction is missing its automation recovery digest.".to_string()
            })?;
            let recovery_automation = recovery_automation.as_deref().ok_or_else(|| {
                "The setup recovery point does not contain automation settings.".to_string()
            })?;
            restore_recovery_bytes(recovery_automation, &old_automation_path, expected)?;
        }
        if new_automation_path != old_automation_path {
            // The recovery point proves the predecessor path and bytes, but it
            // intentionally does not authorize deletion at a different path.
            // Leave a harmless orphan rather than trusting a journal path as
            // deletion authority after an interrupted path-changing commit.
        } else if !journal.old_automation_existed {
            let _ = fs::remove_file(&new_automation_path);
        }
        clear_setup_transaction_journal(&app_config_path)
    })
}

fn draft_from_installed(app: &HubConfig, automation: Option<&serde_json::Value>) -> SetupDraft {
    let get_string = |pointer: &str| {
        automation
            .and_then(|value| value.pointer(pointer))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let get_string_list = |plural: &str, singular: &str, fallback: &str| {
        let values = automation
            .and_then(|value| value.pointer(plural))
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .filter(|values| !values.is_empty());
        values.unwrap_or_else(|| {
            let singular = get_string(singular);
            vec![if singular.is_empty() {
                fallback.to_string()
            } else {
                singular
            }]
        })
    };
    let recipient_rules = automation
        .and_then(|value| value.pointer("/invoice/recipientRules"))
        .and_then(serde_json::Value::as_array)
        .map(|rules| {
            rules
                .iter()
                .enumerate()
                .filter_map(|(index, rule)| {
                    let object = rule.as_object()?;
                    Some(RecipientRuleDraft {
                        id: Some(format!("installed-rule-{index}")),
                        match_text: object
                            .get("match")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        email: object
                            .get("email")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .filter(|rules| !rules.is_empty())
        .unwrap_or_else(|| {
            vec![RecipientRuleDraft {
                id: Some("installed-rule-0".to_string()),
                match_text: String::new(),
                email: String::new(),
            }]
        });
    let bool_at = |pointer: &str, fallback: bool| {
        automation
            .and_then(|value| value.pointer(pointer))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(fallback)
    };
    let workspace_base = workspace_base_from_config(app)
        .to_string_lossy()
        .to_string();
    SetupDraft {
        setup_mode: if automation.is_some() {
            SetupMode::ExistingFolders
        } else {
            SetupMode::NewWorkspace
        },
        hotel_display_name: app.client.display_name.clone(),
        email_signature_name: get_string("/client/emailSignatureName"),
        workspace_base,
        python_executable: app.automation.python_executable.clone(),
        invoice_delivery_mode: app.invoice_delivery_mode.clone(),
        invoice_file_selection_mode: app.invoice_file_selection_mode.clone(),
        gmail_subject: get_string("/gmail/subject"),
        cc_email: get_string("/gmail/ccEmail"),
        gmail_credentials_file: get_string("/paths/gmailCredentialsFile"),
        gmail_token_file: app.gmail.token_path.clone(),
        invoice_input_folder: app.folders.invoice_input_folder.clone(),
        invoice_output_folder: app.folders.invoice_output_folder.clone(),
        invoice_archive_folder: app.folders.invoice_archive_folder.clone(),
        invoice_log_folder: app.folders.invoice_log_folder.clone(),
        invoice_input_patterns: get_string_list(
            "/invoice/inputGlobs",
            "/invoice/inputGlob",
            "*.pdf",
        ),
        recipient_rules,
        contract_year: get_string("/contracts/year"),
        scanner_filename_prefixes: get_string_list(
            "/contracts/scannerFilePrefixes",
            "/contracts/scannerFilePrefix",
            "Sharp MFP",
        ),
        contract_marker_texts: get_string_list(
            "/contracts/contractMarkers",
            "/contracts/contractMarker",
            "Oggetto: Contratto di lavoro subordinato a tempo determinato",
        ),
        shared_scan_folder: app.folders.scansioni_network_share.clone(),
        scans_local_cache_folder: app.folders.scansioni_local_cache_folder.clone(),
        ocr_text_output_folder: app.folders.ocr_text_output_folder.clone(),
        signed_contracts_output_folder: app.folders.contracts_output_folder.clone(),
        contract_log_folder: app.folders.contract_log_folder.clone(),
        safe_mode: app.safety.dry_run_default,
        archive_originals: bool_at("/safety/archiveSuccessfulOriginals", true),
        redact_logs: app.safety.redact_logs,
    }
}

fn workspace_base_from_config(config: &HubConfig) -> PathBuf {
    let invoice_input = PathBuf::from(&config.folders.invoice_input_folder);
    invoice_input
        .ancestors()
        .nth(2)
        .map(Path::to_path_buf)
        .or_else(|| {
            let config_path = PathBuf::from(&config.automation.automation_config_path);
            config_path
                .parent()
                .and_then(Path::parent)
                .map(Path::to_path_buf)
        })
        .unwrap_or_else(|| PathBuf::from(r"C:\InnPilot\workspace"))
}

fn apply_app_patch(
    target: &mut serde_json::Value,
    patch: &SetupPatch,
    generated: &HubConfig,
) -> Result<(), String> {
    let generated = serde_json::to_value(generated)
        .map_err(|error| format!("Could not prepare InnPilot setup: {error}"))?;
    let mut pointers = Vec::new();
    macro_rules! map_if {
        ($field:ident, $($pointer:literal),+ $(,)?) => {
            if patch.$field.is_some() { $(pointers.push($pointer);)+ }
        };
    }
    map_if!(hotel_display_name, "/client/displayName");
    map_if!(python_executable, "/automation/pythonExecutable");
    map_if!(invoice_delivery_mode, "/invoiceDeliveryMode");
    map_if!(invoice_file_selection_mode, "/invoiceFileSelectionMode");
    map_if!(gmail_token_file, "/gmail/tokenPath");
    map_if!(invoice_input_folder, "/folders/invoiceInputFolder");
    map_if!(invoice_output_folder, "/folders/invoiceOutputFolder");
    map_if!(invoice_archive_folder, "/folders/invoiceArchiveFolder");
    map_if!(invoice_log_folder, "/folders/invoiceLogFolder");
    map_if!(shared_scan_folder, "/folders/scansioniNetworkShare");
    map_if!(
        scans_local_cache_folder,
        "/folders/scansioniLocalCacheFolder"
    );
    map_if!(ocr_text_output_folder, "/folders/ocrTextOutputFolder");
    map_if!(
        signed_contracts_output_folder,
        "/folders/contractsOutputFolder"
    );
    map_if!(contract_log_folder, "/folders/contractLogFolder");
    map_if!(safe_mode, "/safety/dryRunDefault");
    map_if!(redact_logs, "/safety/redactLogs");
    for pointer in pointers {
        let value = generated
            .pointer(pointer)
            .cloned()
            .ok_or_else(|| format!("Generated setup is missing {pointer}."))?;
        set_json_pointer(target, pointer, value)?;
    }
    Ok(())
}

fn patch_changes_app(patch: &SetupPatch) -> bool {
    patch.hotel_display_name.is_some()
        || patch.python_executable.is_some()
        || patch.invoice_delivery_mode.is_some()
        || patch.invoice_file_selection_mode.is_some()
        || patch.gmail_token_file.is_some()
        || patch.invoice_input_folder.is_some()
        || patch.invoice_output_folder.is_some()
        || patch.invoice_archive_folder.is_some()
        || patch.invoice_log_folder.is_some()
        || patch.shared_scan_folder.is_some()
        || patch.scans_local_cache_folder.is_some()
        || patch.ocr_text_output_folder.is_some()
        || patch.signed_contracts_output_folder.is_some()
        || patch.contract_log_folder.is_some()
        || patch.safe_mode.is_some()
        || patch.redact_logs.is_some()
}

fn merge_json_preserving_extensions(
    installed: serde_json::Value,
    known: serde_json::Value,
) -> serde_json::Value {
    match (installed, known) {
        (serde_json::Value::Object(mut installed), serde_json::Value::Object(known)) => {
            for (key, known_value) in known {
                let value = installed
                    .remove(&key)
                    .map(|installed_value| {
                        merge_json_preserving_extensions(installed_value, known_value.clone())
                    })
                    .unwrap_or(known_value);
                installed.insert(key, value);
            }
            serde_json::Value::Object(installed)
        }
        (_, known) => known,
    }
}

fn apply_app_config_patch(target: &mut HubConfig, patch: &SetupPatch, generated: &HubConfig) {
    macro_rules! apply_if {
        ($patch_field:ident, $($target:ident).+ $(,)?) => {
            if patch.$patch_field.is_some() {
                target.$($target).+ = generated.$($target).+.clone();
            }
        };
    }
    apply_if!(hotel_display_name, client.display_name);
    apply_if!(python_executable, automation.python_executable);
    apply_if!(invoice_delivery_mode, invoice_delivery_mode);
    apply_if!(invoice_file_selection_mode, invoice_file_selection_mode);
    apply_if!(gmail_token_file, gmail.token_path);
    apply_if!(invoice_input_folder, folders.invoice_input_folder);
    apply_if!(invoice_output_folder, folders.invoice_output_folder);
    apply_if!(invoice_archive_folder, folders.invoice_archive_folder);
    apply_if!(invoice_log_folder, folders.invoice_log_folder);
    apply_if!(shared_scan_folder, folders.scansioni_network_share);
    apply_if!(
        scans_local_cache_folder,
        folders.scansioni_local_cache_folder
    );
    apply_if!(ocr_text_output_folder, folders.ocr_text_output_folder);
    apply_if!(
        signed_contracts_output_folder,
        folders.contracts_output_folder
    );
    apply_if!(contract_log_folder, folders.contract_log_folder);
    apply_if!(safe_mode, safety.dry_run_default);
    apply_if!(redact_logs, safety.redact_logs);
}

fn prepare_setup_patch(
    pair: &ConfigurationPair,
    patch: &SetupPatch,
) -> Result<PreparedSetupPatch, String> {
    let draft = patch.apply_to(draft_from_installed(
        &pair.app_config,
        pair.automation_value.as_ref(),
    ));
    let generated = GeneratedSetup::from_draft_with_current(&draft, &pair.app_config)?;
    let mut next_automation_value = pair
        .automation_value
        .clone()
        .unwrap_or_else(|| generated.automation_config.clone());
    if pair.automation_value.is_some() {
        apply_automation_patch(&mut next_automation_value, patch, &generated)?;
    }
    Ok(PreparedSetupPatch {
        draft,
        generated,
        next_automation_value,
    })
}

fn apply_automation_patch(
    target: &mut serde_json::Value,
    patch: &SetupPatch,
    generated: &GeneratedSetup,
) -> Result<(), String> {
    if !target.is_object() {
        return Err("The current automation setup must be a JSON object.".to_string());
    }
    let generated_value = &generated.automation_config;
    let mut mappings: Vec<(&str, &str)> = Vec::new();
    macro_rules! map_if {
        ($field:ident, $($pointer:literal),+ $(,)?) => {
            if patch.$field.is_some() { $(mappings.push(($pointer, $pointer));)+ }
        };
    }
    map_if!(hotel_display_name, "/client/displayName");
    map_if!(email_signature_name, "/client/emailSignatureName");
    map_if!(gmail_subject, "/gmail/subject");
    map_if!(cc_email, "/gmail/ccEmail");
    map_if!(gmail_credentials_file, "/paths/gmailCredentialsFile");
    map_if!(gmail_token_file, "/paths/gmailTokenFile");
    map_if!(invoice_input_folder, "/paths/invoiceInputDir");
    map_if!(invoice_output_folder, "/paths/invoiceOutputDir");
    map_if!(invoice_archive_folder, "/paths/invoiceArchiveDir");
    map_if!(invoice_log_folder, "/paths/invoiceLogDir");
    map_if!(shared_scan_folder, "/paths/scanSourceDir");
    map_if!(scans_local_cache_folder, "/paths/scanCacheDir");
    map_if!(ocr_text_output_folder, "/paths/contractOcrTextDir");
    map_if!(
        signed_contracts_output_folder,
        "/paths/contractDestinationDir"
    );
    map_if!(contract_log_folder, "/paths/contractLogDir");
    map_if!(invoice_delivery_mode, "/invoice/deliveryMode");
    map_if!(invoice_file_selection_mode, "/invoice/fileSelectionMode");
    map_if!(
        invoice_input_patterns,
        "/invoice/inputGlob",
        "/invoice/inputGlobs"
    );
    map_if!(
        scanner_filename_prefixes,
        "/contracts/scannerFilePrefix",
        "/contracts/scannerFilePrefixes"
    );
    map_if!(
        contract_marker_texts,
        "/contracts/contractMarker",
        "/contracts/contractMarkers"
    );
    map_if!(contract_year, "/contracts/year");
    map_if!(safe_mode, "/safety/dryRunDefault");
    map_if!(archive_originals, "/safety/archiveSuccessfulOriginals");
    map_if!(redact_logs, "/safety/redactLogs");
    if let Some(rules) = &patch.recipient_rules {
        let merged = merge_recipient_rules(target, rules);
        set_json_pointer(target, "/invoice/recipientRules", merged)?;
    }
    if patch.workspace_base.is_some() {
        mappings.extend([
            ("/paths/invoiceInputDir", "/paths/invoiceInputDir"),
            ("/paths/invoiceOutputDir", "/paths/invoiceOutputDir"),
            ("/paths/invoiceArchiveDir", "/paths/invoiceArchiveDir"),
            ("/paths/invoiceLogDir", "/paths/invoiceLogDir"),
        ]);
    }
    for (target_pointer, source_pointer) in mappings {
        let value = generated_value
            .pointer(source_pointer)
            .cloned()
            .ok_or_else(|| format!("Generated setup is missing {source_pointer}."))?;
        set_json_pointer(target, target_pointer, value)?;
    }
    Ok(())
}

fn merge_recipient_rules(
    target: &serde_json::Value,
    requested: &[RecipientRuleDraft],
) -> serde_json::Value {
    let existing = target
        .pointer("/invoice/recipientRules")
        .and_then(serde_json::Value::as_array);
    let mut merged = Vec::new();

    for rule in requested {
        let installed_index = rule
            .id
            .as_deref()
            .and_then(|id| id.strip_prefix("installed-rule-"))
            .and_then(|index| index.parse::<usize>().ok());
        let existing_object = installed_index
            .and_then(|index| existing.and_then(|rules| rules.get(index)))
            .and_then(serde_json::Value::as_object);

        // Empty newly-added rows are UI placeholders. An installed row is
        // retained even when its editable values are empty so its custom
        // metadata is not silently discarded; explicit removal omits its id.
        if existing_object.is_none()
            && rule.match_text.trim().is_empty()
            && rule.email.trim().is_empty()
        {
            continue;
        }

        let mut object = existing_object.cloned().unwrap_or_default();
        object.insert(
            "match".to_string(),
            serde_json::Value::String(rule.match_text.trim().to_string()),
        );
        object.insert(
            "email".to_string(),
            serde_json::Value::String(rule.email.trim().to_string()),
        );
        merged.push(serde_json::Value::Object(object));
    }

    serde_json::Value::Array(merged)
}

fn set_json_pointer(
    root: &mut serde_json::Value,
    pointer: &str,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut segments = pointer.trim_start_matches('/').split('/').peekable();
    let mut current = root;
    while let Some(segment) = segments.next() {
        let object = current
            .as_object_mut()
            .ok_or_else(|| format!("Cannot update non-object configuration path {pointer}."))?;
        if segments.peek().is_none() {
            object.insert(segment.to_string(), value);
            return Ok(());
        }
        current = object
            .entry(segment)
            .or_insert_with(|| serde_json::json!({}));
    }
    Err("Configuration pointer cannot be empty.".to_string())
}

fn create_exact_backup(path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = SETUP_BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    let backup = path.with_file_name(format!(
        "{name}.{stamp}.{}.{}.bak",
        std::process::id(),
        sequence
    ));
    fs::write(&backup, bytes).map_err(|error| format!("Could not create setup backup: {error}"))?;
    Ok(backup)
}

fn folder_plan(specs: &[FolderSpec]) -> Vec<FolderPlanItem> {
    specs
        .iter()
        .map(|spec| {
            let (status, message) = if spec.path.exists() {
                if spec.path.is_dir() {
                    if folder_has_entries(&spec.path) {
                        (
                            FolderPlanStatus::ExistsWithFiles,
                            "Folder already exists and will be left unchanged.".to_string(),
                        )
                    } else {
                        (
                            FolderPlanStatus::ExistsEmpty,
                            "Folder already exists and is empty.".to_string(),
                        )
                    }
                } else {
                    (
                        FolderPlanStatus::Invalid,
                        "A file already exists at this location.".to_string(),
                    )
                }
            } else if spec.path.parent().is_some_and(Path::exists) {
                (
                    FolderPlanStatus::WouldCreate,
                    "Folder would be created.".to_string(),
                )
            } else {
                (
                    FolderPlanStatus::MissingParent,
                    "Folder and missing parent folders would be created.".to_string(),
                )
            };

            FolderPlanItem {
                label: spec.label.to_string(),
                path: spec.path.to_string_lossy().to_string(),
                status,
                message,
            }
        })
        .collect()
}

#[cfg(test)]
fn atomic_write_json_with_backup<T: Serialize>(
    path: &Path,
    value: &T,
    backups: &mut Vec<String>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not prepare setup folder: {error}"))?;
    }

    if path.exists() {
        let backup = backup_path(path);
        fs::copy(path, &backup).map_err(|error| {
            format!(
                "Could not create backup for {}: {error}",
                path.to_string_lossy()
            )
        })?;
        backups.push(backup.to_string_lossy().to_string());
    }

    let temp_path = path.with_extension(format!(
        "{}tmp",
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| format!("{extension}."))
            .unwrap_or_default()
    ));
    let contents = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Could not prepare setup file: {error}"))?;
    fs::write(&temp_path, contents)
        .map_err(|error| format!("Could not write temporary setup file: {error}"))?;

    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            format!(
                "Could not replace existing setup file {}: {error}",
                path.to_string_lossy()
            )
        })?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "Could not save setup file {}: {error}",
            path.to_string_lossy()
        )
    })
}

#[cfg(test)]
fn backup_path(path: &Path) -> PathBuf {
    let stamp = Local::now().format("%Y%m%d%H%M%S");
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    path.with_file_name(format!("{file_name}.{stamp}.bak"))
}

fn clean_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Choose a workspace folder before continuing.".to_string());
    }
    let path = PathBuf::from(repair_concatenated_absolute_path(trimmed));
    reject_parent_traversal(&path)?;
    Ok(path)
}

fn setup_path_or_default(
    workspace_base: &Path,
    value: &str,
    default: PathBuf,
) -> Result<PathBuf, String> {
    let repaired = repair_concatenated_absolute_path(value.trim());
    let trimmed = repaired.as_str();
    if trimmed.is_empty() {
        return Ok(default);
    }

    let path = PathBuf::from(trimmed);
    let path = if path.is_absolute() || looks_like_windows_absolute(trimmed) {
        path
    } else {
        workspace_base.join(path)
    };
    reject_parent_traversal(&path)?;
    Ok(path)
}

fn reject_parent_traversal(path: &Path) -> Result<(), String> {
    if path
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err("Setup folders cannot contain parent-directory traversal (`..`).".to_string());
    }
    Ok(())
}

fn setup_path_for_mode(
    mode: &SetupMode,
    workspace_base: &Path,
    value: &str,
    default: PathBuf,
) -> Result<Option<PathBuf>, String> {
    if value.trim().is_empty() && *mode == SetupMode::ExistingFolders {
        return Ok(None);
    }
    setup_path_or_default(workspace_base, value, default).map(Some)
}

fn path_text(path: &Option<PathBuf>) -> String {
    path.as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn file_parent(path: &Option<PathBuf>) -> Option<PathBuf> {
    path.as_ref()
        .and_then(|path| path.parent())
        .map(Path::to_path_buf)
}

fn repair_concatenated_absolute_path(value: &str) -> String {
    let bytes = value.as_bytes();
    for index in 1..bytes.len().saturating_sub(2) {
        if bytes[index].is_ascii_alphabetic()
            && bytes[index + 1] == b':'
            && (bytes[index + 2] == b'\\' || bytes[index + 2] == b'/')
        {
            return value[index..].to_string();
        }
    }
    value.to_string()
}

fn looks_like_windows_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    (bytes.len() >= 3
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
        && bytes[0].is_ascii_alphabetic())
        || value.starts_with(r"\\")
}

fn validate_workspace_base(path: &Path) -> Result<(), String> {
    if !path
        .components()
        .any(|component| matches!(component, Component::Normal(_)))
    {
        return Err("Choose a workspace folder, not a drive root.".to_string());
    }

    let normalized = normalize_path(path);
    let dangerous_exact = [
        r"c:",
        r"c:\windows",
        r"c:\program files",
        r"c:\program files (x86)",
    ];
    if dangerous_exact.iter().any(|danger| normalized == *danger) {
        return Err("Choose a normal workspace folder, not a Windows system folder.".to_string());
    }

    if normalized.ends_with(r"\users") || is_user_home_root(path) {
        return Err("Choose an InnPilot workspace folder inside Desktop or Documents, not the whole user folder.".to_string());
    }

    let blocked_segments = ["node_modules", "target", "dist", ".git"];
    if path.components().any(|component| match component {
        Component::Normal(value) => blocked_segments
            .iter()
            .any(|segment| value.to_string_lossy().eq_ignore_ascii_case(segment)),
        _ => false,
    }) {
        return Err(
            "Choose a workspace folder outside build or source-control folders.".to_string(),
        );
    }

    Ok(())
}

fn validate_setup_folder_path(workspace: &Path, child: &Path) -> Result<(), String> {
    if !path_starts_with(child, workspace) {
        validate_not_dangerous_path(child)?;
    }
    Ok(())
}

fn validate_not_dangerous_path(path: &Path) -> Result<(), String> {
    let normalized = normalize_path(path);
    let dangerous_exact = [
        r"c:",
        r"c:\",
        r"c:\windows",
        r"c:\program files",
        r"c:\program files (x86)",
    ];
    if dangerous_exact.iter().any(|danger| normalized == *danger) {
        return Err("Choose a normal setup folder, not a Windows system folder.".to_string());
    }
    Ok(())
}

fn path_starts_with(path: &Path, parent: &Path) -> bool {
    let parent = normalize_path(parent);
    let child = normalize_path(path);
    child == parent || child.starts_with(&format!("{parent}\\"))
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn is_user_home_root(path: &Path) -> bool {
    let Some(user_profile) = std::env::var_os("USERPROFILE") else {
        return false;
    };
    normalize_path(path) == normalize_path(Path::new(&user_profile))
}

fn folder_has_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

fn non_empty_or(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalized_list_or_default(values: &[String], fallback: &str) -> Vec<String> {
    let mut normalized = values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        normalized.push(fallback.to_string());
    }
    normalized
}

fn setup_python_executable(value: &str, current: &HubConfig) -> String {
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    let managed = PathBuf::from(r"C:\InnPilot\.venv\Scripts\python.exe");
    if managed.is_file() {
        return managed.to_string_lossy().to_string();
    }
    current.automation.python_executable.clone()
}

fn default_invoice_delivery_mode() -> InvoiceDeliveryMode {
    InvoiceDeliveryMode::GmailDrafts
}

fn default_setup_mode() -> SetupMode {
    SetupMode::NewWorkspace
}

fn default_invoice_file_selection_mode() -> InvoiceFileSelectionMode {
    InvoiceFileSelectionMode::AllPdfs
}

fn push_folder(specs: &mut Vec<FolderSpec>, label: &'static str, path: &Option<PathBuf>) {
    if let Some(path) = path {
        specs.push(FolderSpec {
            label,
            path: path.clone(),
        });
    }
}

fn deserialize_string_list<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Null => Ok(Vec::new()),
        serde_json::Value::String(value) => Ok(vec![value]),
        serde_json::Value::Array(values) => values
            .into_iter()
            .map(|value| match value {
                serde_json::Value::String(text) => Ok(text),
                _ => Err(serde::de::Error::custom("expected a list of strings")),
            })
            .collect(),
        _ => Err(serde::de::Error::custom(
            "expected a string or list of strings",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn preview_does_not_write_files() {
        let root = temp_root("preview");
        let draft = draft_for_root(&root);

        let preview = preview_setup_draft(draft).unwrap();

        assert!(!root.exists());
        assert!(preview
            .folder_plan
            .iter()
            .any(|item| item.status == FolderPlanStatus::MissingParent));
    }

    #[test]
    fn initialize_creates_missing_folders() {
        let root = temp_root("initialize");
        let draft = draft_for_root(&root);

        let result = initialize_workspace(draft, true).unwrap();

        assert!(root.join("Invoices").join("Input").is_dir());
        assert!(!root.join("automation").exists());
        assert!(result
            .folders
            .iter()
            .any(|folder| folder.action == FolderAction::Created));
    }

    #[test]
    fn relative_child_folder_fields_are_resolved_under_workspace() {
        let root = temp_root("relative_children");
        let mut draft = draft_for_root(&root);
        draft.ocr_text_output_folder = "Scans\\CustomText".to_string();
        draft.signed_contracts_output_folder = "Contracts\\2026\\CustomSigned".to_string();

        let generated = GeneratedSetup::from_draft(&draft).unwrap();

        assert_eq!(
            generated.app_config.folders.ocr_text_output_folder,
            root.join("Scans").join("CustomText").to_string_lossy()
        );
        assert_eq!(
            generated.app_config.folders.contracts_output_folder,
            root.join("Contracts")
                .join("2026")
                .join("CustomSigned")
                .to_string_lossy()
        );
    }

    #[test]
    fn absolute_child_folder_fields_are_preserved() {
        let root = temp_root("absolute_children");
        let mut draft = draft_for_root(&root);
        let custom_text = temp_root("absolute_text");
        let custom_contracts = temp_root("absolute_contracts");
        draft.ocr_text_output_folder = custom_text.to_string_lossy().to_string();
        draft.signed_contracts_output_folder = custom_contracts.to_string_lossy().to_string();

        let generated = GeneratedSetup::from_draft(&draft).unwrap();

        assert_eq!(
            generated.app_config.folders.ocr_text_output_folder,
            custom_text.to_string_lossy()
        );
        assert_eq!(
            generated.app_config.folders.contracts_output_folder,
            custom_contracts.to_string_lossy()
        );
    }

    #[test]
    fn workspace_is_not_concatenated_with_absolute_child_path() {
        let root = temp_root("no_concat_workspace");
        let mut draft = draft_for_root(&root);
        let absolute = root
            .join("Scans")
            .join("TextOutput")
            .to_string_lossy()
            .to_string();
        draft.ocr_text_output_folder = absolute.clone();

        let generated = GeneratedSetup::from_draft(&draft).unwrap();

        assert_eq!(
            generated.app_config.folders.ocr_text_output_folder,
            absolute
        );
        assert!(!generated
            .app_config
            .folders
            .ocr_text_output_folder
            .contains(r"C:\InnPilot\workspaceC:\"));
    }

    #[test]
    fn concatenated_workspace_absolute_path_is_repaired_before_generation() {
        let root = temp_root("repaired_workspace");
        let mut draft = draft_for_root(&root);
        draft.workspace_base = format!(r"C:\InnPilot\workspace{}", root.to_string_lossy());

        let generated = GeneratedSetup::from_draft(&draft).unwrap();

        assert_eq!(generated.workspace_base, root);
        assert!(!generated
            .app_config
            .folders
            .invoice_input_folder
            .contains(r"C:\InnPilot\workspaceC:\"));
    }

    #[test]
    fn initialize_succeeds_in_fake_temp_workspace() {
        let root = temp_root("initialize_fake_workspace");
        let mut draft = draft_for_root(&root);
        draft.ocr_text_output_folder = root
            .join("Scans")
            .join("TextOutput")
            .to_string_lossy()
            .to_string();

        let result = initialize_workspace(draft, true).unwrap();

        assert!(root.join("Scans").join("TextOutput").is_dir());
        assert!(root.join("Contracts").join("2026").join("Signed").is_dir());
        assert!(result
            .folders
            .iter()
            .any(|folder| folder.path == root.join("Scans").join("TextOutput").to_string_lossy()));
    }

    #[test]
    fn exact_directory_creation_never_claims_an_existing_folder() {
        let root = temp_root("atomic_creation_claim");
        let existing = root.join("existing");
        fs::create_dir_all(&existing).unwrap();
        let mut created = Vec::new();

        assert!(!create_directory_tree_exact(&existing, &mut created).unwrap());
        assert!(created.is_empty());

        let new_child = existing.join("new").join("leaf");
        assert!(create_directory_tree_exact(&new_child, &mut created).unwrap());
        assert!(created.contains(&existing.join("new")));
        assert!(created.contains(&new_child));
        assert!(!created.contains(&existing));
    }

    #[test]
    fn parent_traversal_is_rejected_before_folder_creation() {
        let root = temp_root("parent_traversal");
        let mut draft = draft_for_root(&root);
        draft.invoice_input_folder = root
            .join("workspace")
            .join("..")
            .join("outside")
            .to_string_lossy()
            .to_string();

        let error = initialize_workspace(draft, true).unwrap_err();
        assert!(error.contains("parent-directory traversal"));
        assert!(!root.join("outside").exists());
    }

    #[test]
    fn remove_setup_created_empty_folders_only_removes_empty_workspace_folders() {
        let root = temp_root("cleanup");
        let keep = root.join("Invoices").join("Input");
        let remove = root.join("Support").join("Diagnostics");
        let traversal_target = root.parent().unwrap().join(format!(
            "{}-outside",
            root.file_name().unwrap().to_string_lossy()
        ));
        fs::create_dir_all(&keep).unwrap();
        fs::create_dir_all(&remove).unwrap();
        fs::create_dir_all(&traversal_target).unwrap();
        fs::write(keep.join("keep.txt"), b"keep").unwrap();

        let result = remove_setup_created_empty_folders(
            root.to_string_lossy().to_string(),
            vec![
                keep.to_string_lossy().to_string(),
                remove.to_string_lossy().to_string(),
                temp_root("outside").to_string_lossy().to_string(),
                root.join("..")
                    .join(traversal_target.file_name().unwrap())
                    .to_string_lossy()
                    .to_string(),
            ],
            true,
        )
        .unwrap();

        assert!(remove.starts_with(&root));
        assert!(!remove.exists());
        assert!(keep.exists());
        assert!(traversal_target.exists());
        assert_eq!(result.removed.len(), 1);
        assert_eq!(result.skipped.len(), 3);
    }

    #[test]
    fn initialize_does_not_delete_existing_files() {
        let root = temp_root("existing");
        let input = root.join("Invoices").join("Input");
        fs::create_dir_all(&input).unwrap();
        let marker = input.join("keep.txt");
        fs::write(&marker, b"keep").unwrap();

        let draft = draft_for_root(&root);
        initialize_workspace(draft, true).unwrap();

        assert_eq!(fs::read_to_string(marker).unwrap(), "keep");
    }

    #[test]
    fn dangerous_workspace_path_is_rejected() {
        let mut draft = draft_for_root(&temp_root("danger"));
        draft.workspace_base = r"C:\".to_string();

        let error = preview_setup_draft(draft).unwrap_err();

        assert!(error.contains("drive root"));
    }

    #[test]
    fn generated_app_and_automation_config_align() {
        let root = temp_root("align");
        let generated = GeneratedSetup::from_draft(&draft_for_root(&root)).unwrap();
        let gmail_token = generated.automation_config["paths"]["gmailTokenFile"]
            .as_str()
            .unwrap();

        assert_eq!(generated.app_config.gmail.token_path, gmail_token);
        assert_eq!(
            generated.app_config.invoice_delivery_mode,
            InvoiceDeliveryMode::GmailDrafts
        );
        assert_eq!(
            generated.app_config.invoice_file_selection_mode,
            InvoiceFileSelectionMode::AllPdfs
        );
        assert_eq!(
            generated.automation_config["invoice"]["deliveryMode"]
                .as_str()
                .unwrap(),
            "gmailDrafts"
        );
        assert_eq!(
            generated.automation_config["invoice"]["fileSelectionMode"]
                .as_str()
                .unwrap(),
            "allPdfs"
        );
        assert_eq!(
            generated.app_config.folders.invoice_input_folder,
            generated.automation_config["paths"]["invoiceInputDir"]
                .as_str()
                .unwrap()
        );
    }

    #[test]
    fn generated_automation_config_preserves_multiple_patterns_prefixes_and_markers() {
        let root = temp_root("multi_lists");
        let generated = GeneratedSetup::from_draft(&draft_for_root(&root)).unwrap();

        assert_eq!(
            generated.automation_config["invoice"]["inputGlobs"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            generated.automation_config["contracts"]["scannerFilePrefixes"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            generated.automation_config["contracts"]["contractMarkers"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            generated.automation_config["invoice"]["inputGlob"]
                .as_str()
                .unwrap(),
            "*.pdf"
        );
        assert_eq!(
            generated.automation_config["contracts"]["scannerFilePrefix"]
                .as_str()
                .unwrap(),
            "Scanner"
        );
        assert_eq!(
            generated.automation_config["ocr"]["languages"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert_eq!(
            generated.automation_config["ocr"]["tessdataDir"]
                .as_str()
                .unwrap(),
            r"ocr\tessdata"
        );
    }

    #[test]
    fn setup_uses_configured_python_executable() {
        let root = temp_root("python_config");
        let mut draft = draft_for_root(&root);
        draft.python_executable = r"C:\InnPilot\.venv\Scripts\python.exe".to_string();

        let generated = GeneratedSetup::from_draft(&draft).unwrap();

        assert_eq!(
            generated.app_config.automation.python_executable,
            r"C:\InnPilot\.venv\Scripts\python.exe"
        );
    }

    #[test]
    fn legacy_single_string_setup_values_deserialize_to_lists() {
        let value = serde_json::json!({
            "hotelDisplayName": "Test",
            "emailSignatureName": "Test",
            "workspaceBase": temp_root("legacy_deserialize").to_string_lossy(),
            "gmailSubject": "Invoices",
            "ccEmail": "",
            "invoiceDeliveryMode": "gmailDrafts",
            "invoiceFileSelectionMode": "filenamePatterns",
            "gmailCredentialsFile": "",
            "gmailTokenFile": "",
            "invoiceInputPattern": "*.pdf",
            "recipientRules": [],
            "contractYear": "2026",
            "scannerFilenamePrefix": "Scanner",
            "contractMarkerText": "Contract",
            "sharedScanFolder": "",
            "ocrTextOutputFolder": "",
            "signedContractsOutputFolder": "",
            "safeMode": true,
            "archiveOriginals": true,
            "redactLogs": true
        });

        let draft: SetupDraft = serde_json::from_value(value).unwrap();

        assert_eq!(draft.invoice_input_patterns, vec!["*.pdf"]);
        assert_eq!(
            draft.invoice_delivery_mode,
            InvoiceDeliveryMode::GmailDrafts
        );
        assert_eq!(
            draft.invoice_file_selection_mode,
            InvoiceFileSelectionMode::FilenamePatterns
        );
        assert_eq!(draft.scanner_filename_prefixes, vec!["Scanner"]);
        assert_eq!(draft.contract_marker_texts, vec!["Contract"]);
    }

    #[test]
    fn fake_workspace_setup_generates_expected_folder_and_config_paths() {
        let root = temp_root("fake_workspace_e2e");
        let generated = GeneratedSetup::from_draft(&draft_for_root(&root)).unwrap();
        let labels = generated
            .folder_specs
            .iter()
            .map(|spec| spec.label)
            .collect::<Vec<_>>();

        for expected in [
            "Invoices/Input",
            "Invoices/ReadyToSend",
            "Invoices/Archive",
            "Invoices/Logs",
            "Gmail/Token",
            "Gmail/Credentials",
            "Scans/IncomingCache",
            "Scans/TextOutput",
            "Contracts/<year>/Signed",
            "Contracts/Logs",
            "Support/Diagnostics",
        ] {
            assert!(labels.contains(&expected));
        }

        let defaults = config::default_config();
        assert_eq!(
            generated.app_config.automation.automation_config_path,
            defaults.automation.automation_config_path
        );
        assert_eq!(
            generated.app_config.automation.automation_root_folder,
            defaults.automation.automation_root_folder
        );
        assert_eq!(generated.app_config.scripts, defaults.scripts);
        assert_eq!(
            generated.automation_config["paths"]["invoiceInputDir"]
                .as_str()
                .unwrap(),
            root.join("Invoices").join("Input").to_string_lossy()
        );
        assert_eq!(
            generated.automation_config["paths"]["contractDestinationDir"]
                .as_str()
                .unwrap(),
            root.join("Contracts")
                .join("2026")
                .join("Signed")
                .to_string_lossy()
        );
        assert!(generated.app_config.safety.dry_run_default);
    }

    #[test]
    fn existing_folder_mappings_are_preserved_in_generated_config() {
        let root = temp_root("existing_mapped_workspace");
        let existing = temp_root("existing_business_folders");
        let mut draft = draft_for_root(&root);
        draft.setup_mode = SetupMode::ExistingFolders;
        draft.invoice_input_folder = existing
            .join("Fatture")
            .join("Input")
            .to_string_lossy()
            .to_string();
        draft.invoice_output_folder = existing
            .join("Fatture")
            .join("ProntoInvio")
            .to_string_lossy()
            .to_string();
        draft.contract_log_folder = existing.join("LogContratti").to_string_lossy().to_string();

        let generated = GeneratedSetup::from_draft(&draft).unwrap();

        assert_eq!(
            generated.app_config.folders.invoice_input_folder,
            existing.join("Fatture").join("Input").to_string_lossy()
        );
        assert_eq!(
            generated.automation_config["paths"]["invoiceOutputDir"]
                .as_str()
                .unwrap(),
            existing
                .join("Fatture")
                .join("ProntoInvio")
                .to_string_lossy()
        );
        assert_eq!(
            generated.app_config.folders.contract_log_folder,
            existing.join("LogContratti").to_string_lossy()
        );
    }

    #[test]
    fn existing_folder_mode_preserves_a_pc_specific_unc_scansioni_path() {
        let root = temp_root("unc_scansioni");
        let mut draft = draft_for_root(&root);
        draft.setup_mode = SetupMode::ExistingFolders;
        draft.shared_scan_folder = r"\\LIFE-SERVER\Scansioni".to_string();

        let generated = GeneratedSetup::from_draft(&draft).unwrap();

        assert_eq!(
            generated.app_config.folders.scansioni_network_share,
            r"\\LIFE-SERVER\Scansioni"
        );
        assert_eq!(
            generated.automation_config["paths"]["scanSourceDir"]
                .as_str()
                .unwrap(),
            r"\\LIFE-SERVER\Scansioni"
        );
    }

    #[test]
    fn existing_folder_mode_allows_skipped_optional_paths() {
        let root = temp_root("existing_skipped");
        let mut draft = draft_for_root(&root);
        draft.setup_mode = SetupMode::ExistingFolders;
        draft.invoice_input_folder.clear();
        draft.invoice_output_folder.clear();
        draft.invoice_archive_folder.clear();
        draft.invoice_log_folder.clear();
        draft.shared_scan_folder.clear();
        draft.scans_local_cache_folder.clear();
        draft.ocr_text_output_folder.clear();
        draft.signed_contracts_output_folder.clear();
        draft.contract_log_folder.clear();

        let generated = GeneratedSetup::from_draft(&draft).unwrap();

        assert_eq!(generated.app_config.folders.invoice_input_folder, "");
        assert_eq!(generated.app_config.folders.contracts_output_folder, "");
        assert!(!generated
            .folder_specs
            .iter()
            .any(|spec| spec.label == "Invoices/Input"));
        assert!(!generated
            .folder_specs
            .iter()
            .any(|spec| spec.label == "automation"));
    }

    #[test]
    fn atomic_write_creates_backup_if_config_exists() {
        let root = temp_root("backup");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("config.json");
        fs::write(&path, b"{\"old\":true}").unwrap();
        let mut backups = Vec::new();

        atomic_write_json_with_backup(&path, &serde_json::json!({"new": true}), &mut backups)
            .unwrap();

        assert_eq!(backups.len(), 1);
        assert!(Path::new(&backups[0]).is_file());
        assert!(fs::read_to_string(path).unwrap().contains("\"new\""));
    }

    #[test]
    fn missing_automation_reconstructs_new_workspace_from_data_paths() {
        let root = temp_root("missing_automation_snapshot");
        let data_workspace = root.join("hotel-data");
        let runtime_root = root.join("managed-runtime");
        let mut current = config::default_config();
        current.folders.invoice_input_folder = data_workspace
            .join("Invoices")
            .join("Input")
            .to_string_lossy()
            .to_string();
        current.automation.automation_root_folder = runtime_root.to_string_lossy().to_string();
        current.automation.automation_config_path = runtime_root
            .join("config.local.json")
            .to_string_lossy()
            .to_string();

        let draft = draft_from_installed(&current, None);

        assert_eq!(draft.setup_mode, SetupMode::NewWorkspace);
        assert_eq!(
            normalize_path(Path::new(&draft.workspace_base)),
            normalize_path(&data_workspace)
        );
    }

    #[test]
    fn empty_first_save_bootstraps_the_configured_automation_path() {
        let root = temp_root("bootstrap_automation_config");
        let data_workspace = root.join("hotel-data");
        let runtime_root = root.join("managed-runtime");
        let automation_path = runtime_root.join("config.local.json");
        let app_path = root.join("config.json");
        fs::create_dir_all(&root).unwrap();

        let mut current = config::default_config();
        current.folders.invoice_input_folder = data_workspace
            .join("Invoices")
            .join("Input")
            .to_string_lossy()
            .to_string();
        current.automation.automation_root_folder = runtime_root.to_string_lossy().to_string();
        current.automation.automation_config_path = automation_path.to_string_lossy().to_string();
        fs::write(&app_path, serde_json::to_vec_pretty(&current).unwrap()).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();
        assert!(pair.automation_bytes.is_none());

        let result =
            apply_setup_patch_locked(&app_path, SetupPatch::default(), &pair.revision).unwrap();

        assert_eq!(
            normalize_path(Path::new(&result.automation_config_path)),
            normalize_path(&automation_path)
        );
        assert!(automation_path.is_file());
        assert!(!data_workspace.join("automation").exists());
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&automation_path).unwrap()).unwrap();
        assert_eq!(
            saved.pointer("/paths/invoiceInputDir").unwrap(),
            &current.folders.invoice_input_folder
        );
    }

    #[test]
    fn changing_data_workspace_preserves_runtime_root_config_path_and_scripts() {
        let root = temp_root("workspace_preserves_runtime");
        let runtime_root = root.join("custom-runtime");
        let automation_path = runtime_root.join("hotel-config.local.json");
        let mut current = config::default_config();
        current.automation.automation_root_folder = runtime_root.to_string_lossy().to_string();
        current.automation.automation_config_path = automation_path.to_string_lossy().to_string();
        current.scripts.invoice_workflow_script = root
            .join("custom-scripts")
            .join("invoice.py")
            .to_string_lossy()
            .to_string();
        current.scripts.gmail_draft_script = root
            .join("custom-scripts")
            .join("gmail.py")
            .to_string_lossy()
            .to_string();
        current.scripts.copy_scansioni_script = root
            .join("custom-scripts")
            .join("scans.py")
            .to_string_lossy()
            .to_string();
        current.scripts.ocr_preprocessing_script = root
            .join("custom-scripts")
            .join("ocr.py")
            .to_string_lossy()
            .to_string();
        current.scripts.contract_processing_script = root
            .join("custom-scripts")
            .join("contracts.py")
            .to_string_lossy()
            .to_string();
        let mut draft = draft_from_installed(&current, Some(&serde_json::json!({})));
        draft.workspace_base = root
            .join("new-data-workspace")
            .to_string_lossy()
            .to_string();

        let generated = GeneratedSetup::from_draft_with_current(&draft, &current).unwrap();

        assert_eq!(generated.app_config.automation, current.automation);
        assert_eq!(generated.app_config.scripts, current.scripts);

        let expected_automation = serde_json::to_value(&current.automation).unwrap();
        let expected_scripts = serde_json::to_value(&current.scripts).unwrap();
        let mut raw = serde_json::to_value(&current).unwrap();
        apply_app_patch(
            &mut raw,
            &SetupPatch {
                workspace_base: Some(draft.workspace_base),
                ..SetupPatch::default()
            },
            &generated.app_config,
        )
        .unwrap();
        assert_eq!(raw.pointer("/automation").unwrap(), &expected_automation);
        assert_eq!(raw.pointer("/scripts").unwrap(), &expected_scripts);
    }

    #[test]
    fn setup_patch_changes_only_the_requested_mapping_and_preserves_custom_json() {
        let root = temp_root("preserve_pair");
        let automation_path = root.join("automation").join("config.local.json");
        fs::create_dir_all(automation_path.parent().unwrap()).unwrap();
        let app_path = root.join("config.json");
        let app_fixture = include_str!("../test-fixtures/config-preservation/app-v2-custom.json")
            .replace(
                "__AUTOMATION_CONFIG_PATH__",
                &automation_path.to_string_lossy().replace('\\', "\\\\"),
            );
        let automation_fixture =
            include_str!("../test-fixtures/config-preservation/automation-custom.json");
        fs::write(&app_path, app_fixture.as_bytes()).unwrap();
        fs::write(&automation_path, automation_fixture.as_bytes()).unwrap();
        let before_app: serde_json::Value = serde_json::from_str(&app_fixture).unwrap();
        let before_automation: serde_json::Value =
            serde_json::from_str(automation_fixture).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();
        let requested = root.join("Only This Folder").to_string_lossy().to_string();

        let result = apply_setup_patch_locked(
            &app_path,
            SetupPatch {
                invoice_input_folder: Some(requested.clone()),
                ..SetupPatch::default()
            },
            &pair.revision,
        )
        .unwrap();

        let mut after_app: serde_json::Value =
            serde_json::from_slice(&fs::read(&app_path).unwrap()).unwrap();
        let mut after_automation: serde_json::Value =
            serde_json::from_slice(&fs::read(&automation_path).unwrap()).unwrap();
        assert_eq!(
            after_app.pointer("/folders/invoiceInputFolder").unwrap(),
            &requested
        );
        assert_eq!(
            after_automation.pointer("/paths/invoiceInputDir").unwrap(),
            &requested
        );
        remove_pointer(&mut after_app, "/folders/invoiceInputFolder");
        let mut before_app_without_field = before_app;
        remove_pointer(&mut before_app_without_field, "/folders/invoiceInputFolder");
        remove_pointer(&mut after_automation, "/paths/invoiceInputDir");
        let mut before_automation_without_field = before_automation;
        remove_pointer(
            &mut before_automation_without_field,
            "/paths/invoiceInputDir",
        );
        assert_eq!(after_app, before_app_without_field);
        assert_eq!(after_automation, before_automation_without_field);
        assert_eq!(result.backups.len(), 2);
    }

    #[test]
    fn snapshot_preview_and_save_share_one_preservation_aware_candidate() {
        let root = temp_root("snapshot_preview_save");
        let automation_path = root.join("automation").join("config.local.json");
        fs::create_dir_all(automation_path.parent().unwrap()).unwrap();
        let app_path = root.join("config.json");
        let app_fixture = include_str!("../test-fixtures/config-preservation/app-v2-custom.json")
            .replace(
                "__AUTOMATION_CONFIG_PATH__",
                &automation_path.to_string_lossy().replace('\\', "\\\\"),
            );
        let automation_fixture =
            include_str!("../test-fixtures/config-preservation/automation-custom.json");
        fs::write(&app_path, app_fixture.as_bytes()).unwrap();
        fs::write(&automation_path, automation_fixture.as_bytes()).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();
        let requested = root.join("Previewed Input").to_string_lossy().to_string();
        let patch = SetupPatch {
            invoice_input_folder: Some(requested.clone()),
            ..SetupPatch::default()
        };

        let preview = preview_setup_patch(&pair, &patch, &pair.revision).unwrap();
        assert_eq!(
            preview.app_config_preview.folders.invoice_input_folder,
            requested
        );
        assert_eq!(
            preview
                .automation_config_preview
                .pointer("/paths/invoiceInputDir")
                .unwrap(),
            &requested
        );
        assert_eq!(
            preview
                .automation_config_preview
                .pointer("/paths/contractInputDir")
                .unwrap(),
            "D:\\FakeHotel\\Scansioni\\Cache\\Contratti"
        );

        apply_setup_patch_locked(&app_path, patch, &pair.revision).unwrap();
        let saved_app: serde_json::Value =
            serde_json::from_slice(&fs::read(&app_path).unwrap()).unwrap();
        let saved_automation: serde_json::Value =
            serde_json::from_slice(&fs::read(&automation_path).unwrap()).unwrap();
        assert_eq!(saved_app["folders"]["invoiceInputFolder"], requested);
        assert_eq!(saved_automation, preview.automation_config_preview);
    }

    #[test]
    fn changing_scan_cache_preserves_distinct_contract_input_path() {
        let root = temp_root("preserve_contract_input");
        let automation_path = root.join("automation").join("config.local.json");
        fs::create_dir_all(automation_path.parent().unwrap()).unwrap();
        let app_path = root.join("config.json");
        let app_fixture = include_str!("../test-fixtures/config-preservation/app-v2-custom.json")
            .replace(
                "__AUTOMATION_CONFIG_PATH__",
                &automation_path.to_string_lossy().replace('\\', "\\\\"),
            );
        let automation_fixture =
            include_str!("../test-fixtures/config-preservation/automation-custom.json");
        fs::write(&app_path, app_fixture.as_bytes()).unwrap();
        fs::write(&automation_path, automation_fixture.as_bytes()).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();
        let requested = root.join("New Scan Cache").to_string_lossy().to_string();

        apply_setup_patch_locked(
            &app_path,
            SetupPatch {
                scans_local_cache_folder: Some(requested.clone()),
                ..SetupPatch::default()
            },
            &pair.revision,
        )
        .unwrap();

        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&automation_path).unwrap()).unwrap();
        assert_eq!(saved["paths"]["scanCacheDir"], requested);
        assert_eq!(
            saved["paths"]["contractInputDir"],
            "D:\\FakeHotel\\Scansioni\\Cache\\Contratti"
        );
    }

    #[test]
    fn legacy_setup_save_migrates_known_fields_and_preserves_legacy_extensions() {
        let root = temp_root("legacy_setup_save");
        let app_path = root.join("config.json");
        fs::create_dir_all(&root).unwrap();
        let fixture = include_str!("../test-fixtures/config-preservation/app-v1-legacy.json");
        let original: serde_json::Value = serde_json::from_str(fixture).unwrap();
        fs::write(&app_path, fixture.as_bytes()).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();
        let automation_path = pair.automation_config_path.clone();
        fs::create_dir_all(automation_path.parent().unwrap()).unwrap();
        let requested = root.join("Legacy New Input").to_string_lossy().to_string();

        apply_setup_patch_locked(
            &app_path,
            SetupPatch {
                invoice_input_folder: Some(requested.clone()),
                ..SetupPatch::default()
            },
            &pair.revision,
        )
        .unwrap();

        let saved_bytes = fs::read(&app_path).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&saved_bytes).unwrap();
        assert_eq!(saved["schemaVersion"], config::CONFIG_VERSION);
        assert_eq!(saved["folders"]["invoiceInputFolder"], requested);
        assert_eq!(saved["paths"], original["paths"]);
        assert_eq!(saved["hotel_custom"], original["hotel_custom"]);
        assert_eq!(saved["legacy_support"], original["legacy_support"]);
        let (reloaded, should_rewrite) =
            config::parse_config_with_migration(std::str::from_utf8(&saved_bytes).unwrap())
                .unwrap();
        assert!(!should_rewrite);
        assert_eq!(reloaded.folders.invoice_input_folder, requested);
    }

    #[test]
    fn incomplete_setup_save_fills_missing_known_fields_without_losing_extensions() {
        let root = temp_root("incomplete_setup_save");
        let automation_path = root.join("automation").join("config.local.json");
        fs::create_dir_all(automation_path.parent().unwrap()).unwrap();
        let app_path = root.join("config.json");
        let fixture = include_str!("../test-fixtures/config-preservation/app-v2-incomplete.json")
            .replace(
                "__AUTOMATION_CONFIG_PATH__",
                &automation_path.to_string_lossy().replace('\\', "\\\\"),
            );
        let automation_fixture =
            include_str!("../test-fixtures/config-preservation/automation-custom.json");
        fs::write(&app_path, fixture.as_bytes()).unwrap();
        fs::write(&automation_path, automation_fixture.as_bytes()).unwrap();
        let original: serde_json::Value = serde_json::from_str(&fixture).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();
        let requested = root.join("Incomplete Input").to_string_lossy().to_string();

        apply_setup_patch_locked(
            &app_path,
            SetupPatch {
                invoice_input_folder: Some(requested.clone()),
                ..SetupPatch::default()
            },
            &pair.revision,
        )
        .unwrap();

        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&app_path).unwrap()).unwrap();
        assert_eq!(saved["folders"]["invoiceInputFolder"], requested);
        assert_eq!(
            saved["client"]["legacyDeskCode"],
            original["client"]["legacyDeskCode"]
        );
        assert_eq!(
            saved["automation"]["localExtension"],
            original["automation"]["localExtension"]
        );
        assert_eq!(
            saved["scripts"]["hotelSpecificScript"],
            original["scripts"]["hotelSpecificScript"]
        );
        assert_eq!(
            saved["folders"]["futureFolder"],
            original["folders"]["futureFolder"]
        );
        assert_eq!(
            saved["gmail"]["accountHint"],
            original["gmail"]["accountHint"]
        );
        assert_eq!(
            saved["safety"]["experimentalGuard"],
            original["safety"]["experimentalGuard"]
        );
        assert_eq!(
            saved["incompleteExtension"],
            original["incompleteExtension"]
        );
    }

    #[test]
    fn recipient_rule_edit_preserves_metadata_and_kept_rule_order() {
        let root = temp_root("preserve_recipient_rule_metadata");
        let automation_path = root.join("automation").join("config.local.json");
        fs::create_dir_all(automation_path.parent().unwrap()).unwrap();
        let app_path = root.join("config.json");
        let app_fixture = include_str!("../test-fixtures/config-preservation/app-v2-custom.json")
            .replace(
                "__AUTOMATION_CONFIG_PATH__",
                &automation_path.to_string_lossy().replace('\\', "\\\\"),
            );
        let automation_fixture =
            include_str!("../test-fixtures/config-preservation/automation-custom.json");
        fs::write(&app_path, app_fixture.as_bytes()).unwrap();
        fs::write(&automation_path, automation_fixture.as_bytes()).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();
        let installed =
            draft_from_installed(&pair.app_config, pair.automation_value.as_ref()).recipient_rules;
        assert_eq!(installed.len(), 3);

        let mut edited_first = installed[0].clone();
        edited_first.match_text = "fixture partner alfa updated".to_string();
        let kept_third = installed[2].clone();
        let added = RecipientRuleDraft {
            id: Some("rule-new-fixture".to_string()),
            match_text: "fixture partner gamma".to_string(),
            email: "gamma@partner.invalid".to_string(),
        };
        apply_setup_patch_locked(
            &app_path,
            SetupPatch {
                recipient_rules: Some(vec![edited_first, kept_third, added]),
                ..SetupPatch::default()
            },
            &pair.revision,
        )
        .unwrap();

        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&automation_path).unwrap()).unwrap();
        let rules = saved
            .pointer("/invoice/recipientRules")
            .and_then(serde_json::Value::as_array)
            .unwrap();
        assert_eq!(rules.len(), 3);
        assert_eq!(rules[0]["match"], "fixture partner alfa updated");
        assert_eq!(rules[0]["committenteId"], "fixture-alfa-001");
        assert_eq!(rules[1]["match"], "fixture pubblica amministrazione");
        assert_eq!(rules[1]["committenteId"], "fixture-pa-777");
        assert_eq!(rules[1]["requiresReference"], true);
        assert_eq!(rules[2]["match"], "fixture partner gamma");
        assert_eq!(rules[2]["email"], "gamma@partner.invalid");
        assert!(rules[2].get("committenteId").is_none());
        assert!(!rules.iter().any(|rule| {
            rule.get("match").and_then(serde_json::Value::as_str) == Some("fixture partner beta")
        }));
    }

    #[test]
    fn unrelated_automation_patch_does_not_reformat_or_change_app_config() {
        let root = temp_root("automation_only_patch");
        let automation_path = root.join("automation").join("config.local.json");
        fs::create_dir_all(automation_path.parent().unwrap()).unwrap();
        let app_path = root.join("config.json");
        let app_fixture = include_str!("../test-fixtures/config-preservation/app-v2-custom.json")
            .replace(
                "__AUTOMATION_CONFIG_PATH__",
                &automation_path.to_string_lossy().replace('\\', "\\\\"),
            );
        let automation_fixture =
            include_str!("../test-fixtures/config-preservation/automation-custom.json");
        fs::write(&app_path, app_fixture.as_bytes()).unwrap();
        fs::write(&automation_path, automation_fixture.as_bytes()).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();

        apply_setup_patch_locked(
            &app_path,
            SetupPatch {
                cc_email: Some("changed-copy@fixture-hotel.invalid".to_string()),
                ..SetupPatch::default()
            },
            &pair.revision,
        )
        .unwrap();

        assert_eq!(fs::read(&app_path).unwrap(), pair.app_bytes);
        let automation: serde_json::Value =
            serde_json::from_slice(&fs::read(&automation_path).unwrap()).unwrap();
        assert_eq!(
            automation.pointer("/gmail/ccEmail").unwrap(),
            "changed-copy@fixture-hotel.invalid"
        );
        assert_eq!(
            automation.pointer("/invoice/recipientRules").unwrap(),
            &serde_json::from_str::<serde_json::Value>(automation_fixture).unwrap()["invoice"]
                ["recipientRules"]
        );
    }

    #[test]
    fn setup_noop_is_byte_for_byte_and_stale_revision_is_rejected() {
        let root = temp_root("noop_stale");
        let automation_path = root.join("automation").join("config.local.json");
        fs::create_dir_all(automation_path.parent().unwrap()).unwrap();
        let app_path = root.join("config.json");
        let app_fixture = include_str!("../test-fixtures/config-preservation/app-v2-custom.json")
            .replace(
                "__AUTOMATION_CONFIG_PATH__",
                &automation_path.to_string_lossy().replace('\\', "\\\\"),
            );
        let automation_fixture =
            include_str!("../test-fixtures/config-preservation/automation-custom.json");
        fs::write(&app_path, app_fixture.as_bytes()).unwrap();
        fs::write(&automation_path, automation_fixture.as_bytes()).unwrap();
        let pair = load_configuration_pair(&app_path).unwrap();

        let result =
            apply_setup_patch_locked(&app_path, SetupPatch::default(), &pair.revision).unwrap();
        assert!(result.backups.is_empty());
        assert_eq!(fs::read(&app_path).unwrap(), pair.app_bytes);
        assert_eq!(
            fs::read(&automation_path).unwrap(),
            pair.automation_bytes.unwrap()
        );

        fs::write(&automation_path, b"{\"externalEdit\":true}").unwrap();
        let error = apply_setup_patch_locked(
            &app_path,
            SetupPatch {
                hotel_display_name: Some("Must Not Apply".to_string()),
                ..SetupPatch::default()
            },
            &pair.revision,
        )
        .unwrap_err();
        assert!(error.contains("changed after this screen was opened"));
        let current_app: serde_json::Value =
            serde_json::from_slice(&fs::read(&app_path).unwrap()).unwrap();
        assert_eq!(
            current_app.pointer("/client/displayName").unwrap(),
            "Hotel Fixture Aurora"
        );
        assert_eq!(
            fs::read(&automation_path).unwrap(),
            b"{\"externalEdit\":true}"
        );
    }

    #[test]
    fn future_schema_setup_patch_is_refused_without_mutation() {
        let root = temp_root("future_schema");
        let app_path = root.join("config.json");
        fs::create_dir_all(&root).unwrap();
        let bytes = include_bytes!("../test-fixtures/config-preservation/app-v3-future.json");
        fs::write(&app_path, bytes).unwrap();

        let error = load_configuration_pair(&app_path).unwrap_err();

        assert!(error.contains("schema version 3"));
        assert_eq!(fs::read(&app_path).unwrap(), bytes);
    }

    #[test]
    fn transaction_state_distinguishes_old_split_and_committed_pairs() {
        let root = temp_root("transaction_states");
        fs::create_dir_all(&root).unwrap();
        let app_path = root.join("config.json");
        let automation_path = root.join("automation.json");
        let old_app = br#"{"version":"old"}"#;
        let new_app = br#"{"version":"new"}"#;
        let old_automation = br#"{"version":"old"}"#;
        let new_automation = br#"{"version":"new"}"#;
        fs::write(&app_path, old_app).unwrap();
        fs::write(&automation_path, old_automation).unwrap();
        let journal = SetupTransactionJournal {
            schema_version: SETUP_TRANSACTION_SCHEMA,
            recovery_point_id: "20260814T000000000Z-1234".to_string(),
            app_config_path: app_path.to_string_lossy().to_string(),
            old_app_sha256: sha256_bytes(old_app),
            new_app_sha256: sha256_bytes(new_app),
            old_automation_path: automation_path.to_string_lossy().to_string(),
            new_automation_path: automation_path.to_string_lossy().to_string(),
            old_automation_existed: true,
            old_automation_sha256: Some(sha256_bytes(old_automation)),
            new_automation_sha256: sha256_bytes(new_automation),
            approved_proposal: None,
        };

        assert_eq!(
            classify_setup_transaction_state(&app_path, &journal).unwrap(),
            SetupTransactionState::Unchanged
        );
        fs::write(&automation_path, new_automation).unwrap();
        assert_eq!(
            classify_setup_transaction_state(&app_path, &journal).unwrap(),
            SetupTransactionState::NeedsRollback
        );
        fs::write(&app_path, new_app).unwrap();
        assert_eq!(
            classify_setup_transaction_state(&app_path, &journal).unwrap(),
            SetupTransactionState::Committed
        );
    }

    #[test]
    fn path_changing_transaction_reconciles_split_and_committed_states() {
        for committed in [false, true] {
            let root = temp_root(if committed {
                "path_change_committed"
            } else {
                "path_change_split"
            });
            let paths = InstallationPaths::from_app_data(&root, None);
            fs::create_dir_all(&paths.runner_root).unwrap();
            fs::write(&paths.runner_db, b"").unwrap();
            let old_automation_path = root.join("old").join("config.local.json");
            let new_automation_path = root.join("new").join("config.local.json");
            fs::create_dir_all(old_automation_path.parent().unwrap()).unwrap();
            fs::create_dir_all(new_automation_path.parent().unwrap()).unwrap();
            let app_fixture =
                include_str!("../test-fixtures/config-preservation/app-v2-custom.json");
            let app_bytes = |automation_path: &Path| {
                app_fixture
                    .replace(
                        "__AUTOMATION_CONFIG_PATH__",
                        &automation_path.to_string_lossy().replace('\\', "\\\\"),
                    )
                    .into_bytes()
            };
            let old_app = app_bytes(&old_automation_path);
            let new_app = app_bytes(&new_automation_path);
            let old_automation =
                include_bytes!("../test-fixtures/config-preservation/automation-custom.json");
            let new_automation = br#"{"version":"new-path"}"#;
            fs::write(&paths.config_file, &old_app).unwrap();
            fs::write(&old_automation_path, old_automation).unwrap();

            let recovery_service =
                recovery::RecoveryService::new(recovery::RecoveryEnvironment::from_installation(
                    &paths,
                    &BuildInfo::from_version("test"),
                ));
            let point = recovery_service
                .create_configuration_point_from_bytes(&old_app, Some(old_automation))
                .unwrap();
            fs::write(&new_automation_path, new_automation).unwrap();
            if committed {
                fs::write(&paths.config_file, &new_app).unwrap();
            }
            let journal = SetupTransactionJournal {
                schema_version: SETUP_TRANSACTION_SCHEMA,
                recovery_point_id: point.id,
                app_config_path: paths.config_file.to_string_lossy().to_string(),
                old_app_sha256: sha256_bytes(&old_app),
                new_app_sha256: sha256_bytes(&new_app),
                old_automation_path: old_automation_path.to_string_lossy().to_string(),
                new_automation_path: new_automation_path.to_string_lossy().to_string(),
                old_automation_existed: true,
                old_automation_sha256: Some(sha256_bytes(old_automation)),
                new_automation_sha256: sha256_bytes(new_automation),
                approved_proposal: None,
            };
            write_setup_transaction_journal(&paths.config_file, &journal).unwrap();

            reconcile_incomplete_setup_at(
                &paths.config_file,
                &recovery_service,
                &paths.runner_root,
            )
            .unwrap();

            assert_eq!(
                fs::read(&paths.config_file).unwrap(),
                if committed { new_app } else { old_app }
            );
            assert_eq!(fs::read(&old_automation_path).unwrap(), old_automation);
            assert_eq!(fs::read(&new_automation_path).unwrap(), new_automation);
            assert!(!setup_transaction_path(&paths.config_file).unwrap().exists());
        }
    }

    fn remove_pointer(value: &mut serde_json::Value, pointer: &str) {
        let mut parts = pointer
            .trim_start_matches('/')
            .split('/')
            .collect::<Vec<_>>();
        let key = parts.pop().unwrap();
        let parent_pointer = format!("/{}", parts.join("/"));
        value
            .pointer_mut(&parent_pointer)
            .and_then(serde_json::Value::as_object_mut)
            .unwrap()
            .remove(key);
    }

    fn draft_for_root(root: &Path) -> SetupDraft {
        SetupDraft {
            setup_mode: SetupMode::NewWorkspace,
            hotel_display_name: "Test Hotel".to_string(),
            email_signature_name: "Test Hotel Team".to_string(),
            workspace_base: root.to_string_lossy().to_string(),
            python_executable: r"C:\InnPilot\.venv\Scripts\python.exe".to_string(),
            invoice_delivery_mode: InvoiceDeliveryMode::GmailDrafts,
            invoice_file_selection_mode: InvoiceFileSelectionMode::AllPdfs,
            gmail_subject: "Invoices - Test Hotel".to_string(),
            cc_email: "backoffice@example.invalid".to_string(),
            gmail_credentials_file: root
                .join("Gmail")
                .join("Credentials")
                .join("gmail_credentials.json")
                .to_string_lossy()
                .to_string(),
            gmail_token_file: root
                .join("Gmail")
                .join("Token")
                .join("gmail_token.json")
                .to_string_lossy()
                .to_string(),
            invoice_input_folder: root
                .join("Invoices")
                .join("Input")
                .to_string_lossy()
                .to_string(),
            invoice_output_folder: root
                .join("Invoices")
                .join("ReadyToSend")
                .to_string_lossy()
                .to_string(),
            invoice_archive_folder: root
                .join("Invoices")
                .join("Archive")
                .to_string_lossy()
                .to_string(),
            invoice_log_folder: root
                .join("Invoices")
                .join("Logs")
                .to_string_lossy()
                .to_string(),
            invoice_input_patterns: vec!["*.pdf".to_string(), "Booking*.pdf".to_string()],
            recipient_rules: vec![RecipientRuleDraft {
                id: None,
                match_text: "partner".to_string(),
                email: "partner@example.invalid".to_string(),
            }],
            contract_year: "2026".to_string(),
            scanner_filename_prefixes: vec!["Scanner".to_string(), "Reception Scanner".to_string()],
            contract_marker_texts: vec!["Contract".to_string(), "Contratto".to_string()],
            shared_scan_folder: root.join("SharedScans").to_string_lossy().to_string(),
            scans_local_cache_folder: root
                .join("Scans")
                .join("IncomingCache")
                .to_string_lossy()
                .to_string(),
            ocr_text_output_folder: root
                .join("Scans")
                .join("TextOutput")
                .to_string_lossy()
                .to_string(),
            signed_contracts_output_folder: root
                .join("Contracts")
                .join("2026")
                .join("Signed")
                .to_string_lossy()
                .to_string(),
            contract_log_folder: root
                .join("Contracts")
                .join("Logs")
                .to_string_lossy()
                .to_string(),
            safe_mode: true,
            archive_originals: true,
            redact_logs: true,
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "innpilot_setup_{name}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
