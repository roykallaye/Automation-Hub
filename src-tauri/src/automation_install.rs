use crate::{
    config::{self, HubConfig, ScriptPaths},
    preflight,
};
use chrono::Local;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const CANONICAL_FILES: &[&str] = &[
    "invoices/process_fatture.py",
    "gmail_drafts/create_gmail_draft.py",
    "contracts/process_contratti.py",
    "shared/__init__.py",
    "shared/config.py",
    "shared/report.py",
    "requirements.txt",
    "README.md",
    "config.example.json",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedAutomationInstallResult {
    source_root: String,
    destination_root: String,
    copied: Vec<String>,
    skipped: Vec<String>,
    backed_up: Vec<String>,
    errors: Vec<String>,
    config_path: Option<String>,
    preflight: Option<preflight::PreflightReport>,
}

pub(crate) fn install_managed_automation_scripts(
    app: &AppHandle,
    confirmed: bool,
) -> Result<ManagedAutomationInstallResult, String> {
    if !confirmed {
        return Err(
            "This support action needs confirmation before FlowHost can install automation scripts."
                .to_string(),
        );
    }

    let source_root = locate_automation_source(app)?;
    let destination_root = managed_automation_root(app)?;
    let mut result = copy_canonical_files(&source_root, &destination_root)?;

    let (mut app_config, _) = config::ensure_config_with_path(app)?;
    apply_managed_root_to_config(&mut app_config, &destination_root);
    let config_path = config::save_config_for_app(app, &app_config)?;
    result.config_path = Some(config_path.to_string_lossy().to_string());
    result.preflight = Some(preflight::build_preflight_report(&app_config));

    Ok(result)
}

fn locate_automation_source(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("automation"));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("automation"));
    }

    find_automation_source(candidates)
}

fn find_automation_source(candidates: Vec<PathBuf>) -> Result<PathBuf, String> {
    candidates
        .into_iter()
        .find(|candidate| has_canonical_sources(candidate))
        .ok_or_else(|| {
            "FlowHost could not find its packaged automation scripts. Ask setup support to reinstall FlowHost or copy the automation folder manually.".to_string()
        })
}

fn managed_automation_root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?;
    Ok(app_data_dir.join("automation"))
}

fn has_canonical_sources(root: &Path) -> bool {
    for relative in CANONICAL_FILES {
        if !root.join(relative.replace('/', "\\")).is_file() {
            return false;
        }
    }
    true
}

fn copy_canonical_files(
    source_root: &Path,
    destination_root: &Path,
) -> Result<ManagedAutomationInstallResult, String> {
    fs::create_dir_all(destination_root)
        .map_err(|error| format!("Could not prepare managed automation folder: {error}"))?;

    let mut copied = Vec::new();
    let mut skipped = Vec::new();
    let mut backed_up = Vec::new();
    let mut errors = Vec::new();

    for relative in CANONICAL_FILES {
        let relative_path = PathBuf::from(relative.replace('/', "\\"));
        let source = source_root.join(&relative_path);
        let destination = destination_root.join(&relative_path);
        if is_forbidden_relative_path(&relative_path) {
            skipped.push(relative.to_string());
            continue;
        }
        if !source.is_file() {
            errors.push(format!("Missing packaged file: {relative}"));
            continue;
        }
        if let Some(parent) = destination.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                errors.push(format!("Could not create folder for {relative}: {error}"));
                continue;
            }
        }

        if destination.exists() {
            if destination.is_file() {
                match backup_existing_file(&destination) {
                    Ok(path) => backed_up.push(path.to_string_lossy().to_string()),
                    Err(error) => {
                        errors.push(format!("Could not back up {relative}: {error}"));
                        continue;
                    }
                }
            } else {
                errors.push(format!(
                    "Could not replace {relative}: destination is not a file."
                ));
                continue;
            }
        }

        match fs::copy(&source, &destination) {
            Ok(_) => copied.push(relative.to_string()),
            Err(error) => errors.push(format!("Could not copy {relative}: {error}")),
        }
    }

    Ok(ManagedAutomationInstallResult {
        source_root: source_root.to_string_lossy().to_string(),
        destination_root: destination_root.to_string_lossy().to_string(),
        copied,
        skipped,
        backed_up,
        errors,
        config_path: None,
        preflight: None,
    })
}

