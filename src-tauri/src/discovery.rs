use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const MAX_REQUESTS: usize = 250;
const MAX_DESCRIPTION_CHARS: usize = 2_000;
const MAX_STEPS: usize = 10;
const MAX_STEP_CHARS: usize = 300;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryRequestDraft {
    description: String,
    suggested_steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryRequest {
    id: String,
    description: String,
    suggested_steps: Vec<String>,
    status: String,
    created_at: String,
    data_location: String,
}

pub(crate) fn create_discovery_request(
    app: &AppHandle,
    draft: DiscoveryRequestDraft,
) -> Result<DiscoveryRequest, String> {
    let description = draft.description.trim();
    if description.is_empty() {
        return Err("Describe the repetitive hotel task before saving the brief.".to_string());
    }
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(format!(
            "The discovery brief is too long. Keep it under {MAX_DESCRIPTION_CHARS} characters."
        ));
    }

    let suggested_steps = draft
        .suggested_steps
        .into_iter()
        .map(|step| step.trim().to_string())
        .filter(|step| !step.is_empty())
        .take(MAX_STEPS)
        .map(|step| step.chars().take(MAX_STEP_CHARS).collect())
        .collect::<Vec<String>>();
    let now = Local::now();
    let request = DiscoveryRequest {
        id: format!("request-{}", now.format("%Y%m%d%H%M%S%3f")),
        description: description.to_string(),
        suggested_steps,
        status: "open".to_string(),
        created_at: now.to_rfc3339(),
        data_location: "local_app_data".to_string(),
    };

    let path = requests_path(app)?;
    let mut requests = read_requests(&path)?;
    requests.push(request.clone());
    if requests.len() > MAX_REQUESTS {
        requests.drain(0..requests.len() - MAX_REQUESTS);
    }
    write_requests(&path, &requests)?;
    Ok(request)
}

pub(crate) fn get_discovery_requests(app: &AppHandle) -> Result<Vec<DiscoveryRequest>, String> {
    let mut requests = read_requests(&requests_path(app)?)?;
    requests.reverse();
    Ok(requests)
}

fn requests_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate InnPilot app data: {error}"))?
        .join("discovery");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the local discovery inbox: {error}"))?;
    Ok(directory.join("requests.json"))
}

fn read_requests(path: &PathBuf) -> Result<Vec<DiscoveryRequest>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read the local discovery inbox: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("The local discovery inbox is not valid JSON: {error}"))
}

fn write_requests(path: &PathBuf, requests: &[DiscoveryRequest]) -> Result<(), String> {
    let contents = serde_json::to_vec_pretty(requests)
        .map_err(|error| format!("Could not prepare the discovery inbox: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, contents)
        .map_err(|error| format!("Could not write the discovery inbox: {error}"))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not replace the discovery inbox: {error}"))?;
    }
    fs::rename(&temp_path, path)
        .map_err(|error| format!("Could not finish the discovery inbox update: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn request_file_round_trip_keeps_local_metadata() {
        let path = temp_path("round_trip").join("requests.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let request = DiscoveryRequest {
            id: "request-test".to_string(),
            description: "Copy the night report into the handover folder.".to_string(),
            suggested_steps: vec!["Observe the current workflow.".to_string()],
            status: "open".to_string(),
            created_at: "2026-07-16T00:00:00+02:00".to_string(),
            data_location: "local_app_data".to_string(),
        };

        write_requests(&path, &[request]).unwrap();
        let saved = read_requests(&path).unwrap();

        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].status, "open");
        assert_eq!(saved[0].data_location, "local_app_data");
    }

    fn temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "innpilot_discovery_{label}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
