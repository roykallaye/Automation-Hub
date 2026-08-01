use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions, Permissions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager};

const CONFIG_VERSION: u32 = 2;

const CONFIG_BACKUP_SUFFIX: &str = ".bak";
const CONFIG_TEMP_ATTEMPTS: u64 = 64;
static CONFIG_IO_LOCK: Mutex<()> = Mutex::new(());
static CONFIG_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HubConfig {
    pub(crate) schema_version: u32,
    pub(crate) language: String,
    pub(crate) client: ClientConfig,
    pub(crate) invoice_delivery_mode: InvoiceDeliveryMode,
    pub(crate) invoice_file_selection_mode: InvoiceFileSelectionMode,
    pub(crate) automation: AutomationConfig,
    pub(crate) scripts: ScriptPaths,
    pub(crate) folders: FolderPaths,
    pub(crate) gmail: GmailConfig,
    pub(crate) safety: SafetyConfig,
    #[serde(default)]
    pub(crate) templates: OutputTemplatesConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum InvoiceDeliveryMode {
    PrepareOnly,
    GmailDrafts,
    SendAutomatically,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum InvoiceFileSelectionMode {
    AllPdfs,
    FilenamePatterns,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientConfig {
    pub(crate) display_name: String,
    #[serde(default)]
    pub(crate) branding: BrandingConfig,
}

/// Per-hotel visual identity. The logo stays local: only its path is stored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct BrandingConfig {
    /// One of the built-in palette ids (e.g. "innpilotDefault", "luxuryGold").
    pub(crate) palette: String,
    /// Absolute path to a local logo image. Empty means no logo configured.
    pub(crate) logo_path: String,
    /// Optional hex override for the brand accent (empty = use palette).
    pub(crate) primary_color: String,
    /// Optional hex override for the primary action color (empty = use palette).
    pub(crate) accent_color: String,
    /// Background wash style: "soft" (default), "plain", or "warm".
    pub(crate) background_style: String,
    pub(crate) watermark_enabled: bool,
    /// Watermark opacity in percent, clamped to 0..=30 when saved.
    pub(crate) watermark_opacity: u8,
}

pub(crate) const MAX_WATERMARK_OPACITY_PERCENT: u8 = 30;

/// Editable output templates, stored locally in config.json.
///
/// Placeholders use single braces (e.g. `{hotelName}`) and are rendered by the
/// automation scripts at run time. Saving templates never runs a workflow,
/// never contacts Gmail, and never sends email.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct OutputTemplatesConfig {
    /// Subject line used when Gmail drafts are created.
    pub(crate) gmail_draft_subject: String,
    /// Body text used for prepared invoice emails / Gmail drafts.
    pub(crate) gmail_draft_body: String,
    /// Signature appended via the {signature} placeholder. Empty = hotel name.
    pub(crate) email_signature: String,
}

pub(crate) const DEFAULT_GMAIL_DRAFT_SUBJECT: &str = "Invoices - {hotelName}";
// Keep in sync with the fallback body in automation/invoices/process_fatture.py.
pub(crate) const DEFAULT_GMAIL_DRAFT_BODY: &str = "Dear Partner,\n\nplease find attached the invoices related to our mutual guests' stays at our hotel.\nFor any additional information, please contact us.\n\nKind regards,\n{signature}\n";

const MAX_TEMPLATE_SUBJECT_CHARS: usize = 200;
const MAX_TEMPLATE_BODY_CHARS: usize = 4000;
const MAX_TEMPLATE_SIGNATURE_CHARS: usize = 120;

impl Default for OutputTemplatesConfig {
    fn default() -> Self {
        Self {
            gmail_draft_subject: DEFAULT_GMAIL_DRAFT_SUBJECT.to_string(),
            gmail_draft_body: DEFAULT_GMAIL_DRAFT_BODY.to_string(),
            email_signature: String::new(),
        }
    }
}

impl OutputTemplatesConfig {
    pub(crate) fn sanitized(&self) -> Self {
        let defaults = Self::default();
        Self {
            gmail_draft_subject: sanitize_template_line(
                &self.gmail_draft_subject,
                &defaults.gmail_draft_subject,
                MAX_TEMPLATE_SUBJECT_CHARS,
            ),
            gmail_draft_body: sanitize_template_text(
                &self.gmail_draft_body,
                &defaults.gmail_draft_body,
                MAX_TEMPLATE_BODY_CHARS,
            ),
            email_signature: truncate_chars(
                self.email_signature.trim(),
                MAX_TEMPLATE_SIGNATURE_CHARS,
            ),
        }
    }
}

fn sanitize_template_line(value: &str, fallback: &str, max_chars: usize) -> String {
    let cleaned: String = value
        .trim()
        .chars()
        .filter(|c| *c != '\n' && *c != '\r')
        .collect();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        truncate_chars(&cleaned, max_chars)
    }
}

