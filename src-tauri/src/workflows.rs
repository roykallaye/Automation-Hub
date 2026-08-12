use crate::{activity, config, preflight, redaction::redact_line};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
#[cfg(not(feature = "cloud-e2e-probe"))]
use tauri::Manager;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::{io::AsRawHandle, process::CommandExt};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{
            OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
        },
    },
};

const MAX_OUTPUT_BYTES_PER_STEP: usize = 1024 * 1024;
const MAX_OUTPUT_LINE_BYTES: usize = 16 * 1024;
const OUTPUT_CHANNEL_CAPACITY: usize = 64;
const STEP_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, Serialize)]
struct CommandEvent {
    command_name: String,
    stream: String,
    line: String,
    timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StepResult {
    pub(crate) name: String,
    pub(crate) exit_code: i32,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkflowRunSource {
    Local,
    Remote,
}

pub(crate) fn ensure_confirmation(command_name: &str, confirmed: bool) -> Result<(), String> {
    if workflow_impact(command_name).is_some() && !confirmed {
        Err("This action needs confirmation before InnPilot can run it.".to_string())
    } else {
        Ok(())
    }
}

pub(crate) async fn run_command_inner(
    app: &AppHandle,
    command_name: &str,
) -> Result<RunSummary, String> {
    run_command_inner_controlled(app, command_name, None, || false).await
}

pub(crate) async fn run_command_inner_controlled<F>(
    app: &AppHandle,
    command_name: &str,
    dry_run_override: Option<bool>,
    should_cancel: F,
) -> Result<RunSummary, String>
where
    F: Fn() -> bool,
{
    run_command_inner_controlled_from(
        app,
        command_name,
        dry_run_override,
        should_cancel,
        WorkflowRunSource::Local,
    )
    .await
}

pub(crate) async fn run_remote_command_inner_controlled<F>(
    app: &AppHandle,
    command_name: &str,
    dry_run: bool,
    should_cancel: F,
) -> Result<RunSummary, String>
where
    F: Fn() -> bool,
{
    run_command_inner_controlled_from(
        app,
        command_name,
        Some(dry_run),
        should_cancel,
        WorkflowRunSource::Remote,
    )
    .await
}

async fn run_command_inner_controlled_from<F>(
    app: &AppHandle,
    command_name: &str,
    dry_run_override: Option<bool>,
    should_cancel: F,
    source: WorkflowRunSource,
) -> Result<RunSummary, String>
where
    F: Fn() -> bool,
{
    let mut config = config::ensure_config(app)?;
    preflight::ensure_workflow_can_run(command_name, &config)?;
    let reports_dir = activity::activity_reports_dir(app)?;
    let dry_run = if command_name == "reconnect_gmail" {
        false
    } else {
        dry_run_override.unwrap_or(config.safety.dry_run_default)
    };
    let (automation_name, steps) =
        command_steps(command_name, &config, Some(&reports_dir), dry_run)?;
    if source == WorkflowRunSource::Remote {
        ensure_remote_runtime(app, command_name, &config, &steps)?;
        config.safety.redact_logs = true;
    }
    let start = Local::now();
    let timer = Instant::now();
    let mut output_tail = VecDeque::with_capacity(100);
    let mut step_results = Vec::new();
    let mut step_reports = Vec::new();
    let mut final_exit_code = 0;
    let mut had_warning = false;
    let mut had_failure = false;

    emit_line(
        app,
        command_name,
        "system",
        &format!("Starting {automation_name}"),
    );

    if command_name == "reconnect_gmail" {
        emit_line(
            app,
            command_name,
            "system",
            "Resetting the configured Gmail sign-in token",
        );
        reset_gmail_token(&config.gmail.token_path)?;
        step_results.push(StepResult {
            name: "Reset Gmail sign-in".to_string(),
            exit_code: 0,
        });
    }

    if dry_run {
        emit_line(
            app,
            command_name,
            "system",
            "Dry-run default is enabled in config. External scripts are still responsible for honoring dry-run behavior.",
        );
    }

    for step in steps {
        if should_cancel() {
            return Err("RUNNER_CANCELLED".to_string());
        }
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
            &should_cancel,
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
            had_failure = true;
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

    let status = if !had_failure {
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

fn ensure_remote_runtime(
    _app: &AppHandle,
    command_name: &str,
    config: &config::HubConfig,
    steps: &[CommandStep],
) -> Result<(), String> {
    #[cfg(feature = "cloud-e2e-probe")]
    let trusted_worker = PathBuf::from(&config.automation.python_executable);
    #[cfg(not(feature = "cloud-e2e-probe"))]
    let trusted_worker =
        config::packaged_worker_path(_app).ok_or_else(|| "RUNNER_UNTRUSTED_RUNTIME".to_string())?;

    crate::worker_runtime::verified_trusted_worker_digest(
        &config.automation.python_executable,
        &trusted_worker,
    )
    .map_err(|_| "RUNNER_UNTRUSTED_RUNTIME".to_string())?;
    if steps.is_empty() {
        return Err("RUNNER_UNTRUSTED_RUNTIME".to_string());
    }

    #[cfg(feature = "cloud-e2e-probe")]
    let automation_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "RUNNER_UNTRUSTED_RUNTIME".to_string())?
        .join("automation");
    #[cfg(not(feature = "cloud-e2e-probe"))]
    let automation_root = _app
        .path()
        .resource_dir()
        .map_err(|_| "RUNNER_UNTRUSTED_RUNTIME".to_string())?
        .join("automation");

    let expected_scripts: &[&str] = match command_name {
        "process_invoices_and_drafts" => {
            if config.invoice_delivery_mode == config::InvoiceDeliveryMode::PrepareOnly {
                &["invoices/process_fatture.py"]
            } else {
                &[
                    "invoices/process_fatture.py",
                    "gmail_drafts/create_gmail_draft.py",
                ]
            }
        }
        "copy_scansioni" => &["scans/copy_scans.py"],
        "process_signed_contracts" => &[
            "scans/copy_scans.py",
            "ocr/extract_scan_text.py",
            "contracts/process_contratti.py",
        ],
        _ => return Err("RUNNER_UNTRUSTED_RUNTIME".to_string()),
    };

    if steps.len() != expected_scripts.len()
        || steps.iter().zip(expected_scripts).any(|(step, expected)| {
            step.program != config.automation.python_executable
                || step.args.first().is_none_or(|path| {
                    !crate::worker_runtime::trusted_path_matches(
                        Path::new(path),
                        &automation_root.join(expected),
                    )
                })
                || step.report_path.is_none()
        })
    {
        return Err("RUNNER_UNTRUSTED_RUNTIME".to_string());
    }
    Ok(())
}

fn command_steps(
    command_name: &str,
    config: &config::HubConfig,
    reports_dir: Option<&Path>,
    dry_run: bool,
) -> Result<(&'static str, Vec<CommandStep>), String> {
    let scripts = &config.scripts;
    let cmd_success = vec![0];
    let robocopy_success = (0..=7).collect::<Vec<i32>>();

    let automation_config_path = config.automation.automation_config_path.clone();
    let python = config.automation.python_executable.clone();
    let build_step = |name: &'static str,
                      path: &str,
                      dry_run: bool,
                      execute_contracts: bool,
                      success_codes: Vec<i32>| {
        script_step(
            name,
            path,
            &python,
            ScriptStepOptions {
                automation_config_path: Some(&automation_config_path),
                dry_run,
                execute_contracts,
                reports_dir,
                command_name,
                success_codes,
            },
        )
    };

    let invoice = build_step(
        "Process invoice PDFs",
        &scripts.invoice_workflow_script,
        dry_run,
        false,
        cmd_success.clone(),
    );
    let gmail = build_step(
        "Create Gmail drafts",
        &scripts.gmail_draft_script,
        dry_run,
        false,
        cmd_success.clone(),
    );
    let mut gmail_authorization = build_step(
        "Authorize Gmail",
        &scripts.gmail_draft_script,
        false,
        false,
        cmd_success.clone(),
    );
    if is_python_script(&scripts.gmail_draft_script) {
        gmail_authorization
            .args
            .push("--authorize-only".to_string());
    }
    let copy_success = if is_python_script(&scripts.copy_scansioni_script) {
        cmd_success.clone()
    } else {
        robocopy_success
    };
    let copy_scansioni = build_step(
        "Copy scansioni cache",
        &scripts.copy_scansioni_script,
        dry_run,
        false,
        copy_success,
    );
    let ocr = build_step(
        "Run OCR preprocessing",
        &scripts.ocr_preprocessing_script,
        dry_run,
        false,
        cmd_success.clone(),
    );
    let contracts = build_step(
        "Process signed contracts",
        &scripts.contract_processing_script,
        false,
        !dry_run,
        cmd_success.clone(),
    );

    match command_name {
        "process_invoices_and_drafts" => {
            if config.invoice_delivery_mode == config::InvoiceDeliveryMode::PrepareOnly {
                Ok(("Prepare Invoice Files", vec![invoice]))
            } else {
                Ok((
                    "Process Invoices & Create Gmail Drafts",
                    vec![invoice, gmail],
                ))
            }
        }
        "reconnect_gmail" => {
            if !is_python_script(&scripts.gmail_draft_script) {
                return Err(
                    "Gmail reconnection needs the updated InnPilot authorization helper. Update the local automation package before reconnecting."
                        .to_string(),
                );
            }
            Ok(("Reconnect Gmail", vec![gmail_authorization]))
        }
        "copy_scansioni" => Ok(("Copy Scansioni", vec![copy_scansioni])),
        "ocr_preprocessing" => Ok(("Run OCR Preprocessing", vec![ocr])),
        "process_signed_contracts" => Ok((
            "Process Signed Contracts",
            vec![copy_scansioni, ocr, contracts],
        )),
        _ => Err("Unknown automation command.".to_string()),
    }
}

struct ScriptStepOptions<'a> {
    automation_config_path: Option<&'a str>,
    dry_run: bool,
    execute_contracts: bool,
    reports_dir: Option<&'a Path>,
    command_name: &'a str,
    success_codes: Vec<i32>,
}

fn script_step(
    name: &'static str,
    path: &str,
    python_executable: &str,
    options: ScriptStepOptions<'_>,
) -> CommandStep {
    if is_python_script(path) {
        let mut args = vec![path.to_string()];
        if let Some(config_path) = options.automation_config_path {
            args.push("--config".to_string());
            args.push(config_path.to_string());
        }
        if options.dry_run {
            args.push("--dry-run".to_string());
        }
        if options.execute_contracts {
            args.push("--execute".to_string());
        }
        let report_path = if supports_json_report(path) {
            options
                .reports_dir
                .map(|dir| activity::report_path_for_step(dir, options.command_name, name))
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
            success_codes: options.success_codes,
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
            success_codes: options.success_codes,
            report_path: None,
        };
    }

    let mut args = vec!["/C".to_string(), "call".to_string(), path.to_string()];
    if options.execute_contracts {
        args.push("--execute".to_string());
    }
    CommandStep {
        name,
        program: "cmd.exe".to_string(),
        args,
        success_codes: options.success_codes,
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

fn supports_json_report(path: &str) -> bool {
    matches!(
        Path::new(path).file_name().and_then(|name| name.to_str()),
        Some(
            "process_fatture.py"
                | "create_gmail_draft.py"
                | "process_contratti.py"
                | "copy_scans.py"
                | "extract_scan_text.py"
        )
    )
}

fn reset_gmail_token(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("The Gmail token path is not configured.".to_string());
    }

    let token_path = Path::new(trimmed);
    if !token_path.exists() {
        return Ok(());
    }
    if !token_path.is_file() {
        return Err("The configured Gmail token path is not a file.".to_string());
    }

    fs::remove_file(token_path)
        .map_err(|error| format!("Could not reset the configured Gmail token: {error}"))
}

#[cfg(windows)]
fn configure_contained_command(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
}

#[cfg(not(windows))]
fn configure_contained_command(_command: &mut Command) {}

#[cfg(windows)]
unsafe fn resume_primary_thread(process_id: u32) -> Result<(), ()> {
    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(());
    }

    let mut entry: THREADENTRY32 = std::mem::zeroed();
    entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
    let mut resumed = false;
    if Thread32First(snapshot, &mut entry) != 0 {
        loop {
            if entry.th32OwnerProcessID == process_id {
                let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if !thread.is_null() {
                    resumed = ResumeThread(thread) != u32::MAX;
                    CloseHandle(thread);
                }
                break;
            }
            if Thread32Next(snapshot, &mut entry) == 0 {
                break;
            }
        }
    }
    CloseHandle(snapshot);
    resumed.then_some(()).ok_or(())
}

#[cfg(windows)]
#[derive(Debug)]
struct ChildContainment {
    job: Option<HANDLE>,
}

#[cfg(windows)]
impl ChildContainment {
    fn attach(child: &mut Child) -> Result<Self, String> {
        let result = unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                Err(())
            } else {
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let configured = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    std::ptr::addr_of!(limits).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) != 0;
                let assigned = configured
                    && AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) != 0;
                let resumed = assigned && resume_primary_thread(child.id()).is_ok();
                if !resumed {
                    if assigned {
                        TerminateJobObject(job, 1);
                    }
                    CloseHandle(job);
                    Err(())
                } else {
                    Ok(Self { job: Some(job) })
                }
            }
        };