fn is_forbidden_relative_path(path: &Path) -> bool {
    let value = path.to_string_lossy().replace('/', "\\").to_lowercase();
    value.contains("__pycache__")
        || value.ends_with(".pyc")
        || value.ends_with(".log")
        || value.ends_with(".pdf")
        || value.contains("config.local.json")
        || value.contains("gmail_token")
        || value.contains("gmail_credentials")
        || value.contains("client_secret")
        || value.starts_with("input\\")
        || value.starts_with("output\\")
        || value.starts_with("archive\\")
}

fn backup_existing_file(path: &Path) -> Result<PathBuf, String> {
    let stamp = Local::now().format("%Y%m%d%H%M%S");
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("automation-file");
    let backup = path.with_file_name(format!("{file_name}.{stamp}.bak"));
    fs::copy(path, &backup).map_err(|error| error.to_string())?;
    Ok(backup)
}

fn apply_managed_root_to_config(config: &mut HubConfig, destination_root: &Path) {
    let previous_scripts = config.scripts.clone();
    let canonical = config::canonical_script_paths(destination_root);
    config.automation.automation_root_folder = destination_root.to_string_lossy().to_string();
    config.scripts = ScriptPaths {
        invoice_workflow_script: managed_or_explicit(
            &previous_scripts.invoice_workflow_script,
            "process_fatture.py",
            &canonical.invoice_workflow_script,
        ),
        gmail_draft_script: managed_or_explicit(
            &previous_scripts.gmail_draft_script,
            "create_gmail_draft.py",
            &canonical.gmail_draft_script,
        ),
        copy_scansioni_script: previous_scripts.copy_scansioni_script,
        ocr_preprocessing_script: previous_scripts.ocr_preprocessing_script,
        contract_processing_script: managed_or_explicit(
            &previous_scripts.contract_processing_script,
            "process_contratti.py",
            &canonical.contract_processing_script,
        ),
    };
}

