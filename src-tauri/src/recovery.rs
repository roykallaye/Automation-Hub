use crate::{config, runner_ledger};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{AppHandle, Manager};

const MANIFEST_SCHEMA: u32 = 1;
const MANIFEST_FILE: &str = "manifest.json";
const APP_CONFIG_FILE: &str = "app-config.json";
const AUTOMATION_CONFIG_FILE: &str = "automation-config.json";
const LEDGER_FILE: &str = "runner.db";
const MAX_RECOVERY_POINTS: usize = 10;
const MAX_CONFIG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LEDGER_BYTES: u64 = 256 * 1024 * 1024;
static RECOVERY_POINT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryPoint {
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) app_version: String,
    pub(crate) integrity: String,
    pub(crate) includes_app_config: bool,
    pub(crate) includes_automation_config: bool,
    pub(crate) includes_runner_ledger: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryStatus {
    pub(crate) points: Vec<RecoveryPoint>,
    pub(crate) retention_limit: usize,
    pub(crate) excluded_data: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryActionResult {
    pub(crate) point: RecoveryPoint,
    pub(crate) pre_restore_point_id: Option<String>,
    pub(crate) restored_configuration: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryManifest {
    schema_version: u32,
    id: String,
    created_at: String,
    app_version: String,
    files: Vec<RecoveryFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryFile {
    role: String,
    file_name: String,
    sha256: String,
    bytes: u64,
}

pub(crate) fn status(app: &AppHandle) -> Result<RecoveryStatus, String> {
    let root = recovery_root(app)?;
    Ok(status_in_root(&root))
}

/// Reads the exact configuration bytes from a verified, status-recognized
/// recovery point. No files are restored or otherwise mutated.
pub(crate) fn read_configuration_point_bytes(
    app: &AppHandle,
    point_id: &str,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let root = recovery_root(app)?;
    read_configuration_point_bytes_in_root(&root, point_id)
}

pub(crate) fn create(app: &AppHandle) -> Result<RecoveryActionResult, String> {
    let _workflow_lock =
        runner_ledger::ProcessLock::try_acquire(app, "workflow")?.ok_or_else(|| {
            "Wait for the current automation to finish before creating a recovery point."
                .to_string()
        })?;
    let point = create_locked(app)?;
    Ok(RecoveryActionResult {
        point,
        pre_restore_point_id: None,
        restored_configuration: false,
    })
}

pub(crate) fn restore_configuration(
    app: &AppHandle,
    point_id: &str,
    confirmed: bool,
) -> Result<RecoveryActionResult, String> {
    if !confirmed {
        return Err("Configuration restore requires confirmation.".to_string());
    }
    validate_point_id(point_id)?;
    let _workflow_lock =
        runner_ledger::ProcessLock::try_acquire(app, "workflow")?.ok_or_else(|| {
            "Wait for the current automation to finish before restoring configuration.".to_string()
        })?;

    let root = recovery_root(app)?;
    let point_dir = safe_point_dir(&root, point_id)?;
    let manifest = read_manifest(&point_dir)?;
    verify_manifest(&point_dir, &manifest)?;

    let app_config_bytes = read_limited(&point_dir.join(APP_CONFIG_FILE), MAX_CONFIG_BYTES)?;
    let restored_config: config::HubConfig =
        serde_json::from_slice(&app_config_bytes).map_err(|_| {
            "The selected recovery point contains an invalid InnPilot configuration.".to_string()
        })?;

    let automation_backup = manifest
        .files
        .iter()
        .find(|file| file.role == "automation_config")
        .map(|_| read_limited(&point_dir.join(AUTOMATION_CONFIG_FILE), MAX_CONFIG_BYTES))
        .transpose()?;
    if let Some(bytes) = &automation_backup {
        validate_json_object(bytes, "automation configuration")?;
    }

    let pre_restore = create_locked(app)?;
    let (_, app_config_path) = config::ensure_config_with_path(app)?;
    let automation_target = automation_backup
        .as_ref()
        .map(|_| aligned_automation_config_path(&restored_config))
        .transpose()?;

    let previous_automation = automation_target
        .as_ref()
        .map(|path| read_optional_limited(path, MAX_CONFIG_BYTES))
        .transpose()?;

    if let (Some(target), Some(bytes)) = (&automation_target, &automation_backup) {
        atomic_replace(target, bytes)?;
    }
    if let Err(error) = atomic_replace(&app_config_path, &app_config_bytes) {
        if let (Some(target), Some(previous)) = (&automation_target, previous_automation.as_ref()) {
            let _ = match previous {
                Some(bytes) => atomic_replace(target, bytes),
                None => remove_if_exists(target),
            };
        }
        return Err(format!(
            "Configuration restore was rolled back because InnPilot could not replace its main settings: {error}"
        ));
    }

    let point = point_from_manifest(&manifest, "ready");
    Ok(RecoveryActionResult {
        point,
        pre_restore_point_id: Some(pre_restore.id),
        restored_configuration: true,
    })
}

fn create_locked(app: &AppHandle) -> Result<RecoveryPoint, String> {
    let (hub_config, config_path) = config::ensure_config_with_path(app)?;
    let app_config_bytes = read_limited(&config_path, MAX_CONFIG_BYTES)?;
    let automation_config_bytes = aligned_automation_config_path(&hub_config)
        .ok()
        .map(|path| read_limited(&path, MAX_CONFIG_BYTES))
        .transpose()?;
    create_configuration_point_from_bytes_locked(
        app,
        &app_config_bytes,
        automation_config_bytes.as_deref(),
    )
}

/// Creates a normal, status-visible recovery point from an exact configuration
/// snapshot that the caller has already loaded while holding the workflow and
/// installation configuration locks.
///
/// This helper deliberately acquires neither of those locks and does not infer
/// or constrain the automation configuration path. That makes it suitable for
/// an existing-folders installation whose automation file is not directly
/// below the configured automation root. The supplied bytes remain subject to
/// the same JSON, size, integrity, and retention rules as user-created points.
pub(crate) fn create_configuration_point_from_bytes_locked(
    app: &AppHandle,
    app_config_bytes: &[u8],
    automation_config_bytes: Option<&[u8]>,
) -> Result<RecoveryPoint, String> {
    let root = recovery_root(app)?;
    create_configuration_point_from_bytes_in_root(
        &root,
        &app.package_info().version.to_string(),
        app_config_bytes,
        automation_config_bytes,
        |destination| runner_ledger::backup_database(app, destination),
    )
}

fn create_configuration_point_from_bytes_in_root<F>(
    root: &Path,
    app_version: &str,
    app_config_bytes: &[u8],
    automation_config_bytes: Option<&[u8]>,
    backup_ledger: F,
) -> Result<RecoveryPoint, String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    validate_recovery_config_bytes(app_config_bytes, "InnPilot settings")?;
    let app_config_text = std::str::from_utf8(app_config_bytes).map_err(|_| {
        "InnPilot settings are not valid and cannot be backed up safely.".to_string()
    })?;
    config::parse_config_with_migration(app_config_text).map_err(|_| {
        "InnPilot settings are not valid and cannot be backed up safely.".to_string()
    })?;
    if let Some(bytes) = automation_config_bytes {
        validate_recovery_config_bytes(bytes, "automation configuration")?;
    }

    fs::create_dir_all(root)
        .map_err(|error| format!("Could not prepare the private recovery folder: {error}"))?;

    let created_at = Utc::now();
    let sequence = RECOVERY_POINT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let id = format!(
        "{}-{}-{sequence:016}",
        created_at.format("%Y%m%dT%H%M%S%3fZ"),
        std::process::id()
    );
    validate_point_id(&id)?;
    let partial = root.join(format!(".partial-{id}"));
    let final_dir = root.join(&id);
    if partial.exists() || final_dir.exists() {
        return Err("Could not allocate a unique recovery point.".to_string());
    }
    fs::create_dir(&partial)
        .map_err(|error| format!("Could not start the recovery point: {error}"))?;

    let result = (|| {
        let mut files = Vec::new();
        write_recovery_file(
            &partial,
            APP_CONFIG_FILE,
            "app_config",
            app_config_bytes,
            &mut files,
        )?;
        if let Some(bytes) = automation_config_bytes {
            write_recovery_file(
                &partial,
                AUTOMATION_CONFIG_FILE,
                "automation_config",
                bytes,
                &mut files,
            )?;
        }

        let ledger_path = partial.join(LEDGER_FILE);
        backup_ledger(&ledger_path)?;
        files.push(digest_file("runner_ledger", LEDGER_FILE, &ledger_path)?);

        let manifest = RecoveryManifest {
            schema_version: MANIFEST_SCHEMA,
            id: id.clone(),
            created_at: created_at.to_rfc3339(),
            app_version: app_version.to_string(),
            files,
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Could not prepare the recovery manifest: {error}"))?;
        write_synced(&partial.join(MANIFEST_FILE), &manifest_bytes)?;
        verify_manifest(&partial, &manifest)?;
        fs::rename(&partial, &final_dir)
            .map_err(|error| format!("Could not finalize the recovery point: {error}"))?;

        let point = point_from_manifest(&manifest, "ready");
        prune_old_points(root)?;
        Ok(point)
    })();

    if result.is_err() && partial.exists() {
        let _ = fs::remove_dir_all(&partial);
    }
    result
}

fn recovery_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("recovery"))
        .map_err(|error| format!("Could not locate the private recovery folder: {error}"))
}

fn status_in_root(root: &Path) -> RecoveryStatus {
    let mut points = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let Some(id) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if validate_point_id(&id).is_err() || !entry.path().is_dir() {
                continue;
            }
            match read_manifest(&entry.path()) {
                Ok(manifest) => {
                    let integrity = if verify_manifest(&entry.path(), &manifest).is_ok() {
                        "ready"
                    } else {
                        "damaged"
                    };
                    points.push(point_from_manifest(&manifest, integrity));
                }
                Err(_) => points.push(RecoveryPoint {
                    id,
                    created_at: String::new(),
                    app_version: String::new(),
                    integrity: "damaged".to_string(),
                    includes_app_config: false,
                    includes_automation_config: false,
                    includes_runner_ledger: false,
                }),
            }
        }
    }
    points.sort_by(|left, right| right.id.cmp(&left.id));
    RecoveryStatus {
        points,
        retention_limit: MAX_RECOVERY_POINTS,
        excluded_data: vec![
            "hotel_documents".to_string(),
            "gmail_credentials_and_tokens".to_string(),
            "activity_logs_and_reports".to_string(),
            "device_private_key".to_string(),
        ],
    }
}

