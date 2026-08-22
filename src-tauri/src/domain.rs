use serde::{Deserialize, Serialize};
use std::fmt;

pub(crate) type WorkspaceResult<T> = Result<T, WorkspaceError>;

/// Stable, adapter-neutral failure codes for InnPilot application services.
///
/// Codes are intentionally broader than individual I/O messages. Adapters can
/// branch on these values without parsing prose or receiving technical causes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceErrorCode {
    StaleRevision,
    InvalidTransition,
    InvalidRequest,
    ConfirmationRequired,
    CapabilityUnavailable,
    UnsupportedSchema,
    CorruptState,
    StateMissing,
    PersistenceBusy,
    PersistenceConflict,
    PersistenceFailed,
    ConfigurationUnavailable,
    ConfigurationInvalid,
    ConfigurationConflict,
    PathPolicyViolation,
    PathUnavailable,
    PermissionDenied,
    PreflightBlocked,
    RecoveryRequired,
    RecoveryUnavailable,
    RecoveryIntegrityFailed,
    RecoveryFailed,
    OperationBusy,
    Internal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceErrorCategory {
    Concurrency,
    Validation,
    Lifecycle,
    Configuration,
    Path,
    Preflight,
    Recovery,
    Capability,
    Persistence,
    Internal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RetryDirective {
    Never,
    Retry,
    Refresh,
    UserAction,
    Recovery,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceResource {
    Onboarding,
    Configuration,
    Recovery,
    RunnerLedger,
    Workspace,
}

/// Bounded, explicitly safe details that adapters may expose to callers.
///
/// This deliberately has no generic map/JSON variant: adding a new detail
/// shape requires a code review and prevents accidental path or secret leaks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SafeErrorDetails {
    Revision {
        resource: WorkspaceResource,
        current: String,
    },
    Transition {
        from: String,
        to: String,
    },
    Schema {
        resource: WorkspaceResource,
        found: u64,
        supported: u64,
    },
    Validation {
        field_codes: Vec<String>,
    },
    Preflight {
        blocker_keys: Vec<String>,
    },
    Recovery {
        point_id: Option<String>,
    },
}

/// The serialized error contract shared by UI and future adapters.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceErrorEnvelope {
    pub(crate) code: WorkspaceErrorCode,
    pub(crate) category: WorkspaceErrorCategory,
    pub(crate) summary: String,
    pub(crate) retry: RetryDirective,
    pub(crate) refresh_required: bool,
    pub(crate) details: Option<SafeErrorDetails>,
}

/// Domain/application error with a safe public envelope and a local-only
/// diagnostic. The diagnostic is never serialized across an adapter boundary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceError {
    #[serde(flatten)]
    envelope: WorkspaceErrorEnvelope,
    #[serde(skip)]
    diagnostic: Option<String>,
}

impl WorkspaceError {
    pub(crate) fn new(
        code: WorkspaceErrorCode,
        category: WorkspaceErrorCategory,
        summary: impl Into<String>,
        retry: RetryDirective,
    ) -> Self {
        Self {
            envelope: WorkspaceErrorEnvelope {
                code,
                category,
                summary: summary.into(),
                retry,
                refresh_required: retry == RetryDirective::Refresh,
                details: None,
            },
            diagnostic: None,
        }
    }

    pub(crate) fn with_details(mut self, details: SafeErrorDetails) -> Self {
        self.envelope.details = Some(details);
        self
    }

    #[allow(dead_code)] // Typed domain surface; no caller today.
    pub(crate) fn with_refresh_required(mut self, required: bool) -> Self {
        self.envelope.refresh_required = required;
        self
    }

    pub(crate) fn with_diagnostic(mut self, diagnostic: impl Into<String>) -> Self {
        self.diagnostic = Some(diagnostic.into());
        self
    }

    pub(crate) fn envelope(&self) -> &WorkspaceErrorEnvelope {
        &self.envelope
    }

    pub(crate) fn code(&self) -> WorkspaceErrorCode {
        self.envelope.code
    }

    #[allow(dead_code)] // Typed domain surface; no caller today.
    pub(crate) fn category(&self) -> WorkspaceErrorCategory {
        self.envelope.category
    }

    pub(crate) fn retry(&self) -> RetryDirective {
        self.envelope.retry
    }

    pub(crate) fn refresh_required(&self) -> bool {
        self.envelope.refresh_required
    }

    #[allow(dead_code)] // Typed domain surface; no caller today.
    pub(crate) fn into_envelope(self) -> WorkspaceErrorEnvelope {
        self.envelope
    }

    // The diagnostic is deliberately withheld from the serialized envelope and
    // from release builds entirely. Debug builds may read it so the synthetic
    // dev commands can say *why* a record was refused; a release binary has no
    // way to reach it at all.
    #[cfg(any(test, debug_assertions))]
    pub(crate) fn diagnostic(&self) -> Option<&str> {
        self.diagnostic.as_deref()
    }
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.envelope.summary)
    }
}

impl std::error::Error for WorkspaceError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialization_contains_only_the_safe_envelope() {
        let error = WorkspaceError::new(
            WorkspaceErrorCode::PersistenceFailed,
            WorkspaceErrorCategory::Persistence,
            "InnPilot could not update local state.",
            RetryDirective::Retry,
        )
        .with_diagnostic(r"os error while reading C:\private\hotel\token.json");

        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["code"], "persistence_failed");
        assert_eq!(value["category"], "persistence");
        assert_eq!(value["summary"], "InnPilot could not update local state.");
        assert!(value.get("diagnostic").is_none());
        assert!(!value.to_string().contains("token.json"));
        assert_eq!(
            error.diagnostic(),
            Some(r"os error while reading C:\private\hotel\token.json")
        );
    }

    #[test]
    fn refresh_retry_sets_stable_refresh_contract() {
        let error = WorkspaceError::new(
            WorkspaceErrorCode::StaleRevision,
            WorkspaceErrorCategory::Concurrency,
            "Configuration changed. Refresh before continuing.",
            RetryDirective::Refresh,
        )
        .with_details(SafeErrorDetails::Revision {
            resource: WorkspaceResource::Configuration,
            current: "sha256:abc".to_string(),
        });

        assert!(error.envelope().refresh_required);
        assert_eq!(error.envelope().retry, RetryDirective::Refresh);
        assert_eq!(
            error.envelope().details,
            Some(SafeErrorDetails::Revision {
                resource: WorkspaceResource::Configuration,
                current: "sha256:abc".to_string(),
            })
        );
        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["details"]["kind"], "revision");
        assert!(value["details"].get("current").is_some());
    }

    #[test]
    fn envelope_rejects_unknown_fields() {
        let json = r#"{
          "code":"internal",
          "category":"internal",
          "summary":"Safe summary",
          "retry":"never",
          "refreshRequired":false,
          "details":null,
          "rawError":"must not be accepted"
        }"#;
        assert!(serde_json::from_str::<WorkspaceErrorEnvelope>(json).is_err());
    }
}
