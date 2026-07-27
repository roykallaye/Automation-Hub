use crate::config::{HubConfig, InvoiceDeliveryMode};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const PYTHON_CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const PACKAGED_WORKER_CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const DPAPI_SECRET_MAGIC: &[u8] = b"INNPILOT-DPAPI-SECRET-V1\n";

const PACKAGED_WORKER_PROBE_CACHE_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppConfigStatus {
    config_path: String,
    config: HubConfig,
    preflight: PreflightReport,
}

impl AppConfigStatus {
    pub(crate) fn new(config_path: String, config: HubConfig) -> Self {
        Self {
            preflight: build_preflight_report(&config),
            config_path,
            config,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreflightReport {
    checked_at: String,
    items: Vec<PreflightItem>,
    workflows: Vec<WorkflowPreflight>,
    dependencies: Vec<PreflightItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReadinessStatus {
    Ready,
    Warning,
    MissingConfiguration,
    MissingScript,
    MissingFolder,
    PermissionProblem,
    NotChecked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreflightItem {
    key: String,
    label: String,
    path: Option<String>,
    item_type: String,
    status: ReadinessStatus,
    message: String,
    readable: Option<bool>,
    writable: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowPreflight {
    key: String,
    label: String,
    command_name: Option<String>,
    status: ReadinessStatus,
    can_run: bool,
    message: String,
    check_keys: Vec<String>,
}

pub(crate) fn build_preflight_report(config: &HubConfig) -> PreflightReport {
    let engine_probe = python_package_probe(&config.automation.python_executable);
    let mut items = vec![
        automation_root_check(&config.automation.automation_root_folder),
        automation_config_check(&config.automation.automation_config_path),
        python_check(&config.automation.python_executable, &engine_probe),
        python_package_summary_check(&config.automation.python_executable, &engine_probe),
        script_check(
            "invoiceWorkflowScript",
            "Invoice workflow script",
            &config.scripts.invoice_workflow_script,
        ),
        script_check(
            "gmailDraftScript",
            "Gmail draft script",
            &config.scripts.gmail_draft_script,
        ),
        script_check(
            "copyScansioniScript",
            "Copy scansioni script",
            &config.scripts.copy_scansioni_script,
        ),
        script_check(
            "ocrPreprocessingScript",
            "OCR preprocessing script",
            &config.scripts.ocr_preprocessing_script,
        ),
        ocr_language_data_check(config),
        script_check(
            "contractProcessingScript",
            "Contract processing script",
            &config.scripts.contract_processing_script,
        ),
        safe_mode_support_check(
            "invoiceSafeModeSupport",
            "Invoice safe-mode support",
            config.safety.dry_run_default,
            if config.invoice_delivery_mode == InvoiceDeliveryMode::GmailDrafts {
                vec![
                    &config.scripts.invoice_workflow_script,
                    &config.scripts.gmail_draft_script,
                ]
            } else {
                vec![&config.scripts.invoice_workflow_script]
            },
        ),
        safe_mode_support_check(
            "gmailSafeModeSupport",
            "Gmail safe-mode support",
            config.safety.dry_run_default,
            vec![&config.scripts.gmail_draft_script],
        ),
        safe_mode_support_check(
            "scanCopySafeModeSupport",
            "Scan-copy safe-mode support",
            config.safety.dry_run_default,
            vec![&config.scripts.copy_scansioni_script],
        ),
        safe_mode_support_check(
            "ocrSafeModeSupport",
            "Document-reading safe-mode support",
            config.safety.dry_run_default,
            vec![&config.scripts.ocr_preprocessing_script],
        ),
        safe_mode_support_check(
            "contractsSafeModeSupport",
            "Contracts safe-mode support",
            config.safety.dry_run_default,
            vec![
                &config.scripts.copy_scansioni_script,
                &config.scripts.ocr_preprocessing_script,
                &config.scripts.contract_processing_script,
            ],
        ),
        folder_check(
            "invoiceInputFolder",
            "Invoice input folder",
            &config.folders.invoice_input_folder,
            true,
            true,
        ),
        folder_check(
            "invoiceOutputFolder",
            "Invoice output folder",
            &config.folders.invoice_output_folder,
            true,
            true,
        ),
        folder_check(
            "invoiceArchiveFolder",
            "Invoice archive folder",
            &config.folders.invoice_archive_folder,
            true,
            true,
        ),
        folder_check(
            "invoiceLogFolder",
            "Invoice log folder",
            &config.folders.invoice_log_folder,
            true,
            true,
        ),
        folder_check(
            "scansioniNetworkShare",
            "Scansioni network share",
            &config.folders.scansioni_network_share,
            true,
            false,
        ),
        folder_check(
            "scansioniLocalCacheFolder",
            "Scansioni local cache folder",
            &config.folders.scansioni_local_cache_folder,
            true,
            true,
        ),
        folder_check(
            "ocrTextOutputFolder",
            "OCR text output folder",
            &config.folders.ocr_text_output_folder,
            true,
            true,
        ),
        folder_check(
            "contractsOutputFolder",
            "Contracts output folder",
            &config.folders.contracts_output_folder,
            true,
            true,
        ),
        folder_check(
            "contractLogFolder",
            "Contract log folder",
            &config.folders.contract_log_folder,
            true,
            true,
        ),
        gmail_credentials_file_check(config),
        token_check("gmailTokenPath", "Gmail token", &config.gmail.token_path),
        token_parent_folder_check(&config.gmail.token_path),
        invoice_delivery_mode_check(&config.invoice_delivery_mode),
        profile_check(&config.client.display_name),
    ];
    items.extend(automation_alignment_checks(config));

    let mut dependencies = vec![
        dependency_unknown("cmdExe", "cmd.exe"),
        dependency_unknown("powershellExe", "powershell.exe"),
        dependency_unknown("explorerExe", "explorer.exe"),
        dependency_unknown(
            "externalScriptDependencies",
            "PDF/OCR/Gmail dependencies used by external scripts",
        ),
    ];
    dependencies.extend(python_package_dependency_checks(
        &config.automation.python_executable,
        &engine_probe,
    ));

    let workflows = workflow_preflight(config, &items, &dependencies);
    items.sort_by(|left, right| left.key.cmp(&right.key));
    dependencies.sort_by(|left, right| left.key.cmp(&right.key));

    PreflightReport {
        checked_at: Local::now().to_rfc3339(),
        items,
        workflows,
        dependencies,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationFileConfig {
    paths: Option<AutomationFilePaths>,
    ocr: Option<AutomationFileOcr>,
    invoice: Option<AutomationFileInvoice>,
    safety: Option<AutomationFileSafety>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationFilePaths {
    invoice_input_dir: Option<String>,
    invoice_output_dir: Option<String>,
    invoice_archive_dir: Option<String>,
    invoice_log_dir: Option<String>,
    gmail_credentials_file: Option<String>,
    gmail_token_file: Option<String>,
    scan_source_dir: Option<String>,
    scan_cache_dir: Option<String>,
    contract_input_dir: Option<String>,
    contract_destination_dir: Option<String>,
    contract_ocr_text_dir: Option<String>,
    contract_log_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationFileInvoice {
    file_selection_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationFileOcr {
    languages: Option<Vec<String>>,
    tessdata_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationFileSafety {
    dry_run_default: Option<bool>,
}

#[derive(Debug)]
struct AlignmentMismatch {
    app_field: &'static str,
    automation_field: &'static str,
    blocking: bool,
}

fn automation_alignment_checks(config: &HubConfig) -> Vec<PreflightItem> {
    let path = config.automation.automation_config_path.trim();
    if path.is_empty() || !Path::new(path).is_file() {
        return Vec::new();
    }

    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) => {
            return vec![automation_alignment_error(
                Some(path),
                &format!(
                    "Automation setup file could not be read. Ask setup support to update the configuration. Error: {error}"
                ),
            )]
        }
    };

    let automation_config: AutomationFileConfig = match serde_json::from_str(&contents) {
        Ok(config) => config,
        Err(error) => {
            return vec![automation_alignment_error(
                Some(path),
                &format!(
                    "Automation setup file is not valid JSON. Ask setup support to update the configuration. Error: {error}"
                ),
            )]
        }
    };

    let mut mismatches = Vec::new();
    if let Some(paths) = automation_config.paths.as_ref() {
        compare_path(
            &mut mismatches,
            "gmail.tokenPath",
            &config.gmail.token_path,
            "paths.gmailTokenFile",
            paths.gmail_token_file.as_deref(),
            true,
        );
        compare_path(
            &mut mismatches,
            "folders.invoiceInputFolder",
            &config.folders.invoice_input_folder,
            "paths.invoiceInputDir",
            paths.invoice_input_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.invoiceOutputFolder",
            &config.folders.invoice_output_folder,
            "paths.invoiceOutputDir",
            paths.invoice_output_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.invoiceArchiveFolder",
            &config.folders.invoice_archive_folder,
            "paths.invoiceArchiveDir",
            paths.invoice_archive_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.invoiceLogFolder",
            &config.folders.invoice_log_folder,
            "paths.invoiceLogDir",
            paths.invoice_log_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.scansioniNetworkShare",
            &config.folders.scansioni_network_share,
            "paths.scanSourceDir",
            paths.scan_source_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.scansioniLocalCacheFolder",
            &config.folders.scansioni_local_cache_folder,
            "paths.scanCacheDir",
            paths.scan_cache_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.scansioniLocalCacheFolder",
            &config.folders.scansioni_local_cache_folder,
            "paths.contractInputDir",
            paths.contract_input_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.ocrTextOutputFolder",
            &config.folders.ocr_text_output_folder,
            "paths.contractOcrTextDir",
            paths.contract_ocr_text_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.contractsOutputFolder",
            &config.folders.contracts_output_folder,
            "paths.contractDestinationDir",
            paths.contract_destination_dir.as_deref(),
            false,
        );
        compare_path(
            &mut mismatches,
            "folders.contractLogFolder",
            &config.folders.contract_log_folder,
            "paths.contractLogDir",
            paths.contract_log_dir.as_deref(),
            false,
        );
    }

    if let Some(invoice) = automation_config.invoice.as_ref() {
        if let Some(file_selection_mode) = invoice.file_selection_mode.as_deref() {
            let app_mode = serde_json::to_value(&config.invoice_file_selection_mode)
                .ok()
                .and_then(|value| value.as_str().map(ToOwned::to_owned))
                .unwrap_or_default();
            if file_selection_mode != app_mode {
                mismatches.push(AlignmentMismatch {
                    app_field: "invoiceFileSelectionMode",
                    automation_field: "invoice.fileSelectionMode",
                    blocking: false,
                });
            }
        }
    }

    if let Some(safety) = automation_config.safety.as_ref() {
        if let Some(dry_run_default) = safety.dry_run_default {
            if dry_run_default != config.safety.dry_run_default {
                mismatches.push(AlignmentMismatch {
                    app_field: "safety.dryRunDefault",
                    automation_field: "safety.dryRunDefault",
                    blocking: false,
                });
            }
        }
    }

    if mismatches.is_empty() {
        return vec![PreflightItem {
            key: "configAlignment".to_string(),
            label: "Config alignment".to_string(),
            path: None,
            item_type: "alignment".to_string(),
            status: ReadinessStatus::Ready,
            message: "InnPilot setup and automation setup match.".to_string(),
            readable: None,
            writable: None,
        }];
    }

    let field_list = mismatch_field_list(&mismatches);
    let mut items = vec![PreflightItem {
        key: "configAlignment".to_string(),
        label: "Config alignment".to_string(),
        path: None,
        item_type: "alignment".to_string(),
        status: ReadinessStatus::Warning,
        message: format!(
            "InnPilot setup and automation setup do not match. Ask setup support to update the configuration. Mismatched fields: {field_list}."
        ),
        readable: None,
        writable: None,
    }];

    let gmail_mismatch = mismatches
        .iter()
        .filter(|mismatch| mismatch.blocking)
        .map(|mismatch| format!("{} / {}", mismatch.app_field, mismatch.automation_field))
        .collect::<Vec<_>>();
    if !gmail_mismatch.is_empty() {
        items.push(PreflightItem {
            key: "gmailTokenAlignment".to_string(),
            label: "Gmail token alignment".to_string(),
            path: None,
            item_type: "alignment".to_string(),
            status: ReadinessStatus::PermissionProblem,
            message: format!(
                "InnPilot setup and automation setup do not match. Ask setup support to update the configuration. Mismatched fields: {}.",
                gmail_mismatch.join(", ")
            ),
            readable: None,
            writable: None,
        });
    }

    items
}

fn automation_alignment_error(path: Option<&str>, message: &str) -> PreflightItem {
    PreflightItem {
        key: "automationConfigAlignment".to_string(),
        label: "Automation setup validation".to_string(),
        path: path.map(str::to_string),
        item_type: "alignment".to_string(),
        status: ReadinessStatus::MissingConfiguration,
        message: message.to_string(),
        readable: None,
        writable: None,
    }
}

fn compare_path(
    mismatches: &mut Vec<AlignmentMismatch>,
    app_field: &'static str,
    app_value: &str,
    automation_field: &'static str,
    automation_value: Option<&str>,
    blocking: bool,
) {
    let Some(automation_value) = automation_value else {
        return;
    };
    if app_value.trim().is_empty() || automation_value.trim().is_empty() {
        return;
    }
    if normalize_for_compare(app_value) != normalize_for_compare(automation_value) {
        mismatches.push(AlignmentMismatch {
            app_field,
            automation_field,
            blocking,
        });
    }
}

fn normalize_for_compare(path: &str) -> String {
    path.trim()
        .trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_lowercase()
}

fn mismatch_field_list(mismatches: &[AlignmentMismatch]) -> String {
    mismatches
        .iter()
        .map(|mismatch| format!("{} / {}", mismatch.app_field, mismatch.automation_field))
        .collect::<Vec<_>>()
        .join(", ")
}

fn automation_config_check(path: &str) -> PreflightItem {
    if path.trim().is_empty() {
        return PreflightItem {
            key: "automationConfigPath".to_string(),
            label: "Automation setup file".to_string(),
            path: None,
            item_type: "config".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Automation setup file is missing. Ask setup support to select or create it."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    let config_path = Path::new(path);
    if !config_path.exists() {
        return PreflightItem {
            key: "automationConfigPath".to_string(),
            label: "Automation setup file".to_string(),
            path: Some(path.to_string()),
            item_type: "config".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Automation setup file is missing. Ask setup support to select or create it."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    if !config_path.is_file() {
        return PreflightItem {
            key: "automationConfigPath".to_string(),
            label: "Automation setup file".to_string(),
            path: Some(path.to_string()),
            item_type: "config".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Automation setup path is not a file. Ask setup support to update InnPilot configuration."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    PreflightItem {
        key: "automationConfigPath".to_string(),
        label: "Automation setup file".to_string(),
        path: Some(path.to_string()),
        item_type: "config".to_string(),
        status: ReadinessStatus::Ready,
        message: "Automation setup file found.".to_string(),
        readable: Some(true),
        writable: None,
    }
}

fn automation_root_check(path: &str) -> PreflightItem {
    if path.trim().is_empty() {
        return PreflightItem {
            key: "automationRootFolder".to_string(),
            label: "Automation scripts folder".to_string(),
            path: None,
            item_type: "config".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message:
                "Automation scripts folder is not configured. Ask setup support to update InnPilot."
                    .to_string(),
            readable: None,
            writable: None,
        };
    }

    let root = Path::new(path);
    if !root.exists() {
        return PreflightItem {
            key: "automationRootFolder".to_string(),
            label: "Automation scripts folder".to_string(),
            path: Some(path.to_string()),
            item_type: "config".to_string(),
            status: ReadinessStatus::MissingFolder,
            message:
                "Automation scripts folder is missing. Ask setup support to install or select it."
                    .to_string(),
            readable: None,
            writable: None,
        };
    }

    if !root.is_dir() {
        return PreflightItem {
            key: "automationRootFolder".to_string(),
            label: "Automation scripts folder".to_string(),
            path: Some(path.to_string()),
            item_type: "config".to_string(),
            status: ReadinessStatus::MissingFolder,
            message:
                "Automation scripts path is not a folder. Ask setup support to update InnPilot."
                    .to_string(),
            readable: None,
            writable: None,
        };
    }

    PreflightItem {
        key: "automationRootFolder".to_string(),
        label: "Automation scripts folder".to_string(),
        path: Some(path.to_string()),
        item_type: "config".to_string(),
        status: ReadinessStatus::Ready,
        message: "Automation scripts folder found.".to_string(),
        readable: Some(true),
        writable: None,
    }
}

fn profile_check(display_name: &str) -> PreflightItem {
    if display_name.trim().is_empty() {
        PreflightItem {
            key: "clientProfile".to_string(),
            label: "Hotel profile".to_string(),
            path: None,
            item_type: "profile".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Hotel display name is missing from config.".to_string(),
            readable: None,
            writable: None,
        }
    } else {
        PreflightItem {
            key: "clientProfile".to_string(),
            label: "Hotel profile".to_string(),
            path: None,
            item_type: "profile".to_string(),
            status: ReadinessStatus::Ready,
            message: format!("Configured for {display_name}."),
            readable: None,
            writable: None,
        }
    }
}

fn invoice_delivery_mode_check(mode: &InvoiceDeliveryMode) -> PreflightItem {
    match mode {
        InvoiceDeliveryMode::PrepareOnly => PreflightItem {
            key: "invoiceDeliveryMode".to_string(),
            label: "Invoice delivery mode".to_string(),
            path: None,
            item_type: "config".to_string(),
            status: ReadinessStatus::Ready,
            message: "InnPilot will prepare invoice files only. Gmail is not required.".to_string(),
            readable: None,
            writable: None,
        },
        InvoiceDeliveryMode::GmailDrafts => PreflightItem {
            key: "invoiceDeliveryMode".to_string(),
            label: "Invoice delivery mode".to_string(),
            path: None,
            item_type: "config".to_string(),
            status: ReadinessStatus::Ready,
            message: "InnPilot will create Gmail drafts. No emails are sent automatically."
                .to_string(),
            readable: None,
            writable: None,
        },
        InvoiceDeliveryMode::SendAutomatically => PreflightItem {
            key: "invoiceDeliveryMode".to_string(),
            label: "Invoice delivery mode".to_string(),
            path: None,
            item_type: "config".to_string(),
            status: ReadinessStatus::PermissionProblem,
            message: "Automatic email sending is not enabled yet. Choose Prepare files only or Create Gmail drafts."
                .to_string(),
            readable: None,
            writable: None,
        },
    }
}

fn is_innpilot_worker(executable: &str) -> bool {
    crate::worker_runtime::is_innpilot_worker(executable)
}

fn automation_engine_check_timeout(executable: &str) -> Duration {
    if is_innpilot_worker(executable) {
        PACKAGED_WORKER_CHECK_TIMEOUT
    } else {
        PYTHON_CHECK_TIMEOUT
    }
}

fn python_check(python_executable: &str, probe: &PythonPackageProbe) -> PreflightItem {
    if python_executable.trim().is_empty() {
        return PreflightItem {
            key: "pythonExecutable".to_string(),
            label: "Automation engine".to_string(),
            path: None,
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message:
                "The automation engine is not configured. Ask setup support to repair InnPilot."
                    .to_string(),
            readable: None,
            writable: None,
        };
    }

    let bundled_worker = is_innpilot_worker(python_executable);
    if bundled_worker {
        let (status, message) = match probe {
            PythonPackageProbe::Ready => (
                ReadinessStatus::Ready,
                "Private InnPilot automation engine ready.".to_string(),
            ),
            PythonPackageProbe::IntegrityFailed => (
                ReadinessStatus::PermissionProblem,
                "The private automation engine failed its integrity check. Reinstall InnPilot."
                    .to_string(),
            ),
            PythonPackageProbe::TimedOut => (
                ReadinessStatus::MissingConfiguration,
                "Automation engine check timed out. Ask setup support to repair InnPilot."
                    .to_string(),
            ),
            PythonPackageProbe::PythonUnavailable => (
                ReadinessStatus::MissingConfiguration,
                "The private automation engine was not found. Reinstall InnPilot.".to_string(),
            ),
            PythonPackageProbe::NotConfigured => (
                ReadinessStatus::MissingConfiguration,
                "The automation engine is not configured. Ask setup support to repair InnPilot."
                    .to_string(),
            ),
            PythonPackageProbe::Missing(_) | PythonPackageProbe::CheckFailed => (
                ReadinessStatus::MissingConfiguration,
                "The private automation engine failed its readiness check. Reinstall InnPilot."
                    .to_string(),
            ),
        };
        return PreflightItem {
            key: "pythonExecutable".to_string(),
            label: "Automation engine".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status,
            message,
            readable: None,
            writable: None,
        };
    }

    let status = command_output_with_timeout(
        python_executable,
        &["--version"],
        automation_engine_check_timeout(python_executable),
    );

    match status {
        Ok(output) if output.status.success() => {
            let version = python_version_from_output(&output.stdout, &output.stderr);
            PreflightItem {
                key: "pythonExecutable".to_string(),
                label: "Automation engine".to_string(),
                path: Some(python_executable.to_string()),
                item_type: "dependency".to_string(),
                status: ReadinessStatus::Ready,
                message: format!("External Python found: {version}."),
                readable: None,
                writable: None,
            }
        }
        Err(TimedCommandError::Timeout) => PreflightItem {
            key: "pythonExecutable".to_string(),
            label: "Automation engine".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Automation engine check timed out. Ask setup support to repair InnPilot.".to_string(),
            readable: None,
            writable: None,
        },
        _ => PreflightItem {
            key: "pythonExecutable".to_string(),
            label: "Automation engine".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "The automation engine was not found. Reinstall InnPilot or ask setup support to repair it."
                .to_string(),
            readable: None,
            writable: None,
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TimedCommandError {
    Io,
    Timeout,
}

fn command_output_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<Output, TimedCommandError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command.spawn().map_err(|_| TimedCommandError::Io)?;
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait().map_err(|_| TimedCommandError::Io)? {
            Some(_) => return child.wait_with_output().map_err(|_| TimedCommandError::Io),
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(TimedCommandError::Timeout);
            }
            None => thread::sleep(Duration::from_millis(25)),
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct RequiredPythonPackage {
    key: &'static str,
    module: &'static str,
    label: &'static str,
    ready_message: &'static str,
    missing_message: &'static str,
}

const REQUIRED_PYTHON_PACKAGES: &[RequiredPythonPackage] = &[
    RequiredPythonPackage {
        key: "pythonPackagePypdf",
        module: "pypdf",
        label: "Invoice PDF tools",
        ready_message: "Invoice PDF tools installed.",
        missing_message: "The managed PDF tools are needed to prepare invoice copies.",
    },
    RequiredPythonPackage {
        key: "pythonPackagePdfium",
        module: "pypdfium2",
        label: "Local PDF renderer",
        ready_message: "Local PDF renderer installed.",
        missing_message: "The local PDF renderer is needed to read invoices and scanned pages.",
    },
    RequiredPythonPackage {
        key: "pythonPackagePillow",
        module: "PIL",
        label: "Local OCR image tools",
        ready_message: "Local OCR image tools installed.",
        missing_message: "The local OCR image tools are needed to read scanned pages.",
    },
    RequiredPythonPackage {
        key: "pythonPackageGoogleApi",
        module: "googleapiclient",
        label: "Gmail draft library",
        ready_message: "Gmail draft library installed.",
        missing_message: "Google API libraries are needed to create Gmail drafts.",
    },
    RequiredPythonPackage {
        key: "pythonPackageGoogleAuthOauthlib",
        module: "google_auth_oauthlib",
        label: "Gmail sign-in library",
        ready_message: "Gmail sign-in library installed.",
        missing_message: "Google sign-in libraries are needed to reconnect Gmail.",
    },
];

#[derive(Debug, Clone)]
enum PythonPackageProbe {
    NotConfigured,
    IntegrityFailed,
    PythonUnavailable,
    TimedOut,
    Ready,
    Missing(Vec<String>),
    CheckFailed,
}

#[derive(Debug, Clone)]
struct CachedPackagedWorkerProbe {
    path: PathBuf,
    digest: String,
    checked_at: Instant,
    result: PythonPackageProbe,
}

static PACKAGED_WORKER_PROBE_CACHE: OnceLock<Mutex<Option<CachedPackagedWorkerProbe>>> =
    OnceLock::new();

fn python_package_probe(python_executable: &str) -> PythonPackageProbe {
    if python_executable.trim().is_empty() {
        return PythonPackageProbe::NotConfigured;
    }
    if is_innpilot_worker(python_executable) {
        return packaged_worker_probe(python_executable);
    }

    let required_modules = REQUIRED_PYTHON_PACKAGES
        .iter()
        .map(|package| format!("'{}'", package.module))
        .collect::<Vec<_>>()
        .join(",");
    let script = format!(
        "import importlib.util, sys; required=[{required_modules}]; missing=[name for name in required if importlib.util.find_spec(name) is None]; print(', '.join(missing)); sys.exit(1 if missing else 0)"
    );
    let output = command_output_with_timeout(
        python_executable,
        &["-c", &script],
        automation_engine_check_timeout(python_executable),
    );

    match output {
        Ok(output) if output.status.success() => PythonPackageProbe::Ready,
        Ok(output) => {
            let missing = String::from_utf8_lossy(&output.stdout)
                .split(',')
                .map(str::trim)
                .filter(|module| !module.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>();
            if missing.is_empty() {
                PythonPackageProbe::CheckFailed
            } else {
                PythonPackageProbe::Missing(missing)
            }
        }
        Err(TimedCommandError::Timeout) => PythonPackageProbe::TimedOut,
        Err(TimedCommandError::Io) => PythonPackageProbe::PythonUnavailable,
    }
}

fn packaged_worker_probe(python_executable: &str) -> PythonPackageProbe {
    let digest = match crate::worker_runtime::verified_worker_digest(python_executable) {
        Ok(Some(digest)) => digest,
        Ok(None) | Err(_) => return PythonPackageProbe::IntegrityFailed,
    };
    let path = Path::new(python_executable)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(python_executable));
    let cache = PACKAGED_WORKER_PROBE_CACHE.get_or_init(|| Mutex::new(None));
    let mut cache = match cache.lock() {
        Ok(cache) => cache,
        Err(_) => return PythonPackageProbe::CheckFailed,
    };
    if let Some(cached) = cache.as_ref() {
        if cached.path == path
            && cached.digest == digest
            && cached.checked_at.elapsed() <= PACKAGED_WORKER_PROBE_CACHE_TTL
        {
            return cached.result.clone();
        }
    }

    let result = match command_output_with_timeout(
        python_executable,
        &["--health-check"],
        automation_engine_check_timeout(python_executable),
    ) {
        Ok(output) if output.status.success() => PythonPackageProbe::Ready,
        Ok(_) => PythonPackageProbe::CheckFailed,
        Err(TimedCommandError::Timeout) => PythonPackageProbe::TimedOut,
        Err(TimedCommandError::Io) => PythonPackageProbe::PythonUnavailable,
    };
    if matches!(result, PythonPackageProbe::Ready) {
        *cache = Some(CachedPackagedWorkerProbe {
            path,
            digest,
            checked_at: Instant::now(),
            result: result.clone(),
        });
    } else {
        *cache = None;
    }
    result
}

fn python_package_summary_check(
    python_executable: &str,
    probe: &PythonPackageProbe,
) -> PreflightItem {
    match probe {
        PythonPackageProbe::NotConfigured => PreflightItem {
            key: "pythonPackages".to_string(),
            label: "Python packages".to_string(),
            path: None,
            item_type: "dependency".to_string(),
            status: ReadinessStatus::NotChecked,
            message: "Python packages can be checked after Python is configured.".to_string(),
            readable: None,
            writable: None,
        },
        PythonPackageProbe::IntegrityFailed => PreflightItem {
            key: "pythonPackages".to_string(),
            label: "Python packages".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::PermissionProblem,
            message:
                "The private automation engine failed its integrity check. Reinstall InnPilot."
                    .to_string(),
            readable: None,
            writable: None,
        },
        PythonPackageProbe::PythonUnavailable => PreflightItem {
            key: "pythonPackages".to_string(),
            label: "Python packages".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::NotChecked,
            message: "Python packages could not be checked because Python is not available."
                .to_string(),
            readable: None,
            writable: None,
        },
        PythonPackageProbe::TimedOut => PreflightItem {
            key: "pythonPackages".to_string(),
            label: "Python packages".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Python check timed out. Choose a working Python executable.".to_string(),
            readable: None,
            writable: None,
        },
        PythonPackageProbe::Ready => PreflightItem {
            key: "pythonPackages".to_string(),
            label: "Python packages".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::Ready,
            message: "Required Python packages are installed.".to_string(),
            readable: None,
            writable: None,
        },
        PythonPackageProbe::Missing(missing) => PreflightItem {
            key: "pythonPackages".to_string(),
            label: "Python packages".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: format!(
                "Install the Python packages needed by InnPilot automations. Missing modules: {}.",
                missing.join(", ")
            ),
            readable: None,
            writable: None,
        },
        PythonPackageProbe::CheckFailed => PreflightItem {
            key: "pythonPackages".to_string(),
            label: "Python packages".to_string(),
            path: Some(python_executable.to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Required Python packages could not be checked. Ask setup support to install automation requirements.".to_string(),
            readable: None,
            writable: None,
        },
    }
}

fn python_package_dependency_checks(
    python_executable: &str,
    probe: &PythonPackageProbe,
) -> Vec<PreflightItem> {
    REQUIRED_PYTHON_PACKAGES
        .iter()
        .map(|package| {
            let missing = match probe {
                PythonPackageProbe::Missing(missing) => missing
                    .iter()
                    .any(|module| module.eq_ignore_ascii_case(package.module)),
                _ => false,
            };
            let (status, message) = match probe {
                PythonPackageProbe::NotConfigured => (
                    ReadinessStatus::NotChecked,
                    "Choose a Python executable before checking this package.".to_string(),
                ),
                PythonPackageProbe::IntegrityFailed => (
                    ReadinessStatus::PermissionProblem,
                    "The private automation engine failed its integrity check. Reinstall InnPilot."
                        .to_string(),
                ),
                PythonPackageProbe::PythonUnavailable => (
                    ReadinessStatus::NotChecked,
                    "Python was not found, so this package was not checked.".to_string(),
                ),
                PythonPackageProbe::TimedOut => (
                    ReadinessStatus::MissingConfiguration,
                    "Python check timed out. Choose a working Python executable.".to_string(),
                ),
                PythonPackageProbe::Ready => {
                    (ReadinessStatus::Ready, package.ready_message.to_string())
                }
                PythonPackageProbe::Missing(_) if missing => (
                    ReadinessStatus::MissingConfiguration,
                    package.missing_message.to_string(),
                ),
                PythonPackageProbe::Missing(_) => {
                    (ReadinessStatus::Ready, package.ready_message.to_string())
                }
                PythonPackageProbe::CheckFailed => (
                    ReadinessStatus::NotChecked,
                    "This Python package could not be checked.".to_string(),
                ),
            };

            PreflightItem {
                key: package.key.to_string(),
                label: package.label.to_string(),
                path: Some(python_executable.to_string()),
                item_type: "dependency".to_string(),
                status,
                message,
                readable: None,
                writable: None,
            }
        })
        .collect()
}

fn python_version_from_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    "available".to_string()
}

fn script_check(key: &str, label: &str, path: &str) -> PreflightItem {
    if path.trim().is_empty() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: None,
            item_type: "script".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Script path is not configured.".to_string(),
            readable: None,
            writable: None,
        };
    }

    let script_path = Path::new(path);
    if !script_path.exists() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: Some(path.to_string()),
            item_type: "script".to_string(),
            status: ReadinessStatus::MissingScript,
            message: script_missing_message(key),
            readable: None,
            writable: None,
        };
    }

    if !script_path.is_file() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: Some(path.to_string()),
            item_type: "script".to_string(),
            status: ReadinessStatus::MissingScript,
            message: "Setup needs attention. The configured automation script path is not a script file. Ask setup support to update InnPilot configuration.".to_string(),
            readable: None,
            writable: None,
        };
    }

    PreflightItem {
        key: key.to_string(),
        label: label.to_string(),
        path: Some(path.to_string()),
        item_type: "script".to_string(),
        status: ReadinessStatus::Ready,
        message: "Script file found.".to_string(),
        readable: Some(true),
        writable: None,
    }
}

fn safe_mode_support_check(
    key: &str,
    label: &str,
    safe_mode_enabled: bool,
    script_paths: Vec<&String>,
) -> PreflightItem {
    let unsupported = script_paths
        .into_iter()
        .filter(|path| !script_supports_safe_mode(path))
        .filter_map(|path| {
            Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .collect::<Vec<_>>();

    if !safe_mode_enabled || unsupported.is_empty() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: None,
            item_type: "safety".to_string(),
            status: ReadinessStatus::Ready,
            message: if safe_mode_enabled {
                "Every worker in this workflow has verified preview support.".to_string()
            } else {
                "Safe mode is off. Live runs still require confirmation.".to_string()
            },
            readable: None,
            writable: None,
        };
    }

    PreflightItem {
        key: key.to_string(),
        label: label.to_string(),
        path: None,
        item_type: "safety".to_string(),
        status: ReadinessStatus::MissingConfiguration,
        message: format!(
            "Safe mode blocked this workflow because these legacy workers cannot prove they support preview-only runs: {}. Install managed workers or have setup support review the legacy scripts before switching to live mode.",
            unsupported.join(", ")
        ),
        readable: None,
        writable: None,
    }
}

fn script_supports_safe_mode(path: &str) -> bool {
    let Some(name) = Path::new(path).file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    matches!(
        name.to_ascii_lowercase().as_str(),
        "process_fatture.py"
            | "create_gmail_draft.py"
            | "process_contratti.py"
            | "copy_scans.py"
            | "extract_scan_text.py"
    )
}

#[cfg(test)]
mod safe_mode_tests {
    use super::*;

    #[test]
    fn canonical_workers_are_safe_mode_aware_but_legacy_wrappers_are_not() {
        assert!(script_supports_safe_mode(
            r"C:\InnPilot\automation\invoices\process_fatture.py"
        ));
        assert!(script_supports_safe_mode(
            r"C:\InnPilot\automation\contracts\process_contratti.py"
        ));
        assert!(!script_supports_safe_mode(r"C:\Hotel\run_invoices.cmd"));
        assert!(!script_supports_safe_mode(r"C:\Hotel\ocr.ps1"));
    }

    #[test]
    fn safe_mode_check_blocks_unknown_legacy_workers() {
        let legacy = r"C:\Hotel\copy_scans.cmd".to_string();
        let check = safe_mode_support_check(
            "fixtureSafeModeSupport",
            "Fixture safe-mode support",
            true,
            vec![&legacy],
        );

        assert_eq!(check.status, ReadinessStatus::MissingConfiguration);
        assert!(check.message.contains("copy_scans.cmd"));
    }
}

fn folder_check(
    key: &str,
    label: &str,
    path: &str,
    require_read: bool,
    require_write: bool,
) -> PreflightItem {
    if path.trim().is_empty() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: None,
            item_type: "folder".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Folder path is not configured.".to_string(),
            readable: None,
            writable: None,
        };
    }

    let folder_path = Path::new(path);
    if !folder_path.exists() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: Some(path.to_string()),
            item_type: "folder".to_string(),
            status: ReadinessStatus::MissingFolder,
            message: folder_missing_message(key),
            readable: None,
            writable: None,
        };
    }

    if !folder_path.is_dir() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: Some(path.to_string()),
            item_type: "folder".to_string(),
            status: ReadinessStatus::MissingFolder,
            message: "Setup needs attention. The configured path is not a folder. Ask setup support to update InnPilot configuration.".to_string(),
            readable: None,
            writable: None,
        };
    }

    let readable = require_read.then(|| fs::read_dir(folder_path).is_ok());
    let writable = require_write.then(|| can_write_to_folder(folder_path));
    let has_read_problem = readable == Some(false);
    let has_write_problem = writable == Some(false);

    if has_read_problem || has_write_problem {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: Some(path.to_string()),
            item_type: "folder".to_string(),
            status: ReadinessStatus::PermissionProblem,
            message: folder_permission_message(key),
            readable,
            writable,
        };
    }

    PreflightItem {
        key: key.to_string(),
        label: label.to_string(),
        path: Some(path.to_string()),
        item_type: "folder".to_string(),
        status: ReadinessStatus::Ready,
        message: "Folder found and permissions look usable.".to_string(),
        readable,
        writable,
    }
}

fn script_missing_message(key: &str) -> String {
    let script_name = match key {
        "invoiceWorkflowScript" => "invoice automation script",
        "gmailDraftScript" => "Gmail draft script",
        "copyScansioniScript" => "scanned-document copy script",
        "ocrPreprocessingScript" => "OCR preprocessing script",
        "contractProcessingScript" => "contract processing script",
        _ => "automation script",
    };
    format!(
        "Setup needs attention. The {script_name} is missing. Ask setup support to update InnPilot configuration."
    )
}

fn folder_missing_message(key: &str) -> String {
    let folder_name = match key {
        "invoiceInputFolder" => "folder used for incoming invoice PDFs",
        "invoiceOutputFolder" => "folder used for ready invoice files",
        "invoiceArchiveFolder" => "invoice archive folder",
        "invoiceLogFolder" => "invoice log folder",
        "scansioniNetworkShare" => "folder used for scanned documents",
        "scansioniLocalCacheFolder" => "local scanned-document cache folder",
        "ocrTextOutputFolder" => "OCR text output folder",
        "contractsOutputFolder" => "signed contracts output folder",
        "contractLogFolder" => "contract log folder",
        _ => "configured folder",
    };
    format!(
        "Setup needs attention. The {folder_name} is missing or not reachable. Ask setup support to update InnPilot configuration."
    )
}

fn folder_permission_message(key: &str) -> String {
    let folder_name = match key {
        "scansioniNetworkShare" => "folder used for scanned documents",
        "invoiceInputFolder" => "folder used for incoming invoice PDFs",
        "invoiceOutputFolder" => "folder used for ready invoice files",
        "invoiceArchiveFolder" => "invoice archive folder",
        "invoiceLogFolder" => "invoice log folder",
        "scansioniLocalCacheFolder" => "local scanned-document cache folder",
        "ocrTextOutputFolder" => "OCR text output folder",
        "contractsOutputFolder" => "signed contracts output folder",
        "contractLogFolder" => "contract log folder",
        _ => "configured folder",
    };
    format!(
        "Setup needs attention. InnPilot cannot read or write the {folder_name}. Ask setup support to check folder permissions."
    )
}

fn ocr_language_data_check(config: &HubConfig) -> PreflightItem {
    let config_path = Path::new(config.automation.automation_config_path.trim());
    if !config_path.is_file() {
        return PreflightItem {
            key: "ocrLanguageData".to_string(),
            label: "Local OCR language data".to_string(),
            path: None,
            item_type: "dependency".to_string(),
            status: ReadinessStatus::NotChecked,
            message: "Local OCR language data is checked after setup is saved.".to_string(),
            readable: None,
            writable: None,
        };
    }

    let automation_config = fs::read_to_string(config_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<AutomationFileConfig>(&contents).ok());
    let Some(ocr) = automation_config.and_then(|automation| automation.ocr) else {
        return PreflightItem {
            key: "ocrLanguageData".to_string(),
            label: "Local OCR language data".to_string(),
            path: None,
            item_type: "dependency".to_string(),
            status: ReadinessStatus::NotChecked,
            message: "Legacy setup does not declare the local OCR models yet. Refresh managed scripts and setup before using image-only PDFs.".to_string(),
            readable: None,
            writable: None,
        };
    };

    let configured_path = ocr.tessdata_dir.unwrap_or_default();
    if configured_path.trim().is_empty() {
        return PreflightItem {
            key: "ocrLanguageData".to_string(),
            label: "Local OCR language data".to_string(),
            path: None,
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Local OCR language data is not configured. Refresh InnPilot setup."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    let declared = Path::new(configured_path.trim());
    let language_dir = if declared.is_absolute() {
        declared.to_path_buf()
    } else {
        config_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(declared)
    };
    let languages = ocr
        .languages
        .filter(|languages| !languages.is_empty())
        .unwrap_or_else(|| vec!["ita".to_string(), "eng".to_string(), "deu".to_string()]);

    if !language_dir.is_dir() {
        return PreflightItem {
            key: "ocrLanguageData".to_string(),
            label: "Local OCR language data".to_string(),
            path: Some(language_dir.to_string_lossy().to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingFolder,
            message:
                "Local OCR models are missing. Reinstall or refresh InnPilot's managed scripts."
                    .to_string(),
            readable: Some(false),
            writable: None,
        };
    }

    let missing = languages
        .iter()
        .filter(|language| {
            language.is_empty()
                || !language
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '_')
                || !language_dir
                    .join(format!("{language}.traineddata"))
                    .is_file()
        })
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return PreflightItem {
            key: "ocrLanguageData".to_string(),
            label: "Local OCR language data".to_string(),
            path: Some(language_dir.to_string_lossy().to_string()),
            item_type: "dependency".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: format!(
                "Local OCR models are incomplete. Missing language codes: {}. Refresh managed scripts.",
                missing.join(", ")
            ),
            readable: Some(true),
            writable: None,
        };
    }

    PreflightItem {
        key: "ocrLanguageData".to_string(),
        label: "Local OCR language data".to_string(),
        path: Some(language_dir.to_string_lossy().to_string()),
        item_type: "dependency".to_string(),
        status: ReadinessStatus::Ready,
        message: format!(
            "Local OCR is ready for {} language model(s). Documents stay on this PC.",
            languages.len()
        ),
        readable: Some(true),
        writable: None,
    }
}

fn is_expected_protected_secret(path: &Path, purpose: &str) -> Result<bool, String> {
    let expected = [DPAPI_SECRET_MAGIC, purpose.as_bytes(), b"\n"].concat();
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut prefix = vec![0_u8; expected.len()];
    let mut read = 0;
    while read < prefix.len() {
        let count = file
            .read(&mut prefix[read..])
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        read += count;
    }
    Ok(read == expected.len() && prefix == expected)
}

fn token_check(key: &str, label: &str, path: &str) -> PreflightItem {
    if path.trim().is_empty() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: None,
            item_type: "token".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Gmail token path is not configured.".to_string(),
            readable: None,
            writable: None,
        };
    }

    let token_path = Path::new(path);
    if token_path.is_file() {
        return match is_expected_protected_secret(token_path, "gmail-token") {
            Ok(true) => PreflightItem {
                key: key.to_string(),
                label: label.to_string(),
                path: Some(path.to_string()),
                item_type: "token".to_string(),
                status: ReadinessStatus::Ready,
                message: "Gmail token uses InnPilot's Windows-protected format. Access is verified when Gmail runs.".to_string(),
                readable: Some(true),
                writable: None,
            },
            Ok(false) => PreflightItem {
                key: key.to_string(),
                label: label.to_string(),
                path: Some(path.to_string()),
                item_type: "token".to_string(),
                status: ReadinessStatus::Warning,
                message: "Legacy plaintext Gmail token found. InnPilot will encrypt it before the next Gmail API use.".to_string(),
                readable: Some(true),
                writable: None,
            },
            Err(_) => PreflightItem {
                key: key.to_string(),
                label: label.to_string(),
                path: Some(path.to_string()),
                item_type: "token".to_string(),
                status: ReadinessStatus::PermissionProblem,
                message: "Gmail token file cannot be read. Check its Windows permissions.".to_string(),
                readable: Some(false),
                writable: None,
            },
        };
    }
    if token_path.exists() {
        return PreflightItem {
            key: key.to_string(),
            label: label.to_string(),
            path: Some(path.to_string()),
            item_type: "token".to_string(),
            status: ReadinessStatus::PermissionProblem,
            message: "The Gmail token path is not a file.".to_string(),
            readable: Some(false),
            writable: None,
        };
    }

    PreflightItem {
        key: key.to_string(),
        label: label.to_string(),
        path: Some(path.to_string()),
        item_type: "token".to_string(),
        status: ReadinessStatus::NotChecked,
        message: "Gmail token file is missing. Reconnect Gmail may create it later.".to_string(),
        readable: None,
        writable: None,
    }
}
fn gmail_credentials_file_check(config: &HubConfig) -> PreflightItem {
    let automation_config_path = config.automation.automation_config_path.trim();
    if automation_config_path.is_empty() || !Path::new(automation_config_path).is_file() {
        return PreflightItem {
            key: "gmailCredentialsFile".to_string(),
            label: "Gmail credentials file".to_string(),
            path: None,
            item_type: "credentials".to_string(),
            status: ReadinessStatus::NotChecked,
            message: "Gmail credentials are checked after the automation setup file is saved."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    let contents = match fs::read_to_string(automation_config_path) {
        Ok(contents) => contents,
        Err(_) => {
            return PreflightItem {
                key: "gmailCredentialsFile".to_string(),
                label: "Gmail credentials file".to_string(),
                path: None,
                item_type: "credentials".to_string(),
                status: ReadinessStatus::MissingConfiguration,
                message: "Gmail credentials file could not be checked. Ask setup support to update InnPilot setup."
                    .to_string(),
                readable: None,
                writable: None,
            }
        }
    };

    let automation_config: AutomationFileConfig = match serde_json::from_str(&contents) {
        Ok(config) => config,
        Err(_) => {
            return PreflightItem {
                key: "gmailCredentialsFile".to_string(),
                label: "Gmail credentials file".to_string(),
                path: None,
                item_type: "credentials".to_string(),
                status: ReadinessStatus::MissingConfiguration,
                message: "Gmail credentials file could not be checked. Ask setup support to update InnPilot setup."
                    .to_string(),
                readable: None,
                writable: None,
            }
        }
    };

    let credentials_path = automation_config
        .paths
        .and_then(|paths| paths.gmail_credentials_file)
        .unwrap_or_default();
    let credentials_path = credentials_path.trim();
    if credentials_path.is_empty() {
        return PreflightItem {
            key: "gmailCredentialsFile".to_string(),
            label: "Gmail credentials file".to_string(),
            path: None,
            item_type: "credentials".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Choose the Gmail credentials file, or switch invoice delivery to Prepare files only."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    let path = Path::new(credentials_path);
    if !path.exists() {
        return PreflightItem {
            key: "gmailCredentialsFile".to_string(),
            label: "Gmail credentials file".to_string(),
            path: Some(credentials_path.to_string()),
            item_type: "credentials".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Gmail credentials file not found. Choose the Gmail credentials file, or switch invoice delivery to Prepare files only."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    if !path.is_file() {
        return PreflightItem {
            key: "gmailCredentialsFile".to_string(),
            label: "Gmail credentials file".to_string(),
            path: Some(credentials_path.to_string()),
            item_type: "credentials".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Gmail credentials path is not a file. Choose the Gmail credentials file."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    match is_expected_protected_secret(path, "gmail-client-credentials") {
        Ok(true) => PreflightItem {
            key: "gmailCredentialsFile".to_string(),
            label: "Gmail credentials file".to_string(),
            path: Some(credentials_path.to_string()),
            item_type: "credentials".to_string(),
            status: ReadinessStatus::Ready,
            message: "Gmail client credentials use InnPilot's Windows-protected format. Access is verified when Gmail runs.".to_string(),
            readable: Some(true),
            writable: None,
        },
        Ok(false) => PreflightItem {
            key: "gmailCredentialsFile".to_string(),
            label: "Gmail credentials file".to_string(),
            path: Some(credentials_path.to_string()),
            item_type: "credentials".to_string(),
            status: ReadinessStatus::Warning,
            message: "Legacy plaintext Gmail client credentials found. InnPilot will encrypt them before the next Gmail API use.".to_string(),
            readable: Some(true),
            writable: None,
        },
        Err(_) => PreflightItem {
            key: "gmailCredentialsFile".to_string(),
            label: "Gmail credentials file".to_string(),
            path: Some(credentials_path.to_string()),
            item_type: "credentials".to_string(),
            status: ReadinessStatus::PermissionProblem,
            message: "Gmail credentials file cannot be read. Check its Windows permissions.".to_string(),
            readable: Some(false),
            writable: None,
        },
    }
}

fn token_parent_folder_check(token_path: &str) -> PreflightItem {
    if token_path.trim().is_empty() {
        return PreflightItem {
            key: "gmailTokenFolder".to_string(),
            label: "Gmail token folder".to_string(),
            path: None,
            item_type: "folder".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Setup needs attention. The Gmail sign-in folder is not configured."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    let Some(parent) = Path::new(token_path).parent() else {
        return PreflightItem {
            key: "gmailTokenFolder".to_string(),
            label: "Gmail token folder".to_string(),
            path: None,
            item_type: "folder".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Setup needs attention. The Gmail sign-in folder is not configured."
                .to_string(),
            readable: None,
            writable: None,
        };
    };

    if parent.as_os_str().is_empty() {
        return PreflightItem {
            key: "gmailTokenFolder".to_string(),
            label: "Gmail token folder".to_string(),
            path: None,
            item_type: "folder".to_string(),
            status: ReadinessStatus::MissingConfiguration,
            message: "Setup needs attention. The Gmail sign-in folder is not configured."
                .to_string(),
            readable: None,
            writable: None,
        };
    }

    let parent_path = parent.to_string_lossy().to_string();
    let mut item = folder_check(
        "gmailTokenFolder",
        "Gmail token folder",
        &parent_path,
        true,
        true,
    );

    if item.status != ReadinessStatus::Ready {
        item.message = "Setup needs attention. The Gmail sign-in folder is missing or cannot be used. Ask setup support to update InnPilot configuration.".to_string();
    } else {
        item.message = "Gmail sign-in folder is available.".to_string();
    }

    item
}

fn dependency_unknown(key: &str, label: &str) -> PreflightItem {
    PreflightItem {
        key: key.to_string(),
        label: label.to_string(),
        path: None,
        item_type: "dependency".to_string(),
        status: ReadinessStatus::NotChecked,
        message: "Dependency is required by the shell or external scripts but is not verified by this app-side preflight yet.".to_string(),
        readable: None,
        writable: None,
    }
}

fn workflow_preflight(
    config: &HubConfig,
    items: &[PreflightItem],
    _dependencies: &[PreflightItem],
) -> Vec<WorkflowPreflight> {
    let invoice_uses_gmail = config.invoice_delivery_mode == InvoiceDeliveryMode::GmailDrafts;
    let invoice_needs_python = is_python_script(&config.scripts.invoice_workflow_script)
        || (invoice_uses_gmail && is_python_script(&config.scripts.gmail_draft_script));
    let gmail_needs_python = is_python_script(&config.scripts.gmail_draft_script);
    let scan_copy_needs_python = is_python_script(&config.scripts.copy_scansioni_script);
    let ocr_needs_python = is_python_script(&config.scripts.ocr_preprocessing_script);
    let contracts_needs_python = scan_copy_needs_python
        || ocr_needs_python
        || is_python_script(&config.scripts.contract_processing_script);
    let invoice_base_checks = [
        "invoiceWorkflowScript",
        "invoiceInputFolder",
        "invoiceOutputFolder",
        "invoiceLogFolder",
        "invoiceDeliveryMode",
        "invoiceSafeModeSupport",
    ];
    let invoice_gmail_checks = [
        "gmailDraftScript",
        "gmailCredentialsFile",
        "gmailTokenFolder",
        "gmailTokenAlignment",
    ];
    let invoice_checks = if invoice_uses_gmail {
        let mut checks = invoice_base_checks.to_vec();
        checks.extend(invoice_gmail_checks);
        with_python_config(&checks, invoice_needs_python)
    } else {
        with_python_config(&invoice_base_checks, invoice_needs_python)
    };
    let gmail_checks = with_python_config(
        &[
            "gmailDraftScript",
            "invoiceOutputFolder",
            "invoiceLogFolder",
            "gmailCredentialsFile",
            "gmailTokenPath",
            "gmailTokenFolder",
            "gmailTokenAlignment",
            "gmailSafeModeSupport",
        ],
        gmail_needs_python,
    );
    let contracts_checks = with_python_config(
        &[
            "copyScansioniScript",
            "ocrPreprocessingScript",
            "contractProcessingScript",
            "scansioniNetworkShare",
            "scansioniLocalCacheFolder",
            "ocrTextOutputFolder",
            "ocrLanguageData",
            "contractsOutputFolder",
            "contractsSafeModeSupport",
        ],
        contracts_needs_python,
    );
    let scan_copy_checks = with_python_config(
        &[
            "copyScansioniScript",
            "scansioniNetworkShare",
            "scansioniLocalCacheFolder",
            "scanCopySafeModeSupport",
        ],
        scan_copy_needs_python,
    );
    let ocr_checks = with_python_config(
        &[
            "ocrPreprocessingScript",
            "scansioniLocalCacheFolder",
            "ocrTextOutputFolder",
            "ocrLanguageData",
            "ocrSafeModeSupport",
        ],
        ocr_needs_python,
    );

    vec![
        workflow(
            "clientProfile",
            "Hotel profile",
            None,
            &["clientProfile"],
            items,
            false,
        ),
        workflow(
            "invoiceWorkflow",
            "Invoice workflow",
            Some("process_invoices_and_drafts"),
            &invoice_checks,
            items,
            true,
        ),
        workflow(
            "gmailDraftsWorkflow",
            "Gmail drafts workflow",
            Some("reconnect_gmail"),
            &gmail_checks,
            items,
            true,
        ),
        workflow(
            "scansioniNetwork",
            "Scansioni/network folder",
            Some("copy_scansioni"),
            &scan_copy_checks,
            items,
            true,
        ),
        workflow(
            "ocrWorkflow",
            "OCR workflow",
            Some("ocr_preprocessing"),
            &ocr_checks,
            items,
            true,
        ),
        workflow(
            "contractsWorkflow",
            "Contracts workflow",
            Some("process_signed_contracts"),
            &contracts_checks,
            items,
            true,
        ),
    ]
}

fn with_python_config(checks: &[&'static str], include_python: bool) -> Vec<&'static str> {
    let mut result = checks.to_vec();
    if include_python {
        result.insert(0, "automationConfigAlignment");
        result.insert(0, "pythonPackages");
        result.insert(0, "pythonExecutable");
        result.insert(0, "automationConfigPath");
    }
    result
}

fn is_python_script(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("py"))
}

fn workflow(
    key: &str,
    label: &str,
    command_name: Option<&str>,
    check_keys: &[&str],
    items: &[PreflightItem],
    runnable: bool,
) -> WorkflowPreflight {
    let checks = check_keys
        .iter()
        .filter_map(|key| items.iter().find(|item| item.key == *key))
        .collect::<Vec<_>>();
    let blocking = checks
        .iter()
        .find(|item| is_blocking_status(&item.status, item.item_type.as_str()));
    let status = blocking
        .map(|item| item.status.clone())
        .unwrap_or(ReadinessStatus::Ready);
    let can_run = runnable && status == ReadinessStatus::Ready;
    let message = blocking
        .map(|item| format!("{}: {}", item.label, item.message))
        .unwrap_or_else(|| "Ready.".to_string());

    WorkflowPreflight {
        key: key.to_string(),
        label: label.to_string(),
        command_name: command_name.map(str::to_string),
        status,
        can_run,
        message,
        check_keys: check_keys.iter().map(|key| key.to_string()).collect(),
    }
}

fn is_blocking_status(status: &ReadinessStatus, item_type: &str) -> bool {
    match status {
        ReadinessStatus::Ready => false,
        ReadinessStatus::Warning => false,
        ReadinessStatus::NotChecked if item_type == "token" => false,
        ReadinessStatus::NotChecked => false,
        ReadinessStatus::MissingConfiguration
        | ReadinessStatus::MissingScript
        | ReadinessStatus::MissingFolder
        | ReadinessStatus::PermissionProblem => true,
    }
}

pub(crate) fn ensure_workflow_can_run(
    command_name: &str,
    config: &HubConfig,
) -> Result<(), String> {
    let report = build_preflight_report(config);
    let workflow = report
        .workflows
        .iter()
        .find(|workflow| workflow.command_name.as_deref() == Some(command_name))
        .ok_or_else(|| "Unknown automation command.".to_string())?;

    if workflow.can_run {
        Ok(())
    } else {
        Err(format!(
            "{} is not ready. {}",
            workflow.label, workflow.message
        ))
    }
}

#[cfg(feature = "cloud-e2e-probe")]
pub(crate) fn workflow_blocker_key(command_name: &str, config: &HubConfig) -> Option<String> {
    let report = build_preflight_report(config);
    let workflow = report
        .workflows
        .iter()
        .find(|workflow| workflow.command_name.as_deref() == Some(command_name))?;
    if workflow.can_run {
        return None;
    }
    workflow.check_keys.iter().find_map(|key| {
        report
            .items
            .iter()
            .find(|item| item.key == *key)
            .filter(|item| is_blocking_status(&item.status, item.item_type.as_str()))
            .map(|item| item.key.clone())
    })
}

pub(crate) fn can_write_to_folder(path: &Path) -> bool {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let probe_path = path.join(format!(".innpilot_write_probe_{stamp}.tmp"));
    let result =
        fs::File::create(&probe_path).and_then(|mut file| file.write_all(b"innpilot preflight"));
    let _ = fs::remove_file(&probe_path);
    result.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        ClientConfig, FolderPaths, GmailConfig, HubConfig, InvoiceDeliveryMode, SafetyConfig,
        ScriptPaths,
    };
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn packaged_worker_has_a_cold_start_allowance() {
        assert_eq!(
            automation_engine_check_timeout(r"C:\InnPilot\worker\innpilot-worker.exe"),
            PACKAGED_WORKER_CHECK_TIMEOUT
        );
        assert_eq!(
            automation_engine_check_timeout("python"),
            PYTHON_CHECK_TIMEOUT
        );
    }

    #[test]
    fn missing_script_is_detected() {
        let item = script_check(
            "invoiceWorkflowScript",
            "Invoice workflow script",
            "C:\\definitely\\missing\\script.cmd",
        );

        assert_eq!(item.status, ReadinessStatus::MissingScript);
    }

    #[test]
    fn workflow_is_not_ready_when_required_script_is_missing() {
        let mut config = config_with_temp_paths();
        config.scripts.invoice_workflow_script = "C:\\definitely\\missing\\script.cmd".to_string();

        let report = build_preflight_report(&config);
        let invoice = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "invoiceWorkflow")
            .unwrap();

        assert!(!invoice.can_run);
        assert_eq!(invoice.status, ReadinessStatus::MissingScript);
    }

    #[test]
    fn missing_gmail_token_file_does_not_block_reconnect_when_parent_folder_exists() {
        let config = config_with_temp_paths();

        let report = build_preflight_report(&config);
        let token = report
            .items
            .iter()
            .find(|item| item.key == "gmailTokenPath")
            .unwrap();
        let reconnect = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "gmailDraftsWorkflow")
            .unwrap();

        assert_eq!(token.status, ReadinessStatus::NotChecked);
        assert!(reconnect.can_run);
    }

    #[test]
    fn missing_gmail_token_parent_folder_is_reported_and_blocks_reconnect() {
        let mut config = config_with_temp_paths();
        let missing_parent = std::env::temp_dir().join(format!(
            "innpilot_missing_token_parent_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        config.gmail.token_path = missing_parent
            .join("gmail_token.json")
            .to_string_lossy()
            .to_string();

        let report = build_preflight_report(&config);
        let token_folder = report
            .items
            .iter()
            .find(|item| item.key == "gmailTokenFolder")
            .unwrap();
        let reconnect = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "gmailDraftsWorkflow")
            .unwrap();

        assert_eq!(token_folder.status, ReadinessStatus::MissingFolder);
        assert!(!reconnect.can_run);
    }

    #[test]
    fn workflow_readiness_is_ready_for_existing_fake_scripts_and_folders() {
        let config = config_with_temp_paths();
        let report = build_preflight_report(&config);
        let invoice = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "invoiceWorkflow")
            .unwrap();

        assert!(invoice.can_run);
        assert_eq!(invoice.status, ReadinessStatus::Ready);
    }

    #[test]
    fn matching_app_and_automation_config_gives_no_alignment_warning() {
        let config = config_with_temp_paths();
        let report = build_preflight_report(&config);
        let alignment = report
            .items
            .iter()
            .find(|item| item.key == "configAlignment")
            .unwrap();

        assert_eq!(alignment.status, ReadinessStatus::Ready);
    }

    #[test]
    fn mismatched_gmail_token_path_blocks_gmail_workflows() {
        let config = config_with_temp_paths();
        let mismatched_token = Path::new(&config.gmail.token_path)
            .with_file_name("different_gmail_token.json")
            .to_string_lossy()
            .to_string();
        write_automation_config(&config, Some(&mismatched_token), None, None);

        let report = build_preflight_report(&config);
        let token_alignment = report
            .items
            .iter()
            .find(|item| item.key == "gmailTokenAlignment")
            .unwrap_or_else(|| {
                panic!(
                    "gmailTokenAlignment missing. Items: {:?}",
                    report
                        .items
                        .iter()
                        .map(|item| (&item.key, &item.status, &item.message))
                        .collect::<Vec<_>>()
                )
            });
        let gmail = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "gmailDraftsWorkflow")
            .unwrap();
        let invoice = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "invoiceWorkflow")
            .unwrap();

        assert_eq!(token_alignment.status, ReadinessStatus::PermissionProblem);
        assert!(!gmail.can_run);
        assert!(!invoice.can_run);
    }

    #[test]
    fn missing_gmail_credentials_path_blocks_gmail_workflows() {
        let config = config_with_temp_paths();
        write_automation_config(&config, None, Some(""), None);

        let report = build_preflight_report(&config);
        let credentials = report
            .items
            .iter()
            .find(|item| item.key == "gmailCredentialsFile")
            .unwrap();
        let gmail = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "gmailDraftsWorkflow")
            .unwrap();
        let invoice = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "invoiceWorkflow")
            .unwrap();

        assert_eq!(credentials.status, ReadinessStatus::MissingConfiguration);
        assert!(!gmail.can_run);
        assert!(!invoice.can_run);
    }

    #[test]
    fn prepare_only_invoice_mode_does_not_require_gmail_credentials() {
        let mut config = config_with_temp_paths();
        config.invoice_delivery_mode = InvoiceDeliveryMode::PrepareOnly;
        write_automation_config(&config, None, Some(""), None);

        let report = build_preflight_report(&config);
        let invoice = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "invoiceWorkflow")
            .unwrap();
        let gmail = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "gmailDraftsWorkflow")
            .unwrap();

        assert!(invoice.can_run);
        assert!(!invoice
            .check_keys
            .contains(&"gmailCredentialsFile".to_string()));
        assert!(!gmail.can_run);
    }

    #[test]
    fn send_automatically_invoice_mode_is_blocked() {
        let mut config = config_with_temp_paths();
        config.invoice_delivery_mode = InvoiceDeliveryMode::SendAutomatically;

        let report = build_preflight_report(&config);
        let mode = report
            .items
            .iter()
            .find(|item| item.key == "invoiceDeliveryMode")
            .unwrap();
        let invoice = report
            .workflows
            .iter()
            .find(|workflow| workflow.key == "invoiceWorkflow")
            .unwrap();

        assert_eq!(mode.status, ReadinessStatus::PermissionProblem);
        assert!(!invoice.can_run);
        assert!(mode.message.contains("not enabled yet"));
    }

    #[test]
    fn missing_gmail_credentials_file_is_reported() {
        let config = config_with_temp_paths();
        let missing_credentials = Path::new(&config.gmail.token_path)
            .with_file_name("missing_gmail_credentials.json")
            .to_string_lossy()
            .to_string();
        write_automation_config(&config, None, Some(&missing_credentials), None);

        let report = build_preflight_report(&config);
        let credentials = report
            .items
            .iter()
            .find(|item| item.key == "gmailCredentialsFile")
            .unwrap();

        assert_eq!(credentials.status, ReadinessStatus::MissingConfiguration);
        assert!(credentials.message.contains("not found"));
    }

    #[test]
    fn legacy_plaintext_gmail_credentials_are_reported_for_migration() {
        let config = config_with_temp_paths();

        let report = build_preflight_report(&config);
        let credentials = report
            .items
            .iter()
            .find(|item| item.key == "gmailCredentialsFile")
            .unwrap();

        assert_eq!(credentials.status, ReadinessStatus::Warning);
        assert!(credentials.message.contains("encrypt"));
    }

    #[test]
    fn protected_gmail_credentials_are_ready() {
        let config = config_with_temp_paths();
        let credentials_path =
            Path::new(&config.gmail.token_path).with_file_name("gmail_credentials.json");
        fs::write(
            &credentials_path,
            [
                DPAPI_SECRET_MAGIC,
                b"gmail-client-credentials\n",
                b"synthetic-protected-payload\n",
            ]
            .concat(),
        )
        .unwrap();
        write_automation_config(
            &config,
            None,
            Some(credentials_path.to_string_lossy().as_ref()),
            None,
        );

        let report = build_preflight_report(&config);
        let credentials = report
            .items
            .iter()
            .find(|item| item.key == "gmailCredentialsFile")
            .unwrap();

        assert_eq!(credentials.status, ReadinessStatus::Ready);
        assert!(credentials.message.contains("protected"));
    }

    #[test]
    fn token_preflight_distinguishes_plaintext_from_dpapi_protected_storage() {
        let config = config_with_temp_paths();
        let token_path = Path::new(&config.gmail.token_path);
        fs::write(token_path, b"{\"token\":\"synthetic\"}").unwrap();

        let plaintext = token_check("gmailTokenPath", "Gmail token", &config.gmail.token_path);

        assert_eq!(plaintext.status, ReadinessStatus::Warning);
        assert!(plaintext.message.contains("encrypt"));

        fs::write(
            token_path,
            [
                DPAPI_SECRET_MAGIC,
                b"gmail-token\n",
                b"synthetic-protected-payload\n",
            ]
            .concat(),
        )
        .unwrap();
        let protected = token_check("gmailTokenPath", "Gmail token", &config.gmail.token_path);

        assert_eq!(protected.status, ReadinessStatus::Ready);
        assert!(protected.message.contains("protected"));
    }

    #[test]
    fn gmail_credentials_message_does_not_expose_file_contents() {
        let config = config_with_temp_paths();
        let secret_marker = "secret-client-value-that-must-not-leak";
        let credentials_path =
            Path::new(&config.gmail.token_path).with_file_name("gmail_credentials.json");
        fs::write(
            &credentials_path,
            format!(r#"{{"secret":"{secret_marker}"}}"#),
        )
        .unwrap();
        write_automation_config(
            &config,
            None,
            Some(credentials_path.to_string_lossy().as_ref()),
            None,
        );

        let report = build_preflight_report(&config);
        let credentials = report
            .items
            .iter()
            .find(|item| item.key == "gmailCredentialsFile")
            .unwrap();

        assert_eq!(credentials.status, ReadinessStatus::Warning);
        assert!(!credentials.message.contains(secret_marker));
        assert!(!credentials.label.contains(secret_marker));
    }

    #[test]
    fn missing_automation_config_reports_existing_missing_setup_message() {
        let mut config = config_with_temp_paths();
        config.automation.automation_config_path =
            Path::new(&config.automation.automation_config_path)
                .with_file_name("missing_config.local.json")
                .to_string_lossy()
                .to_string();

        let report = build_preflight_report(&config);
        let item = report
            .items
            .iter()
            .find(|item| item.key == "automationConfigPath")
            .unwrap();

        assert_eq!(item.status, ReadinessStatus::MissingConfiguration);
        assert_eq!(
            item.message,
            "Automation setup file is missing. Ask setup support to select or create it."
        );
    }

    #[test]
    fn invalid_automation_config_reports_setup_warning() {
        let config = config_with_temp_paths();
        fs::write(
            &config.automation.automation_config_path,
            b"{not valid json",
        )
        .unwrap();

        let report = build_preflight_report(&config);
        let item = report
            .items
            .iter()
            .find(|item| item.key == "automationConfigAlignment")
            .unwrap();

        assert_eq!(item.status, ReadinessStatus::MissingConfiguration);
        assert!(item.message.contains("not valid JSON"));
    }

    fn config_with_temp_paths() -> HubConfig {
        let root = std::env::temp_dir().join(format!(
            "innpilot_preflight_test_{}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let scripts = root.join("scripts");
        let input = root.join("invoice-input");
        let output = root.join("invoice-output");
        let archive = root.join("archive");
        let logs = root.join("logs");
        let network = root.join("network-scans");
        let cache = root.join("cache");
        let text = root.join("text");
        let contracts = root.join("contracts");

        for dir in [
            &scripts, &input, &output, &archive, &logs, &network, &cache, &text, &contracts,
        ] {
            fs::create_dir_all(dir).unwrap();
        }

        let invoice_script = scripts.join("invoice.cmd");
        let gmail_script = scripts.join("gmail.cmd");
        let copy_script = scripts.join("copy.cmd");
        let ocr_script = scripts.join("ocr.ps1");
        let contract_script = scripts.join("contracts.cmd");
        let credentials_file = scripts.join("gmail_credentials.json");

        for file in [
            &invoice_script,
            &gmail_script,
            &copy_script,
            &ocr_script,
            &contract_script,
            &credentials_file,
        ] {
            fs::write(file, b"echo fake").unwrap();
        }

        let config = HubConfig {
            schema_version: 2,
            language: "en".to_string(),
            client: ClientConfig {
                display_name: "Test Hotel".to_string(),
                branding: crate::config::BrandingConfig::default(),
            },
            invoice_delivery_mode: InvoiceDeliveryMode::GmailDrafts,
            invoice_file_selection_mode: crate::config::InvoiceFileSelectionMode::AllPdfs,
            automation: crate::config::AutomationConfig {
                automation_root_folder: scripts.to_string_lossy().to_string(),
                automation_config_path: scripts
                    .join("config.local.json")
                    .to_string_lossy()
                    .to_string(),
                python_executable: "python".to_string(),
            },
            scripts: ScriptPaths {
                invoice_workflow_script: invoice_script.to_string_lossy().to_string(),
                gmail_draft_script: gmail_script.to_string_lossy().to_string(),
                copy_scansioni_script: copy_script.to_string_lossy().to_string(),
                ocr_preprocessing_script: ocr_script.to_string_lossy().to_string(),
                contract_processing_script: contract_script.to_string_lossy().to_string(),
            },
            folders: FolderPaths {
                invoice_input_folder: input.to_string_lossy().to_string(),
                invoice_output_folder: output.to_string_lossy().to_string(),
                invoice_archive_folder: archive.to_string_lossy().to_string(),
                invoice_log_folder: logs.to_string_lossy().to_string(),
                scansioni_network_share: network.to_string_lossy().to_string(),
                scansioni_local_cache_folder: cache.to_string_lossy().to_string(),
                ocr_text_output_folder: text.to_string_lossy().to_string(),
                contracts_output_folder: contracts.to_string_lossy().to_string(),
                contract_log_folder: logs.to_string_lossy().to_string(),
            },
            gmail: GmailConfig {
                token_path: scripts
                    .join("gmail_token.json")
                    .to_string_lossy()
                    .to_string(),
            },
            safety: SafetyConfig {
                dry_run_default: false,
                require_confirmation_for_file_moves: true,
                redact_logs: true,
            },
            templates: Default::default(),
        };
        write_automation_config(&config, None, None, None);
        config
    }

    #[test]
    fn missing_automation_root_folder_is_reported() {
        let mut config = config_with_temp_paths();
        config.automation.automation_root_folder = std::env::temp_dir()
            .join("innpilot_missing_automation_root")
            .join("automation")
            .to_string_lossy()
            .to_string();

        let report = build_preflight_report(&config);
        let item = report
            .items
            .iter()
            .find(|item| item.key == "automationRootFolder")
            .unwrap();

        assert_eq!(item.status, ReadinessStatus::MissingFolder);
        assert!(item
            .message
            .contains("Automation scripts folder is missing"));
    }

    #[test]
    fn missing_python_executable_is_reported() {
        let item = python_check(
            "definitely_missing_python_for_innpilot_tests.exe",
            &PythonPackageProbe::PythonUnavailable,
        );

        assert_eq!(item.status, ReadinessStatus::MissingConfiguration);
    }

    #[test]
    fn python_version_message_uses_version_output() {
        let version = python_version_from_output(b"Python 3.12.1\r\n", b"");

        assert_eq!(version, "Python 3.12.1");
    }

    #[test]
    fn missing_python_package_summary_is_operator_friendly() {
        let item = python_package_summary_check(
            "python",
            &PythonPackageProbe::Missing(vec!["pypdf".to_string()]),
        );

        assert_eq!(item.status, ReadinessStatus::MissingConfiguration);
        assert!(item.message.contains("Install the Python packages"));
        assert!(item.message.contains("pypdf"));
    }

    #[test]
    fn packaged_worker_uses_the_integrity_checked_probe_without_a_second_process() {
        let path = r"C:\InnPilot\worker\innpilot-worker.exe";
        let ready = python_check(path, &PythonPackageProbe::Ready);
        let changed = python_check(path, &PythonPackageProbe::IntegrityFailed);

        assert_eq!(ready.status, ReadinessStatus::Ready);
        assert!(ready.message.contains("Private InnPilot"));
        assert_eq!(changed.status, ReadinessStatus::PermissionProblem);
        assert!(changed.message.contains("integrity check"));
    }

    #[test]
    fn packaged_worker_integrity_failure_blocks_every_dependency() {
        let checks = python_package_dependency_checks(
            r"C:\InnPilot\worker\innpilot-worker.exe",
            &PythonPackageProbe::IntegrityFailed,
        );

        assert!(!checks.is_empty());
        assert!(checks
            .iter()
            .all(|item| item.status == ReadinessStatus::PermissionProblem));
    }

    #[test]
    fn missing_python_package_dependency_has_friendly_label() {
        let checks = python_package_dependency_checks(
            "python",
            &PythonPackageProbe::Missing(vec!["googleapiclient".to_string()]),
        );
        let gmail = checks
            .iter()
            .find(|item| item.key == "pythonPackageGoogleApi")
            .unwrap();
        let pdf_tools = checks
            .iter()
            .find(|item| item.key == "pythonPackagePypdf")
            .unwrap();

        assert_eq!(gmail.label, "Gmail draft library");
        assert_eq!(gmail.status, ReadinessStatus::MissingConfiguration);
        assert!(gmail.message.contains("Gmail drafts"));
        assert_eq!(pdf_tools.status, ReadinessStatus::Ready);
    }

    #[test]
    fn timed_out_python_package_check_is_operator_friendly() {
        let item = python_package_summary_check("python", &PythonPackageProbe::TimedOut);

        assert_eq!(item.status, ReadinessStatus::MissingConfiguration);
        assert!(item.message.contains("timed out"));
        assert!(item.message.contains("working Python executable"));
    }

    #[test]
    fn local_ocr_models_are_ready_when_all_declared_languages_exist() {
        let config = config_with_temp_paths();
        let config_path = Path::new(&config.automation.automation_config_path);
        let tessdata = config_path.parent().unwrap().join("ocr").join("tessdata");
        fs::create_dir_all(&tessdata).unwrap();
        for language in ["ita", "eng", "deu"] {
            fs::write(tessdata.join(format!("{language}.traineddata")), b"fixture").unwrap();
        }
        fs::write(
            config_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "ocr": {
                    "languages": ["ita", "eng", "deu"],
                    "tessdataDir": "ocr\\tessdata"
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let item = ocr_language_data_check(&config);

        assert_eq!(item.status, ReadinessStatus::Ready);
        assert!(item.message.contains("3 language"));
        assert!(item.message.contains("stay on this PC"));
    }

    #[test]
    fn missing_local_ocr_model_blocks_image_ocr_before_a_workflow_starts() {
        let config = config_with_temp_paths();
        let config_path = Path::new(&config.automation.automation_config_path);
        let tessdata = config_path.parent().unwrap().join("ocr").join("tessdata");
        fs::create_dir_all(&tessdata).unwrap();
        fs::write(tessdata.join("ita.traineddata"), b"fixture").unwrap();
        fs::write(
            config_path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "ocr": {
                    "languages": ["ita", "eng", "deu"],
                    "tessdataDir": "ocr\\tessdata"
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let item = ocr_language_data_check(&config);

        assert_eq!(item.status, ReadinessStatus::MissingConfiguration);
        assert!(item.message.contains("eng"));
        assert!(item.message.contains("deu"));
        let workflow = workflow(
            "ocrWorkflow",
            "OCR workflow",
            Some("ocr_preprocessing"),
            &["ocrLanguageData"],
            std::slice::from_ref(&item),
            true,
        );
        assert!(!workflow.can_run);
    }

    fn write_automation_config(
        config: &HubConfig,
        gmail_token_override: Option<&str>,
        gmail_credentials_override: Option<&str>,
        dry_run_override: Option<bool>,
    ) {
        let default_credentials = Path::new(&config.gmail.token_path)
            .with_file_name("gmail_credentials.json")
            .to_string_lossy()
            .to_string();
        let automation_config = serde_json::json!({
            "paths": {
                "invoiceInputDir": config.folders.invoice_input_folder,
                "invoiceOutputDir": config.folders.invoice_output_folder,
                "invoiceArchiveDir": config.folders.invoice_archive_folder,
                "invoiceLogDir": config.folders.invoice_log_folder,
                "gmailCredentialsFile": gmail_credentials_override.unwrap_or(&default_credentials),
                "gmailTokenFile": gmail_token_override.unwrap_or(&config.gmail.token_path),
                "contractDestinationDir": config.folders.contracts_output_folder,
                "contractOcrTextDir": config.folders.ocr_text_output_folder,
                "contractLogDir": config.folders.contract_log_folder
            },
            "safety": {
                "dryRunDefault": dry_run_override.unwrap_or(config.safety.dry_run_default)
            }
        });
        fs::write(
            &config.automation.automation_config_path,
            serde_json::to_vec_pretty(&automation_config).unwrap(),
        )
        .unwrap();
    }
}