fn read_configuration_point_bytes_in_root(
    root: &Path,
    point_id: &str,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let point_dir = safe_point_dir(root, point_id)?;
    let manifest = read_manifest(&point_dir)?;
    verify_manifest(&point_dir, &manifest)?;

    let app_config_bytes = read_limited(&point_dir.join(APP_CONFIG_FILE), MAX_CONFIG_BYTES)?;
    validate_recovery_config_bytes(&app_config_bytes, "InnPilot settings")?;
    let app_config_text = std::str::from_utf8(&app_config_bytes)
        .map_err(|_| "The recovery point contains invalid InnPilot settings.".to_string())?;
    config::parse_config_with_migration(app_config_text)
        .map_err(|_| "The recovery point contains invalid InnPilot settings.".to_string())?;

    let automation_config_bytes = manifest
        .files
        .iter()
        .any(|file| file.role == "automation_config")
        .then(|| read_limited(&point_dir.join(AUTOMATION_CONFIG_FILE), MAX_CONFIG_BYTES))
        .transpose()?;
    if let Some(bytes) = &automation_config_bytes {
        validate_recovery_config_bytes(bytes, "automation configuration")?;
    }

    Ok((app_config_bytes, automation_config_bytes))
}

fn read_manifest(point_dir: &Path) -> Result<RecoveryManifest, String> {
    let bytes = read_limited(&point_dir.join(MANIFEST_FILE), MAX_CONFIG_BYTES)?;
    let manifest: RecoveryManifest = serde_json::from_slice(&bytes)
        .map_err(|_| "The recovery manifest is invalid.".to_string())?;
    if manifest.schema_version != MANIFEST_SCHEMA {
        return Err("This recovery point uses an unsupported format.".to_string());
    }
    validate_point_id(&manifest.id)?;
    if point_dir.file_name().and_then(|name| name.to_str()) != Some(manifest.id.as_str()) {
        return Err("The recovery manifest does not match its folder.".to_string());
    }
    Ok(manifest)
}

