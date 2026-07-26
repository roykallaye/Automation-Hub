use std::{env, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    if !cfg!(windows) {
        eprintln!("The InnPilot cloud probe is available only on Windows.");
        return ExitCode::FAILURE;
    }

    let pairing_code = match env::var("INNPILOT_E2E_PAIRING_CODE") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("The one-time cloud probe pairing code is missing.");
            return ExitCode::FAILURE;
        }
    };
    let worker = match env::var("INNPILOT_E2E_WORKER") {
        Ok(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => {
            eprintln!("The verified automation engine path is missing.");
            return ExitCode::FAILURE;
        }
    };

    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => return ExitCode::FAILURE,
    };

    match runtime.block_on(innpilot_lib::run_cloud_e2e_probe(&pairing_code, &worker)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => {
            eprintln!("The InnPilot cloud probe failed safely.");
            ExitCode::FAILURE
        }
    }
}
