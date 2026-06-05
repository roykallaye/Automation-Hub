use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HubConfig {
    paths: HubPaths,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HubPaths {
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
    codex_scripts: String,
}

#[derive(Debug, Clone, Serialize)]
struct CommandEvent {
    command_name: String,
    stream: String,
    line: String,
    timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StepResult {
    name: String,
    exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RunSummary {
    automation_name: String,
    command_name: String,
    start_time: String,
    end_time: String,
    duration_ms: u128,
    exit_code: i32,
    status: String,
    steps: Vec<StepResult>,
    last_output_lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct LogInfo {
    key: String,
    label: String,
    path: Option<String>,
    modified: Option<String>,
}

struct AppState {
    is_running: Mutex<bool>,
    last_run: Mutex<Option<RunSummary>>,
}

#[derive(Debug, Clone)]
struct CommandStep {
    name: &'static str,
    program: String,
    args: Vec<String>,
    success_codes: Vec<i32>,
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            is_running: Mutex::new(false),
            last_run: Mutex::new(None),
        })
        .setup(|app| {
            ensure_config(&app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_command,
            open_path,
            get_latest_logs,
            get_last_run_summary
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life Hotel Automation Hub");
}

#[tauri::command]
async fn run_command(
    app: AppHandle,
    state: State<'_, AppState>,
    command_name: String,
) -> Result<RunSummary, String> {
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

    let result = run_command_inner(&app, &command_name).await;

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

async fn run_command_inner(app: &AppHandle, command_name: &str) -> Result<RunSummary, String> {
    let config = ensure_config(app)?;
    let (automation_name, steps) = command_steps(command_name, &config)?;
    let start = Local::now();
    let timer = Instant::now();
    let mut output_tail = VecDeque::with_capacity(100);
    let mut step_results = Vec::new();
    let mut final_exit_code = 0;
    let mut had_warning = false;

    emit_line(app, command_name, "system", &format!("Starting {automation_name}"));

    for step in steps {
        emit_line(app, command_name, "system", &format!("Running {}", step.name));
        let exit_code = run_step(app, command_name, &step, &mut output_tail)?;
        step_results.push(StepResult {
            name: step.name.to_string(),
            exit_code,
        });

        if !step.success_codes.contains(&exit_code) {
            final_exit_code = exit_code;
            emit_line(
                app,
                command_name,
                "system",
                &format!("Stopped after {} returned exit code {exit_code}", step.name),
            );
            break;
        }

        if exit_code != 0 {
            had_warning = true;
            final_exit_code = exit_code;
        }
    }

    let all_steps_succeeded = step_results
        .iter()
        .zip(command_steps(command_name, &config)?.1.iter())
        .all(|(result, step)| step.success_codes.contains(&result.exit_code));
    let status = if all_steps_succeeded {
        if had_warning {
            "warning"
        } else {
            "success"
        }
    } else {
        "error"
    };

    let summary = RunSummary {
        automation_name: automation_name.to_string(),
        command_name: command_name.to_string(),
        start_time: start.to_rfc3339(),
        end_time: Local::now().to_rfc3339(),
        duration_ms: timer.elapsed().as_millis(),
        exit_code: final_exit_code,
        status: status.to_string(),
        steps: step_results,
        last_output_lines: output_tail.into_iter().collect(),
    };

    app.emit("command-finished", &summary)
        .map_err(|error| error.to_string())?;
    Ok(summary)
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let config = ensure_config(&app)?;
    if !is_allowed_path(&config, &path) {
        return Err("This path is not in the Life Hotel Automation Hub allowlist.".to_string());
    }

    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|error| format!("Could not open path: {error}"))?;
    Ok(())
}

#[tauri::command]
fn get_latest_logs(app: AppHandle) -> Result<Vec<LogInfo>, String> {
    let config = ensure_config(&app)?;
    let copy_scansioni_log = PathBuf::from(format!(
        "{}\\copy_scansioni.log",
        config.paths.codex_scripts
    ));
    Ok(vec![
        latest_log("invoice_logs", "Latest invoice log", &config.paths.fatture_logs, None),
        latest_log(
            "contract_logs",
            "Latest contract log",
            &config.paths.fatture_logs,
            Some("contratt"),
        ),
        latest_log("codex_scripts", "Latest CodexScripts log", &config.paths.codex_scripts, None),
        LogInfo {
            key: "copy_scansioni".to_string(),
            label: "Copy scansioni log".to_string(),
            path: copy_scansioni_log
                .exists()
                .then(|| copy_scansioni_log.to_string_lossy().to_string()),
            modified: modified_time(&copy_scansioni_log),
        },
    ])
}

#[tauri::command]
fn get_last_run_summary(state: State<'_, AppState>) -> Result<Option<RunSummary>, String> {
    let last_run = state
        .last_run
        .lock()
        .map_err(|_| "Could not read last run summary.".to_string())?;
    Ok(last_run.clone())
}

fn command_steps(command_name: &str, config: &HubConfig) -> Result<(&'static str, Vec<CommandStep>), String> {
    let paths = &config.paths;
    let cmd_success = vec![0];
    let robocopy_success = (0..=7).collect::<Vec<i32>>();

    let cmd_file = |name: &'static str, path: &str, success_codes: Vec<i32>| CommandStep {
        name,
        program: "cmd.exe".to_string(),
        args: vec!["/C".to_string(), "call".to_string(), path.to_string()],
        success_codes,
    };

    let invoice = cmd_file(
        "Process invoice PDFs",
        &paths.invoice_process_command,
        cmd_success.clone(),
    );
    let gmail = cmd_file("Create Gmail drafts", &paths.gmail_draft_command, cmd_success.clone());
    let reset_gmail = CommandStep {
        name: "Reset Gmail sign-in",
        program: "cmd.exe".to_string(),
        args: vec![
            "/C".to_string(),
            format!(
                "if exist \"{}\" del /q \"{}\"",
                paths.gmail_token, paths.gmail_token
            ),
        ],
        success_codes: cmd_success.clone(),
    };
    let copy_scansioni = cmd_file(
        "Copy scansioni cache",
        &paths.copy_scansioni_command,
        robocopy_success,
    );
    let ocr = CommandStep {
        name: "Run OCR preprocessing",
        program: "powershell.exe".to_string(),
        args: vec![
            "-NoProfile".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-File".to_string(),
            paths.ocr_preprocess_script.clone(),
        ],
        success_codes: cmd_success.clone(),
    };
    let contracts = CommandStep {
        name: "Process signed contracts",
        program: "cmd.exe".to_string(),
        args: vec![
            "/C".to_string(),
            "call".to_string(),
            paths.contract_process_command.clone(),
            "--execute".to_string(),
        ],
        success_codes: cmd_success.clone(),
    };

    match command_name {
        "process_invoices_and_drafts" => Ok(("Process Invoices & Create Gmail Drafts", vec![invoice, gmail])),
        "reconnect_gmail" => Ok(("Reconnect Gmail", vec![reset_gmail, gmail])),
        "copy_scansioni" => Ok(("Copy Scansioni", vec![copy_scansioni])),
        "ocr_preprocessing" => Ok(("Run OCR Preprocessing", vec![ocr])),
        "process_signed_contracts" => Ok((
            "Process Signed Contracts",
            vec![copy_scansioni, ocr, contracts],
        )),
        _ => Err("Unknown automation command.".to_string()),
    }
}

fn run_step(
    app: &AppHandle,
    command_name: &str,
    step: &CommandStep,
    output_tail: &mut VecDeque<String>,
) -> Result<i32, String> {
    let mut command = Command::new(&step.program);
    command.args(&step.args).stdout(Stdio::piped()).stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", step.name))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("Could not capture stdout for {}", step.name))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("Could not capture stderr for {}", step.name))?;
    let (sender, receiver) = mpsc::channel::<(String, String)>();

    let stdout_sender = sender.clone();
    thread::spawn(move || read_stream("stdout", stdout, stdout_sender));
    let stderr_sender = sender.clone();
    thread::spawn(move || read_stream("stderr", stderr, stderr_sender));
    drop(sender);

    let exit_code = loop {
        match receiver.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok((stream, line)) => {
                push_tail(output_tail, format!("[{stream}] {line}"));
                emit_line(app, command_name, &stream, &line);
                for (stream, line) in receiver.try_iter() {
                    push_tail(output_tail, format!("[{stream}] {line}"));
                    emit_line(app, command_name, &stream, &line);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                thread::sleep(std::time::Duration::from_millis(100));
            }
        }

        match child
            .try_wait()
            .map_err(|error| format!("Could not wait for {}: {error}", step.name))?
        {
            Some(status) => break status.code().unwrap_or(-1),
            None => continue,
        }
    };

    for (stream, line) in receiver.iter() {
        push_tail(output_tail, format!("[{stream}] {line}"));
        emit_line(app, command_name, &stream, &line);
    }

    Ok(exit_code)
}

fn read_stream<R: std::io::Read + Send + 'static>(
    stream: &'static str,
    reader: R,
    sender: mpsc::Sender<(String, String)>,
) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buffer).trim_end().to_string();
                let _ = sender.send((stream.to_string(), line));
            }
            Err(_) => break,
        }
    }
}

