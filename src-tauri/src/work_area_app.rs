//! The local manager adapter for Work Areas.
//!
//! This is the counterpart to the MCP planning adapter, and the asymmetry
//! between them is the whole point. The assistant may prepare questions, a map
//! and a plan; it has no tool that answers, confirms, approves or archives.
//! Those operations exist only here, reachable only from a local manager action
//! in the desktop window.
//!
//! Everything below delegates to the typed `WorkAreaService` operations and
//! renders the shared `work_area_view` projections. Nothing in this module
//! decides readiness, staleness, provenance or automation eligibility — it
//! passes through what the aggregate already determined, so the manager UI and
//! the assistant cannot end up believing different things about the same area.

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    application::SetupApplicationService,
    domain::{
        RetryDirective, SafeErrorDetails, WorkspaceError, WorkspaceErrorCategory,
        WorkspaceErrorCode, WorkspaceResult,
    },
    platform::{BuildInfo, InstallationPaths},
    work_area::{WorkAreaTemplate, MAX_DESCRIPTION_CHARS, MAX_NAME_CHARS, MAX_TEXT_CHARS},
    work_area_store::{
        CreateWorkAreaRequest, SubmitAnswerRequest, WorkAreaRepository, WorkAreaService,
    },
    work_area_view::{
        context_view, opportunity_views, plan_view, ImprovementPlanView, OpportunityView,
        WorkAreaContextView, WorkAreaSummaryView,
    },
};

/// How many responsibilities the create form may define at once. Scope is meant
/// to be a short statement of what the area handles, not an inventory.
const MAX_RESPONSIBILITIES: usize = 12;

/// Everything one Work Area screen needs, fetched together so the manager view
/// can never show a plan from one revision beside a map from another.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkAreaDetailView {
    pub(crate) context: WorkAreaContextView,
    pub(crate) plan: Option<ImprovementPlanView>,
}

/// One planning recommendation, carrying the area it belongs to.
///
/// The Automations page shows these next to real automations, so it must be
/// able to say where each came from and whether its plan is still current.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpportunityListing {
    pub(crate) work_area_id: String,
    pub(crate) work_area_name: String,
    pub(crate) plan_stale: bool,
    pub(crate) opportunity: OpportunityView,
}

/// The create form.
///
/// `responsibilities` becomes the area's scope. Asking "what does this area
/// mainly handle?" is a question a manager can answer immediately, and it is
/// also the one piece of the map the assistant is not allowed to invent: scope
/// is a decision about the business, not an inference from folders.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateWorkAreaCommand {
    pub(crate) name: String,
    pub(crate) template: WorkAreaTemplate,
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) responsibilities: Vec<String>,
}

pub(crate) struct WorkAreaApplicationService {
    areas: WorkAreaService,
}

impl WorkAreaApplicationService {
    pub(crate) fn resolve(app: &AppHandle) -> WorkspaceResult<Self> {
        let paths = InstallationPaths::resolve(app)?;
        // The installation id binds every stored area to this installation, so
        // a record copied from another machine fails to load rather than being
        // silently adopted.
        let installation_id = onboarding_installation_id(app, &paths)?;
        Ok(Self {
            areas: WorkAreaService::new(WorkAreaRepository::new(
                paths.work_area_root.clone(),
                installation_id,
            )),
        })
    }

    pub(crate) fn overview(&self) -> WorkspaceResult<Vec<WorkAreaSummaryView>> {
        Ok(self
            .areas
            .list()?
            .into_iter()
            .map(|summary| WorkAreaSummaryView {
                id: summary.id,
                name: summary.name,
                template: summary.template,
                state: summary.state,
                revision: summary.revision,
                workflows_mapped: summary.workflows_mapped,
                open_blocking_questions: summary.open_blocking_questions,
                map_ready: summary.map_ready,
                plan_stale: summary.plan_stale,
            })
            .collect())
    }

    pub(crate) fn detail(&self, work_area_id: &str) -> WorkspaceResult<WorkAreaDetailView> {
        let record = self.areas.get(work_area_id)?;
        Ok(WorkAreaDetailView {
            context: context_view(&record),
            plan: plan_view(&record),
        })
    }

    pub(crate) fn create(
        &self,
        command: CreateWorkAreaCommand,
    ) -> WorkspaceResult<WorkAreaDetailView> {
        let name = command.name.trim().to_string();
        if name.chars().count() > MAX_NAME_CHARS {
            return Err(invalid("That name is too long.", "name"));
        }
        if let Some(description) = command.description.as_ref() {
            if description.chars().count() > MAX_DESCRIPTION_CHARS {
                return Err(invalid("That description is too long.", "description"));
            }
        }
        let responsibilities = normalize_responsibilities(command.responsibilities)?;

        let now = timestamp();
        let record = self.areas.create(
            CreateWorkAreaRequest {
                name,
                template: command.template,
                description: command
                    .description
                    .map(|text| text.trim().to_string())
                    .filter(|text| !text.is_empty()),
            },
            &now,
        )?;

        // Scope is a separate typed operation because it changes the map, not
        // just the label. Creating an area with no stated responsibilities is
        // allowed: the area then simply starts from "not started".
        let record = if responsibilities.is_empty() {
            record
        } else {
            self.areas.set_scope(
                &record.area.id,
                responsibilities,
                Vec::new(),
                record.revision,
                &now,
            )?
        };

        Ok(WorkAreaDetailView {
            context: context_view(&record),
            plan: plan_view(&record),
        })
    }

