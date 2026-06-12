use crate::{
    config::{
        self, AutomationConfig, ClientConfig, FolderPaths, GmailConfig, HubConfig,
        InvoiceDeliveryMode, SafetyConfig, ScriptPaths,
    },
    preflight,
};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupDraft {
    hotel_display_name: String,
    email_signature_name: String,
    workspace_base: String,
    #[serde(default)]
    python_executable: String,
    #[serde(default = "default_invoice_delivery_mode")]
    invoice_delivery_mode: InvoiceDeliveryMode,
    gmail_subject: String,
    cc_email: String,
    gmail_credentials_file: String,
    gmail_token_file: String,
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
    ocr_text_output_folder: String,
    signed_contracts_output_folder: String,
    safe_mode: bool,
    archive_originals: bool,
    redact_logs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecipientRuleDraft {
    id: Option<String>,
    match_text: String,
    email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupPreview {
    workspace_base: String,
    folder_plan: Vec<FolderPlanItem>,
    app_config_preview: HubConfig,
    automation_config_preview: serde_json::Value,
    warnings: Vec<String>,
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
}

pub(crate) fn preview_setup(draft: SetupDraft) -> Result<SetupPreview, String> {
    let generated = GeneratedSetup::from_draft(&draft)?;
    Ok(SetupPreview {
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
    for spec in &generated.folder_specs {
        let path = &spec.path;
        if path.exists() {
            if path.is_dir() {
                results.push(FolderActionResult {
                    label: spec.label.to_string(),
                    path: path.to_string_lossy().to_string(),
                    action: FolderAction::AlreadyExists,
                    message: if folder_has_entries(path) {
                        "Folder already exists and was left unchanged.".to_string()
                    } else {
                        "Empty folder already exists.".to_string()
                    },
                });
            } else {
                results.push(FolderActionResult {
                    label: spec.label.to_string(),
                    path: path.to_string_lossy().to_string(),
                    action: FolderAction::Failed,
                    message: "A file already exists at this location.".to_string(),
                });
            }
            continue;
        }

        match fs::create_dir_all(path) {
            Ok(()) => results.push(FolderActionResult {
                label: spec.label.to_string(),
                path: path.to_string_lossy().to_string(),
                action: FolderAction::Created,
                message: "Folder created.".to_string(),
            }),
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
    })
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
    let mut ordered_paths = paths
        .into_iter()
        .map(|path| PathBuf::from(path.trim()))
        .filter(|path| !path.as_os_str().is_empty())
        .collect::<Vec<_>>();
    ordered_paths.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

    let mut removed = Vec::new();
    let mut skipped = Vec::new();
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

pub(crate) fn save_setup_config(
    app: &AppHandle,
    draft: SetupDraft,
    confirmed: bool,
) -> Result<SaveSetupResult, String> {
    if !confirmed {
        return Err(
            "This setup action needs confirmation before InnPilot can save configuration."
                .to_string(),
        );
    }

    let generated = GeneratedSetup::from_draft(&draft)?;
    let app_config_path = app_config_path(app)?;
    let automation_config_path =
        PathBuf::from(&generated.app_config.automation.automation_config_path);

    let automation_parent = automation_config_path
        .parent()
        .ok_or_else(|| "Automation setup file path is missing a parent folder.".to_string())?;
    if !automation_parent.exists() {
        return Err(
            "Automation setup folder is missing. Create the workspace folders before saving setup."
                .to_string(),
        );
    }
    if !automation_parent.is_dir() {
        return Err("Automation setup folder path is not a folder.".to_string());
    }

    if let Some(app_parent) = app_config_path.parent() {
        fs::create_dir_all(app_parent)
            .map_err(|error| format!("Could not prepare InnPilot setup folder: {error}"))?;
    }

    let mut backups = Vec::new();
    atomic_write_json_with_backup(&app_config_path, &generated.app_config, &mut backups)?;
    atomic_write_json_with_backup(
        &automation_config_path,
        &generated.automation_config,
        &mut backups,
    )?;

    Ok(SaveSetupResult {
        app_config_path: app_config_path.to_string_lossy().to_string(),
        automation_config_path: automation_config_path.to_string_lossy().to_string(),
        validation: preflight::build_preflight_report(&generated.app_config),
        backups,
    })
}

pub(crate) fn validate_setup(app: &AppHandle) -> Result<preflight::PreflightReport, String> {
    let config = config::ensure_config(app)?;
    Ok(preflight::build_preflight_report(&config))
}

#[derive(Debug)]
struct GeneratedSetup {
    workspace_base: PathBuf,
    folder_specs: Vec<FolderSpec>,
    app_config: HubConfig,
    automation_config: serde_json::Value,
    warnings: Vec<String>,
}

#[derive(Debug)]
struct FolderSpec {
    label: &'static str,
    path: PathBuf,
}

impl GeneratedSetup {
    fn from_draft(draft: &SetupDraft) -> Result<Self, String> {
        let workspace_base = clean_path(&draft.workspace_base)?;
        validate_workspace_base(&workspace_base)?;

        let year = if draft.contract_year.trim().is_empty() {
            Local::now().format("%Y").to_string()
        } else {
            draft.contract_year.trim().to_string()
        };

        let invoice_input = workspace_base.join("Invoices").join("Input");
        let invoice_output = workspace_base.join("Invoices").join("ReadyToSend");
        let invoice_archive = workspace_base.join("Invoices").join("Archive");
        let invoice_logs = workspace_base.join("Invoices").join("Logs");
        let gmail_token_folder = workspace_base.join("Gmail").join("Token");
        let gmail_credentials_folder = workspace_base.join("Gmail").join("Credentials");
        let scans_cache = workspace_base.join("Scans").join("IncomingCache");
        let default_scans_text = workspace_base.join("Scans").join("TextOutput");
        let contracts_output_default = workspace_base.join("Contracts").join(&year).join("Signed");
        let contracts_logs = workspace_base.join("Contracts").join("Logs");
        let support_diagnostics = workspace_base.join("Support").join("Diagnostics");
        let automation_config_folder = workspace_base.join("automation");

        let ocr_text_output = setup_path_or_default(
            &workspace_base,
            &draft.ocr_text_output_folder,
            default_scans_text.clone(),
        )?;
        let signed_contracts_output = setup_path_or_default(
            &workspace_base,
            &draft.signed_contracts_output_folder,
            contracts_output_default.clone(),
        )?;
        let shared_scan_folder = setup_path_or_default(
            &workspace_base,
            &draft.shared_scan_folder,
            scans_cache.clone(),
        )?;
        let gmail_token_file = setup_path_or_default(
            &workspace_base,
            &draft.gmail_token_file,
            gmail_token_folder.join("gmail_token.json"),
        )?;
        let gmail_credentials_file = setup_path_or_default(
            &workspace_base,
            &draft.gmail_credentials_file,
            gmail_credentials_folder.join("gmail_credentials.json"),
        )?;

        let folder_specs = vec![
            FolderSpec {
                label: "Invoices/Input",
                path: invoice_input.clone(),
            },
            FolderSpec {
                label: "Invoices/ReadyToSend",
                path: invoice_output.clone(),
            },
            FolderSpec {
                label: "Invoices/Archive",
                path: invoice_archive.clone(),
            },
            FolderSpec {
                label: "Invoices/Logs",
                path: invoice_logs.clone(),
            },
            FolderSpec {
                label: "Gmail/Token",
                path: gmail_token_folder,
            },
            FolderSpec {
                label: "Gmail/Credentials",
                path: gmail_credentials_folder,
            },
            FolderSpec {
                label: "Scans/IncomingCache",
                path: scans_cache.clone(),
            },
            FolderSpec {
                label: "Scans/TextOutput",
                path: ocr_text_output.clone(),
            },
            FolderSpec {
                label: "Contracts/<year>/Signed",
                path: signed_contracts_output.clone(),
            },
            FolderSpec {
                label: "Contracts/Logs",
                path: contracts_logs.clone(),
            },
            FolderSpec {
                label: "Support/Diagnostics",
                path: support_diagnostics,
            },
            FolderSpec {
                label: "automation",
                path: automation_config_folder.clone(),
            },
        ];

        for spec in &folder_specs {
            validate_setup_folder_path(&workspace_base, &spec.path)?;
        }

        let current = config::default_config();
        let python_executable = setup_python_executable(&draft.python_executable, &current);
        let automation_config_path = automation_config_folder.join("config.local.json");
        let automation_root = PathBuf::from(&current.automation.automation_root_folder);
        let canonical_scripts = config::canonical_script_paths(&automation_root);

        let app_config = HubConfig {
            schema_version: current.schema_version,
            client: ClientConfig {
                display_name: non_empty_or(&draft.hotel_display_name, "Your Hotel"),
            },
            invoice_delivery_mode: draft.invoice_delivery_mode.clone(),
            automation: AutomationConfig {
                automation_root_folder: current.automation.automation_root_folder,
                automation_config_path: automation_config_path.to_string_lossy().to_string(),
                python_executable,
            },
            scripts: ScriptPaths {
                invoice_workflow_script: canonical_scripts.invoice_workflow_script,
                gmail_draft_script: canonical_scripts.gmail_draft_script,
                copy_scansioni_script: current.scripts.copy_scansioni_script,
                ocr_preprocessing_script: current.scripts.ocr_preprocessing_script,
                contract_processing_script: canonical_scripts.contract_processing_script,
            },
            folders: FolderPaths {
                invoice_input_folder: invoice_input.to_string_lossy().to_string(),
                invoice_output_folder: invoice_output.to_string_lossy().to_string(),
                invoice_archive_folder: invoice_archive.to_string_lossy().to_string(),
                invoice_log_folder: invoice_logs.to_string_lossy().to_string(),
                scansioni_network_share: shared_scan_folder.to_string_lossy().to_string(),
                scansioni_local_cache_folder: scans_cache.to_string_lossy().to_string(),
                ocr_text_output_folder: ocr_text_output.to_string_lossy().to_string(),
                contracts_output_folder: signed_contracts_output.to_string_lossy().to_string(),
                contract_log_folder: contracts_logs.to_string_lossy().to_string(),
            },
            gmail: GmailConfig {
                token_path: gmail_token_file.to_string_lossy().to_string(),
            },
            safety: SafetyConfig {
                dry_run_default: draft.safe_mode,
                require_confirmation_for_file_moves: true,
                redact_logs: draft.redact_logs,
            },
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

        let invoice_input_patterns = normalized_list_or_default(
            &draft.invoice_input_patterns,
            "Funzione Pubblica amministrazione*.pdf",
        );
        let scanner_filename_prefixes =
            normalized_list_or_default(&draft.scanner_filename_prefixes, "Sharp MFP");
        let contract_marker_texts = normalized_list_or_default(
            &draft.contract_marker_texts,
            "Oggetto: Contratto di lavoro subordinato a tempo determinato",
        );
        let first_invoice_input_pattern = invoice_input_patterns
            .first()
            .cloned()
            .unwrap_or_else(|| "Funzione Pubblica amministrazione*.pdf".to_string());
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
                "gmailCredentialsFile": gmail_credentials_file.to_string_lossy().to_string(),
                "gmailTokenFile": app_config.gmail.token_path,
                "contractInputShortcut": "",
                "contractInputDir": app_config.folders.scansioni_network_share,
                "contractDestinationDir": app_config.folders.contracts_output_folder,
                "contractOcrTextDir": app_config.folders.ocr_text_output_folder,
                "contractLogDir": app_config.folders.contract_log_folder,
            },
            "gmail": {
                "subject": draft.gmail_subject.trim(),
                "ccEmail": draft.cc_email.trim(),
            },
            "invoice": {
                "deliveryMode": draft.invoice_delivery_mode,
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

fn app_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?;
    Ok(app_data_dir.join("config.json"))
}

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
    Ok(PathBuf::from(repair_concatenated_absolute_path(trimmed)))
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
    if path.is_absolute() || looks_like_windows_absolute(trimmed) {
        return Ok(path);
    }

    Ok(workspace_base.join(path))
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

        let preview = preview_setup(draft).unwrap();

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
        assert!(root.join("automation").is_dir());
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
    fn remove_setup_created_empty_folders_only_removes_empty_workspace_folders() {
        let root = temp_root("cleanup");
        let keep = root.join("Invoices").join("Input");
        let remove = root.join("Support").join("Diagnostics");
        fs::create_dir_all(&keep).unwrap();
        fs::create_dir_all(&remove).unwrap();
        fs::write(keep.join("keep.txt"), b"keep").unwrap();

        let result = remove_setup_created_empty_folders(
            root.to_string_lossy().to_string(),
            vec![
                keep.to_string_lossy().to_string(),
                remove.to_string_lossy().to_string(),
                temp_root("outside").to_string_lossy().to_string(),
            ],
            true,
        )
        .unwrap();

        assert!(remove.starts_with(&root));
        assert!(!remove.exists());
        assert!(keep.exists());
        assert_eq!(result.removed.len(), 1);
        assert_eq!(result.skipped.len(), 2);
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

        let error = preview_setup(draft).unwrap_err();

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
            generated.automation_config["invoice"]["deliveryMode"]
                .as_str()
                .unwrap(),
            "gmailDrafts"
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
            "automation",
        ] {
            assert!(labels.contains(&expected));
        }

        assert_eq!(
            generated.app_config.automation.automation_config_path,
            root.join("automation")
                .join("config.local.json")
                .to_string_lossy()
        );
        assert!(generated
            .app_config
            .automation
            .automation_root_folder
            .contains("automation"));
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

    fn draft_for_root(root: &Path) -> SetupDraft {
        SetupDraft {
            hotel_display_name: "Test Hotel".to_string(),
            email_signature_name: "Test Hotel Team".to_string(),
            workspace_base: root.to_string_lossy().to_string(),
            python_executable: r"C:\InnPilot\.venv\Scripts\python.exe".to_string(),
            invoice_delivery_mode: InvoiceDeliveryMode::GmailDrafts,
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