fn emit_line(app: &AppHandle, command_name: &str, stream: &str, line: &str) {
    let _ = app.emit(
        "command-output",
        CommandEvent {
            command_name: command_name.to_string(),
            stream: stream.to_string(),
            line: line.to_string(),
            timestamp: Local::now().to_rfc3339(),
        },
    );
}

fn push_tail(output_tail: &mut VecDeque<String>, line: String) {
    if output_tail.len() == 100 {
        output_tail.pop_front();
    }
    output_tail.push_back(line);
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

fn modified_time(path: &Path) -> Option<String> {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .map(|modified| DateTime::<Local>::from(modified).to_rfc3339())
}

fn is_allowed_path(config: &HubConfig, path: &str) -> bool {
    let paths = &config.paths;
    let allowed_roots = [
        &paths.invoices_input,
        &paths.ready_invoices,
        &paths.fatture_logs,
        &paths.network_scans,
        &paths.local_scans_cache,
        &paths.ocr_text_output,
        &paths.signed_contracts,
        &paths.codex_scripts,
    ];
    let normalized = normalize_for_compare(path);
    allowed_roots.iter().any(|root| {
        let root = normalize_for_compare(root);
        normalized == root || normalized.starts_with(&format!("{root}\\"))
    })
}

fn normalize_for_compare(path: &str) -> String {
    path.trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_lowercase()
}

fn ensure_config(app: &AppHandle) -> Result<HubConfig, String> {
    let config = default_config();
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate app data directory: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    let config_path = app_data_dir.join("config.json");

    if config_path.exists() {
        let contents = fs::read_to_string(&config_path)
            .map_err(|error| format!("Could not read config file: {error}"))?;
        serde_json::from_str(&contents).map_err(|error| format!("Invalid config file: {error}"))
    } else {
        let contents = serde_json::to_string_pretty(&config)
            .map_err(|error| format!("Could not prepare default config: {error}"))?;
        fs::write(&config_path, contents)
            .map_err(|error| format!("Could not write default config: {error}"))?;
        Ok(config)
    }
}

fn default_config() -> HubConfig {
    HubConfig {
        paths: HubPaths {
            invoice_process_command:
                r"C:\Users\back-office-life\Desktop\Fatture\Script\run_process_fatture_scheduled.cmd"
                    .to_string(),
            gmail_draft_command:
                r"C:\Users\back-office-life\Desktop\Fatture\Script\run_create_gmail_draft.cmd"
                    .to_string(),
            gmail_token: r"C:\Users\back-office-life\Desktop\Fatture\Script\gmail_token.json"
                .to_string(),
            invoices_input: r"C:\Users\back-office-life\Desktop\Fatture\Input".to_string(),
            ready_invoices:
                r"C:\Users\back-office-life\Desktop\Fatture\Output_ProntoInvio".to_string(),
            fatture_logs: r"C:\Users\back-office-life\Desktop\Fatture\Log".to_string(),
            copy_scansioni_command: r"C:\Users\back-office-life\Documents\copy_scansioni.cmd"
                .to_string(),
            network_scans: r"\\172.16.47.20\shared\Scansioni".to_string(),
            local_scans_cache: r"C:\Users\back-office-life\Documents\CodexInput\Scansioni"
                .to_string(),
            ocr_preprocess_script:
                r"C:\Users\back-office-life\Documents\CodexScripts\preprocess_scansioni_to_text.ps1"
                    .to_string(),
            ocr_text_output:
                r"C:\Users\back-office-life\Documents\CodexInput\ScansioniText".to_string(),
            contract_process_command:
                r"C:\Users\back-office-life\Desktop\Fatture\Script\run_process_contratti.cmd"
                    .to_string(),
            signed_contracts:
                r"C:\Users\back-office-life\Desktop\Life Hotel\Staff\2026\CONTRATTI FIRMATI"
                    .to_string(),
            codex_scripts: r"C:\Users\back-office-life\Documents\CodexScripts".to_string(),
        },
    }
}
