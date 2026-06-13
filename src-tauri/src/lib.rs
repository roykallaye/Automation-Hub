mod activity;
mod automation_install;
mod branding;
mod config;
mod logs;
mod paths;
mod preflight;
mod redaction;
mod setup;
mod templates;
mod workflows;

use std::{process::Command, sync::Mutex};
use tauri::{AppHandle, State};

struct AppState {
    is_running: Mutex<bool>,
    last_run: Mutex<Option<workflows::RunSummary>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            remove_setup_created_empty_folders,
            save_setup_config,
            validate_setup,
            install_managed_automation_scripts,
            get_activity_history,
            get_activity_detail,
            open_activity_report,
            save_client_branding,
            read_branding_logo,
            save_output_templates,
            save_app_language
        ])
        .run(tauri::generate_context!())
        .expect("error while running InnPilot");
}

#[tauri::command]
fn get_activity_history(app: AppHandle) -> Result<Vec<activity::ActivityRecord>, String> {
    activity::get_activity_history(&app)
}

#[tauri::command]
fn get_activity_detail(
    app: AppHandle,
    id: String,
) -> Result<Option<activity::ActivityRecord>, String> {
    activity::get_activity_detail(&app, &id)
}

#[tauri::command]
fn open_activity_report(app: AppHandle, path: String) -> Result<(), String> {
    if !activity::is_activity_report_path(&app, &path)? {
        return Err("This activity report is not in the InnPilot activity folder.".to_string());
    }

    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|error| format!("Could not open activity report: {error}"))?;
    Ok(())
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
fn save_client_branding(
    app: AppHandle,
    draft: branding::ClientBrandingDraft,
) -> Result<preflight::AppConfigStatus, String> {
    branding::save_client_branding(&app, draft)
}

#[tauri::command]
fn read_branding_logo(app: AppHandle) -> Result<Option<String>, String> {
    branding::read_branding_logo(&app)
}

#[tauri::command]
fn save_output_templates(
    app: AppHandle,
    draft: templates::OutputTemplatesDraft,
) -> Result<preflight::AppConfigStatus, String> {
    templates::save_output_templates(&app, draft)
}

#[tauri::command]
fn save_app_language(
    app: AppHandle,
    language: String,
) -> Result<preflight::AppConfigStatus, String> {
    let (config, config_path) = config::save_language_for_app(&app, &language)?;
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
fn remove_setup_created_empty_folders(
    workspace_base: String,
    paths: Vec<String>,
    confirmed: Option<bool>,
) -> Result<setup::SetupCleanupResult, String> {
    setup::remove_setup_created_empty_folders(workspace_base, paths, confirmed.unwrap_or(false))
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
fn install_managed_automation_scripts(
    app: AppHandle,
    confirmed: Option<bool>,
) -> Result<automation_install::ManagedAutomationInstallResult, String> {
    automation_install::install_managed_automation_scripts(&app, confirmed.unwrap_or(false))
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
        return Err("This path is not in the InnPilot allowlist.".to_string());
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
