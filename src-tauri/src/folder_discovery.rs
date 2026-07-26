use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

const MAX_FOLDER_PREVIEW: usize = 50;
const MAX_FILE_PREVIEW: usize = 30;
const MAX_COUNTED_ENTRIES: usize = 500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderInspection {
    selected_path: String,
    exists: bool,
    is_directory: bool,
    readable: bool,
    writable: bool,
    parent: Option<String>,
    parent_name: Option<String>,
    nearby_folders: Vec<FolderCandidate>,
    child_folders: Vec<FolderCandidate>,
    file_counts_by_extension: BTreeMap<String, usize>,
    pdf_count: usize,
    txt_count: usize,
    json_count: usize,
    recent_modified_preview: Vec<String>,
    warnings: Vec<String>,
    suggested_role: Option<String>,
    confidence: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderCandidate {
    path: String,
    name: String,
    suggested_role: Option<String>,
    confidence: u8,
    reason: String,
}

#[derive(Debug)]
struct FilePreview {
    name: String,
    modified: Option<SystemTime>,
}

pub(crate) fn inspect_existing_folder(path: String) -> Result<FolderInspection, String> {
    let selected = clean_input_path(&path)?;
    validate_discovery_path(&selected)?;

    let exists = selected.exists();
    if !exists {
        return Err("Folder not found. Choose an existing folder.".to_string());
    }
    let is_directory = selected.is_dir();
    if !is_directory {
        return Err("Choose a folder, not a file.".to_string());
    }

    let readable = fs::read_dir(&selected).is_ok();
    let writable = selected
        .metadata()
        .map(|metadata| !metadata.permissions().readonly())
        .unwrap_or(false);

    let parent = selected.parent().map(Path::to_path_buf);
    let mut warnings = Vec::new();
    if !readable {
        warnings.push("InnPilot cannot read this folder.".to_string());
    }
    if !writable {
        warnings.push("This folder may be read-only.".to_string());
    }

    let (file_counts_by_extension, recent_modified_preview) = summarize_files(&selected);
    let child_folders = folder_candidates(&selected, MAX_FOLDER_PREVIEW);
    let nearby_folders = parent
        .as_ref()
        .map(|parent| folder_candidates(parent, MAX_FOLDER_PREVIEW))
        .unwrap_or_default();
    let suggestion = suggest_role_for_path(&selected);

    Ok(FolderInspection {
        selected_path: selected.to_string_lossy().to_string(),
        exists,
        is_directory,
        readable,
        writable,
        parent: parent
            .as_ref()
            .map(|parent| parent.to_string_lossy().to_string()),
        parent_name: parent
            .as_ref()
            .and_then(|parent| parent.file_name())
            .map(|name| name.to_string_lossy().to_string()),
        nearby_folders,
        child_folders,
        pdf_count: *file_counts_by_extension.get("pdf").unwrap_or(&0),
        txt_count: *file_counts_by_extension.get("txt").unwrap_or(&0),
        json_count: *file_counts_by_extension.get("json").unwrap_or(&0),
        file_counts_by_extension,
        recent_modified_preview,
        warnings,
        suggested_role: suggestion
            .as_ref()
            .map(|suggestion| suggestion.role.to_string()),
        confidence: suggestion.map(|suggestion| suggestion.confidence),
    })
}

fn clean_input_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim().trim_matches('"').trim_matches('\'').trim();
    if trimmed.is_empty() {
        return Err("Choose a folder before inspecting.".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

fn validate_discovery_path(path: &Path) -> Result<(), String> {
    let normalized = normalize_path(path);
    let dangerous_exact = [
        r"c:",
        r"c:\",
        r"c:\windows",
        r"c:\program files",
        r"c:\program files (x86)",
    ];
    if dangerous_exact.iter().any(|danger| normalized == *danger) {
        return Err("Choose a normal work folder, not a Windows system folder.".to_string());
    }

    if normalized.ends_with(r"\users") || is_user_home_root(path) {
        return Err("Choose a specific work folder, not the whole user folder.".to_string());
    }

    let blocked_segments = ["node_modules", "target", "dist", ".git"];
    if path.components().any(|component| match component {
        Component::Normal(value) => blocked_segments
            .iter()
            .any(|segment| value.to_string_lossy().eq_ignore_ascii_case(segment)),
        _ => false,
    }) {
        return Err(
            "Choose a hotel work folder, not a build or source-control folder.".to_string(),
        );
    }

    Ok(())
}

fn folder_candidates(path: &Path, limit: usize) -> Vec<FolderCandidate> {
    let Ok(entries) = fs::read_dir(path) else {
        return Vec::new();
    };

    let mut folders = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let suggestion = suggest_role_for_name(&name);
            Some(FolderCandidate {
                path: path.to_string_lossy().to_string(),
                name,
                suggested_role: suggestion
                    .as_ref()
                    .map(|suggestion| suggestion.role.to_string()),
                confidence: suggestion
                    .as_ref()
                    .map(|suggestion| suggestion.confidence)
                    .unwrap_or(0),
                reason: suggestion
                    .map(|suggestion| suggestion.reason.to_string())
                    .unwrap_or_else(|| "No clear match yet.".to_string()),
            })
        })
        .collect::<Vec<_>>();
    folders.sort_by_key(|folder| folder.name.to_lowercase());
    folders.truncate(limit);
    folders
}

fn summarize_files(path: &Path) -> (BTreeMap<String, usize>, Vec<String>) {
    let Ok(entries) = fs::read_dir(path) else {
        return (BTreeMap::new(), Vec::new());
    };
    let mut counts = BTreeMap::new();
    let mut previews = Vec::new();

    for entry in entries.filter_map(Result::ok).take(MAX_COUNTED_ENTRIES) {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }
        let extension = entry_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_lowercase())
            .unwrap_or_else(|| "no_extension".to_string());
        *counts.entry(extension).or_insert(0) += 1;

        if previews.len() < MAX_FILE_PREVIEW {
            previews.push(FilePreview {
                name: entry.file_name().to_string_lossy().to_string(),
                modified: entry
                    .metadata()
                    .and_then(|metadata| metadata.modified())
                    .ok(),
            });
        }
    }

    previews.sort_by_key(|preview| std::cmp::Reverse(preview.modified));
    (
        counts,
        previews
            .into_iter()
            .take(MAX_FILE_PREVIEW)
            .map(|preview| preview.name)
            .collect(),
    )
}