        result.map_err(|_| {
            if child.kill().is_ok() {
                let _ = child.wait();
            }
            "RUNNER_CONTAINMENT_FAILURE".to_string()
        })
    }

    fn terminate(&self) -> Result<(), String> {
        let Some(job) = self.job else {
            return Err("RUNNER_CONTAINMENT_FAILURE".to_string());
        };
        if unsafe { TerminateJobObject(job, 1) } == 0 {
            return Err("RUNNER_CONTAINMENT_FAILURE".to_string());
        }
        Ok(())
    }

    fn release(&mut self) {
        if let Some(job) = self.job.take() {
            unsafe {
                CloseHandle(job);
            }
        }
    }
}

#[cfg(windows)]
impl Drop for ChildContainment {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(not(windows))]
#[derive(Debug)]
struct ChildContainment;

#[cfg(not(windows))]
impl ChildContainment {
    fn attach(_child: &mut Child) -> Result<Self, String> {
        Ok(Self)
    }

    fn release(&mut self) {}
}

#[cfg(windows)]
fn terminate_child(child: &mut Child, containment: &mut ChildContainment) -> Result<(), String> {
    if containment.terminate().is_err() {
        if child.kill().is_ok() {
            let _ = child.wait();
        }
        containment.release();
        return Err("RUNNER_CONTAINMENT_FAILURE".to_string());
    }
    let _ = child.wait();
    containment.release();
    Ok(())
}