fn verify_manifest(point_dir: &Path, manifest: &RecoveryManifest) -> Result<(), String> {
    if !(2..=3).contains(&manifest.files.len()) {
        return Err("The recovery manifest contains an unsafe file count.".to_string());
    }
    let mut app_configs = 0;
    let mut ledgers = 0;
    let mut automation_configs = 0;
    for file in &manifest.files {
        let expected_name = match file.role.as_str() {
            "app_config" => {
                app_configs += 1;
                APP_CONFIG_FILE
            }
            "automation_config" => {
                automation_configs += 1;
                AUTOMATION_CONFIG_FILE
            }
            "runner_ledger" => {
                ledgers += 1;
                LEDGER_FILE
            }
            _ => return Err("The recovery manifest contains an unknown file role.".to_string()),
        };
        if file.file_name != expected_name {
            return Err("The recovery manifest contains an unsafe filename.".to_string());
        }
        let actual = digest_file(&file.role, expected_name, &point_dir.join(expected_name))?;
        if actual.sha256 != file.sha256 || actual.bytes != file.bytes {
            return Err("A recovery file failed its integrity check.".to_string());
        }
    }
    if app_configs != 1 || ledgers != 1 || automation_configs > 1 {
        return Err("The recovery manifest has incomplete or duplicate files.".to_string());
    }
    Ok(())
}