#[derive(Debug, Clone)]
struct RoleSuggestion {
    role: &'static str,
    confidence: u8,
    reason: &'static str,
}

fn suggest_role_for_path(path: &Path) -> Option<RoleSuggestion> {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(suggest_role_for_name)
}

fn suggest_role_for_name(name: &str) -> Option<RoleSuggestion> {
    let normalized = name.to_lowercase();
    let contains_any = |needles: &[&str]| needles.iter().any(|needle| normalized.contains(needle));

    if contains_any(&["credentials", "credenziali"]) {
        return Some(role(
            "gmailCredentialsFolder",
            88,
            "Name looks like Gmail credentials.",
        ));
    }
    if contains_any(&["token"]) {
        return Some(role(
            "gmailTokenFolder",
            86,
            "Name looks like a Gmail sign-in folder.",
        ));
    }
    if contains_any(&["ready", "pronto", "invio", "output"]) {
        return Some(role(
            "invoiceOutputFolder",
            82,
            "Name looks like ready invoice output.",
        ));
    }
    if contains_any(&["archive", "archivio"]) {
        return Some(role(
            "invoiceArchiveFolder",
            84,
            "Name looks like an archive.",
        ));
    }
    if contains_any(&["log", "logs"]) {
        return Some(role(
            "invoiceLogFolder",
            65,
            "Name looks like a log folder.",
        ));
    }
    if contains_any(&["firmati", "signed"]) && contains_any(&["contratti", "contracts"]) {
        return Some(role(
            "contractsOutputFolder",
            88,
            "Name looks like signed contracts.",
        ));
    }
    if contains_any(&["contratti", "contracts"]) {
        return Some(role(
            "contractsOutputFolder",
            72,
            "Name looks contract-related.",
        ));
    }
    if contains_any(&["ocr", "text", "testo", "txt"]) {
        return Some(role(
            "ocrTextOutputFolder",
            78,
            "Name looks like extracted text.",
        ));
    }
    if contains_any(&["scansioni", "scans", "scanner", "scan"]) {
        return Some(role(
            "scansioniNetworkShare",
            74,
            "Name looks scan-related.",
        ));
    }
    if contains_any(&["input", "ingresso", "entrata"])
        || contains_any(&["fatture", "fattura", "invoice", "invoices"])
    {
        return Some(role(
            "invoiceInputFolder",
            70,
            "Name looks invoice-related.",
        ));
    }

    None
}