#[cfg(not(windows))]
fn terminate_child(child: &mut Child, containment: &mut ChildContainment) -> Result<(), String> {
    child
        .kill()
        .map_err(|_| "RUNNER_CONTAINMENT_FAILURE".to_string())?;
    let _ = child.wait();
    containment.release();
    Ok(())
}

#[derive(Debug)]
struct StreamLine {
    stream: &'static str,
    line: String,
}

fn run_step(
    app: &AppHandle,
    command_name: &str,
    step: &CommandStep,
    output_tail: &mut VecDeque<String>,
    redact_logs: bool,
    should_cancel: &impl Fn() -> bool,
) -> Result<i32, String> {
    crate::worker_runtime::verify_worker(&step.program)?;
    let mut command = Command::new(&step.program);
    command
        .args(&step.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    configure_contained_command(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", step.name))?;
    let mut containment = ChildContainment::attach(&mut child)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("Could not capture stdout for {}", step.name))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("Could not capture stderr for {}", step.name))?;
    let (sender, receiver) = mpsc::sync_channel::<StreamLine>(OUTPUT_CHANNEL_CAPACITY);
    let output_bytes = Arc::new(AtomicUsize::new(0));

    let stdout_sender = sender.clone();
    let stdout_bytes = Arc::clone(&output_bytes);
    let stdout_thread =
        thread::spawn(move || read_stream("stdout", stdout, stdout_sender, stdout_bytes));
    let stderr_sender = sender.clone();
    let stderr_bytes = Arc::clone(&output_bytes);
    let stderr_thread =
        thread::spawn(move || read_stream("stderr", stderr, stderr_sender, stderr_bytes));
    drop(sender);
    let deadline = Instant::now() + STEP_TIMEOUT;
    let mut stop_error = None;

    let exit_code = loop {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(message) => {
                handle_output_line(
                    app,
                    command_name,
                    message.stream,
                    &message.line,
                    output_tail,
                    redact_logs,
                );
                for message in receiver.try_iter().take(OUTPUT_CHANNEL_CAPACITY) {
                    handle_output_line(
                        app,
                        command_name,
                        message.stream,
                        &message.line,
                        output_tail,
                        redact_logs,
                    );
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }

        if should_cancel() {
            stop_error = Some("RUNNER_CANCELLED".to_string());
        } else if Instant::now() >= deadline {
            stop_error = Some("RUNNER_TIMEOUT".to_string());
        } else if output_bytes.load(Ordering::Relaxed) > MAX_OUTPUT_BYTES_PER_STEP {
            stop_error = Some("RUNNER_OUTPUT_LIMIT".to_string());
        }
        if stop_error.is_some() {
            if let Err(error) = terminate_child(&mut child, &mut containment) {
                stop_error = Some(error);
            }
            break -1;
        }

        match child
            .try_wait()
            .map_err(|error| format!("Could not wait for {}: {error}", step.name))?
        {
            Some(status) => {
                containment.release();
                break status.code().unwrap_or(-1);
            }
            None => continue,
        }
    };

    if stop_error.is_some() {
        drop(receiver);
    } else {
        for message in receiver.iter() {
            handle_output_line(
                app,
                command_name,
                message.stream,
                &message.line,
                output_tail,
                redact_logs,
            );
        }
    }
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    if stop_error.is_none() && output_bytes.load(Ordering::Relaxed) > MAX_OUTPUT_BYTES_PER_STEP {
        stop_error = Some("RUNNER_OUTPUT_LIMIT".to_string());
    }
    if let Some(error) = stop_error {
        return Err(error);
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
    let line = truncate_utf8(line, MAX_OUTPUT_LINE_BYTES);
    push_tail(output_tail, format!("[{stream}] {line}"));
    emit_line(app, command_name, stream, &line);
}

fn read_stream<R: std::io::Read + Send + 'static>(
    stream: &'static str,
    reader: R,
    sender: mpsc::SyncSender<StreamLine>,
    output_bytes: Arc<AtomicUsize>,
) {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::with_capacity(MAX_OUTPUT_LINE_BYTES);
    let mut truncated = false;
    loop {
        let available = match reader.fill_buf() {
            Ok(bytes) => bytes,
            Err(_) => return,
        };
        if available.is_empty() {
            if !line.is_empty() && !send_stream_line(stream, &sender, &mut line, truncated) {
                return;
            }
            return;
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |index| index + 1);
        if add_output_bytes(&output_bytes, take) > MAX_OUTPUT_BYTES_PER_STEP {
            return;
        }
        let content_end = newline.unwrap_or(take);
        let content = &available[..content_end];
        let remaining = MAX_OUTPUT_LINE_BYTES.saturating_sub(line.len());
        line.extend_from_slice(&content[..content.len().min(remaining)]);
        truncated |= content.len() > remaining;
        reader.consume(take);

        if newline.is_some() {
            if !send_stream_line(stream, &sender, &mut line, truncated) {
                return;
            }
            truncated = false;
        }
    }
}

fn send_stream_line(
    stream: &'static str,
    sender: &mpsc::SyncSender<StreamLine>,
    buffer: &mut Vec<u8>,
    truncated: bool,
) -> bool {
    while buffer
        .last()
        .is_some_and(|byte| matches!(byte, b'\r' | b'\n'))
    {
        buffer.pop();
    }
    let mut line = String::from_utf8_lossy(buffer).into_owned();
    if truncated {
        const SUFFIX: &str = " ... [output truncated]";
        line = truncate_utf8(line, MAX_OUTPUT_LINE_BYTES.saturating_sub(SUFFIX.len()));
        line.push_str(SUFFIX);
    } else {
        line = truncate_utf8(line, MAX_OUTPUT_LINE_BYTES);
    }
    buffer.clear();
    sender.send(StreamLine { stream, line }).is_ok()
}

fn add_output_bytes(counter: &AtomicUsize, bytes: usize) -> usize {
    counter
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
            Some(value.saturating_add(bytes))
        })
        .unwrap_or_else(|value| value)
        .saturating_add(bytes)
}

