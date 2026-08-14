mod activity;
mod automation_install;
mod branding;
#[cfg(feature = "cloud-e2e-probe")]
mod cloud_probe;
#[cfg(feature = "cloud-e2e-probe")]
pub use cloud_probe::run_cloud_e2e_probe;
mod config;
mod desktop_service;
mod discovery;
mod folder_discovery;
mod logs;
mod paths;
mod preflight;
mod recovery;
mod redaction;
mod runner_identity;
mod runner_ledger;
mod runner_protocol;
mod runner_service;
mod setup;
mod templates;
mod worker_runtime;
mod workflows;

use std::{process::Command, sync::Mutex};
use tauri::{AppHandle, State, WindowEvent};

struct AppState {
    is_running: Mutex<bool>,
    last_run: Mutex<Option<workflows::RunSummary>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _working_directory| {
                let app = app.clone();
                let _ = app.clone().run_on_main_thread(move || {
                    desktop_service::show_main_window(&app);
                });
            },
        ))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(desktop_service::BACKGROUND_ARG)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            is_running: Mutex::new(false),
            last_run: Mutex::new(None),
        })
        .setup(|app| {
            setup::reconcile_incomplete_setup(app.handle()).map_err(std::io::Error::other)?;
            config::ensure_config(app.handle()).map_err(std::io::Error::other)?;
            desktop_service::setup(app)?;
            runner_service::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_service_status,
            set_desktop_service_enabled,
            run_command,
            open_path,
            get_latest_logs,
            get_last_run_summary,
            get_config_status,
            refresh_config_status,
            validate_configuration,
            get_setup_snapshot,
            preview_setup,
            initialize_workspace,
            assert_setup_revision,
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
            save_app_language,
            inspect_existing_folder,
            create_discovery_request,
            get_discovery_requests,
            get_lifedesk_connection,
            pair_with_lifedesk,
            sync_with_lifedesk,
            get_recovery_status,
            create_recovery_point,
            restore_recovery_configuration
        ])
        .run(tauri::generate_context!())
        .expect("error while running InnPilot");
}

#[tauri::command]
fn get_desktop_service_status(
    app: AppHandle,
) -> Result<desktop_service::DesktopServiceStatus, String> {
    desktop_service::status(&app)
}

#[tauri::command]
fn set_desktop_service_enabled(
    app: AppHandle,
    enabled: bool,
    confirmed: Option<bool>,
) -> Result<desktop_service::DesktopServiceStatus, String> {
    desktop_service::set_enabled(&app, enabled, confirmed.unwrap_or(false))
}

#[tauri::command]
fn get_lifedesk_connection(
    app: AppHandle,
) -> Result<runner_protocol::RunnerConnectionStatus, String> {
    runner_protocol::connection_status(&app)
}

#[tauri::command]
async fn pair_with_lifedesk(
    app: AppHandle,
    pairing_code: String,
) -> Result<runner_protocol::RunnerConnectionStatus, String> {
    runner_protocol::pair(&app, &pairing_code).await
}

#[tauri::command]
async fn sync_with_lifedesk(app: AppHandle) -> Result<runner_protocol::RunnerSyncResult, String> {
    runner_protocol::sync(&app).await
}

#[tauri::command]
fn get_recovery_status(app: AppHandle) -> Result<recovery::RecoveryStatus, String> {
    recovery::status(&app)
}

#[tauri::command]
fn create_recovery_point(app: AppHandle) -> Result<recovery::RecoveryActionResult, String> {
    recovery::create(&app)
}

#[tauri::command]
fn restore_recovery_configuration(
    app: AppHandle,
    point_id: String,
    confirmed: Option<bool>,
) -> Result<recovery::RecoveryActionResult, String> {
    recovery::restore_configuration(&app, &point_id, confirmed.unwrap_or(false))
}

#[tauri::command]
fn create_discovery_request(
    app: AppHandle,
    draft: discovery::DiscoveryRequestDraft,
) -> Result<discovery::DiscoveryRequest, String> {
    discovery::create_discovery_request(&app, draft)
}

#[tauri::command]
fn get_discovery_requests(app: AppHandle) -> Result<Vec<discovery::DiscoveryRequest>, String> {
    discovery::get_discovery_requests(&app)
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
    Ok(preflight::AppConfigStatus::new_fast(
        config_path.to_string_lossy().to_string(),
        config,
    ))
}

#[tauri::command]
async fn refresh_config_status(app: AppHandle) -> Result<preflight::AppConfigStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (config, config_path) = config::ensure_config_with_path(&app)?;
        Ok(preflight::AppConfigStatus::new(
            config_path.to_string_lossy().to_string(),
            config,
        ))
    })
    .await
    .map_err(|_| "The automation safety check stopped unexpectedly.".to_string())?
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
    Ok(preflight::AppConfigStatus::new_fast(
        config_path.to_string_lossy().to_string(),
        config,
    ))
}

#[tauri::command]
fn inspect_existing_folder(path: String) -> Result<folder_discovery::FolderInspection, String> {
    folder_discovery::inspect_existing_folder(path)
}

#[tauri::command]
fn validate_configuration(app: AppHandle) -> Result<preflight::PreflightReport, String> {
    let config = config::ensure_config(&app)?;
    Ok(preflight::build_preflight_report(&config))
}

#[tauri::command]
fn get_setup_snapshot(app: AppHandle) -> Result<setup::SetupSnapshot, String> {
    setup::get_setup_snapshot(&app)
}

#[tauri::command]
fn preview_setup(
    app: AppHandle,
    patch: setup::SetupPatch,
    expected_revision: String,
) -> Result<setup::SetupPreview, String> {
    setup::preview_setup(&app, patch, &expected_revision)
}

#[tauri::command]
fn initialize_workspace(
    draft: setup::SetupDraft,
    confirmed: Option<bool>,
) -> Result<setup::WorkspaceInitResult, String> {
    setup::initialize_workspace(draft, confirmed.unwrap_or(false))
}

#[tauri::command]
fn assert_setup_revision(app: AppHandle, expected_revision: String) -> Result<(), String> {
    setup::assert_setup_revision(&app, &expected_revision)
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
    patch: setup::SetupPatch,
    expected_revision: String,
    confirmed: Option<bool>,
) -> Result<setup::SaveSetupResult, String> {
    setup::save_setup_config(&app, patch, expected_revision, confirmed.unwrap_or(false))
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

    let _workflow_lock = runner_ledger::ProcessLock::try_acquire(&app, "workflow")?
        .ok_or_else(|| "Another InnPilot automation is already running.".to_string())?;

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
