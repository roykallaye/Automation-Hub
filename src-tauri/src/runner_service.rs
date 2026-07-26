use crate::{
    runner_ledger::{JobCounters, LeasedJob, PendingTerminalUpdate, ProcessLock, RunnerLedger},
    runner_protocol::{self, CloudJob, RunnerJobUpdate, RunnerSyncExchange},
    workflows,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::AppHandle;

const CAPABILITIES: [&str; 3] = ["invoices", "scan_import", "signed_contracts"];
const HEARTBEAT_SECONDS: u64 = 25;
const INITIAL_DELAY_SECONDS: u64 = 3;
const MAX_OFFLINE_BACKOFF_SECONDS: u64 = 300;

pub(crate) fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let service_lock = match ProcessLock::try_acquire(&app, "service") {
            Ok(Some(lock)) => lock,
            _ => return,
        };
        let _service_lock = service_lock;
        if RunnerLedger::open(&app)
            .and_then(|ledger| ledger.recover_interrupted_jobs())
            .is_err()
        {
            return;
        }
        tokio::time::sleep(Duration::from_secs(INITIAL_DELAY_SECONDS)).await;

        let mut backoff = 10_u64;
        loop {
            let delay = match run_cycle(&app).await {
                Ok(seconds) => {
                    backoff = 10;
                    u64::from(seconds.clamp(10, 300))
                }
                Err(_) => {
                    let current = backoff;
                    backoff = (backoff.saturating_mul(2)).min(MAX_OFFLINE_BACKOFF_SECONDS);
                    current
                }
            };
            tokio::time::sleep(Duration::from_secs(delay + jitter_seconds())).await;
        }
    });
}

async fn run_cycle(app: &AppHandle) -> Result<u32, String> {
    let pending = {
        let ledger = RunnerLedger::open(app)?;
        ledger.pending_terminal_update()?
    };
    let exchange = if let Some(pending) = pending {
        let update = update_from_pending(&pending);
        let exchange = runner_protocol::sync_exchange(app, &CAPABILITIES, Some(&update)).await?;
        RunnerLedger::open(app)?.mark_cloud_reported(&pending.job_id)?;
        exchange
    } else {
        runner_protocol::sync_exchange(app, &CAPABILITIES, None).await?
    };

    let next_sync = exchange.next_sync_seconds;
    if let Some(job) = exchange.job {
        process_job(app, job).await?;
    }
    Ok(next_sync)
}

async fn process_job(app: &AppHandle, job: CloudJob) -> Result<(), String> {
    let leased = LeasedJob {
        job_id: job.id.clone(),
        idempotency_key: job.idempotency_key.clone(),
        workflow: job.workflow.clone(),
        mode: job.mode.clone(),
    };
    let state = {
        let mut ledger = RunnerLedger::open(app)?;
        ledger.record_lease(&leased)?
    };

    if matches!(
        state.as_str(),
        "succeeded" | "attention" | "failed" | "cancelled"
    ) {
        return report_pending_result(app, &job.id).await;
    }
    if state == "running" {
        finish_without_run(
            app,
            &job.id,
            "attention",
            Some("RUNNER_RESTARTED"),
            Some("recovery_required"),
        )?;
        return report_pending_result(app, &job.id).await;
    }
    if job.cancel_requested {
        finish_without_run(
            app,
            &job.id,
            "cancelled",
            None,
            Some("cancelled_before_start"),
        )?;
        return report_pending_result(app, &job.id).await;
    }
    if job.mode != "dry_run" {
        finish_without_run(
            app,
            &job.id,
            "failed",
            Some("EXECUTE_NOT_ENABLED"),
            Some("execute_blocked"),
        )?;
        return report_pending_result(app, &job.id).await;
    }

    let _workflow_lock = match ProcessLock::try_acquire(app, "workflow")? {
        Some(lock) => lock,
        None => {
            finish_without_run(
                app,
                &job.id,
                "attention",
                Some("LOCAL_RUNNER_BUSY"),
                Some("retry_after_local_run"),
            )?;
            return report_pending_result(app, &job.id).await;
        }
    };
    RunnerLedger::open(app)?.mark_running(&job.id)?;
    let running_update = running_update(&job.id);
    let first_heartbeat =
        runner_protocol::sync_exchange(app, &CAPABILITIES, Some(&running_update)).await;
    let first_heartbeat = match first_heartbeat {
        Ok(exchange) => exchange,
        Err(error) => {
            finish_without_run(
                app,
                &job.id,
                "failed",
                Some("CONTROL_PLANE_UNAVAILABLE"),
                Some("start_not_confirmed"),
            )?;
            return Err(error);
        }
    };
    if cancellation_for(&first_heartbeat, &job.id) {
        finish_without_run(
            app,
            &job.id,
            "cancelled",
            None,
            Some("cancelled_before_start"),
        )?;
        return report_pending_result(app, &job.id).await;
    }

    let cancelled = Arc::new(AtomicBool::new(false));
    let heartbeat = spawn_heartbeat(app.clone(), running_update, Arc::clone(&cancelled));

    let command_name = command_for_workflow(&job.workflow)?;
    let result = workflows::run_command_inner_controlled(app, command_name, Some(true), || {
        cancelled.load(Ordering::Relaxed)
    })
    .await;

    heartbeat.abort();
    let _ = heartbeat.await;

    let (state, counters, error_code, summary_code) = summarize_run(result);
    RunnerLedger::open(app)?.mark_terminal(&job.id, state, &counters, error_code, summary_code)?;
    report_pending_result(app, &job.id).await
}

