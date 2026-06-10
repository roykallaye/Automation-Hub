use crate::{config, preflight, redaction::redact_line};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader},
    path::Path,
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

#[derive(Debug, Clone)]
struct CommandStep {
    name: &'static str,
    program: String,
    args: Vec<String>,
    success_codes: Vec<i32>,
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
    let (automation_name, steps) = command_steps(command_name, &config)?;
    let start = Local::now();
    let timer = Instant::now();
    let mut output_tail = VecDeque::with_capacity(100);
    let mut step_results = Vec::new();
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
    };

    let invoice = script_step(
        "Process invoice PDFs",
        &scripts.invoice_workflow_script,
        &python,
        Some(&automation_config_path),
        config.safety.dry_run_default,
        false,
        cmd_success.clone(),
    );
    let gmail = script_step(
        "Create Gmail drafts",
        &scripts.gmail_draft_script,
        &python,
        Some(&automation_config_path),
        config.safety.dry_run_default,
        false,
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
        cmd_success.clone(),
    );
    let contracts = script_step(
        "Process signed contracts",
        &scripts.contract_processing_script,
        &python,
        Some(&automation_config_path),
        false,
        is_legacy_wrapper(&scripts.contract_processing_script),
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
        return CommandStep {
            name,
            program: python_executable.to_string(),
            args,
            success_codes,
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
}