fn sanitize_template_text(value: &str, fallback: &str, max_chars: usize) -> String {
    let cleaned = value.replace("\r\n", "\n");
    if cleaned.trim().is_empty() {
        fallback.to_string()
    } else {
        truncate_chars(&cleaned, max_chars)
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

impl Default for BrandingConfig {
    fn default() -> Self {
        Self {
            palette: "innpilotDefault".to_string(),
            logo_path: String::new(),
            primary_color: String::new(),
            accent_color: String::new(),
            background_style: "soft".to_string(),
            watermark_enabled: true,
            watermark_opacity: 6,
        }
    }
}

impl BrandingConfig {
    pub(crate) fn sanitized(&self) -> Self {
        let mut branding = self.clone();
        branding.palette = sanitize_palette(&branding.palette);
        branding.primary_color = sanitize_hex_color(&branding.primary_color);
        branding.accent_color = sanitize_hex_color(&branding.accent_color);
        branding.background_style = sanitize_background_style(&branding.background_style);
        branding.watermark_opacity = branding
            .watermark_opacity
            .min(MAX_WATERMARK_OPACITY_PERCENT);
        branding.logo_path = branding.logo_path.trim().to_string();
        branding
    }
}

// Keep in sync with BRAND_PALETTES in src/branding.ts.
const KNOWN_PALETTES: [&str; 12] = [
    "innpilotDefault",
    "amethystSuite",
    "coastalHotel",
    "midnightNavy",
    "luxuryGold",
    "sunsetCoral",
    "roseBoutique",
    "alpineSpa",
    "forestEmerald",
    "mediterranean",
    "slateHarbor",
    "modernMinimal",
];

fn sanitize_palette(palette: &str) -> String {
    let trimmed = palette.trim();
    if KNOWN_PALETTES.contains(&trimmed) {
        trimmed.to_string()
    } else {
        "innpilotDefault".to_string()
    }
}

fn sanitize_hex_color(color: &str) -> String {
    let trimmed = color.trim();
    let is_hex = trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|c| c.is_ascii_hexdigit());
    if is_hex {
        trimmed.to_lowercase()
    } else {
        String::new()
    }
}

fn sanitize_background_style(style: &str) -> String {
    match style.trim() {
        "plain" => "plain".to_string(),
        "warm" => "warm".to_string(),
        _ => "soft".to_string(),
    }
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

    if let Some((mut config, should_rewrite)) = load_config_with_recovery(&config_path)? {
        let worker_changed = prefer_packaged_worker(app, &mut config);
        if should_rewrite || worker_changed {
            write_config(&config_path, &config)?;
        }
        Ok((config, config_path))
    } else {
        let mut config = default_config_for_app_data(&app_data_dir);
        prefer_packaged_worker(app, &mut config);
        write_config(&config_path, &config)?;
        Ok((config, config_path))
    }
}

fn prefer_packaged_worker(app: &AppHandle, config: &mut HubConfig) -> bool {
    let Some(worker) = packaged_worker_path(app) else {
        return false;
    };
    if !should_replace_python_selection(&config.automation.python_executable) {
        return false;
    }
    let worker = user_visible_path(&worker);
    if config.automation.python_executable == worker {
        return false;
    }
    config.automation.python_executable = worker;
    true
}

pub(crate) fn packaged_worker_path(app: &AppHandle) -> Option<PathBuf> {
    let worker = app
        .path()
        .resource_dir()
        .ok()?
        .join("worker")
        .join(if cfg!(windows) {
            "innpilot-worker.exe"
        } else {
            "innpilot-worker"
        });
    worker.is_file().then_some(worker)
}

fn user_visible_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(local) = value.strip_prefix(r"\\?\") {
            return local.to_string();
        }
    }
    value
}

