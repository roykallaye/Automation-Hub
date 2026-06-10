use crate::config::HubConfig;
use chrono::{DateTime, Local};
use serde::Serialize;
use std::{fs, path::PathBuf};

#[derive(Debug, Clone, Serialize)]
pub(crate) struct LogInfo {
    key: String,
    label: String,
    path: Option<String>,
    modified: Option<String>,
}

pub(crate) fn get_latest_logs(config: &HubConfig) -> Vec<LogInfo> {
    vec![
        latest_log(
            "invoice_logs",
            "Latest invoice log",
            &config.folders.invoice_log_folder,
            None,
        ),
        latest_log(
            "contract_logs",
            "Latest contract log",
            &config.folders.contract_log_folder,
            Some("contratt"),
        ),
    ]
}

fn latest_log(key: &str, label: &str, directory: &str, name_filter: Option<&str>) -> LogInfo {
    let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_lowercase();
            let is_log_like = file_name.ends_with(".log") || file_name.ends_with(".txt");
            if !is_log_like {
                continue;
            }
            if let Some(filter) = name_filter {
                if !file_name.contains(filter) {
                    continue;
                }
            }
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if newest
                        .as_ref()
                        .map(|(_, current)| modified > *current)
                        .unwrap_or(true)
                    {
                        newest = Some((path, modified));
                    }
                }
            }
        }
    }

    LogInfo {
        key: key.to_string(),
        label: label.to_string(),
        path: newest
            .as_ref()
            .map(|(path, _)| path.to_string_lossy().to_string()),
        modified: newest.map(|(_, modified)| DateTime::<Local>::from(modified).to_rfc3339()),
    }
}