fn managed_or_explicit(current: &str, canonical_file_name: &str, managed_path: &str) -> String {
    let path = Path::new(current);
    let current_name = path.file_name().and_then(|name| name.to_str());
    if current.trim().is_empty()
        || current_name.is_some_and(|name| name.eq_ignore_ascii_case(canonical_file_name))
    {
        managed_path.to_string()
    } else {
        current.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn copy_only_allowed_canonical_files() {
        let root = temp_root("copy_allowed");
        let source = root.join("source");
        let destination = root.join("destination");
        create_source_tree(&source);

        let result = copy_canonical_files(&source, &destination).unwrap();

        assert!(result.errors.is_empty());
        assert!(destination
            .join("invoices")
            .join("process_fatture.py")
            .is_file());
        assert!(destination
            .join("gmail_drafts")
            .join("create_gmail_draft.py")
            .is_file());
        assert!(destination
            .join("contracts")
            .join("process_contratti.py")
            .is_file());
        assert!(destination.join("shared").join("config.py").is_file());
        assert!(!destination.join("config.local.json").exists());
        assert!(!destination.join("gmail_token.json").exists());
        assert!(!destination.join("__pycache__").exists());
        assert_eq!(result.copied.len(), CANONICAL_FILES.len());
    }

    #[test]
    fn canonical_allowlist_contains_no_forbidden_paths() {
        for relative in CANONICAL_FILES {
            assert!(
                !is_forbidden_relative_path(Path::new(relative)),
                "canonical allowlist includes forbidden path: {relative}"
            );
        }
    }

    #[test]
    fn copy_does_not_delete_unrelated_destination_files() {
        let root = temp_root("keeps_unrelated");
        let source = root.join("source");
        let destination = root.join("destination");
        create_source_tree(&source);
        fs::create_dir_all(&destination).unwrap();
        let marker = destination.join("keep-me.txt");
        fs::write(&marker, b"keep").unwrap();

        copy_canonical_files(&source, &destination).unwrap();

        assert_eq!(fs::read_to_string(marker).unwrap(), "keep");
    }

    #[test]
    fn copy_backs_up_existing_versioned_files() {
        let root = temp_root("backup_existing");
        let source = root.join("source");
        let destination = root.join("destination");
        create_source_tree(&source);
        let existing = destination.join("invoices").join("process_fatture.py");
        fs::create_dir_all(existing.parent().unwrap()).unwrap();
        fs::write(&existing, b"old").unwrap();

        let result = copy_canonical_files(&source, &destination).unwrap();

        assert_eq!(fs::read_to_string(existing).unwrap(), "canonical");
        assert_eq!(result.backed_up.len(), 1);
        assert!(Path::new(&result.backed_up[0]).is_file());
    }

    #[test]
    fn config_points_to_managed_root_after_install() {
        let root = temp_root("config_managed");
        let destination = root.join("app-data").join("automation");
        let mut config = config::default_config();
        config.scripts.invoice_workflow_script = root
            .join("repo")
            .join("automation")
            .join("invoices")
            .join("process_fatture.py")
            .to_string_lossy()
            .to_string();
        config.scripts.gmail_draft_script = root
            .join("repo")
            .join("automation")
            .join("gmail_drafts")
            .join("create_gmail_draft.py")
            .to_string_lossy()
            .to_string();
        config.scripts.contract_processing_script = root
            .join("repo")
            .join("automation")
            .join("contracts")
            .join("process_contratti.py")
            .to_string_lossy()
            .to_string();
        config.scripts.copy_scansioni_script = r"C:\legacy\copy_scansioni.cmd".to_string();

        apply_managed_root_to_config(&mut config, &destination);

        assert_eq!(
            config.automation.automation_root_folder,
            destination.to_string_lossy()
        );
        assert_eq!(
            config.scripts.invoice_workflow_script,
            destination
                .join("invoices")
                .join("process_fatture.py")
                .to_string_lossy()
        );
        assert_eq!(
            config.scripts.copy_scansioni_script,
            r"C:\legacy\copy_scansioni.cmd"
        );
    }

    #[test]
    fn explicit_legacy_script_paths_are_preserved() {
        let root = temp_root("legacy_preserved");
        let destination = root.join("managed");
        let mut config = config::default_config();
        config.scripts.invoice_workflow_script = r"C:\legacy\run_invoice.cmd".to_string();

        apply_managed_root_to_config(&mut config, &destination);

        assert_eq!(
            config.scripts.invoice_workflow_script,
            r"C:\legacy\run_invoice.cmd"
        );
    }

    #[test]
    fn missing_source_returns_errors() {
        let root = temp_root("missing_source");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).unwrap();

        let result = copy_canonical_files(&source, &destination).unwrap();

        assert!(!result.errors.is_empty());
        assert!(result
            .errors
            .iter()
            .any(|error| error.contains("Missing packaged file")));
    }

    #[test]
    fn missing_source_returns_friendly_error() {
        let root = temp_root("missing_source_friendly");
        let error = find_automation_source(vec![root.join("missing")]).unwrap_err();

        assert!(error.contains("could not find its packaged automation scripts"));
    }

    #[test]
    fn preflight_sees_canonical_scripts_after_copy() {
        let root = temp_root("preflight_after_copy");
        let source = root.join("source");
        let destination = root.join("destination");
        create_source_tree(&source);
        copy_canonical_files(&source, &destination).unwrap();

        let scripts = config::canonical_script_paths(&destination);

        assert!(Path::new(&scripts.invoice_workflow_script).is_file());
        assert!(Path::new(&scripts.gmail_draft_script).is_file());
        assert!(Path::new(&scripts.contract_processing_script).is_file());
    }

    fn create_source_tree(source: &Path) {
        for relative in CANONICAL_FILES {
            let path = source.join(relative.replace('/', "\\"));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"canonical").unwrap();
        }
        fs::write(source.join("config.local.json"), b"must not copy").unwrap();
        fs::write(source.join("gmail_token.json"), b"must not copy").unwrap();
        fs::write(source.join("gmail_credentials.json"), b"must not copy").unwrap();
        fs::create_dir_all(source.join("__pycache__")).unwrap();
        fs::write(source.join("__pycache__").join("bad.pyc"), b"must not copy").unwrap();
        fs::write(source.join("report_1.json"), b"must not copy").unwrap();
        fs::write(source.join("real.pdf"), b"must not copy").unwrap();
    }

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "flowhost_automation_install_{name}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