fn point_from_manifest(manifest: &RecoveryManifest, integrity: &str) -> RecoveryPoint {
    RecoveryPoint {
        id: manifest.id.clone(),
        created_at: manifest.created_at.clone(),
        app_version: manifest.app_version.clone(),
        integrity: integrity.to_string(),
        includes_app_config: manifest.files.iter().any(|file| file.role == "app_config"),
        includes_automation_config: manifest
            .files
            .iter()
            .any(|file| file.role == "automation_config"),
        includes_runner_ledger: manifest
            .files
            .iter()
            .any(|file| file.role == "runner_ledger"),
    }
}

fn validate_point_id(id: &str) -> Result<(), String> {
    if id.len() < 20
        || id.len() > 64
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("The recovery point identifier is invalid.".to_string());
    }
    Ok(())
}

fn safe_point_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    validate_point_id(id)?;
    let root = fs::canonicalize(root)
        .map_err(|_| "The private recovery folder is unavailable.".to_string())?;
    let candidate = root.join(id);
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|_| "The selected recovery point does not exist.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The selected recovery point is not a safe folder.".to_string());
    }
    let canonical = fs::canonicalize(&candidate)
        .map_err(|_| "The selected recovery point cannot be verified.".to_string())?;
    if canonical.parent() != Some(root.as_path()) {
        return Err(
            "The selected recovery point is outside the private recovery folder.".to_string(),
        );
    }
    Ok(canonical)
}

fn aligned_automation_config_path(config: &config::HubConfig) -> Result<PathBuf, String> {
    let root = PathBuf::from(&config.automation.automation_root_folder);
    let candidate = PathBuf::from(&config.automation.automation_config_path);
    if candidate.file_name().and_then(|name| name.to_str()) != Some("config.local.json") {
        return Err("The automation setup filename is not eligible for recovery.".to_string());
    }
    let root = fs::canonicalize(&root)
        .map_err(|_| "The managed automation folder is unavailable.".to_string())?;
    let parent = candidate
        .parent()
        .ok_or_else(|| "The automation setup path has no parent folder.".to_string())?;
    let parent = fs::canonicalize(parent)
        .map_err(|_| "The automation setup folder is unavailable.".to_string())?;
    if parent != root {
        return Err(
            "The automation setup file is outside the managed automation folder.".to_string(),
        );
    }
    Ok(candidate)
}

fn write_recovery_file(
    directory: &Path,
    file_name: &str,
    role: &str,
    bytes: &[u8],
    files: &mut Vec<RecoveryFile>,
) -> Result<(), String> {
    let path = directory.join(file_name);
    write_synced(&path, bytes)?;
    files.push(digest_file(role, file_name, &path)?);
    Ok(())
}

fn digest_file(role: &str, file_name: &str, path: &Path) -> Result<RecoveryFile, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Could not read a recovery file: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("Could not inspect a recovery file: {error}"))?;
    let mut hasher = Sha256::new();
    let max_bytes = if role == "runner_ledger" {
        MAX_LEDGER_BYTES
    } else {
        MAX_CONFIG_BYTES
    };
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err("A recovery file exceeds its safe size boundary.".to_string());
    }
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not verify a recovery file: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(RecoveryFile {
        role: role.to_string(),
        file_name: file_name.to_string(),
        sha256: format!("{:x}", hasher.finalize()),
        bytes: metadata.len(),
    })
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect a recovery source: {error}"))?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(
            "A recovery source is not a regular file or exceeds the safe size limit.".to_string(),
        );
    }
    fs::read(path).map_err(|error| format!("Could not read a recovery source: {error}"))
}

fn read_optional_limited(path: &Path, limit: u64) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    read_limited(path, limit).map(Some)
}

fn validate_json_object(bytes: &[u8], label: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| format!("The {label} is not valid JSON."))?;
    if !value.is_object() {
        return Err(format!("The {label} must contain a JSON object."));
    }
    Ok(())
}