fn spawn_heartbeat(
    app: AppHandle,
    update: RunnerJobUpdate,
    cancelled: Arc<AtomicBool>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(HEARTBEAT_SECONDS)).await;
            if let Ok(exchange) =
                runner_protocol::sync_exchange(&app, &CAPABILITIES, Some(&update)).await
            {
                if cancellation_for(&exchange, &update.job_id) {
                    cancelled.store(true, Ordering::Relaxed);
                }
            }
        }
    })
}

fn cancellation_for(exchange: &RunnerSyncExchange, job_id: &str) -> bool {
    exchange
        .job
        .as_ref()
        .is_some_and(|job| job.id == job_id && job.cancel_requested)
}

async fn report_pending_result(app: &AppHandle, expected_job_id: &str) -> Result<(), String> {
    let pending = RunnerLedger::open(app)?
        .pending_terminal_update()?
        .filter(|pending| pending.job_id == expected_job_id);
    let Some(pending) = pending else {
        return Ok(());
    };
    let update = update_from_pending(&pending);
    runner_protocol::sync_exchange(app, &CAPABILITIES, Some(&update)).await?;
    RunnerLedger::open(app)?.mark_cloud_reported(&pending.job_id)
}

fn finish_without_run(
    app: &AppHandle,
    job_id: &str,
    state: &str,
    error_code: Option<&str>,
    summary_code: Option<&str>,
) -> Result<(), String> {
    RunnerLedger::open(app)?.mark_terminal(
        job_id,
        state,
        &JobCounters {
            input_count: 0,
            success_count: 0,
            warning_count: u32::from(state == "attention"),
            failure_count: u32::from(state == "failed"),
        },
        error_code,
        summary_code,
    )
}

fn summarize_run(
    result: Result<workflows::RunSummary, String>,
) -> (
    &'static str,
    JobCounters,
    Option<&'static str>,
    Option<&'static str>,
) {
    match result {
        Ok(summary) => {
            let input_count = summary.steps.len().min(1_000_000) as u32;
            let success_count = summary
                .steps
                .iter()
                .filter(|step| step.exit_code == 0)
                .count()
                .min(1_000_000) as u32;
            let failure_count = summary
                .steps
                .iter()
                .filter(|step| step.exit_code != 0)
                .count()
                .min(1_000_000) as u32;
            if summary.status == "success" {
                (
                    "succeeded",
                    JobCounters {
                        input_count,
                        success_count,
                        warning_count: 0,
                        failure_count,
                    },
                    None,
                    Some("dry_run_completed"),
                )
            } else if summary.status == "warning" {
                (
                    "attention",
                    JobCounters {
                        input_count,
                        success_count,
                        warning_count: 1,
                        failure_count,
                    },
                    None,
                    Some("dry_run_completed_with_warnings"),
                )
            } else {
                (
                    "failed",
                    JobCounters {
                        input_count,
                        success_count,
                        warning_count: 0,
                        failure_count: failure_count.max(1),
                    },
                    Some("WORKFLOW_FAILED"),
                    Some("dry_run_failed"),
                )
            }
        }
        Err(error) if error == "RUNNER_CANCELLED" => (
            "cancelled",
            JobCounters {
                input_count: 0,
                success_count: 0,
                warning_count: 0,
                failure_count: 0,
            },
            None,
            Some("cancelled_safely"),
        ),
        Err(_) => (
            "failed",
            JobCounters {
                input_count: 0,
                success_count: 0,
                warning_count: 0,
                failure_count: 1,
            },
            Some("WORKFLOW_FAILED"),
            Some("dry_run_failed"),
        ),
    }
}

fn running_update(job_id: &str) -> RunnerJobUpdate {
    RunnerJobUpdate {
        error_code: None,
        failure_count: 0,
        input_count: 0,
        job_id: job_id.to_string(),
        status: "running".to_string(),
        success_count: 0,
        summary_code: None,
        warning_count: 0,
    }
}

fn update_from_pending(pending: &PendingTerminalUpdate) -> RunnerJobUpdate {
    RunnerJobUpdate {
        error_code: pending.error_code.clone(),
        failure_count: pending.counters.failure_count,
        input_count: pending.counters.input_count,
        job_id: pending.job_id.clone(),
        status: pending.state.clone(),
        success_count: pending.counters.success_count,
        summary_code: pending.summary_code.clone(),
        warning_count: pending.counters.warning_count,
    }
}

fn command_for_workflow(workflow: &str) -> Result<&'static str, String> {
    match workflow {
        "invoices" => Ok("process_invoices_and_drafts"),
        "scan_import" => Ok("copy_scansioni"),
        "signed_contracts" => Ok("process_signed_contracts"),
        _ => Err("The cloud workflow is not supported by this InnPilot version.".to_string()),
    }
}

fn jitter_seconds() -> u64 {
    let mut byte = [0_u8; 1];
    if getrandom::fill(&mut byte).is_ok() {
        u64::from(byte[0] % 6)
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_workflows_map_only_to_reviewed_local_commands() {
        assert_eq!(
            command_for_workflow("invoices").unwrap(),
            "process_invoices_and_drafts"
        );
        assert_eq!(
            command_for_workflow("scan_import").unwrap(),
            "copy_scansioni"
        );
        assert_eq!(
            command_for_workflow("signed_contracts").unwrap(),
            "process_signed_contracts"
        );
        assert!(command_for_workflow("powershell").is_err());
        assert!(command_for_workflow("gmail_drafts").is_err());
    }

    #[test]
    fn raw_errors_never_enter_cloud_updates() {
        let (state, counters, error, summary) =
            summarize_run(Err(r"C:\Hotel\Guest Name\private.pdf failed".to_string()));
        assert_eq!(state, "failed");
        assert_eq!(counters.failure_count, 1);
        assert_eq!(error, Some("WORKFLOW_FAILED"));
        assert_eq!(summary, Some("dry_run_failed"));
    }
}
