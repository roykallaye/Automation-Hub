use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const CONFIG_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HubConfig {
    pub(crate) schema_version: u32,
    pub(crate) client: ClientConfig,
    pub(crate) automation: AutomationConfig,
    pub(crate) scripts: ScriptPaths,
    pub(crate) folders: FolderPaths,
    pub(crate) gmail: GmailConfig,
    pub(crate) safety: SafetyConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientConfig {
    pub(crate) display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutomationConfig {
    pub(crate) automation_root_folder: String,
    pub(crate) automation_config_path: String,
    pub(crate) python_executable: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptPaths {
    pub(crate) invoice_workflow_script: String,
    pub(crate) gmail_draft_script: String,
    pub(crate) copy_scansioni_script: String,
    pub(crate) ocr_preprocessing_script: String,
    pub(crate) contract_processing_script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderPaths {
    pub(crate) invoice_input_folder: String,
    pub(crate) invoice_output_folder: String,
    pub(crate) invoice_archive_folder: String,
    pub(crate) invoice_log_folder: String,
    pub(crate) scansioni_network_share: String,
    pub(crate) scansioni_local_cache_folder: String,
    pub(crate) ocr_text_output_folder: String,
    pub(crate) contracts_output_folder: String,
    pub(crate) contract_log_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GmailConfig {
    pub(crate) token_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafetyConfig {
    pub(crate) dry_run_default: bool,
    pub(crate) require_confirmation_for_file_moves: bool,
    pub(crate) redact_logs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyHubConfig {
    paths: LegacyHubPaths,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyHubPaths {
    invoice_process_command: String,
    gmail_draft_command: String,
    gmail_token: String,
    invoices_input: String,
    ready_invoices: String,
    fatture_logs: String,
    copy_scansioni_command: String,
    network_scans: String,
    local_scans_cache: String,
    ocr_preprocess_script: String,
    ocr_text_output: String,
    contract_process_command: String,
    signed_contracts: String,
    codex_scripts: Option<String>,
}

pub(crate) fn ensure_config(app: &AppHandle) -> Result<HubConfig, String> {
    ensure_config_with_path(app).map(|(config, _)| config)
}

pub(crate) fn ensure_config_with_path(app: &AppHandle) -> Result<(HubConfig, PathBuf), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    let config_path = app_data_dir.join("config.json");

    if config_path.exists() {
        let contents = fs::read_to_string(&config_path)
            .map_err(|error| format!("Could not read config file: {error}"))?;
        let (config, should_rewrite) = parse_config_with_migration(&contents)?;
        if should_rewrite {
            write_config(&config_path, &config)?;
        }
        Ok((config, config_path))
    } else {
        let config = default_config();
        write_config(&config_path, &config)?;
        Ok((config, config_path))
    }
}

pub(crate) fn save_config_for_app(app: &AppHandle, config: &HubConfig) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    let config_path = app_data_dir.join("config.json");
    write_config(&config_path, config)?;
    Ok(config_path)
}

fn parse_config_with_migration(contents: &str) -> Result<(HubConfig, bool), String> {
    let value: serde_json::Value =
        serde_json::from_str(contents).map_err(|error| format!("Invalid config file: {error}"))?;

    if value.get("paths").is_some() {
        let legacy: LegacyHubConfig = serde_json::from_value(value)
            .map_err(|error| format!("Invalid legacy config file: {error}"))?;
        return Ok((config_from_legacy(legacy), true));
    }

    let default_value =
        serde_json::to_value(default_config()).map_err(|error| format!("Config error: {error}"))?;
    let merged = merge_json(default_value, value);
    let config: HubConfig = serde_json::from_value(merged.clone())
        .map_err(|error| format!("Invalid config file: {error}"))?;
    let original: serde_json::Value =
        serde_json::from_str(contents).map_err(|error| format!("Invalid config file: {error}"))?;
    Ok((config, merged != original))
}

fn merge_json(
    default_value: serde_json::Value,
    user_value: serde_json::Value,
) -> serde_json::Value {
    match (default_value, user_value) {
        (serde_json::Value::Object(mut default), serde_json::Value::Object(user)) => {
            for (key, value) in user {
                let merged_value = default
                    .remove(&key)
                    .map(|default_value| merge_json(default_value, value.clone()))
                    .unwrap_or(value);
                default.insert(key, merged_value);
            }
            serde_json::Value::Object(default)
        }
        (_, user_value) => user_value,
    }
}

fn write_config(config_path: &Path, config: &HubConfig) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(config)
        .map_err(|error| format!("Could not prepare config: {error}"))?;
    fs::write(config_path, contents).map_err(|error| format!("Could not write config: {error}"))
}

fn config_from_legacy(legacy: LegacyHubConfig) -> HubConfig {
    let paths = legacy.paths;
    let fatture_logs = paths.fatture_logs;
    HubConfig {
        schema_version: CONFIG_VERSION,
        client: ClientConfig {
            display_name: "Your Hotel".to_string(),
        },
        automation: default_config().automation,
        scripts: ScriptPaths {
            invoice_workflow_script: paths.invoice_process_command,
            gmail_draft_script: paths.gmail_draft_command,
            copy_scansioni_script: paths.copy_scansioni_command,
            ocr_preprocessing_script: paths.ocr_preprocess_script,
            contract_processing_script: paths.contract_process_command,
        },
        folders: FolderPaths {
            invoice_input_folder: paths.invoices_input,
            invoice_output_folder: paths.ready_invoices,
            invoice_archive_folder: default_config().folders.invoice_archive_folder,
            invoice_log_folder: fatture_logs.clone(),
            scansioni_network_share: paths.network_scans,
            scansioni_local_cache_folder: paths.local_scans_cache,
            ocr_text_output_folder: paths.ocr_text_output,
            contracts_output_folder: paths.signed_contracts,
            contract_log_folder: fatture_logs,
        },
        gmail: GmailConfig {
            token_path: paths.gmail_token,
        },
        safety: default_config().safety,
    }
}

pub(crate) fn default_config() -> HubConfig {
    let automation_root = default_automation_root();
    let automation_config_path = automation_root.join("config.local.json");
    let script_paths = canonical_script_paths(&automation_root);

    HubConfig {
        schema_version: CONFIG_VERSION,
        client: ClientConfig {
            display_name: "Your Hotel".to_string(),
        },
        automation: AutomationConfig {
            automation_root_folder: automation_root.to_string_lossy().to_string(),
            automation_config_path: automation_config_path.to_string_lossy().to_string(),
            python_executable: "python".to_string(),
        },
        scripts: ScriptPaths {
            invoice_workflow_script: script_paths.invoice_workflow_script,
            gmail_draft_script: script_paths.gmail_draft_script,
            copy_scansioni_script: script_paths.copy_scansioni_script,
            ocr_preprocessing_script: script_paths.ocr_preprocessing_script,
            contract_processing_script: script_paths.contract_processing_script,
        },
        folders: FolderPaths {
            invoice_input_folder: r"C:\InnPilot\workspace\Invoices\Input".to_string(),
            invoice_output_folder: r"C:\InnPilot\workspace\Invoices\ReadyToSend".to_string(),
            invoice_archive_folder: r"C:\InnPilot\workspace\Invoices\Archive".to_string(),
            invoice_log_folder: r"C:\InnPilot\workspace\Invoices\Logs".to_string(),
            scansioni_network_share: r"C:\InnPilot\workspace\Scans\IncomingCache".to_string(),
            scansioni_local_cache_folder: r"C:\InnPilot\workspace\Scans\IncomingCache".to_string(),
            ocr_text_output_folder: r"C:\InnPilot\workspace\Scans\TextOutput".to_string(),
            contracts_output_folder: r"C:\InnPilot\workspace\Contracts\2026\Signed".to_string(),
            contract_log_folder: r"C:\InnPilot\workspace\Contracts\Logs".to_string(),
        },
        gmail: GmailConfig {
            token_path: r"C:\InnPilot\workspace\Gmail\Token\gmail_token.json".to_string(),
        },
        safety: SafetyConfig {
            dry_run_default: false,
            require_confirmation_for_file_moves: true,
            redact_logs: true,
        },
    }
}

fn default_automation_root() -> PathBuf {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    default_automation_root_for_locations(exe_dir.as_deref(), &current_dir)
}

#[cfg(test)]
fn default_automation_root_for_current_dir(current_dir: &Path) -> PathBuf {
    default_automation_root_for_locations(None, current_dir)
}

fn default_automation_root_for_locations(exe_dir: Option<&Path>, current_dir: &Path) -> PathBuf {
    if let Some(exe_dir) = exe_dir {
        let installed_automation = exe_dir.join("automation");
        if looks_like_automation_root(&installed_automation) {
            return installed_automation;
        }
    }

    let current_automation = current_dir.join("automation");
    if looks_like_automation_root(&current_automation) {
        current_automation
    } else {
        PathBuf::from(r"C:\InnPilot\automation")
    }
}

pub(crate) fn canonical_script_paths(automation_root: &Path) -> ScriptPaths {
    ScriptPaths {
        invoice_workflow_script: automation_root
            .join("invoices")
            .join("process_fatture.py")
            .to_string_lossy()
            .to_string(),
        gmail_draft_script: automation_root
            .join("gmail_drafts")
            .join("create_gmail_draft.py")
            .to_string_lossy()
            .to_string(),
        copy_scansioni_script: automation_root
            .join("copy_scansioni.cmd")
            .to_string_lossy()
            .to_string(),
        ocr_preprocessing_script: automation_root
            .join("preprocess_scansioni_to_text.ps1")
            .to_string_lossy()
            .to_string(),
        contract_processing_script: automation_root
            .join("contracts")
            .join("process_contratti.py")
            .to_string_lossy()
            .to_string(),
    }
}

fn looks_like_automation_root(path: &Path) -> bool {
    path.join("invoices").join("process_fatture.py").is_file()
        && path
            .join("gmail_drafts")
            .join("create_gmail_draft.py")
            .is_file()
        && path
            .join("contracts")
            .join("process_contratti.py")
            .is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_contains_portable_schema_and_generic_defaults() {
        let config = default_config();

        assert_eq!(config.schema_version, CONFIG_VERSION);
        assert_eq!(config.client.display_name, "Your Hotel");
        assert!(config
            .scripts
            .invoice_workflow_script
            .contains("process_fatture.py"));
        assert!(config
            .automation
            .automation_config_path
            .contains("config.local.json"));
        assert!(config
            .automation
            .automation_root_folder
            .contains("automation"));
        assert_eq!(config.automation.python_executable, "python");
        assert!(config.safety.require_confirmation_for_file_moves);
        assert!(config.safety.redact_logs);
    }

    #[test]
    fn legacy_config_is_migrated_to_new_shape() {
        let old = r#"{
          "paths": {
            "invoice_process_command": "C:\\old\\invoice.cmd",
            "gmail_draft_command": "C:\\old\\gmail.cmd",
            "gmail_token": "C:\\old\\gmail_token.json",
            "invoices_input": "C:\\old\\input",
            "ready_invoices": "C:\\old\\ready",
            "fatture_logs": "C:\\old\\logs",
            "copy_scansioni_command": "C:\\old\\copy.cmd",
            "network_scans": "\\\\server\\shared\\Scansioni",
            "local_scans_cache": "C:\\old\\cache",
            "ocr_preprocess_script": "C:\\old\\ocr.ps1",
            "ocr_text_output": "C:\\old\\text",
            "contract_process_command": "C:\\old\\contracts.cmd",
            "signed_contracts": "C:\\old\\contracts"
          }
        }"#;

        let (config, should_rewrite) = parse_config_with_migration(old).unwrap();

        assert!(should_rewrite);
        assert_eq!(
            config.scripts.invoice_workflow_script,
            "C:\\old\\invoice.cmd"
        );
        assert!(config
            .automation
            .automation_config_path
            .contains("config.local.json"));
        assert_eq!(config.folders.invoice_output_folder, "C:\\old\\ready");
        assert_eq!(config.gmail.token_path, "C:\\old\\gmail_token.json");
    }

    #[test]
    fn repo_automation_root_is_used_when_canonical_scripts_exist() {
        let root = std::env::temp_dir().join("innpilot_repo_root_for_config_test");
        let automation = root.join("automation");
        fs::create_dir_all(automation.join("invoices")).unwrap();
        fs::create_dir_all(automation.join("gmail_drafts")).unwrap();
        fs::create_dir_all(automation.join("contracts")).unwrap();
        fs::write(automation.join("invoices").join("process_fatture.py"), b"").unwrap();
        fs::write(
            automation
                .join("gmail_drafts")
                .join("create_gmail_draft.py"),
            b"",
        )
        .unwrap();
        fs::write(
            automation.join("contracts").join("process_contratti.py"),
            b"",
        )
        .unwrap();

        assert_eq!(default_automation_root_for_current_dir(&root), automation);
    }

    #[test]
    fn managed_automation_root_is_used_when_repo_scripts_are_missing() {
        let root = std::env::temp_dir().join("innpilot_missing_repo_root_for_config_test");

        assert_eq!(
            default_automation_root_for_current_dir(&root),
            PathBuf::from(r"C:\InnPilot\automation")
        );
    }

    #[test]
    fn installed_exe_automation_root_is_preferred_over_current_directory() {
        let root = std::env::temp_dir().join("innpilot_installed_root_for_config_test");
        let exe_dir = root.join("installed");
        let current_dir = root.join("working");
        let automation = exe_dir.join("automation");
        create_canonical_script_markers(&automation);
        create_canonical_script_markers(&current_dir.join("automation"));

        assert_eq!(
            default_automation_root_for_locations(Some(&exe_dir), &current_dir),
            automation
        );
    }

    #[test]
    fn canonical_paths_are_derived_from_automation_root() {
        let root = PathBuf::from(r"C:\InnPilot\automation");
        let scripts = canonical_script_paths(&root);

        assert_eq!(
            scripts.invoice_workflow_script,
            r"C:\InnPilot\automation\invoices\process_fatture.py"
        );
        assert_eq!(
            scripts.gmail_draft_script,
            r"C:\InnPilot\automation\gmail_drafts\create_gmail_draft.py"
        );
        assert_eq!(
            scripts.contract_processing_script,
            r"C:\InnPilot\automation\contracts\process_contratti.py"
        );
    }

    fn create_canonical_script_markers(root: &Path) {
        fs::create_dir_all(root.join("invoices")).unwrap();
        fs::create_dir_all(root.join("gmail_drafts")).unwrap();
        fs::create_dir_all(root.join("contracts")).unwrap();
        fs::write(root.join("invoices").join("process_fatture.py"), b"").unwrap();
        fs::write(root.join("gmail_drafts").join("create_gmail_draft.py"), b"").unwrap();
        fs::write(root.join("contracts").join("process_contratti.py"), b"").unwrap();
    }
}
