use crate::config::HubConfig;
use std::{fs, path::Path};

pub(crate) fn is_allowed_path(config: &HubConfig, path: &str) -> bool {
    let folders = &config.folders;
    let allowed_roots = [
        folders.invoice_input_folder.as_str(),
        folders.invoice_output_folder.as_str(),
        folders.invoice_archive_folder.as_str(),
        folders.invoice_log_folder.as_str(),
        folders.scansioni_network_share.as_str(),
        folders.scansioni_local_cache_folder.as_str(),
        folders.ocr_text_output_folder.as_str(),
        folders.contracts_output_folder.as_str(),
        folders.contract_log_folder.as_str(),
    ];

    // Explorer only needs to open paths that already exist. Canonicalizing both
    // sides before comparing also resolves `..`, junctions and symlinks, so a
    // crafted child-looking path cannot escape a configured hotel folder.
    let Ok(target) = fs::canonicalize(Path::new(path)) else {
        return false;
    };

    allowed_roots.iter().any(|root| {
        if root.trim().is_empty() {
            return false;
        }
        fs::canonicalize(Path::new(root))
            .map(|allowed_root| target == allowed_root || target.starts_with(&allowed_root))
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        ClientConfig, FolderPaths, GmailConfig, HubConfig, InvoiceDeliveryMode, SafetyConfig,
        ScriptPaths,
    };
    use std::{
        fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn allowed_path_accepts_configured_folder_children() {
        let config = config_with_temp_paths();
        let child = Path::new(&config.folders.invoice_input_folder).join("sample.pdf");
        fs::write(&child, b"fake fixture").unwrap();

        assert!(is_allowed_path(&config, child.to_str().unwrap()));
        assert!(!is_allowed_path(&config, "C:\\unrelated\\sample.pdf"));
    }

    #[test]
    fn allowed_path_rejects_script_parent_and_script_sibling_folders() {
        let config = config_with_temp_paths();
        let script_parent = Path::new(&config.scripts.invoice_workflow_script)
            .parent()
            .unwrap();
        let sibling = script_parent.parent().unwrap().join("sibling");
        fs::create_dir_all(&sibling).unwrap();

        assert!(!is_allowed_path(&config, script_parent.to_str().unwrap()));
        assert!(!is_allowed_path(&config, sibling.to_str().unwrap()));
    }

    #[test]
    fn allowed_path_rejects_parent_traversal_that_resolves_outside_root() {
        let config = config_with_temp_paths();
        let allowed = Path::new(&config.folders.invoice_input_folder);
        let outside = allowed.parent().unwrap().join("outside");
        fs::create_dir_all(&outside).unwrap();
        let secret = outside.join("secret.txt");
        fs::write(&secret, b"fake fixture").unwrap();
        let traversal = allowed.join("..").join("outside").join("secret.txt");

        assert!(secret.exists());
        assert!(!is_allowed_path(
            &config,
            traversal.to_string_lossy().as_ref()
        ));
    }

    #[test]
    fn allowed_path_accepts_configured_business_folders() {
        let config = config_with_temp_paths();

        assert!(is_allowed_path(&config, &config.folders.invoice_log_folder));
        assert!(is_allowed_path(
            &config,
            &config.folders.contracts_output_folder
        ));
    }

    fn config_with_temp_paths() -> HubConfig {
        let root = std::env::temp_dir().join(format!(
            "innpilot_paths_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let scripts = root.join("scripts");
        let input = root.join("invoice-input");
        let output = root.join("invoice-output");
        let logs = root.join("logs");
        let network = root.join("network-scans");
        let cache = root.join("cache");
        let text = root.join("text");
        let contracts = root.join("contracts");

        for dir in [
            &scripts, &input, &output, &logs, &network, &cache, &text, &contracts,
        ] {
            fs::create_dir_all(dir).unwrap();
        }

        HubConfig {
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
                invoice_workflow_script: scripts.join("invoice.cmd").to_string_lossy().to_string(),
                gmail_draft_script: scripts.join("gmail.cmd").to_string_lossy().to_string(),
                copy_scansioni_script: scripts.join("copy.cmd").to_string_lossy().to_string(),
                ocr_preprocessing_script: scripts.join("ocr.ps1").to_string_lossy().to_string(),
                contract_processing_script: scripts
                    .join("contracts.cmd")
                    .to_string_lossy()
                    .to_string(),
            },
            folders: FolderPaths {
                invoice_input_folder: input.to_string_lossy().to_string(),
                invoice_output_folder: output.to_string_lossy().to_string(),
                invoice_archive_folder: root.join("archive").to_string_lossy().to_string(),
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
        }
    }
}
