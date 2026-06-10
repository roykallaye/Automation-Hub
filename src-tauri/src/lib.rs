mod config;
mod logs;
mod paths;
mod preflight;
mod redaction;
mod setup;
mod workflows;

use std::{process::Command, sync::Mutex};
use tauri::{AppHandle, State};

struct AppState {
    is_running: Mutex<bool>,
    last_run: Mutex<Option<workflows::RunSummary>>,
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            is_running: Mutex::new(false),
            last_run: Mutex::new(None),
        })
        .setup(|app| {
            config::ensure_config(&app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_command,
            open_path,
            get_latest_logs,
            get_last_run_summary,
            get_config_status,
            validate_configuration,
            preview_setup,
            initialize_workspace,
            save_setup_config,
            validate_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running FlowHost");
}

#[tauri::command]
fn get_config_status(app: AppHandle) -> Result<preflight::AppConfigStatus, String> {
    let (config, config_path) = config::ensure_config_with_path(&app)?;
    Ok(preflight::AppConfigStatus::new(
        config_path.to_string_lossy().to_string(),
        config,
    ))
}

#[tauri::command]
fn validate_configuration(app: AppHandle) -> Result<preflight::PreflightReport, String> {
    let config = config::ensure_config(&app)?;
    Ok(preflight::build_preflight_report(&config))
}

#[tauri::command]
fn preview_setup(draft: setup::SetupDraft) -> Result<setup::SetupPreview, String> {
    setup::preview_setup(draft)
}

#[tauri::command]
fn initialize_workspace(
    draft: setup::SetupDraft,
    confirmed: Option<bool>,
) -> Result<setup::WorkspaceInitResult, String> {
    setup::initialize_workspace(draft, confirmed.unwrap_or(false))
}

#[tauri::command]
fn save_setup_config(
    app: AppHandle,
    draft: setup::SetupDraft,
    confirmed: Option<bool>,
) -> Result<setup::SaveSetupResult, String> {
    setup::save_setup_config(&app, draft, confirmed.unwrap_or(false))
}

#[tauri::command]
fn validate_setup(app: AppHandle) -> Result<preflight::PreflightReport, String> {
    setup::validate_setup(&app)
}

#[tauri::command]
async fn run_command(
    app: AppHandle,
    state: State<'_, AppState>,
    command_name: String,
    confirmed: Option<bool>,
) -> Result<workflows::RunSummary, String> {
    workflows::ensure_confirmation(&command_name, confirmed.unwrap_or(false))?;

    {
        let mut running = state
            .is_running
            .lock()
            .map_err(|_| "Could not check current automation state.".to_string())?;
        if *running {
            return Err("Another automation is already running.".to_string());
        }
        *running = true;
    }

    let result = workflows::run_command_inner(&app, &command_name).await;

    if let Ok(summary) = &result {
        if let Ok(mut last_run) = state.last_run.lock() {
            *last_run = Some(summary.clone());
        }
    }

    if let Ok(mut running) = state.is_running.lock() {
        *running = false;
    }

    result
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let config = config::ensure_config(&app)?;
    if !paths::is_allowed_path(&config, &path) {
        return Err("This path is not in the FlowHost allowlist.".to_string());
    }

    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|error| format!("Could not open path: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_latest_logs(app: AppHandle) -> Result<Vec<logs::LogInfo>, String> {
    let config = config::ensure_config(&app)?;
    Ok(logs::get_latest_logs(&config))
}

#[tauri::command]
fn get_last_run_summary(
    state: State<'_, AppState>,
) -> Result<Option<workflows::RunSummary>, String> {
    let last_run = state
        .last_run
        .lock()
        .map_err(|_| "Could not read last run summary.".to_string())?;
    Ok(last_run.clone())
}