fn truncate_utf8(mut value: String, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value
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
        AutomationConfig, ClientConfig, FolderPaths, GmailConfig, HubConfig, InvoiceDeliveryMode,
        SafetyConfig, ScriptPaths,
    };
    use std::{
        fs,
        io::Cursor,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn high_impact_workflow_without_confirmation_is_rejected() {
        let result = ensure_confirmation("process_signed_contracts", false);

        assert_eq!(
            result.unwrap_err(),
            "This action needs confirmation before InnPilot can run it."
        );
    }

    #[test]
    fn high_impact_workflow_with_confirmation_can_continue_to_readiness_validation() {
        assert!(ensure_confirmation("process_invoices_and_drafts", true).is_ok());
    }

    #[test]
    fn gmail_token_reset_deletes_only_the_exact_configured_file() {
        let root = temp_root("gmail_token_reset");
        fs::create_dir_all(&root).unwrap();
        let token = root.join("gmail_token.json");
        let neighbor = root.join("keep.json");
        fs::write(&token, b"fake-token").unwrap();
        fs::write(&neighbor, b"keep").unwrap();

        reset_gmail_token(token.to_string_lossy().as_ref()).unwrap();

        assert!(!token.exists());
        assert_eq!(fs::read_to_string(neighbor).unwrap(), "keep");
    }

    #[test]
    fn gmail_token_reset_rejects_a_directory() {
        let root = temp_root("gmail_token_directory");
        fs::create_dir_all(&root).unwrap();

        assert!(reset_gmail_token(root.to_string_lossy().as_ref()).is_err());
        assert!(root.exists());
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

        let (_title, steps) = command_steps(
            "process_invoices_and_drafts",
            &config,
            Some(&reports_dir),
            config.safety.dry_run_default,
        )
        .unwrap();

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
    fn prepare_only_invoice_mode_skips_gmail_draft_step() {
        let root = temp_root("prepare_only_steps");
        let mut config = config_with_fake_workspace(&root);
        config.invoice_delivery_mode = config::InvoiceDeliveryMode::PrepareOnly;
        let reports_dir = root.join("app-data").join("activity").join("reports");

        let (title, steps) = command_steps(
            "process_invoices_and_drafts",
            &config,
            Some(&reports_dir),
            config.safety.dry_run_default,
        )
        .unwrap();

        assert_eq!(title, "Prepare Invoice Files");
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].name, "Process invoice PDFs");
        assert!(steps[0].args.contains(&"--dry-run".to_string()));
        assert!(steps[0].args.contains(&"--json-report".to_string()));
    }

    #[test]
    fn reconnect_gmail_uses_authorization_only_without_dry_run() {
        let root = temp_root("gmail_authorization_only");
        let config = config_with_fake_workspace(&root);
        let reports_dir = root.join("app-data").join("activity").join("reports");

        let (title, steps) = command_steps(
            "reconnect_gmail",
            &config,
            Some(&reports_dir),
            config.safety.dry_run_default,
        )
        .unwrap();

        assert_eq!(title, "Reconnect Gmail");
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].name, "Authorize Gmail");
        assert!(steps[0].args.contains(&"--authorize-only".to_string()));
        assert!(!steps[0].args.contains(&"--dry-run".to_string()));
        assert!(steps[0].args.contains(&"--json-report".to_string()));
    }

    #[test]
    fn reconnect_gmail_rejects_legacy_wrappers_that_may_ignore_authorize_only() {
        let root = temp_root("gmail_legacy_reconnect");
        let mut config = config_with_fake_workspace(&root);
        let legacy_wrapper = root.join("scripts").join("run_create_gmail_draft.cmd");
        fs::write(&legacy_wrapper, b"echo unsafe legacy wrapper").unwrap();
        config.scripts.gmail_draft_script = legacy_wrapper.to_string_lossy().to_string();

        let error = command_steps(
            "reconnect_gmail",
            &config,
            Some(&root.join("reports")),
            config.safety.dry_run_default,
        )
        .unwrap_err();

        assert!(error.contains("updated InnPilot authorization helper"));
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

        let (_title, steps) = command_steps(
            "process_signed_contracts",
            &config,
            Some(&reports_dir),
            config.safety.dry_run_default,
        )
        .unwrap();
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

        let (_title, steps) = command_steps(
            "process_signed_contracts",
            &config,
            Some(&reports_dir),
            config.safety.dry_run_default,
        )
        .unwrap();
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
            language: "en".to_string(),
            client: ClientConfig {
                display_name: "Fake Hotel".to_string(),
                branding: crate::config::BrandingConfig::default(),
            },
            invoice_delivery_mode: InvoiceDeliveryMode::GmailDrafts,
            invoice_file_selection_mode: crate::config::InvoiceFileSelectionMode::AllPdfs,
            automation: AutomationConfig {
                automation_root_folder: scripts.to_string_lossy().to_string(),
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
            templates: Default::default(),
        }
    }

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "innpilot_workflow_e2e_{name}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn stream_reader_caps_each_emitted_line() {
        let mut input = vec![b'a'; MAX_OUTPUT_LINE_BYTES + 1_000];
        input.push(b'\n');
        let expected_bytes = input.len();
        let (sender, receiver) = mpsc::sync_channel(1);
        let output_bytes = Arc::new(AtomicUsize::new(0));

        read_stream(
            "stdout",
            Cursor::new(input),
            sender,
            Arc::clone(&output_bytes),
        );
        let message = receiver.recv().unwrap();

        assert!(message.line.len() <= MAX_OUTPUT_LINE_BYTES);
        assert!(message.line.ends_with(" ... [output truncated]"));
        assert_eq!(output_bytes.load(Ordering::Relaxed), expected_bytes);
    }

    #[test]
    fn stream_reader_stops_before_forwarding_output_beyond_the_total_cap() {
        let input = vec![b'a'; MAX_OUTPUT_BYTES_PER_STEP + 1];
        let (sender, receiver) = mpsc::sync_channel(1);
        let output_bytes = Arc::new(AtomicUsize::new(0));

        read_stream(
            "stdout",
            Cursor::new(input),
            sender,
            Arc::clone(&output_bytes),
        );

        assert!(receiver.recv().is_err());
        assert!(output_bytes.load(Ordering::Relaxed) > MAX_OUTPUT_BYTES_PER_STEP);
    }
}
