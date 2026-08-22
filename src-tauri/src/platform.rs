use crate::domain::{
    RetryDirective, WorkspaceError, WorkspaceErrorCategory, WorkspaceErrorCode, WorkspaceResult,
};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const RUNNER_DATABASE_FILE: &str = "runner.db";

/// Explicit installation locations required by InnPilot application services.
///
/// Tauri path resolution is confined to `resolve`; domain services receive
/// this value and do not depend on `AppHandle`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InstallationPaths {
    pub(crate) config_file: PathBuf,
    pub(crate) onboarding_dir: PathBuf,
    pub(crate) recovery_root: PathBuf,
    pub(crate) runner_root: PathBuf,
    pub(crate) runner_db: PathBuf,
    pub(crate) packaged_worker: Option<PathBuf>,
    pub(crate) discovery_root: PathBuf,
    pub(crate) proposal_root: PathBuf,
    pub(crate) proposal_approval_root: PathBuf,
    /// Phase H-A Work Area planning records, one protected document per area.
    pub(crate) work_area_root: PathBuf,
}

impl InstallationPaths {
    pub(crate) fn resolve(app: &AppHandle) -> WorkspaceResult<Self> {
        let app_data_dir = app.path().app_data_dir().map_err(|error| {
            WorkspaceError::new(
                WorkspaceErrorCode::PathUnavailable,
                WorkspaceErrorCategory::Path,
                "InnPilot could not locate its private application data.",
                RetryDirective::Retry,
            )
            .with_diagnostic(format!("app_data_dir resolution failed: {error}"))
        })?;
        let packaged_worker = app.path().resource_dir().ok().and_then(|root| {
            let candidate = root.join("worker").join(if cfg!(windows) {
                "innpilot-worker.exe"
            } else {
                "innpilot-worker"
            });
            candidate.is_file().then_some(candidate)
        });
        Ok(Self::from_app_data(app_data_dir, packaged_worker))
    }

    pub(crate) fn from_app_data(
        app_data_dir: impl AsRef<Path>,
        packaged_worker: Option<PathBuf>,
    ) -> Self {
        let app_data_dir = app_data_dir.as_ref();
        let runner_root = app_data_dir.join("runner");
        Self {
            config_file: app_data_dir.join("config.json"),
            onboarding_dir: app_data_dir.join("onboarding"),
            recovery_root: app_data_dir.join("recovery"),
            runner_db: runner_root.join(RUNNER_DATABASE_FILE),
            runner_root,
            packaged_worker,
            discovery_root: app_data_dir.join("environment-discovery"),
            proposal_root: app_data_dir.join("setup-proposals"),
            proposal_approval_root: app_data_dir.join("proposal-approvals"),
            work_area_root: app_data_dir.join("work-areas"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BuildInfo {
    pub(crate) app_version: String,
}

impl BuildInfo {
    pub(crate) fn resolve(app: &AppHandle) -> Self {
        Self::from_version(app.package_info().version.to_string())
    }

    pub(crate) fn from_version(app_version: impl Into<String>) -> Self {
        Self {
            app_version: app_version.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_paths_are_derived_from_one_explicit_root() {
        let root = PathBuf::from(r"C:\InnPilotTest\private");
        let worker = PathBuf::from(r"C:\InnPilotTest\resources\worker\innpilot-worker.exe");
        let paths = InstallationPaths::from_app_data(&root, Some(worker.clone()));

        assert_eq!(paths.config_file, root.join("config.json"));
        assert_eq!(paths.onboarding_dir, root.join("onboarding"));
        assert_eq!(paths.recovery_root, root.join("recovery"));
        assert_eq!(paths.runner_root, root.join("runner"));
        assert_eq!(paths.runner_db, root.join("runner").join("runner.db"));
        assert_eq!(paths.packaged_worker, Some(worker));
        assert_eq!(paths.discovery_root, root.join("environment-discovery"));
        assert_eq!(paths.proposal_root, root.join("setup-proposals"));
        assert_eq!(
            paths.proposal_approval_root,
            root.join("proposal-approvals")
        );
    }

    #[test]
    fn packaged_worker_is_an_explicit_optional_capability() {
        let paths = InstallationPaths::from_app_data("private", None);
        assert!(paths.packaged_worker.is_none());
    }

    #[test]
    fn build_info_is_explicit_platform_input() {
        assert_eq!(BuildInfo::from_version("0.1.0").app_version, "0.1.0");
    }
}
