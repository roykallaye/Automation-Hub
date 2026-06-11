use crate::{activity, config, preflight, redaction::redact_line};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::Instant,
};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
struct CommandEvent {
    command_name: String,
    stream: String,
    line: String,
    timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StepResult {
    name: String,
    exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct RunSummary {
    pub(crate) automation_name: String,
    pub(crate) command_name: String,
    pub(crate) start_time: String,
    pub(crate) end_time: String,
    pub(crate) duration_ms: u128,
    pub(crate) exit_code: i32,
    pub(crate) status: String,
    pub(crate) steps: Vec<StepResult>,
    pub(crate) last_output_lines: Vec<String>,
}

#[derive(Debug, Clone)]
struct CommandStep {
    name: &'static str,
    program: String,
    args: Vec<String>,
    success_codes: Vec<i32>,
    report_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkflowImpact {
    High,
}

pub(crate) fn ensure_confirmation(command_name: &str, confirmed: bool) -> Result<(), String> {
    if workflow_impact(command_name).is_some() && !confirmed {
        Err("This action needs confirmation before FlowHost can run it.".to_string())
    } else {
        Ok(())
    }
}

pub(crate) async fn run_command_inner(
    app: &AppHandle,
    command_name: &str,
) -> Result<RunSummary, String> {
    let config = config::ensure_config(app)?;
    preflight::ensure_workflow_can_run(command_name, &config)?;
    let reports_dir = activity::activity_reports_dir(app)?;
    let (automation_name, steps) = command_steps(command_name, &config, Some(&reports_dir))?;
    let start = Local::now();
    let timer = Instant::now();
    let mut output_tail = VecDeque::with_capacity(100);
    let mut step_results = Vec::new();
    let mut step_reports = Vec::new();
    let mut final_exit_code = 0;
    let mut had_warning = false;

    emit_line(
        app,
        command_name,
        "system",
        &format!("Starting {automation_name}"),
    );

    if config.safety.dry_run_default {
        emit_line(
            app,
            command_name,
            "system",
            "Dry-run default is enabled in config. External scripts are still responsible for honoring dry-run behavior.",
        );
    }

    for step in steps {
        emit_line(
            app,
            command_name,
            "system",
            &format!("Running {}", step.name),
        );
        let exit_code = run_step(
            app,
            command_name,
            &step,
            &mut output_tail,
            config.safety.redact_logs,
        )?;
        step_results.push(StepResult {
            name: step.name.to_string(),
            exit_code,
        });

        if let Some(report_path) = step.report_path.clone() {
            step_reports.push(activity::StepReport { path: report_path });
        }

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
        .zip(command_steps(command_name, &config, None)?.1.iter())
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
    let _ = activity::append_run_activity(app, &summary, &step_reports);
    Ok(summary)
}

fn workflow_impact(command_name: &str) -> Option<WorkflowImpact> {
    match command_name {
        "process_invoices_and_drafts"
        | "reconnect_gmail"
        | "copy_scansioni"
        | "ocr_preprocessing"
        | "process_signed_contracts" => Some(WorkflowImpact::High),
        _ => None,
    }
}

fn command_steps(
    command_name: &str,
    config: &config::HubConfig,
    reports_dir: Option<&Path>,
) -> Result<(&'static str, Vec<CommandStep>), String> {
    let scripts = &config.scripts;
    let cmd_success = vec![0];
    let robocopy_success = (0..=7).collect::<Vec<i32>>();

    let automation_config_path = config.automation.automation_config_path.clone();
    let python = config.automation.python_executable.clone();

    let cmd_file = |name: &'static str, path: &str, success_codes: Vec<i32>| CommandStep {
        name,
        program: "cmd.exe".to_string(),
        args: vec!["/C".to_string(), "call".to_string(), path.to_string()],
        success_codes,
        report_path: None,
    };

    let invoice = script_step(
        "Process invoice PDFs",
        &scripts.invoice_workflow_script,
        &python,
        Some(&automation_config_path),
        config.safety.dry_run_default,
        false,
        reports_dir,
        command_name,
        cmd_success.clone(),
    );
    let gmail = script_step(
        "Create Gmail drafts",
        &scripts.gmail_draft_script,
        &python,
        Some(&automation_config_path),
        config.safety.dry_run_default,
        false,
        reports_dir,
        command_name,
        cmd_success.clone(),
    );
    let reset_gmail = CommandStep {
        name: "Reset Gmail sign-in",
        program: "cmd.exe".to_string(),
        args: vec![
            "/C".to_string(),
            format!(
                "if exist \"{}\" del /q \"{}\"",
                config.gmail.token_path, config.gmail.token_path
            ),
        ],
        success_codes: cmd_success.clone(),
        report_path: None,
    };
    let copy_scansioni = cmd_file(
        "Copy scansioni cache",
        &scripts.copy_scansioni_script,
        robocopy_success,
    );
    let ocr = script_step(
        "Run OCR preprocessing",
        &scripts.ocr_preprocessing_script,
        &python,
        Some(&automation_config_path),
        false,
        false,
        reports_dir,
        command_name,
        cmd_success.clone(),
    );
    let contracts = script_step(
        "Process signed contracts",
        &scripts.contract_processing_script,
        &python,
        Some(&automation_config_path),
        false,
        is_legacy_wrapper(&scripts.contract_processing_script),
        reports_dir,
        command_name,
        cmd_success.clone(),
    );

    match command_name {
        "process_invoices_and_drafts" => Ok((
            "Process Invoices & Create Gmail Drafts",
            vec![invoice, gmail],
        )),
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

fn script_step(
    name: &'static str,
    path: &str,
    python_executable: &str,
    automation_config_path: Option<&str>,
    dry_run: bool,
    execute_contracts: bool,
    reports_dir: Option<&Path>,
    command_name: &str,
    success_codes: Vec<i32>,
) -> CommandStep {
    if is_python_script(path) {
        let mut args = vec![path.to_string()];
        if let Some(config_path) = automation_config_path {
            args.push("--config".to_string());
            args.push(config_path.to_string());
        }
        if dry_run {
            args.push("--dry-run".to_string());
        }
        if execute_contracts {
            args.push("--execute".to_string());
        }
        let report_path = if supports_json_report(path) {
            reports_dir.map(|dir| activity::report_path_for_step(dir, command_name, name))
        } else {
            None
        };
        if let Some(report_path) = &report_path {
            args.push("--json-report".to_string());
            args.push(report_path.to_string_lossy().to_string());
        }
        return CommandStep {
            name,
            program: python_executable.to_string(),
            args,
            success_codes,
            report_path,
        };
    }

    if is_powershell_script(path) {
        return CommandStep {
            name,
            program: "powershell.exe".to_string(),
            args: vec![
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-File".to_string(),
                path.to_string(),
            ],
            success_codes,
            report_path: None,
        };
    }

    let mut args = vec!["/C".to_string(), "call".to_string(), path.to_string()];
    if execute_contracts {
        args.push("--execute".to_string());
    }
    CommandStep {
        name,
        program: "cmd.exe".to_string(),
        args,
        success_codes,
        report_path: None,
    }
}

fn is_python_script(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("py"))
}

fn is_powershell_script(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ps1"))
}

fn is_legacy_wrapper(path: &str) -> bool {
    !is_python_script(path)
}

fn supports_json_report(path: &str) -> bool {
    matches!(
        Path::new(path).file_name().and_then(|name| name.to_str()),
        Some("process_fatture.py" | "create_gmail_draft.py" | "process_contratti.py")
    )
}

fn run_step(
    app: &AppHandle,
    command_name: &str,
    step: &CommandStep,
    output_tail: &mut VecDeque<String>,
    redact_logs: bool,
) -> Result<i32, String> {
    let mut command = Command::new(&step.program);
    command
        .args(&step.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

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
                handle_output_line(app, command_name, &stream, &line, output_tail, redact_logs);
                for (stream, line) in receiver.try_iter() {
                    handle_output_line(app, command_name, &stream, &line, output_tail, redact_logs);
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
        handle_output_line(app, command_name, &stream, &line, output_tail, redact_logs);
    }

    Ok(exit_code)
}

fn handle_output_line(
    app: &AppHandle,
    command_name: &str,
    stream: &str,
    line: &str,
    output_tail: &mut VecDeque<String>,
    redact_logs: bool,
) {
    let line = if redact_logs {
        redact_line(line)
    } else {
        line.to_string()
    };
    push_tail(output_tail, format!("[{stream}] {line}"));
    emit_line(app, command_name, stream, &line);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        AutomationConfig, ClientConfig, FolderPaths, GmailConfig, HubConfig, SafetyConfig,
        ScriptPaths,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn high_impact_workflow_without_confirmation_is_rejected() {
        let result = ensure_confirmation("process_signed_contracts", false);

        assert_eq!(
            result.unwrap_err(),
            "This action needs confirmation before FlowHost can run it."
        );
    }

    #[test]
    fn high_impact_workflow_with_confirmation_can_continue_to_readiness_validation() {
        assert!(ensure_confirmation("process_invoices_and_drafts", true).is_ok());
    }

    #[test]
    fn unknown_command_is_not_rejected_by_confirmation_guard() {
        assert!(ensure_confirmation("unknown_command", false).is_ok());
    }

    #[test]
    fn canonical_python_steps_receive_app_controlled_json_report_paths() {
        let root = temp_root("canonical_reports");
        let config = config_with_fake_workspace(&root);
        let reports_dir = root.join("app-data").join("activity").join("reports");

        let (_title, steps) =
            command_steps("process_invoices_and_drafts", &config, Some(&reports_dir)).unwrap();

        assert_eq!(steps.len(), 2);
        for step in steps {
            let report_path = step
                .report_path
                .expect("canonical step should have report path");
            assert!(report_path.starts_with(&reports_dir));
            assert!(step.args.contains(&"--json-report".to_string()));
            assert!(step
                .args
                .iter()
                .any(|arg| arg == &report_path.to_string_lossy()));
            assert!(step.args.contains(&"--config".to_string()));
            assert!(step.args.contains(&"--dry-run".to_string()));
        }
    }

    #[test]
    fn legacy_wrappers_do_not_receive_json_report_flags() {
        let root = temp_root("legacy_reports");
        let mut config = config_with_fake_workspace(&root);
        config.scripts.contract_processing_script = root
            .join("scripts")
            .join("run_process_contratti.cmd")
            .to_string_lossy()
            .to_string();
        fs::write(&config.scripts.contract_processing_script, b"echo fake").unwrap();
        let reports_dir = root.join("app-data").join("activity").join("reports");

        let (_title, steps) =
            command_steps("process_signed_contracts", &config, Some(&reports_dir)).unwrap();
        let contract_step = steps
            .iter()
            .find(|step| step.name == "Process signed contracts")
            .unwrap();

        assert!(contract_step.report_path.is_none());
        assert!(!contract_step.args.contains(&"--json-report".to_string()));
    }

    #[test]
    fn fake_canonical_contract_step_uses_report_path_without_execute_flag() {
        let root = temp_root("contract_dry_run");
        let config = config_with_fake_workspace(&root);
        let reports_dir = root.join("app-data").join("activity").join("reports");

        let (_title, steps) =
            command_steps("process_signed_contracts", &config, Some(&reports_dir)).unwrap();
        let contract_step = steps
            .iter()
            .find(|step| step.name == "Process signed contracts")
            .unwrap();

        assert!(contract_step
            .report_path
            .as_ref()
            .unwrap()
            .starts_with(&reports_dir));
        assert!(contract_step.args.contains(&"--json-report".to_string()));
        assert!(!contract_step.args.contains(&"--execute".to_string()));
    }

    fn config_with_fake_workspace(root: &Path) -> HubConfig {
        let scripts = root.join("scripts");
        let invoice_input = root.join("Invoices").join("Input");
        let invoice_output = root.join("Invoices").join("ReadyToSend");
        let invoice_archive = root.join("Invoices").join("Archive");
        let invoice_logs = root.join("Invoices").join("Logs");
        let gmail_token_dir = root.join("Gmail").join("Token");
        let scans_cache = root.join("Scans").join("IncomingCache");
        let ocr_text = root.join("Scans").join("TextOutput");
        let contracts = root.join("Contracts").join("2026").join("Signed");
        let contract_logs = root.join("Contracts").join("Logs");

        for dir in [
            &scripts,
            &invoice_input,
            &invoice_output,
            &invoice_archive,
            &invoice_logs,
            &gmail_token_dir,
            &scans_cache,
            &ocr_text,
            &contracts,
            &contract_logs,
        ] {
            fs::create_dir_all(dir).unwrap();
        }

        let invoice_script = scripts.join("process_fatture.py");
        let gmail_script = scripts.join("create_gmail_draft.py");
        let copy_script = scripts.join("copy_scansioni.cmd");
        let ocr_script = scripts.join("preprocess_scansioni_to_text.ps1");
        let contract_script = scripts.join("process_contratti.py");
        for file in [
            &invoice_script,
            &gmail_script,
            &copy_script,
            &ocr_script,
            &contract_script,
        ] {
            fs::write(file, b"fake script fixture").unwrap();
        }

        HubConfig {
            schema_version: 2,
            client: ClientConfig {
                display_name: "Fake Hotel".to_string(),
            },
            automation: AutomationConfig {
                automation_config_path: root
                    .join("automation")
                    .join("config.local.json")
                    .to_string_lossy()
                    .to_string(),
                python_executable: "python".to_string(),
            },
            scripts: ScriptPaths {
                invoice_workflow_script: invoice_script.to_string_lossy().to_string(),
                gmail_draft_script: gmail_script.to_string_lossy().to_string(),
                copy_scansioni_script: copy_script.to_string_lossy().to_string(),
                ocr_preprocessing_script: ocr_script.to_string_lossy().to_string(),
                contract_processing_script: contract_script.to_string_lossy().to_string(),
            },
            folders: FolderPaths {
                invoice_input_folder: invoice_input.to_string_lossy().to_string(),
                invoice_output_folder: invoice_output.to_string_lossy().to_string(),
                invoice_archive_folder: invoice_archive.to_string_lossy().to_string(),
                invoice_log_folder: invoice_logs.to_string_lossy().to_string(),
                scansioni_network_share: scans_cache.to_string_lossy().to_string(),
                scansioni_local_cache_folder: scans_cache.to_string_lossy().to_string(),
                ocr_text_output_folder: ocr_text.to_string_lossy().to_string(),
                contracts_output_folder: contracts.to_string_lossy().to_string(),
                contract_log_folder: contract_logs.to_string_lossy().to_string(),
            },
            gmail: GmailConfig {
                token_path: gmail_token_dir
                    .join("gmail_token.json")
                    .to_string_lossy()
                    .to_string(),
            },
            safety: SafetyConfig {
                dry_run_default: true,
                require_confirmation_for_file_moves: true,
                redact_logs: true,
            },
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "flowhost_workflow_e2e_{name}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
}
