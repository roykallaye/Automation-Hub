use std::process::ExitCode;

#[cfg(debug_assertions)]
use std::path::PathBuf;

fn usage() -> &'static str {
    "Usage: innpilot-mcp --profile <opaque-profile-id>"
}

#[tokio::main]
async fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--profile") => {
            let Some(profile_id) = args.next() else {
                eprintln!("{}", usage());
                return ExitCode::from(2);
            };
            if args.next().is_some() {
                eprintln!("{}", usage());
                return ExitCode::from(2);
            }
            match innpilot_lib::local_mcp::run_stdio(profile_id).await {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::from(1)
                }
            }
        }
        #[cfg(debug_assertions)]
        Some("--dev-bootstrap-synthetic") => {
            let Some(root) = args.next() else {
                eprintln!("Synthetic bootstrap requires a marked test root.");
                return ExitCode::from(2);
            };
            if args.next().is_some() {
                eprintln!("Synthetic bootstrap accepts exactly one test root.");
                return ExitCode::from(2);
            }
            match innpilot_lib::local_mcp::bootstrap_synthetic(PathBuf::from(root)) {
                Ok(status) => match serde_json::to_string(&status) {
                    Ok(json) => {
                        println!("{json}");
                        ExitCode::SUCCESS
                    }
                    Err(_) => ExitCode::from(1),
                },
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::from(1)
                }
            }
        }
        #[cfg(debug_assertions)]
        Some("--dev-status-synthetic") => {
            synthetic_command(args, innpilot_lib::local_mcp::status_synthetic)
        }
        #[cfg(debug_assertions)]
        Some("--dev-revoke-synthetic") => {
            synthetic_command(args, innpilot_lib::local_mcp::revoke_synthetic)
        }
        #[cfg(debug_assertions)]
        Some("--dev-approve-discovery-synthetic") => {
            let Some(root) = args.next() else {
                eprintln!("Synthetic discovery approval requires a marked test root.");
                return ExitCode::from(2);
            };
            let Some(folder) = args.next() else {
                eprintln!("Synthetic discovery approval requires one folder.");
                return ExitCode::from(2);
            };
            if args.next().is_some() {
                return ExitCode::from(2);
            }
            match innpilot_lib::local_mcp::approve_discovery_synthetic(
                PathBuf::from(root),
                PathBuf::from(folder),
            ) {
                Ok(json) => {
                    println!("{json}");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::from(1)
                }
            }
        }
        #[cfg(debug_assertions)]
        Some("--dev-revoke-discovery-synthetic") => {
            synthetic_json_command(args, innpilot_lib::local_mcp::revoke_discovery_synthetic)
        }
        #[cfg(debug_assertions)]
        Some("--dev-seed-work-area-synthetic") => {
            synthetic_json_command(args, innpilot_lib::local_mcp::seed_work_area_synthetic)
        }
        #[cfg(debug_assertions)]
        Some("--dev-downgrade-grant-synthetic") => {
            synthetic_json_command(args, innpilot_lib::local_mcp::downgrade_grant_synthetic)
        }
        #[cfg(debug_assertions)]
        Some("--dev-work-area-manager-synthetic") => {
            let Some(root) = args.next() else {
                eprintln!("Synthetic manager action requires a marked test root.");
                return ExitCode::from(2);
            };
            let Some(work_area_id) = args.next() else {
                eprintln!("Synthetic manager action requires a work area id.");
                return ExitCode::from(2);
            };
            let Some(action) = args.next() else {
                eprintln!("Synthetic manager action requires an action.");
                return ExitCode::from(2);
            };
            let value = args.next();
            match innpilot_lib::local_mcp::work_area_manager_synthetic(
                PathBuf::from(root),
                work_area_id,
                action,
                value,
            ) {
                Ok(json) => {
                    println!("{json}");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::from(1)
                }
            }
        }
        #[cfg(debug_assertions)]
        Some("--dev-validate-synthetic") => {
            let Some(root) = args.next() else {
                eprintln!("Synthetic validation requires a marked test root.");
                return ExitCode::from(2);
            };
            let Some(proposal_id) = args.next() else {
                eprintln!("Synthetic validation requires a proposal identifier.");
                return ExitCode::from(2);
            };
            if args.next().is_some() {
                return ExitCode::from(2);
            }
            match innpilot_lib::local_mcp::validate_synthetic(PathBuf::from(root), proposal_id) {
                Ok(result) => match serde_json::to_string(&result) {
                    Ok(json) => {
                        println!("{json}");
                        ExitCode::SUCCESS
                    }
                    Err(_) => ExitCode::from(1),
                },
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::from(1)
                }
            }
        }
        _ => {
            eprintln!("{}", usage());
            ExitCode::from(2)
        }
    }
}

#[cfg(debug_assertions)]
fn synthetic_command(
    mut args: impl Iterator<Item = String>,
    operation: fn(PathBuf) -> Result<innpilot_lib::local_mcp::LocalAgentConnectionStatus, String>,
) -> ExitCode {
    let Some(root) = args.next() else {
        eprintln!("Synthetic operation requires a marked test root.");
        return ExitCode::from(2);
    };
    if args.next().is_some() {
        eprintln!("Synthetic operation accepts exactly one test root.");
        return ExitCode::from(2);
    }
    match operation(PathBuf::from(root)) {
        Ok(status) => match serde_json::to_string(&status) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(_) => ExitCode::from(1),
        },
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

#[cfg(debug_assertions)]
fn synthetic_json_command(
    mut args: impl Iterator<Item = String>,
    operation: fn(PathBuf) -> Result<String, String>,
) -> ExitCode {
    let Some(root) = args.next() else {
        eprintln!("Synthetic operation requires a marked test root.");
        return ExitCode::from(2);
    };
    if args.next().is_some() {
        eprintln!("Synthetic operation accepts exactly one test root.");
        return ExitCode::from(2);
    }
    match operation(PathBuf::from(root)) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}