    /// The manager answering a question.
    ///
    /// Deliberately the only write in this file that touches understanding.
    /// The returned detail is read back from the stored record, so the UI shows
    /// the backend's outcome rather than what it optimistically expected.
    pub(crate) fn submit_answer(
        &self,
        request: SubmitAnswerRequest,
    ) -> WorkspaceResult<WorkAreaDetailView> {
        let record = self.areas.submit_manager_answer(request, &timestamp())?;
        Ok(WorkAreaDetailView {
            context: context_view(&record),
            plan: plan_view(&record),
        })
    }

    pub(crate) fn archive(
        &self,
        work_area_id: &str,
        expected_revision: u64,
    ) -> WorkspaceResult<Vec<WorkAreaSummaryView>> {
        self.areas
            .archive(work_area_id, expected_revision, &timestamp())?;
        self.overview()
    }

    /// Every planning opportunity across all areas.
    ///
    /// The Automations page needs this to keep opportunities visibly separate
    /// from real automations. Archived areas are excluded: their plans are
    /// history, not proposals.
    pub(crate) fn opportunities(&self) -> WorkspaceResult<Vec<OpportunityListing>> {
        let mut listings = Vec::new();
        for summary in self.areas.list()? {
            if summary.state == crate::work_area::WorkAreaState::Archived {
                continue;
            }
            let record = self.areas.get(&summary.id)?;
            for opportunity in opportunity_views(&record) {
                listings.push(OpportunityListing {
                    work_area_id: record.area.id.clone(),
                    work_area_name: record.area.name.clone(),
                    plan_stale: summary.plan_stale,
                    opportunity,
                });
            }
        }
        Ok(listings)
    }
}

fn onboarding_installation_id(
    app: &AppHandle,
    paths: &InstallationPaths,
) -> WorkspaceResult<String> {
    let services = SetupApplicationService::new(paths.clone(), BuildInfo::resolve(app))?;
    let snapshot = services.onboarding().get().map_err(|error| {
        WorkspaceError::new(
            WorkspaceErrorCode::StateMissing,
            WorkspaceErrorCategory::Lifecycle,
            "InnPilot could not confirm which installation this is.",
            RetryDirective::Refresh,
        )
        .with_diagnostic(format!("{error:?}"))
    })?;
    Ok(snapshot.installation_id().to_string())
}

fn normalize_responsibilities(values: Vec<String>) -> WorkspaceResult<Vec<String>> {
    let mut normalized = Vec::new();
    for value in values {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() > MAX_TEXT_CHARS {
            return Err(invalid(
                "One of those responsibilities is too long.",
                "responsibilities",
            ));
        }
        if !normalized.contains(&trimmed) {
            normalized.push(trimmed);
        }
    }
    if normalized.len() > MAX_RESPONSIBILITIES {
        return Err(invalid(
            "That is more responsibilities than InnPilot can record for one area.",
            "responsibilities",
        ));
    }
    Ok(normalized)
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn invalid(summary: &str, field: &str) -> WorkspaceError {
    WorkspaceError::new(
        WorkspaceErrorCode::InvalidRequest,
        WorkspaceErrorCategory::Validation,
        summary,
        RetryDirective::UserAction,
    )
    .with_details(SafeErrorDetails::Validation {
        field_codes: vec![field.to_string()],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responsibilities_are_trimmed_deduplicated_and_bounded() {
        let normalized = normalize_responsibilities(vec![
            "  Check-in  ".to_string(),
            "Check-in".to_string(),
            "   ".to_string(),
            "Guest requests".to_string(),
        ])
        .expect("valid responsibilities");
        assert_eq!(
            normalized,
            vec!["Check-in".to_string(), "Guest requests".to_string()]
        );
    }

    #[test]
    fn an_oversized_responsibility_is_refused_before_it_reaches_the_record() {
        let error = normalize_responsibilities(vec!["x".repeat(MAX_TEXT_CHARS + 1)])
            .expect_err("oversized responsibility");
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }

    #[test]
    fn too_many_responsibilities_are_refused() {
        let values = (0..MAX_RESPONSIBILITIES + 1)
            .map(|index| format!("responsibility {index}"))
            .collect();
        let error = normalize_responsibilities(values).expect_err("too many responsibilities");
        assert_eq!(error.code(), WorkspaceErrorCode::InvalidRequest);
    }
}