fn should_replace_python_selection(value: &str) -> bool {
    let normalized = value.trim().replace('/', "\\").to_ascii_lowercase();
    normalized.is_empty()
        || normalized == "python"
        || normalized == "python.exe"
        || normalized.ends_with("\\innpilot\\.venv\\scripts\\python.exe")
        || normalized.ends_with("\\worker\\innpilot-worker.exe")
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

pub(crate) fn save_language_for_app(
    app: &AppHandle,
    language: &str,
) -> Result<(HubConfig, PathBuf), String> {
    let (mut config, _) = ensure_config_with_path(app)?;
    config.language = sanitize_language(language);
    let path = save_config_for_app(app, &config)?;
    Ok((config, path))
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
    let mut config: HubConfig = serde_json::from_value(merged.clone())
        .map_err(|error| format!("Invalid config file: {error}"))?;
    config.language = sanitize_language(&config.language);
    let original: serde_json::Value =
        serde_json::from_str(contents).map_err(|error| format!("Invalid config file: {error}"))?;
    if original.get("invoiceFileSelectionMode").is_none() {
        config.invoice_file_selection_mode = InvoiceFileSelectionMode::FilenamePatterns;
    }
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
    let _io_guard = CONFIG_IO_LOCK
        .lock()
        .map_err(|_| "Configuration persistence lock is unavailable.".to_string())?;
    write_config_with_primary_activation(config_path, config, atomic_activate_file)
}

fn write_config_with_primary_activation<F>(
    config_path: &Path,
    config: &HubConfig,
    activate_primary: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> Result<(), String>,
{
    let contents = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("Could not prepare config: {error}"))?;

    let parent = config_path
        .parent()
        .ok_or_else(|| "The config file has no parent folder.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not prepare config folder: {error}"))?;

    if config_path.exists() {
        let current_contents = fs::read_to_string(config_path)
            .map_err(|error| format!("Could not read the current config before saving: {error}"))?;
        parse_config_with_migration(&current_contents).map_err(|error| {
            format!(
                "The current config is invalid, so it was not replaced and its backup was preserved: {error}"
            )
        })?;
        install_last_known_good_backup(config_path, current_contents.as_bytes())?;
    }

    let permissions = existing_permissions(config_path)?;
    atomic_write_bytes_with(config_path, &contents, permissions, activate_primary)
}

fn load_config_with_recovery(config_path: &Path) -> Result<Option<(HubConfig, bool)>, String> {
    let _io_guard = CONFIG_IO_LOCK
        .lock()
        .map_err(|_| "Configuration persistence lock is unavailable.".to_string())?;
    load_config_with_recovery_unlocked(config_path)
}

fn load_config_with_recovery_unlocked(
    config_path: &Path,
) -> Result<Option<(HubConfig, bool)>, String> {
    if config_path.exists() {
        match read_validated_config(config_path, "primary") {
            Ok((_, config, should_rewrite)) => {
                return Ok(Some((config, should_rewrite)));
            }
            Err(primary_error) => {
                return recover_validated_backup(config_path, &primary_error).map(Some);
            }
        }
    }

    let backup_path = config_backup_path(config_path);
    if backup_path.exists() {
        return recover_validated_backup(config_path, "The primary config is missing.").map(Some);
    }

    Ok(None)
}

fn recover_validated_backup(
    config_path: &Path,
    primary_error: &str,
) -> Result<(HubConfig, bool), String> {
    let backup_path = config_backup_path(config_path);
    if !backup_path.exists() {
        return Err(format!(
            "{primary_error} No last-known-good config backup is available."
        ));
    }

    let (backup_contents, config, should_rewrite) =
        read_validated_config(&backup_path, "last-known-good backup").map_err(|backup_error| {
            format!(
                "{primary_error} Recovery was refused because the last-known-good backup is also invalid: {backup_error}"
            )
        })?;

    let permissions = existing_permissions(config_path)?;
    atomic_write_bytes_with(
        config_path,
        backup_contents.as_bytes(),
        permissions,
        atomic_activate_file,
    )
    .map_err(|error| {
        format!(
            "{primary_error} The backup was valid, but the primary config could not be restored safely: {error}"
        )
    })?;

    Ok((config, should_rewrite))
}