fn validate_recovery_config_bytes(bytes: &[u8], label: &str) -> Result<(), String> {
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        return Err(format!("The {label} exceeds the safe recovery size limit."));
    }
    validate_json_object(bytes, label)
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file =
        File::create(path).map_err(|error| format!("Could not create a recovery file: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("Could not write a recovery file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not safely flush a recovery file: {error}"))
}

fn atomic_replace(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "The configuration target has no parent folder.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare the configuration folder: {error}"))?;
    let temp = target.with_extension("recovery-tmp");
    let rollback = target.with_extension("pre-recovery");
    remove_if_exists(&temp)?;
    remove_if_exists(&rollback)?;
    write_synced(&temp, bytes)?;

    if target.exists() {
        fs::rename(target, &rollback)
            .map_err(|error| format!("Could not preserve the current configuration: {error}"))?;
    }
    if let Err(error) = fs::rename(&temp, target) {
        if rollback.exists() {
            let _ = fs::rename(&rollback, target);
        }
        let _ = remove_if_exists(&temp);
        return Err(format!(
            "Could not activate the recovered configuration: {error}"
        ));
    }
    remove_if_exists(&rollback)
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove a temporary recovery file: {error}"
        )),
    }
}

fn prune_old_points(root: &Path) -> Result<(), String> {
    let status = status_in_root(root);
    for point in status.points.iter().skip(MAX_RECOVERY_POINTS) {
        let point_dir = safe_point_dir(root, &point.id)?;
        fs::remove_dir_all(point_dir)
            .map_err(|error| format!("Could not prune an old recovery point: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const APP_CONFIG_FIXTURE: &[u8] =
        include_bytes!("../test-fixtures/config-preservation/app-v2-custom.json");
    const LEGACY_APP_CONFIG_FIXTURE: &[u8] =
        include_bytes!("../test-fixtures/config-preservation/app-v1-legacy.json");
    const AUTOMATION_CONFIG_FIXTURE: &[u8] =
        include_bytes!("../test-fixtures/config-preservation/automation-custom.json");

    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "innpilot_recovery_{label}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn point_ids_reject_traversal_and_hidden_partial_folders() {
        assert!(validate_point_id("../../secrets").is_err());
        assert!(validate_point_id(".partial-20260726T120000000Z-1").is_err());
        assert!(validate_point_id("20260726T120000000Z-1234").is_ok());
    }

    #[test]
    fn manifest_integrity_detects_tampering_and_unknown_files() {
        let root = temp_root("integrity");
        let id = "20260726T120000000Z-1234";
        let point = root.join(id);
        fs::create_dir(&point).unwrap();
        let mut files = Vec::new();
        write_recovery_file(&point, APP_CONFIG_FILE, "app_config", b"{}", &mut files).unwrap();
        write_recovery_file(&point, LEDGER_FILE, "runner_ledger", b"sqlite", &mut files).unwrap();
        let manifest = RecoveryManifest {
            schema_version: 1,
            id: id.to_string(),
            created_at: "2026-07-26T12:00:00Z".to_string(),
            app_version: "0.1.0".to_string(),
            files,
        };
        assert!(verify_manifest(&point, &manifest).is_ok());
        fs::write(point.join(APP_CONFIG_FILE), b"{\"changed\":true}").unwrap();
        assert!(verify_manifest(&point, &manifest).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_replace_preserves_or_replaces_without_partial_content() {
        let root = temp_root("replace");
        let target = root.join("config.json");
        fs::write(&target, b"old").unwrap();
        atomic_replace(&target, b"new").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert!(!target.with_extension("pre-recovery").exists());
        assert!(!target.with_extension("recovery-tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn status_ignores_untrusted_directories() {
        let root = temp_root("status");
        fs::create_dir(root.join(".partial-secret")).unwrap();
        fs::create_dir(root.join("not-a-point")).unwrap();
        let status = status_in_root(&root);
        assert!(status.points.is_empty());
        assert_eq!(status.retention_limit, MAX_RECOVERY_POINTS);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn raw_byte_configuration_point_is_recognized_and_exact() {
        let root = temp_root("raw_bytes");
        let point = create_configuration_point_from_bytes_in_root(
            &root,
            "0.1.0-test",
            APP_CONFIG_FIXTURE,
            Some(AUTOMATION_CONFIG_FIXTURE),
            |destination| fs::write(destination, b"fake-ledger").map_err(|error| error.to_string()),
        )
        .unwrap();

        let status = status_in_root(&root);
        assert_eq!(status.points.len(), 1);
        assert_eq!(status.points[0], point);
        assert_eq!(point.integrity, "ready");
        assert!(point.includes_app_config);
        assert!(point.includes_automation_config);
        assert!(point.includes_runner_ledger);

        let point_dir = root.join(&point.id);
        assert_eq!(
            fs::read(point_dir.join(APP_CONFIG_FILE)).unwrap(),
            APP_CONFIG_FIXTURE
        );
        assert_eq!(
            fs::read(point_dir.join(AUTOMATION_CONFIG_FILE)).unwrap(),
            AUTOMATION_CONFIG_FIXTURE
        );
        let manifest = read_manifest(&point_dir).unwrap();
        verify_manifest(&point_dir, &manifest).unwrap();
        let (app_bytes, automation_bytes) =
            read_configuration_point_bytes_in_root(&root, &point.id).unwrap();
        assert_eq!(app_bytes, APP_CONFIG_FIXTURE);
        assert_eq!(automation_bytes.as_deref(), Some(AUTOMATION_CONFIG_FIXTURE));
        assert!(!root.join(format!(".partial-{}", point.id)).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn raw_byte_configuration_point_accepts_and_returns_exact_legacy_settings() {
        let root = temp_root("raw_legacy_bytes");
        let point = create_configuration_point_from_bytes_in_root(
            &root,
            "0.1.0-test",
            LEGACY_APP_CONFIG_FIXTURE,
            None,
            |destination| fs::write(destination, b"fake-ledger").map_err(|error| error.to_string()),
        )
        .unwrap();

        let (app_bytes, automation_bytes) =
            read_configuration_point_bytes_in_root(&root, &point.id).unwrap();
        assert_eq!(app_bytes, LEGACY_APP_CONFIG_FIXTURE);
        assert!(automation_bytes.is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verified_configuration_point_read_rejects_traversal_and_tampering() {
        let root = temp_root("verified_read");
        let point = create_configuration_point_from_bytes_in_root(
            &root,
            "0.1.0-test",
            APP_CONFIG_FIXTURE,
            Some(AUTOMATION_CONFIG_FIXTURE),
            |destination| fs::write(destination, b"fake-ledger").map_err(|error| error.to_string()),
        )
        .unwrap();

        assert!(read_configuration_point_bytes_in_root(&root, "../../outside").is_err());
        fs::write(
            root.join(&point.id).join(AUTOMATION_CONFIG_FILE),
            b"{\"tampered\":true}",
        )
        .unwrap();
        let error = read_configuration_point_bytes_in_root(&root, &point.id).unwrap_err();
        assert!(error.contains("integrity check"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn raw_byte_configuration_point_rejects_invalid_or_oversized_input_before_writing() {
        let parent = temp_root("raw_bytes_invalid");
        let invalid_root = parent.join("invalid");
        let error = create_configuration_point_from_bytes_in_root(
            &invalid_root,
            "0.1.0-test",
            APP_CONFIG_FIXTURE,
            Some(b"[]"),
            |_| panic!("ledger backup must not run for invalid input"),
        )
        .unwrap_err();
        assert!(error.contains("must contain a JSON object"));
        assert!(!invalid_root.exists());

        let oversized_root = parent.join("oversized");
        let oversized = vec![b' '; MAX_CONFIG_BYTES as usize + 1];
        let error = create_configuration_point_from_bytes_in_root(
            &oversized_root,
            "0.1.0-test",
            &oversized,
            None,
            |_| panic!("ledger backup must not run for oversized input"),
        )
        .unwrap_err();
        assert!(error.contains("safe recovery size limit"));
        assert!(!oversized_root.exists());
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn raw_byte_configuration_points_obey_retention() {
        let root = temp_root("raw_bytes_retention");
        for _ in 0..(MAX_RECOVERY_POINTS + 2) {
            create_configuration_point_from_bytes_in_root(
                &root,
                "0.1.0-test",
                APP_CONFIG_FIXTURE,
                None,
                |destination| {
                    fs::write(destination, b"fake-ledger").map_err(|error| error.to_string())
                },
            )
            .unwrap();
        }

        let status = status_in_root(&root);
        assert_eq!(status.points.len(), MAX_RECOVERY_POINTS);
        assert!(status.points.iter().all(|point| point.integrity == "ready"));
        assert!(status
            .points
            .iter()
            .all(|point| point.includes_app_config && point.includes_runner_ledger));
        fs::remove_dir_all(root).unwrap();
    }
}
