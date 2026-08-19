mod activity;
mod application;
mod automation_install;
mod branding;
#[cfg(feature = "cloud-e2e-probe")]
mod cloud_probe;
#[cfg(feature = "cloud-e2e-probe")]
pub use cloud_probe::run_cloud_e2e_probe;
mod config;
mod desktop_service;
mod discovery;
mod domain;
mod folder_discovery;
pub mod local_mcp;
mod logs;
mod onboarding;
mod paths;
mod platform;
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

fn setup_application_service(
    app: &AppHandle,
) -> domain::WorkspaceResult<application::SetupApplicationService> {
    let paths = platform::InstallationPaths::resolve(app)?;
    application::SetupApplicationService::new(paths, platform::BuildInfo::resolve(app))
}

fn health_service(app: &AppHandle) -> domain::WorkspaceResult<application::HealthService> {
    let paths = platform::InstallationPaths::resolve(app)?;
    let repository = config::ConfigurationRepository::new(paths.config_file, paths.packaged_worker);
    Ok(application::HealthService::new(
        setup::ConfigurationService::new(repository),
    ))
}

fn recovery_application_service(
    app: &AppHandle,
) -> domain::WorkspaceResult<application::RecoveryApplicationService> {
    let paths = platform::InstallationPaths::resolve(app)?;
    let environment = recovery::RecoveryEnvironment::from_installation(
        &paths,
        &platform::BuildInfo::resolve(app),
    );
    Ok(application::RecoveryApplicationService::new(
        recovery::RecoveryService::new(environment),
    ))
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
            let paths = platform::InstallationPaths::resolve(app.handle())
                .map_err(std::io::Error::other)?;
            let services = application::SetupApplicationService::new(
                paths.clone(),
                platform::BuildInfo::resolve(app.handle()),
            )
            .map_err(std::io::Error::other)?;
            services
                .configuration()
                .reconcile_incomplete_commit(services.recovery(), &paths.runner_root)
                .map_err(std::io::Error::other)?;
            // Capture this before `ensure_config` creates first-run defaults so
            // onboarding can distinguish a new installation from an upgrade.
            let config_preexisted = paths.config_file.is_file();
            services
                .configuration()
                .ensure()
                .map_err(std::io::Error::other)?;
            // A damaged or newer onboarding record must not prevent InnPilot
            // from opening. The typed command routes the UI to Support and
            // preserves the record for explicit recovery.
            if services
                .onboarding()
                .reconcile_startup(config_preexisted)
                .is_err()
            {
                eprintln!("InnPilot onboarding state needs recovery or a newer app version.");
            }
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
            get_onboarding_state,
            begin_or_resume_onboarding,
            record_onboarding_progress,
            mark_onboarding_failed,
            restart_onboarding,
            import_legacy_onboarding_progress,
            recover_onboarding_state,
            get_setup_snapshot,
            preview_setup,
            apply_approved_setup,
            remove_setup_created_empty_folders,
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
            restore_recovery_configuration,
            get_local_agent_connection,
            create_local_agent_connection,
            revoke_local_agent_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running InnPilot");
}

#[tauri::command]
fn get_local_agent_connection(
    app: AppHandle,
) -> Result<local_mcp::LocalAgentConnectionStatus, domain::WorkspaceError> {
    local_mcp::connection_status(&app)
}

#[tauri::command]
fn create_local_agent_connection(
    app: AppHandle,
) -> Result<local_mcp::LocalAgentConnectionStatus, domain::WorkspaceError> {
    local_mcp::create_connection(&app)
}