fn read_validated_config(path: &Path, label: &str) -> Result<(String, HubConfig, bool), String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read the {label} config: {error}"))?;
    let (config, should_rewrite) = parse_config_with_migration(&contents)
        .map_err(|error| format!("The {label} config is invalid: {error}"))?;
    Ok((contents, config, should_rewrite))
}

fn install_last_known_good_backup(
    config_path: &Path,
    validated_primary: &[u8],
) -> Result<(), String> {
    let backup_path = config_backup_path(config_path);
    let permissions = existing_permissions(config_path)?;
    atomic_write_bytes_with(
        &backup_path,
        validated_primary,
        permissions,
        atomic_activate_file,
    )
    .map_err(|error| format!("Could not preserve the last-known-good config backup: {error}"))
}

fn config_backup_path(config_path: &Path) -> PathBuf {
    let file_name = config_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    config_path.with_file_name(format!("{file_name}{CONFIG_BACKUP_SUFFIX}"))
}

fn existing_permissions(path: &Path) -> Result<Option<Permissions>, String> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(metadata.permissions())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not inspect config permissions: {error}")),
    }
}

fn atomic_write_bytes_with<F>(
    target: &Path,
    contents: &[u8],
    permissions: Option<Permissions>,
    activate: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> Result<(), String>,
{
    let (temp_path, mut temp_file) = create_unique_sibling_temp(target)?;
    let mut pending = PendingTemp::new(temp_path);

    if let Some(permissions) = permissions {
        fs::set_permissions(pending.path(), permissions)
            .map_err(|error| format!("Could not preserve config permissions: {error}"))?;
    }

    temp_file
        .write_all(contents)
        .map_err(|error| format!("Could not write temporary config: {error}"))?;
    temp_file
        .flush()
        .map_err(|error| format!("Could not flush temporary config: {error}"))?;
    temp_file
        .sync_all()
        .map_err(|error| format!("Could not safely sync temporary config: {error}"))?;
    drop(temp_file);

    activate(pending.path(), target)?;
    pending.disarm();
    Ok(())
}

fn create_unique_sibling_temp(target: &Path) -> Result<(PathBuf, File), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "The config file has no parent folder.".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");

    for _ in 0..CONFIG_TEMP_ATTEMPTS {
        let sequence = CONFIG_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(
            ".{file_name}.{}.{sequence}.tmp",
            std::process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("Could not create temporary config: {error}"));
            }
        }
    }

    Err("Could not allocate a unique temporary config file.".to_string())
}

struct PendingTemp {
    path: PathBuf,
    armed: bool,
}