fn role(role: &'static str, confidence: u8, reason: &'static str) -> RoleSuggestion {
    RoleSuggestion {
        role,
        confidence,
        reason,
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn trims_quoted_paths() {
        let root = temp_root("quoted");
        fs::create_dir_all(&root).unwrap();
        let inspected = inspect_existing_folder(format!("\"{}\"", root.to_string_lossy())).unwrap();

        assert_eq!(inspected.selected_path, root.to_string_lossy());
    }

    #[test]
    fn rejects_build_folders() {
        let root = temp_root("blocked").join("node_modules").join("data");
        fs::create_dir_all(&root).unwrap();

        let error = inspect_existing_folder(root.to_string_lossy().to_string()).unwrap_err();

        assert!(error.contains("build or source-control"));
    }

    #[test]
    fn returns_directory_summary_without_file_contents() {
        let root = temp_root("summary");
        fs::create_dir_all(root.join("ReadyToSend")).unwrap();
        fs::write(root.join("guest_invoice.pdf"), b"SECRET GUEST CONTENT").unwrap();
        fs::write(root.join("notes.txt"), b"PRIVATE NOTE").unwrap();

        let inspected = inspect_existing_folder(root.to_string_lossy().to_string()).unwrap();
        let serialized = serde_json::to_string(&inspected).unwrap();

        assert!(inspected.readable);
        assert_eq!(inspected.pdf_count, 1);
        assert_eq!(inspected.txt_count, 1);
        assert!(inspected
            .child_folders
            .iter()
            .any(|folder| folder.name == "ReadyToSend"));
        assert!(!serialized.contains("SECRET GUEST CONTENT"));
        assert!(!serialized.contains("PRIVATE NOTE"));
    }

    #[test]
    fn caps_file_preview() {
        let root = temp_root("caps");
        fs::create_dir_all(&root).unwrap();
        for index in 0..40 {
            fs::write(root.join(format!("invoice-{index}.pdf")), b"fake").unwrap();
        }

        let inspected = inspect_existing_folder(root.to_string_lossy().to_string()).unwrap();

        assert_eq!(inspected.recent_modified_preview.len(), MAX_FILE_PREVIEW);
    }

    #[test]
    fn suggests_roles_from_folder_names() {
        let root = temp_root("roles");
        let input = root.join("Fatture").join("Input");
        let archive = root.join("Fatture").join("Archivio");
        fs::create_dir_all(&input).unwrap();
        fs::create_dir_all(&archive).unwrap();

        let inspected = inspect_existing_folder(input.to_string_lossy().to_string()).unwrap();

        assert_eq!(
            inspected.suggested_role.as_deref(),
            Some("invoiceInputFolder")
        );
        assert!(inspected
            .nearby_folders
            .iter()
            .any(|folder| folder.suggested_role.as_deref() == Some("invoiceArchiveFolder")));
    }

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "innpilot_discovery_{name}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