#[tauri::command]
fn revoke_local_agent_connection(
    app: AppHandle,
) -> Result<local_mcp::LocalAgentConnectionStatus, domain::WorkspaceError> {
    local_mcp::revoke_connection(&app)
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
fn get_recovery_status(app: AppHandle) -> Result<recovery::RecoveryStatus, domain::WorkspaceError> {
    recovery_application_service(&app)?.status()
}

#[tauri::command]
fn create_recovery_point(
    app: AppHandle,
) -> Result<recovery::RecoveryActionResult, domain::WorkspaceError> {
    recovery_application_service(&app)?.create()
}

#[tauri::command]
fn restore_recovery_configuration(
    app: AppHandle,
    point_id: String,
    confirmed: Option<bool>,
) -> Result<recovery::RecoveryActionResult, domain::WorkspaceError> {
    setup_application_service(&app)?.restore_configuration(&point_id, confirmed.unwrap_or(false))
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
fn get_config_status(app: AppHandle) -> Result<preflight::AppConfigStatus, domain::WorkspaceError> {
    health_service(&app)?.check(application::HealthCheckRequest {
        mode: application::HealthCheckMode::Fast,
    })
}

#[tauri::command]
async fn refresh_config_status(
    app: AppHandle,
) -> Result<preflight::AppConfigStatus, domain::WorkspaceError> {
    tauri::async_runtime::spawn_blocking(move || {
        health_service(&app)?.check(application::HealthCheckRequest {
            mode: application::HealthCheckMode::Full,
        })
    })
    .await
    .map_err(|error| {
        domain::WorkspaceError::new(
            domain::WorkspaceErrorCode::Internal,
            domain::WorkspaceErrorCategory::Internal,
            "The automation safety check stopped unexpectedly.",
            domain::RetryDirective::Retry,
        )
        .with_diagnostic(error.to_string())
    })?
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
fn validate_configuration(
    app: AppHandle,
) -> Result<preflight::PreflightReport, domain::WorkspaceError> {
    health_service(&app)?.validate()
}

#[tauri::command]
fn get_onboarding_state(
    app: AppHandle,
) -> Result<onboarding::OnboardingSnapshot, onboarding::OnboardingError> {
    onboarding::get(&app)
}

#[tauri::command]
fn begin_or_resume_onboarding(
    app: AppHandle,
    mode: onboarding::OnboardingMode,
    expected_revision: u64,
    request_id: String,
) -> Result<onboarding::OnboardingSnapshot, onboarding::OnboardingError> {
    onboarding::begin_or_resume(&app, mode, expected_revision, request_id)
}

#[tauri::command]
fn record_onboarding_progress(
    app: AppHandle,
    checkpoint: onboarding::ManualSetupCheckpoint,
    expected_revision: u64,
    request_id: String,
) -> Result<onboarding::OnboardingSnapshot, onboarding::OnboardingError> {
    onboarding::record_progress(&app, checkpoint, expected_revision, request_id)
}

#[tauri::command]
fn mark_onboarding_failed(
    app: AppHandle,
    expected_revision: u64,
    failure_code: String,
    request_id: String,
) -> Result<onboarding::OnboardingSnapshot, onboarding::OnboardingError> {
    onboarding::mark_failed(&app, expected_revision, failure_code, request_id)
}

#[tauri::command]
fn restart_onboarding(
    app: AppHandle,
    mode: onboarding::OnboardingMode,
    expected_revision: u64,
    request_id: String,
) -> Result<onboarding::OnboardingSnapshot, onboarding::OnboardingError> {
    onboarding::restart(&app, mode, expected_revision, request_id)
}

#[tauri::command]
fn import_legacy_onboarding_progress(
    app: AppHandle,
    raw_json: String,
    expected_revision: u64,
    request_id: String,
) -> Result<onboarding::OnboardingSnapshot, onboarding::OnboardingError> {
    onboarding::import_legacy(&app, raw_json, expected_revision, request_id)
}

#[tauri::command]
fn recover_onboarding_state(
    app: AppHandle,
) -> Result<onboarding::OnboardingSnapshot, onboarding::OnboardingError> {
    onboarding::recover(&app)
}

#[tauri::command]
fn get_setup_snapshot(app: AppHandle) -> Result<setup::SetupSnapshot, domain::WorkspaceError> {
    setup_application_service(&app)?.setup_snapshot()
}

#[tauri::command]
fn preview_setup(
    app: AppHandle,
    patch: setup::SetupPatch,
    expected_revision: String,
) -> Result<setup::SetupPreview, domain::WorkspaceError> {
    setup_application_service(&app)?.preview_setup(&patch, &expected_revision)
}

#[tauri::command]
fn apply_approved_setup(
    app: AppHandle,
    request: application::ApplyApprovedSetupRequest,
) -> Result<application::ApplyApprovedSetupResult, domain::WorkspaceError> {
    setup_application_service(&app)?.apply_approved_setup(request)
}

#[tauri::command]
fn remove_setup_created_empty_folders(
    app: AppHandle,
    expected_onboarding_revision: u64,
    confirmed: Option<bool>,
) -> Result<CleanupCreatedFoldersCommandResult, domain::WorkspaceError> {
    let (cleanup, onboarding) = setup_application_service(&app)?
        .cleanup_created_folders(expected_onboarding_revision, confirmed.unwrap_or(false))?;
    Ok(CleanupCreatedFoldersCommandResult {
        cleanup,
        onboarding,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupCreatedFoldersCommandResult {
    cleanup: setup::SetupCleanupResult,
    onboarding: onboarding::OnboardingSnapshot,
}

#[tauri::command]
fn validate_setup(app: AppHandle) -> Result<preflight::PreflightReport, domain::WorkspaceError> {
    health_service(&app)?.validate()
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