impl PendingTemp {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingTemp {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(windows)]
fn atomic_activate_file(temp: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    const REPLACEFILE_WRITE_THROUGH: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let temp_wide = wide(temp);
    let target_wide = wide(target);
    let replaced = if target.exists() {
        unsafe {
            ReplaceFileW(
                target_wide.as_ptr(),
                temp_wide.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        }
    } else {
        unsafe {
            MoveFileExW(
                temp_wide.as_ptr(),
                target_wide.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        }
    };

    if replaced == 0 {
        Err(format!(
            "Could not atomically activate config: {}",
            io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_activate_file(temp: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temp, target)
        .map_err(|error| format!("Could not atomically activate config: {error}"))?;
    if let Some(parent) = target.parent() {
        File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Could not sync config directory: {error}"))?;
    }
    Ok(())
}

fn config_from_legacy(legacy: LegacyHubConfig) -> HubConfig {
    let paths = legacy.paths;
    let fatture_logs = paths.fatture_logs;
    HubConfig {
        schema_version: CONFIG_VERSION,
        language: "en".to_string(),
        client: ClientConfig {
            display_name: "Your Hotel".to_string(),
            branding: crate::config::BrandingConfig::default(),
        },
        invoice_delivery_mode: InvoiceDeliveryMode::GmailDrafts,
        invoice_file_selection_mode: InvoiceFileSelectionMode::FilenamePatterns,
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
        templates: OutputTemplatesConfig::default(),
    }
}

pub(crate) fn default_config() -> HubConfig {
    default_config_for_automation_root(default_automation_root())
}

fn default_config_for_app_data(app_data_dir: &Path) -> HubConfig {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    default_config_for_app_data_and_current_dir(app_data_dir, &current_dir)
}

fn default_config_for_app_data_and_current_dir(
    app_data_dir: &Path,
    current_dir: &Path,
) -> HubConfig {
    let repo_automation = current_dir.join("automation");
    let automation_root = if cfg!(debug_assertions) && looks_like_automation_root(&repo_automation)
    {
        repo_automation
    } else {
        app_data_dir.join("automation")
    };
    default_config_for_automation_root(automation_root)
}

fn default_config_for_automation_root(automation_root: PathBuf) -> HubConfig {
    let automation_config_path = automation_root.join("config.local.json");
    let script_paths = canonical_script_paths(&automation_root);

    HubConfig {
        schema_version: CONFIG_VERSION,
        language: "en".to_string(),
        client: ClientConfig {
            display_name: "Your Hotel".to_string(),
            branding: crate::config::BrandingConfig::default(),
        },
        invoice_delivery_mode: InvoiceDeliveryMode::GmailDrafts,
        invoice_file_selection_mode: InvoiceFileSelectionMode::AllPdfs,
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
        templates: OutputTemplatesConfig::default(),
    }
}

pub(crate) fn sanitize_language(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "it" => "it".to_string(),
        _ => "en".to_string(),
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
            .join("scans")
            .join("copy_scans.py")
            .to_string_lossy()
            .to_string(),
        ocr_preprocessing_script: automation_root
            .join("ocr")
            .join("extract_scan_text.py")
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
        && path.join("scans").join("copy_scans.py").is_file()
        && path.join("ocr").join("extract_scan_text.py").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn persistence_temp_root(label: &str) -> PathBuf {
        let sequence = CONFIG_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "innpilot_config_persistence_{label}_{}_{}",
            std::process::id(),
            sequence
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn assert_no_pending_config_temps(root: &Path) {
        let pending: Vec<_> = fs::read_dir(root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(
            pending.is_empty(),
            "temporary config files were not cleaned up: {pending:?}"
        );
    }

    #[test]
    fn atomic_config_save_reloads_and_preserves_previous_valid_version() {
        let root = persistence_temp_root("save_reload");
        let path = root.join("config.json");
        let mut first = default_config();
        first.client.display_name = "First Hotel Name".to_string();
        write_config(&path, &first).unwrap();

        let (loaded_first, _) = load_config_with_recovery(&path).unwrap().unwrap();
        assert_eq!(loaded_first, first);
        assert!(!config_backup_path(&path).exists());

        let mut second = first.clone();
        second.client.display_name = "Current Hotel Name".to_string();
        write_config(&path, &second).unwrap();

        let (loaded_second, _) = load_config_with_recovery(&path).unwrap().unwrap();
        let (_, backed_up_first, _) =
            read_validated_config(&config_backup_path(&path), "test backup").unwrap();
        assert_eq!(loaded_second, second);
        assert_eq!(backed_up_first, first);
        assert_no_pending_config_temps(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_primary_recovers_only_from_a_validated_last_known_good_backup() {
        let root = persistence_temp_root("primary_recovery");
        let path = root.join("config.json");
        let mut last_known_good = default_config();
        last_known_good.client.display_name = "Last Known Good".to_string();
        write_config(&path, &last_known_good).unwrap();

        let mut current = last_known_good.clone();
        current.client.display_name = "Current Before Corruption".to_string();
        write_config(&path, &current).unwrap();
        fs::write(&path, br#"{"schemaVersion":"#).unwrap();

        let (recovered, _) = load_config_with_recovery(&path).unwrap().unwrap();
        let (_, restored_primary, _) = read_validated_config(&path, "restored primary").unwrap();
        assert_eq!(recovered, last_known_good);
        assert_eq!(restored_primary, last_known_good);
        assert_no_pending_config_temps(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_backup_is_ignored_for_valid_primary_and_refused_for_corrupt_primary() {
        let root = persistence_temp_root("backup_corruption");
        let path = root.join("config.json");
        let mut first = default_config();
        first.client.display_name = "First".to_string();
        write_config(&path, &first).unwrap();

        let mut current = first.clone();
        current.client.display_name = "Current".to_string();
        write_config(&path, &current).unwrap();
        let backup = config_backup_path(&path);
        fs::write(&backup, br#"{"invalid":"#).unwrap();

        let (loaded, _) = load_config_with_recovery(&path).unwrap().unwrap();
        assert_eq!(loaded, current);

        fs::write(&path, br#"{"also-invalid":"#).unwrap();
        let primary_before = fs::read(&path).unwrap();
        let backup_before = fs::read(&backup).unwrap();
        let error = load_config_with_recovery(&path).unwrap_err();
        assert!(error.contains("Recovery was refused"));
        assert!(error.contains("backup is also invalid"));
        assert_eq!(fs::read(&path).unwrap(), primary_before);
        assert_eq!(fs::read(&backup).unwrap(), backup_before);
        assert_no_pending_config_temps(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_pre_replace_activation_leaves_complete_primary_and_no_partial_temp() {
        let root = persistence_temp_root("pre_replace_failure");
        let path = root.join("config.json");
        let mut original = default_config();
        original.client.display_name = "Original".to_string();
        write_config(&path, &original).unwrap();

        let mut replacement = original.clone();
        replacement.client.display_name = "Replacement".to_string();
        let error = write_config_with_primary_activation(&path, &replacement, |temp, target| {
            assert_eq!(target, path);
            assert_eq!(temp.parent(), path.parent());
            let staged = fs::read_to_string(temp).unwrap();
            let (staged_config, _) = parse_config_with_migration(&staged).unwrap();
            assert_eq!(staged_config, replacement);
            Err("simulated failure before atomic replacement".to_string())
        })
        .unwrap_err();

        assert!(error.contains("simulated failure"));
        let (_, persisted, _) = read_validated_config(&path, "primary").unwrap();
        let (_, backup, _) = read_validated_config(&config_backup_path(&path), "backup").unwrap();
        assert_eq!(persisted, original);
        assert_eq!(backup, original);
        assert_no_pending_config_temps(&root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn default_config_contains_portable_schema_and_generic_defaults() {
        let config = default_config();

        assert_eq!(config.schema_version, CONFIG_VERSION);
        assert_eq!(config.client.display_name, "Your Hotel");
        assert_eq!(
            config.invoice_delivery_mode,
            InvoiceDeliveryMode::GmailDrafts
        );
        assert_eq!(
            config.invoice_file_selection_mode,
            InvoiceFileSelectionMode::AllPdfs
        );
        assert_eq!(config.language, "en");
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
    fn packaged_worker_replaces_only_default_or_old_managed_python() {
        assert!(should_replace_python_selection("python"));
        assert!(should_replace_python_selection("python.exe"));
        assert!(should_replace_python_selection(
            r"C:\InnPilot\.venv\Scripts\python.exe"
        ));
        assert!(should_replace_python_selection(
            r"C:\Program Files\InnPilot\worker\innpilot-worker.exe"
        ));
        assert!(!should_replace_python_selection(
            r"D:\HotelTools\approved-python.exe"
        ));
    }

    #[cfg(windows)]
    #[test]
    fn packaged_paths_are_saved_without_windows_extended_prefixes() {
        assert_eq!(
            user_visible_path(Path::new(
                r"\\?\C:\Program Files\InnPilot\worker\innpilot-worker.exe"
            )),
            r"C:\Program Files\InnPilot\worker\innpilot-worker.exe"
        );
        assert_eq!(
            user_visible_path(Path::new(r"\\?\UNC\server\share")),
            r"\\server\share"
        );
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
        assert_eq!(
            config.invoice_delivery_mode,
            InvoiceDeliveryMode::GmailDrafts
        );
        assert_eq!(
            config.invoice_file_selection_mode,
            InvoiceFileSelectionMode::FilenamePatterns
        );
    }

    #[test]
    fn default_config_includes_default_branding() {
        let config = default_config();

        assert_eq!(config.client.branding.palette, "innpilotDefault");
        assert!(config.client.branding.logo_path.is_empty());
        assert!(config.client.branding.watermark_enabled);
        assert_eq!(config.client.branding.watermark_opacity, 6);
        assert_eq!(config.client.branding.background_style, "soft");
    }

    #[test]
    fn config_without_branding_is_migrated_with_defaults() {
        let partial = r#"{
          "schemaVersion": 2,
          "client": { "displayName": "Test Hotel" }
        }"#;

        let (config, should_rewrite) = parse_config_with_migration(partial).unwrap();

        assert!(should_rewrite);
        assert_eq!(config.client.display_name, "Test Hotel");
        assert_eq!(config.client.branding, BrandingConfig::default());
    }

    #[test]
    fn config_with_branding_keeps_saved_values() {
        let saved = r#"{
          "schemaVersion": 2,
          "client": {
            "displayName": "Test Hotel",
            "branding": {
              "palette": "luxuryGold",
              "logoPath": "C:\\Hotel\\logo.png",
              "watermarkEnabled": false,
              "watermarkOpacity": 12
            }
          }
        }"#;

        let (config, _) = parse_config_with_migration(saved).unwrap();

        assert_eq!(config.client.branding.palette, "luxuryGold");
        assert_eq!(config.client.branding.logo_path, r"C:\Hotel\logo.png");
        assert!(!config.client.branding.watermark_enabled);
        assert_eq!(config.client.branding.watermark_opacity, 12);
    }

    #[test]
    fn branding_serializes_with_camel_case_keys() {
        let json = serde_json::to_value(BrandingConfig::default()).unwrap();

        assert!(json.get("logoPath").is_some());
        assert!(json.get("watermarkEnabled").is_some());
        assert!(json.get("watermarkOpacity").is_some());
        assert!(json.get("backgroundStyle").is_some());
        assert!(json.get("primaryColor").is_some());
        assert!(json.get("accentColor").is_some());
    }

    #[test]
    fn branding_sanitize_clamps_and_validates() {
        let branding = BrandingConfig {
            palette: "notARealPalette".to_string(),
            logo_path: "  C:\\Hotel\\logo.png  ".to_string(),
            primary_color: "#ZZZZZZ".to_string(),
            accent_color: "#1A2B3C".to_string(),
            background_style: "neon".to_string(),
            watermark_enabled: true,
            watermark_opacity: 90,
        }
        .sanitized();

        assert_eq!(branding.palette, "innpilotDefault");
        assert_eq!(branding.logo_path, r"C:\Hotel\logo.png");
        assert_eq!(branding.primary_color, "");
        assert_eq!(branding.accent_color, "#1a2b3c");
        assert_eq!(branding.background_style, "soft");
        assert_eq!(branding.watermark_opacity, MAX_WATERMARK_OPACITY_PERCENT);
    }

    #[test]
    fn default_config_includes_default_templates() {
        let config = default_config();

        assert_eq!(
            config.templates.gmail_draft_subject,
            DEFAULT_GMAIL_DRAFT_SUBJECT
        );
        assert_eq!(config.templates.gmail_draft_body, DEFAULT_GMAIL_DRAFT_BODY);
        assert!(config.templates.email_signature.is_empty());
    }

    #[test]
    fn config_without_templates_is_migrated_with_defaults() {
        let partial = r#"{
          "schemaVersion": 2,
          "client": { "displayName": "Test Hotel" }
        }"#;

        let (config, should_rewrite) = parse_config_with_migration(partial).unwrap();

        assert!(should_rewrite);
        assert_eq!(config.templates, OutputTemplatesConfig::default());
    }

    #[test]
    fn config_with_templates_keeps_saved_values() {
        let saved = r#"{
          "schemaVersion": 2,
          "client": { "displayName": "Test Hotel" },
          "templates": {
            "gmailDraftSubject": "Invoices {date} - {hotelName}",
            "gmailDraftBody": "Hello,\nattached {invoiceCount} invoices.\n{signature}",
            "emailSignature": "Front Office Team"
          }
        }"#;

        let (config, _) = parse_config_with_migration(saved).unwrap();

        assert_eq!(
            config.templates.gmail_draft_subject,
            "Invoices {date} - {hotelName}"
        );
        assert!(config.templates.gmail_draft_body.contains("{invoiceCount}"));
        assert_eq!(config.templates.email_signature, "Front Office Team");
    }

    #[test]
    fn templates_serialize_with_camel_case_keys() {
        let json = serde_json::to_value(OutputTemplatesConfig::default()).unwrap();

        assert!(json.get("gmailDraftSubject").is_some());
        assert!(json.get("gmailDraftBody").is_some());
        assert!(json.get("emailSignature").is_some());
    }

    #[test]
    fn templates_sanitize_restores_defaults_and_strips_newlines_in_subject() {
        let templates = OutputTemplatesConfig {
            gmail_draft_subject: "  Line\nbreaks\rremoved  ".to_string(),
            gmail_draft_body: "   \n  ".to_string(),
            email_signature: "  The Team  ".to_string(),
        }
        .sanitized();

        assert_eq!(templates.gmail_draft_subject, "Linebreaksremoved");
        assert_eq!(templates.gmail_draft_body, DEFAULT_GMAIL_DRAFT_BODY);
        assert_eq!(templates.email_signature, "The Team");
    }

    #[test]
    fn templates_sanitize_caps_length_and_normalizes_line_endings() {
        let long_body = format!("Hello\r\nWorld {}", "x".repeat(6000));
        let templates = OutputTemplatesConfig {
            gmail_draft_subject: "s".repeat(500),
            gmail_draft_body: long_body,
            email_signature: "g".repeat(500),
        }
        .sanitized();

        assert_eq!(templates.gmail_draft_subject.chars().count(), 200);
        assert!(templates.gmail_draft_body.starts_with("Hello\nWorld"));
        assert!(templates.gmail_draft_body.chars().count() <= 4000);
        assert_eq!(templates.email_signature.chars().count(), 120);
    }

    #[test]
    fn missing_invoice_delivery_mode_defaults_to_gmail_drafts() {
        let partial = r#"{
          "schemaVersion": 2,
          "client": { "displayName": "Test Hotel" }
        }"#;

        let (config, should_rewrite) = parse_config_with_migration(partial).unwrap();

        assert!(should_rewrite);
        assert_eq!(
            config.invoice_delivery_mode,
            InvoiceDeliveryMode::GmailDrafts
        );
    }

    #[test]
    fn missing_invoice_file_selection_mode_preserves_legacy_filename_pattern_behavior() {
        let partial = r#"{
          "schemaVersion": 2,
          "client": { "displayName": "Test Hotel" }
        }"#;

        let (config, should_rewrite) = parse_config_with_migration(partial).unwrap();

        assert!(should_rewrite);
        assert_eq!(
            config.invoice_file_selection_mode,
            InvoiceFileSelectionMode::FilenamePatterns
        );
    }

    #[test]
    fn config_language_accepts_italian() {
        let partial = r#"{
          "schemaVersion": 2,
          "language": "it",
          "client": { "displayName": "Test Hotel" }
        }"#;

        let (config, _) = parse_config_with_migration(partial).unwrap();

        assert_eq!(config.language, "it");
    }

    #[test]
    fn invalid_config_language_falls_back_to_english() {
        let partial = r#"{
          "schemaVersion": 2,
          "language": "fr",
          "client": { "displayName": "Test Hotel" }
        }"#;

        let (config, _) = parse_config_with_migration(partial).unwrap();

        assert_eq!(config.language, "en");
    }

    #[test]
    fn repo_automation_root_is_used_when_canonical_scripts_exist() {
        let root = std::env::temp_dir().join("innpilot_repo_root_for_config_test");
        let automation = root.join("automation");
        create_canonical_script_markers(&automation);

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
    fn app_data_default_uses_app_managed_automation_root_when_repo_scripts_are_missing() {
        let app_data_dir = std::env::temp_dir().join("innpilot_app_data_config_test");
        let temp_current_dir = std::env::temp_dir().join("innpilot_no_repo_automation_config_test");
        fs::create_dir_all(&temp_current_dir).unwrap();

        let config = default_config_for_app_data_and_current_dir(&app_data_dir, &temp_current_dir);

        assert_eq!(
            config.automation.automation_root_folder,
            app_data_dir
                .join("automation")
                .to_string_lossy()
                .to_string()
        );
        assert_eq!(
            config.scripts.invoice_workflow_script,
            app_data_dir
                .join("automation")
                .join("invoices")
                .join("process_fatture.py")
                .to_string_lossy()
                .to_string()
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
            scripts.copy_scansioni_script,
            r"C:\InnPilot\automation\scans\copy_scans.py"
        );
        assert_eq!(
            scripts.ocr_preprocessing_script,
            r"C:\InnPilot\automation\ocr\extract_scan_text.py"
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
        fs::create_dir_all(root.join("scans")).unwrap();
        fs::create_dir_all(root.join("ocr")).unwrap();
        fs::write(root.join("invoices").join("process_fatture.py"), b"").unwrap();
        fs::write(root.join("gmail_drafts").join("create_gmail_draft.py"), b"").unwrap();
        fs::write(root.join("contracts").join("process_contratti.py"), b"").unwrap();
        fs::write(root.join("scans").join("copy_scans.py"), b"").unwrap();
        fs::write(root.join("ocr").join("extract_scan_text.py"), b"").unwrap();
    }
}
