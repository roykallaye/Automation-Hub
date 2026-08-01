use crate::{config, preflight, runner_protocol, runner_service, workflows};
use getrandom::fill;
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::Manager;

const PROBE_IDENTIFIER: &str = "com.innpilot.cloud-e2e-probe";
const CAPABILITIES: [&str; 3] = ["invoices", "scan_import", "signed_contracts"];
const JOB_WAIT_TIMEOUT: Duration = Duration::from_secs(60);

struct ProbeWorkspace {
    app_data_root: PathBuf,
    path: PathBuf,
}

impl ProbeWorkspace {
    fn create(app_data_root: &Path) -> Result<Self, String> {
        let mut random = [0_u8; 8];
        fill(&mut random).map_err(|_| "Could not create the probe workspace.".to_string())?;
        let suffix = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let path = app_data_root.join(format!(
            "cloud-e2e-workspace-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir(&path).map_err(|_| "Could not create the probe workspace.".to_string())?;
        Ok(Self {
            app_data_root: app_data_root.to_path_buf(),
            path,
        })
    }
}

impl Drop for ProbeWorkspace {
    fn drop(&mut self) {
        let Ok(root) = fs::canonicalize(&self.app_data_root) else {
            return;
        };
        let Ok(path) = fs::canonicalize(&self.path) else {
            return;
        };
        let safe_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("cloud-e2e-workspace-"));
        if safe_name && path.starts_with(&root) && path.parent() == Some(root.as_path()) {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn prepare_probe_profile(path: &Path) -> Result<(), String> {
    if path.file_name().and_then(|name| name.to_str()) != Some(PROBE_IDENTIFIER) {
        return Err("Refusing to reset an unexpected probe profile.".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "The probe profile has no safe parent.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|_| "Could not prepare the probe profile parent.".to_string())?;

    if path.exists() {
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|_| "Could not verify the probe profile parent.".to_string())?;
        let canonical_profile = fs::canonicalize(path)
            .map_err(|_| "Could not verify the existing probe profile.".to_string())?;
        let is_exact_child = canonical_profile.parent() == Some(canonical_parent.as_path())
            && canonical_profile.file_name().and_then(|name| name.to_str())
                == Some(PROBE_IDENTIFIER);
        if !is_exact_child {
            return Err("Refusing to reset an untrusted probe profile.".to_string());
        }
        fs::remove_dir_all(&canonical_profile)
            .map_err(|_| "Could not reset the isolated probe profile.".to_string())?;
    }

    fs::create_dir(path).map_err(|_| "Could not create the isolated probe profile.".to_string())
}

fn record_diagnostic(app_data: &Path, code: &str) {
    if code
        .chars()
        .all(|character| character.is_ascii_uppercase() || character == '_')
    {
        let _ = fs::write(app_data.join("probe-diagnostic.txt"), code.as_bytes());
    }
}

pub async fn run_cloud_e2e_probe(
    pairing_code: &str,
    worker: &Path,
    expected_mode: &str,
) -> Result<(), String> {
    if !matches!(expected_mode, "dry_run" | "execute") {
        return Err("The probe execution mode is invalid.".to_string());
    }
    let worker = fs::canonicalize(worker)
        .map_err(|_| "The verified automation engine is unavailable.".to_string())?;
    if !worker.is_file() {
        return Err("The verified automation engine is unavailable.".to_string());
    }

    let mut context = tauri::generate_context!();
    context.config_mut().identifier = PROBE_IDENTIFIER.to_string();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .build(context)
        .map_err(|_| "Could not initialize the isolated InnPilot probe.".to_string())?;
    let app_handle = app.handle();
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| "Could not locate the isolated probe data.".to_string())?;
    prepare_probe_profile(&app_data)?;
    let workspace = ProbeWorkspace::create(&app_data)?;

    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Could not locate the reviewed automation source.".to_string())?
        .to_path_buf();
    let automation = repository.join("automation");
    let scan_source = workspace.path.join("scan-source");
    let scan_cache = workspace.path.join("scan-cache");
    let invoice_input = workspace.path.join("invoice-input");
    let invoice_output = workspace.path.join("invoice-output");
    let invoice_archive = workspace.path.join("invoice-archive");
    let invoice_logs = workspace.path.join("invoice-logs");
    let ocr_output = workspace.path.join("ocr-output");
    let contract_output = workspace.path.join("contract-output");
    let contract_logs = workspace.path.join("contract-logs");
    let gmail = workspace.path.join("gmail");
    for directory in [
        &scan_source,
        &scan_cache,
        &invoice_input,
        &invoice_output,
        &invoice_archive,
        &invoice_logs,
        &ocr_output,
        &contract_output,
        &contract_logs,
        &gmail,
    ] {
        fs::create_dir_all(directory)
            .map_err(|_| "Could not prepare the synthetic workflow folders.".to_string())?;
    }
    fs::write(
        scan_source.join("Sharp MFP synthetic.pdf"),
        b"%PDF-1.4\n% InnPilot synthetic dry-run fixture\n%%EOF\n",
    )
    .map_err(|_| "Could not prepare the synthetic scan fixture.".to_string())?;

    let automation_config_path = workspace.path.join("automation-config.json");
    let automation_config = json!({
        "contracts": { "scannerFilePrefixes": ["Sharp MFP"] },
        "paths": {
            "scanCacheDir": scan_cache,
            "scanSourceDir": scan_source
        },
        "safety": { "dryRunDefault": true }
    });
    fs::write(
        &automation_config_path,
        serde_json::to_vec_pretty(&automation_config)
            .map_err(|_| "Could not prepare the synthetic automation setup.".to_string())?,
    )
    .map_err(|_| "Could not store the synthetic automation setup.".to_string())?;

    let mut local_config = config::ensure_config(app_handle)?;
    local_config.client.display_name = "InnPilot cloud probe".to_string();
    local_config.automation.automation_root_folder = automation.to_string_lossy().to_string();
    local_config.automation.automation_config_path =
        automation_config_path.to_string_lossy().to_string();
    local_config.automation.python_executable = worker.to_string_lossy().to_string();
    local_config.scripts.invoice_workflow_script = automation
        .join("invoices/process_fatture.py")
        .to_string_lossy()
        .to_string();
    local_config.scripts.gmail_draft_script = automation
        .join("gmail_drafts/create_gmail_draft.py")
        .to_string_lossy()
        .to_string();
    local_config.scripts.copy_scansioni_script = automation
        .join("scans/copy_scans.py")
        .to_string_lossy()
        .to_string();
    local_config.scripts.ocr_preprocessing_script = automation
        .join("ocr/extract_scan_text.py")
        .to_string_lossy()
        .to_string();
    local_config.scripts.contract_processing_script = automation
        .join("contracts/process_contratti.py")
        .to_string_lossy()
        .to_string();
    local_config.folders.invoice_input_folder = invoice_input.to_string_lossy().to_string();
    local_config.folders.invoice_output_folder = invoice_output.to_string_lossy().to_string();
    local_config.folders.invoice_archive_folder = invoice_archive.to_string_lossy().to_string();
    local_config.folders.invoice_log_folder = invoice_logs.to_string_lossy().to_string();
    local_config.folders.scansioni_network_share = scan_source.to_string_lossy().to_string();
    local_config.folders.scansioni_local_cache_folder = scan_cache.to_string_lossy().to_string();
    local_config.folders.ocr_text_output_folder = ocr_output.to_string_lossy().to_string();
    local_config.folders.contracts_output_folder = contract_output.to_string_lossy().to_string();
    local_config.folders.contract_log_folder = contract_logs.to_string_lossy().to_string();
    local_config.gmail.token_path = gmail.join("token.json").to_string_lossy().to_string();
    local_config.safety.dry_run_default = true;
    config::save_config_for_app(app_handle, &local_config)?;

    if let Some(blocker) = preflight::workflow_blocker_key("copy_scansioni", &local_config) {
        let blocker = blocker
            .chars()
            .fold(String::new(), |mut result, character| {
                if character.is_ascii_uppercase() && !result.is_empty() {
                    result.push('_');
                }
                if character.is_ascii_alphanumeric() {
                    result.push(character.to_ascii_uppercase());
                } else {
                    result.push('_');
                }
                result
            });
        record_diagnostic(&app_data, &format!("LOCAL_PREFLIGHT_FAILED_{blocker}"));
        return Err("The synthetic workflow preflight failed.".to_string());
    }
    preflight::ensure_workflow_can_run("copy_scansioni", &local_config)?;
    let local_run = match workflows::run_command_inner_controlled(
        app_handle,
        "copy_scansioni",
        Some(true),
        || false,
    )
    .await
    {
        Ok(summary) => summary,
        Err(_) => {
            record_diagnostic(&app_data, "LOCAL_WORKFLOW_FAILED");
            return Err("The synthetic local workflow failed.".to_string());
        }
    };
    if local_run.status != "success" || local_run.exit_code != 0 {
        record_diagnostic(&app_data, "LOCAL_WORKFLOW_NOT_SUCCESSFUL");
        return Err("The synthetic local workflow needs attention.".to_string());
    }
    record_diagnostic(&app_data, "LOCAL_WORKFLOW_PASSED");

    if runner_protocol::pair(app_handle, pairing_code)
        .await
        .is_err()
    {
        record_diagnostic(&app_data, "PAIRING_FAILED");
        return Err("The isolated cloud pairing failed.".to_string());
    }
    record_diagnostic(&app_data, "PAIRING_PASSED");
    let deadline = Instant::now() + JOB_WAIT_TIMEOUT;
    while Instant::now() < deadline {
        let exchange = match runner_protocol::sync_exchange(app_handle, &CAPABILITIES, None).await {
            Ok(exchange) => exchange,
            Err(_) => {
                record_diagnostic(&app_data, "SYNC_FAILED");
                return Err("The isolated cloud sync failed.".to_string());
            }
        };
        record_diagnostic(&app_data, "SYNC_PASSED");
        if let Some(job) = exchange.job {
            if job.workflow != "scan_import" || job.mode != expected_mode {
                record_diagnostic(&app_data, "UNEXPECTED_JOB");
                return Err("The probe received an unexpected cloud job.".to_string());
            }
            if runner_service::process_job(app_handle, job).await.is_err() {
                record_diagnostic(&app_data, "JOB_PROCESSING_FAILED");
                return Err("The isolated cloud job failed safely.".to_string());
            }
            let copied_files = fs::read_dir(&scan_cache)
                .map_err(|_| "Could not verify the synthetic scan cache.".to_string())?
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_file())
                .count();
            let source_preserved = scan_source.join("Sharp MFP synthetic.pdf").is_file();
            let expected_effect = match expected_mode {
                "dry_run" => copied_files == 0,
                "execute" => copied_files == 1,
                _ => false,
            };
            if !source_preserved || !expected_effect {
                record_diagnostic(&app_data, "JOB_EFFECT_MISMATCH");
                return Err("The synthetic cloud job had an unexpected file effect.".to_string());
            }
            record_diagnostic(
                &app_data,
                if expected_mode == "execute" {
                    "EXECUTE_COMPLETED"
                } else {
                    "DRY_RUN_COMPLETED"
                },
            );
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    record_diagnostic(&app_data, "JOB_TIMEOUT");
    Err("The probe did not receive a cloud job before the timeout.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_parent() -> PathBuf {
        let mut random = [0_u8; 8];
        fill(&mut random).unwrap();
        let suffix = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        std::env::temp_dir().join(format!("innpilot-cloud-probe-profile-{suffix}"))
    }

    #[test]
    fn probe_profile_reset_removes_only_the_exact_synthetic_profile() {
        let parent = test_parent();
        let profile = parent.join(PROBE_IDENTIFIER);
        let sibling = parent.join("keep-me");
        fs::create_dir_all(profile.join("runner")).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        fs::write(profile.join("runner/connection.json"), b"synthetic").unwrap();
        fs::write(sibling.join("sentinel.txt"), b"keep").unwrap();

        prepare_probe_profile(&profile).unwrap();

        assert!(profile.is_dir());
        assert!(fs::read_dir(&profile).unwrap().next().is_none());
        assert_eq!(fs::read(sibling.join("sentinel.txt")).unwrap(), b"keep");
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn probe_profile_reset_rejects_an_unexpected_directory_name() {
        let parent = test_parent();
        let unexpected = parent.join("real-profile");
        fs::create_dir_all(&unexpected).unwrap();
        fs::write(unexpected.join("sentinel.txt"), b"keep").unwrap();

        assert!(prepare_probe_profile(&unexpected).is_err());
        assert_eq!(fs::read(unexpected.join("sentinel.txt")).unwrap(), b"keep");
        fs::remove_dir_all(parent).unwrap();
    }
}
