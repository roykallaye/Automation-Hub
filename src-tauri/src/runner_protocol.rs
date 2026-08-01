use crate::{config, preflight, runner_identity::DeviceIdentity};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use reqwest::{redirect::Policy, Client, Response, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const PROTOCOL_VERSION: u8 = 1;
const PAIRING_PREFIX: &str = "innpilot-v1";
const FUNCTION_BASE_URL: &str =
    "https://nmolrdmdllewursumsyy.supabase.co/functions/v1/automation-runner";
const SYNC_ROUTE: &str = "/automation-runner/sync";
const CONNECTION_FILE: &str = "connection.json";
const MAX_RESPONSE_BYTES: usize = 16_384;
const EXECUTE_AUTHORIZATION_VERSION: u8 = 1;
const MAX_LEASE_SECONDS: i64 = 120;
const MIN_LEASE_SECONDS: i64 = 10;
const MAX_APPROVAL_AGE_SECONDS: i64 = 86_400;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SavedConnection {
    schema_version: u8,
    installation_key: String,
    key_fingerprint: String,
    installation_label: String,
    paired_at: Option<String>,
    last_sync_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunnerConnectionStatus {
    state: &'static str,
    installation_label: Option<String>,
    key_fingerprint_short: Option<String>,
    paired_at: Option<String>,
    last_sync_at: Option<String>,
    protocol_version: u8,
    private_key_protection: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunnerSyncResult {
    connection: RunnerConnectionStatus,
    server_time: String,
    next_sync_seconds: u32,
    job_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunnerJobUpdate {
    pub(crate) error_code: Option<String>,
    pub(crate) failure_count: u32,
    pub(crate) input_count: u32,
    pub(crate) job_id: String,
    pub(crate) status: String,
    pub(crate) success_count: u32,
    pub(crate) summary_code: Option<String>,
    pub(crate) warning_count: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloudJob {
    pub(crate) id: String,
    pub(crate) idempotency_key: String,
    pub(crate) workflow: String,
    pub(crate) mode: String,
    pub(crate) status: String,
    pub(crate) lease_expires_at: String,
    pub(crate) cancel_requested: bool,
    pub(crate) approval: Option<ExecuteApproval>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExecuteApproval {
    approved_at: String,
    approved_by: String,
    authorization_version: u8,
}

pub(crate) struct RunnerSyncExchange {
    pub(crate) server_time: String,
    pub(crate) next_sync_seconds: u32,
    pub(crate) job: Option<CloudJob>,
}

#[derive(Debug)]
struct PairingCode {
    installation_key: String,
    pairing_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentRequest<'a> {
    installation_key: &'a str,
    key_fingerprint: &'a str,
    pairing_token: &'a str,
    protocol_version: u8,
    public_key: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequest<'a> {
    capabilities: &'a [&'static str],
    job_update: Option<&'a RunnerJobUpdate>,
    protocol_version: u8,
    runner_version: &'static str,
    scansioni_path_kind: &'static str,
    scansioni_status: &'static str,
}

#[derive(Deserialize)]
struct ApiCode {
    code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentInstallation {
    installation_id: String,
    label: String,
    key_fingerprint: String,
    protocol_version: u8,
}

#[derive(Deserialize)]
struct EnrollmentResponse {
    code: String,
    installation: EnrollmentInstallation,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncPayload {
    server_time: String,
    next_sync_seconds: u32,
    job: Option<CloudJob>,
}

#[derive(Deserialize)]
struct SyncResponse {
    code: String,
    sync: SyncPayload,
}

pub(crate) fn connection_status(app: &AppHandle) -> Result<RunnerConnectionStatus, String> {
    match load_connection(app) {
        Ok(Some(connection)) => Ok(status_from_connection(&connection)),
        Ok(None) => Ok(RunnerConnectionStatus {
            state: "notConnected",
            installation_label: None,
            key_fingerprint_short: None,
            paired_at: None,
            last_sync_at: None,
            protocol_version: PROTOCOL_VERSION,
            private_key_protection: "windowsCurrentUser",
        }),
        Err(error) => Err(error),
    }
}

pub(crate) async fn pair(
    app: &AppHandle,
    pairing_code: &str,
) -> Result<RunnerConnectionStatus, String> {
    let code = parse_pairing_code(pairing_code)?;
    let identity = DeviceIdentity::load_or_create(app)?;
    let fingerprint = identity.fingerprint();
    let public_key = identity.public_key_base64();

    let mut connection = SavedConnection {
        schema_version: PROTOCOL_VERSION,
        installation_key: code.installation_key.clone(),
        key_fingerprint: fingerprint.clone(),
        installation_label: "PC InnPilot".to_string(),
        paired_at: None,
        last_sync_at: None,
    };
    let body = EnrollmentRequest {
        installation_key: &code.installation_key,
        key_fingerprint: &fingerprint,
        pairing_token: &code.pairing_token,
        protocol_version: PROTOCOL_VERSION,
        public_key: &public_key,
    };
    let response = http_client()?
        .post(format!("{FUNCTION_BASE_URL}/enroll"))
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            "LifeDesk is not reachable. Check the internet connection and try again.".to_string()
        })?;
    let status = response.status();
    if status != StatusCode::OK {
        let code = read_api_code(response).await;
        return Err(pairing_error(status, code.as_deref()));
    }

    let enrolled: EnrollmentResponse = read_json_limited(response).await?;
    if enrolled.code != "PAIRED"
        || !is_uuid(&enrolled.installation.installation_id)
        || enrolled.installation.key_fingerprint != fingerprint
        || enrolled.installation.protocol_version != PROTOCOL_VERSION
    {
        return Err("LifeDesk returned an invalid pairing confirmation.".to_string());
    }

    connection.installation_label = enrolled.installation.label;
    connection.paired_at = Some(Utc::now().to_rfc3339());
    save_connection(app, &connection)?;
    Ok(status_from_connection(&connection))
}

pub(crate) async fn sync(app: &AppHandle) -> Result<RunnerSyncResult, String> {
    let exchange = sync_exchange(app, &[], None).await?;
    let connection = connection_status(app)?;
    Ok(RunnerSyncResult {
        connection,
        server_time: exchange.server_time,
        next_sync_seconds: exchange.next_sync_seconds,
        job_available: exchange.job.is_some(),
    })
}

pub(crate) async fn sync_exchange(
    app: &AppHandle,
    capabilities: &[&'static str],
    job_update: Option<&RunnerJobUpdate>,
) -> Result<RunnerSyncExchange, String> {
    validate_sync_input(capabilities, job_update)?;
    let mut connection = load_connection(app)?
        .filter(|item| item.paired_at.is_some())
        .ok_or_else(|| "Connect this PC to LifeDesk before synchronizing.".to_string())?;
    let identity = DeviceIdentity::load_or_create(app)?;
    if identity.fingerprint() != connection.key_fingerprint {
        return Err(
            "The protected device identity does not match this LifeDesk connection.".to_string(),
        );
    }

    let config = config::ensure_config(app)?;
    let (scansioni_status, scansioni_path_kind) =
        scansioni_health(&config.folders.scansioni_network_share);
    let body = SyncRequest {
        capabilities,
        job_update,
        protocol_version: PROTOCOL_VERSION,
        runner_version: env!("CARGO_PKG_VERSION"),
        scansioni_path_kind,
        scansioni_status,
    };
    let body_text = serde_json::to_string(&body)
        .map_err(|error| format!("Could not prepare the LifeDesk heartbeat: {error}"))?;
    let timestamp = unix_timestamp()?;
    let nonce = random_nonce()?;
    let body_digest = sha256_hex(body_text.as_bytes());
    let canonical = canonical_request(
        "POST",
        SYNC_ROUTE,
        &connection.installation_key,
        timestamp,
        &nonce,
        &body_digest,
    );
    let signature = identity.sign_base64(canonical.as_bytes());

    let response = http_client()?
        .post(format!("{FUNCTION_BASE_URL}/sync"))
        .header("Content-Type", "application/json")
        .header("X-InnPilot-Installation", &connection.installation_key)
        .header("X-InnPilot-Nonce", &nonce)
        .header("X-InnPilot-Protocol", PROTOCOL_VERSION.to_string())
        .header("X-InnPilot-Signature", signature)
        .header("X-InnPilot-Timestamp", timestamp.to_string())
        .body(body_text)
        .send()
        .await
        .map_err(|_| {
            "LifeDesk is not reachable. Check the internet connection and try again.".to_string()
        })?;
    let status = response.status();
    if status != StatusCode::OK {
        let code = read_api_code(response).await;
        return Err(sync_error(status, code.as_deref()));
    }

    let payload: SyncResponse = read_json_limited(response).await?;
    if payload.code != "SYNCED" || !(5..=300).contains(&payload.sync.next_sync_seconds) {
        return Err("LifeDesk returned an invalid synchronization response.".to_string());
    }
    let server_time = chrono::DateTime::parse_from_rfc3339(&payload.sync.server_time)
        .map_err(|_| "LifeDesk returned an invalid synchronization response.".to_string())?;
    if let Some(job) = payload.sync.job.as_ref() {
        validate_cloud_job(job, capabilities, server_time)?;
    }
    connection.last_sync_at = Some(payload.sync.server_time.clone());
    save_connection(app, &connection)?;

    Ok(RunnerSyncExchange {
        server_time: payload.sync.server_time,
        next_sync_seconds: payload.sync.next_sync_seconds,
        job: payload.sync.job,
    })
}

fn validate_sync_input(
    capabilities: &[&str],
    update: Option<&RunnerJobUpdate>,
) -> Result<(), String> {
    let allowed = [
        "invoices",
        "gmail_drafts",
        "scan_import",
        "signed_contracts",
    ];
    if capabilities.len() > allowed.len()
        || capabilities.iter().any(|value| !allowed.contains(value))
        || capabilities
            .iter()
            .enumerate()
            .any(|(index, value)| capabilities[..index].contains(value))
    {
        return Err("The local runner capabilities are invalid.".to_string());
    }
    if let Some(update) = update {
        if !is_uuid(&update.job_id)
            || !matches!(
                update.status.as_str(),
                "running" | "succeeded" | "attention" | "failed" | "cancelled"
            )
            || [
                update.input_count,
                update.success_count,
                update.warning_count,
                update.failure_count,
            ]
            .into_iter()
            .any(|count| count > 1_000_000)
            || !valid_code(update.error_code.as_deref(), true)
            || !valid_code(update.summary_code.as_deref(), false)
        {
            return Err("The local runner job update is invalid.".to_string());
        }
    }
    Ok(())
}

fn validate_cloud_job(
    job: &CloudJob,
    capabilities: &[&str],
    server_time: chrono::DateTime<chrono::FixedOffset>,
) -> Result<(), String> {
    let lease_expires_at = chrono::DateTime::parse_from_rfc3339(&job.lease_expires_at)
        .map_err(|_| "LifeDesk returned an invalid leased job.".to_string())?;
    let lease_seconds = lease_expires_at
        .signed_duration_since(server_time)
        .num_seconds();
    if !is_uuid(&job.id)
        || !is_uuid(&job.idempotency_key)
        || !capabilities.contains(&job.workflow.as_str())
        || !matches!(job.mode.as_str(), "dry_run" | "execute")
        || !matches!(job.status.as_str(), "leased" | "running")
        || !(MIN_LEASE_SECONDS..=MAX_LEASE_SECONDS).contains(&lease_seconds)
    {
        return Err("LifeDesk returned an invalid leased job.".to_string());
    }
    match job.mode.as_str() {
        "dry_run" if job.approval.is_some() => {
            return Err("LifeDesk returned an invalid leased job.".to_string());
        }
        "execute" => {
            let approval = job
                .approval
                .as_ref()
                .ok_or_else(|| "LifeDesk did not provide execute approval evidence.".to_string())?;
            let approved_at =
                chrono::DateTime::parse_from_rfc3339(&approval.approved_at).map_err(|_| {
                    "LifeDesk did not provide valid execute approval evidence.".to_string()
                })?;
            let approval_age = server_time.signed_duration_since(approved_at).num_seconds();
            if approval.authorization_version != EXECUTE_AUTHORIZATION_VERSION
                || !is_uuid(&approval.approved_by)
                || !(0..=MAX_APPROVAL_AGE_SECONDS).contains(&approval_age)
            {
                return Err("LifeDesk did not provide valid execute approval evidence.".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

fn valid_code(value: Option<&str>, uppercase: bool) -> bool {
    value.is_none_or(|value| {
        !value.is_empty()
            && value.len() <= 80
            && value.chars().all(|character| {
                character.is_ascii_digit()
                    || character == '_'
                    || if uppercase {
                        character.is_ascii_uppercase()
                    } else {
                        character.is_ascii_lowercase()
                    }
            })
    })
}

fn parse_pairing_code(value: &str) -> Result<PairingCode, String> {
    let trimmed = value.trim();
    if trimmed.len() > 180 || trimmed.chars().any(char::is_whitespace) {
        return Err("The LifeDesk connection code is not valid.".to_string());
    }
    let mut parts = trimmed.split(':');
    let prefix = parts.next().unwrap_or_default();
    let installation_key = parts.next().unwrap_or_default();
    let pairing_token = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || prefix != PAIRING_PREFIX
        || !is_uuid(installation_key)
        || pairing_token.len() != 64
        || !pairing_token
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("The LifeDesk connection code is not valid.".to_string());
    }
    Ok(PairingCode {
        installation_key: installation_key.to_ascii_lowercase(),
        pairing_token: pairing_token.to_ascii_lowercase(),
    })
}

fn is_uuid(value: &str) -> bool {
    let expected_hyphens = [8, 13, 18, 23];
    value.len() == 36
        && value.chars().enumerate().all(|(index, character)| {
            if expected_hyphens.contains(&index) {
                character == '-'
            } else {
                character.is_ascii_hexdigit()
            }
        })
}

fn status_from_connection(connection: &SavedConnection) -> RunnerConnectionStatus {
    RunnerConnectionStatus {
        state: if connection.paired_at.is_some() {
            "connected"
        } else {
            "pairingIncomplete"
        },
        installation_label: Some(connection.installation_label.clone()),
        key_fingerprint_short: Some(connection.key_fingerprint.chars().take(12).collect()),
        paired_at: connection.paired_at.clone(),
        last_sync_at: connection.last_sync_at.clone(),
        protocol_version: PROTOCOL_VERSION,
        private_key_protection: "windowsCurrentUser",
    }
}

fn scansioni_health(path: &str) -> (&'static str, &'static str) {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return ("not_configured", "unknown");
    }
    let kind = if trimmed.starts_with(r"\\") {
        "unc"
    } else if trimmed.len() >= 3
        && trimmed.as_bytes()[1] == b':'
        && matches!(trimmed.as_bytes()[2], b'\\' | b'/')
    {
        "local"
    } else {
        "unknown"
    };
    let folder = Path::new(trimmed);
    if !folder.is_dir() || fs::read_dir(folder).is_err() {
        return ("unreachable", kind);
    }
    if preflight::can_write_to_folder(folder) {
        ("available", kind)
    } else {
        ("read_only", kind)
    }
}

fn canonical_request(
    method: &str,
    route: &str,
    installation_key: &str,
    timestamp: u64,
    nonce: &str,
    body_digest: &str,
) -> String {
    format!(
        "INNPILOT/{PROTOCOL_VERSION}\n{}\n{route}\n{installation_key}\n{timestamp}\n{nonce}\n{body_digest}",
        method.to_ascii_uppercase()
    )
}

fn unix_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| "The Windows clock is invalid.".to_string())
}

fn random_nonce() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Could not create a request nonce: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn sha256_hex(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .redirect(Policy::none())
        .user_agent(concat!("InnPilot/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Could not initialize the protected LifeDesk connection.".to_string())
}

async fn read_api_code(response: Response) -> Option<String> {
    read_json_limited::<ApiCode>(response)
        .await
        .ok()
        .map(|payload| payload.code)
}

async fn read_json_limited<T: DeserializeOwned>(mut response: Response) -> Result<T, String> {
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_RESPONSE_BYTES)
    {
        return Err("LifeDesk returned an oversized response.".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the LifeDesk response.".to_string())?
    {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("LifeDesk returned an oversized response.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "LifeDesk returned an invalid response.".to_string())
}

fn pairing_error(status: StatusCode, code: Option<&str>) -> String {
    match code {
        Some("PAIRING_REJECTED") => {
            "This code has expired, was already used, or was revoked. Create a new code in LifeDesk."
                .to_string()
        }
        Some("INVALID_ENROLLMENT_REQUEST") | Some("INVALID_DEVICE_KEY") => {
            "The LifeDesk connection code is invalid.".to_string()
        }
        Some("RUNNER_SERVICE_UNAVAILABLE") => {
            "The LifeDesk connection service is temporarily unavailable.".to_string()
        }
        _ if status.is_server_error() => {
            "The LifeDesk connection service is temporarily unavailable.".to_string()
        }
        _ => "LifeDesk refused the connection. Create a new code and try again.".to_string(),
    }
}

fn sync_error(status: StatusCode, code: Option<&str>) -> String {
    match code {
        Some("RUNNER_AUTH_REJECTED") => {
            "This PC is no longer authorized. Create a new connection code in LifeDesk.".to_string()
        }
        Some("RUNNER_REQUEST_REPLAYED") => {
            "LifeDesk rejected a repeated request. Check the Windows clock and try again."
                .to_string()
        }
        Some("RUNNER_SERVICE_UNAVAILABLE") => {
            "The LifeDesk connection service is temporarily unavailable.".to_string()
        }
        _ if status.is_server_error() => {
            "The LifeDesk connection service is temporarily unavailable.".to_string()
        }
        _ => "LifeDesk could not synchronize this PC.".to_string(),
    }
}

fn connection_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("runner").join(CONNECTION_FILE))
        .map_err(|error| format!("Could not locate the runner data folder: {error}"))
}

fn load_connection(app: &AppHandle) -> Result<Option<SavedConnection>, String> {
    let path = connection_path(app)?;
    let backup = path.with_extension("json.bak");
    let chosen = if path.exists() {
        path
    } else if backup.exists() {
        backup
    } else {
        return Ok(None);
    };
    let contents = fs::read(&chosen)
        .map_err(|error| format!("Could not read the LifeDesk connection: {error}"))?;
    let connection: SavedConnection = serde_json::from_slice(&contents)
        .map_err(|_| "The local LifeDesk connection record is damaged.".to_string())?;
    if connection.schema_version != PROTOCOL_VERSION
        || !is_uuid(&connection.installation_key)
        || connection.key_fingerprint.len() != 64
        || !connection
            .key_fingerprint
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("The local LifeDesk connection record is invalid.".to_string());
    }
    Ok(Some(connection))
}

fn save_connection(app: &AppHandle, connection: &SavedConnection) -> Result<(), String> {
    let path = connection_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "The runner data folder is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the runner data folder: {error}"))?;
    let temporary = path.with_extension("json.new");
    let backup = path.with_extension("json.bak");
    let contents = serde_json::to_vec_pretty(connection)
        .map_err(|error| format!("Could not prepare the LifeDesk connection record: {error}"))?;

    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("Could not prepare the LifeDesk connection record: {error}"))?;
    file.write_all(&contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not safely store the LifeDesk connection: {error}"))?;

    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("Could not rotate the LifeDesk connection backup: {error}"))?;
    }
    if path.exists() {
        fs::rename(&path, &backup)
            .map_err(|error| format!("Could not back up the LifeDesk connection: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if backup.exists() {
            let _ = fs::rename(&backup, &path);
        }
        return Err(format!(
            "Could not activate the LifeDesk connection record: {error}"
        ));
    }
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_the_versioned_pairing_format() {
        let code = parse_pairing_code(
            "innpilot-v1:123e4567-e89b-12d3-a456-426614174000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )
        .unwrap();
        assert_eq!(
            code.installation_key,
            "123e4567-e89b-12d3-a456-426614174000"
        );
        assert_eq!(code.pairing_token.len(), 64);
        assert!(parse_pairing_code("innpilot-v1:not-a-uuid:abc").is_err());
        assert!(parse_pairing_code("innpilot-v2:123e4567-e89b-12d3-a456-426614174000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").is_err());
    }

    #[test]
    fn canonical_request_matches_the_cloud_contract() {
        assert_eq!(
            canonical_request(
                "post",
                SYNC_ROUTE,
                "123e4567-e89b-12d3-a456-426614174000",
                1_700_000_000,
                "0123456789abcdefghijkl",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
            "INNPILOT/1\nPOST\n/automation-runner/sync\n123e4567-e89b-12d3-a456-426614174000\n1700000000\n0123456789abcdefghijkl\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
    }

    #[test]
    fn rejects_hidden_extra_pairing_fields() {
        assert!(parse_pairing_code(
            "innpilot-v1:123e4567-e89b-12d3-a456-426614174000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:extra"
        )
        .is_err());
    }

    fn leased_job(mode: &str, approval: Option<ExecuteApproval>) -> CloudJob {
        CloudJob {
            id: "11111111-1111-4111-8111-111111111111".to_string(),
            idempotency_key: "22222222-2222-4222-8222-222222222222".to_string(),
            workflow: "invoices".to_string(),
            mode: mode.to_string(),
            status: "leased".to_string(),
            lease_expires_at: "2026-08-01T10:01:30Z".to_string(),
            cancel_requested: false,
            approval,
        }
    }

    fn approval(at: &str, version: u8) -> ExecuteApproval {
        ExecuteApproval {
            approved_at: at.to_string(),
            approved_by: "33333333-3333-4333-8333-333333333333".to_string(),
            authorization_version: version,
        }
    }

    #[test]
    fn dry_runs_reject_approval_evidence() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-08-01T10:00:00Z").unwrap();
        assert!(validate_cloud_job(&leased_job("dry_run", None), &["invoices"], now).is_ok());
        assert!(validate_cloud_job(
            &leased_job("dry_run", Some(approval("2026-08-01T09:59:00Z", 1)),),
            &["invoices"],
            now,
        )
        .is_err());
    }

    #[test]
    fn execute_jobs_require_fresh_versioned_approval() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-08-01T10:00:00Z").unwrap();
        assert!(validate_cloud_job(&leased_job("execute", None), &["invoices"], now).is_err());
        for invalid in [
            approval("2026-08-01T09:59:00Z", 2),
            approval("2026-07-31T09:59:59Z", 1),
            approval("2026-08-01T10:00:01Z", 1),
        ] {
            assert!(
                validate_cloud_job(&leased_job("execute", Some(invalid)), &["invoices"], now,)
                    .is_err()
            );
        }
        assert!(validate_cloud_job(
            &leased_job("execute", Some(approval("2026-08-01T09:59:00Z", 1)),),
            &["invoices"],
            now,
        )
        .is_ok());
    }
}
