use crate::{config, preflight};
use serde::Deserialize;
use std::{fs, path::Path};
use tauri::AppHandle;

/// Template fields the frontend can update from the Settings page.
///
/// Saving templates only writes local configuration files. It never runs a
/// workflow, never contacts Gmail, and never sends or drafts any email.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutputTemplatesDraft {
    pub(crate) gmail_draft_subject: String,
    pub(crate) gmail_draft_body: String,
    #[serde(default)]
    pub(crate) email_signature: String,
}

pub(crate) fn save_output_templates(
    app: &AppHandle,
    draft: OutputTemplatesDraft,
) -> Result<preflight::AppConfigStatus, String> {
    let (mut hub_config, _) = config::ensure_config_with_path(app)?;

    hub_config.templates = config::OutputTemplatesConfig {
        gmail_draft_subject: draft.gmail_draft_subject,
        gmail_draft_body: draft.gmail_draft_body,
        email_signature: draft.email_signature,
    }
    .sanitized();

    let config_path = config::save_config_for_app(app, &hub_config)?;

    // Keep the existing automation config aligned so the invoice/draft scripts
    // pick up the new wording. This is a non-destructive key merge: any file
    // that does not exist yet is left for guided setup to create.
    sync_templates_into_automation_config(
        Path::new(&hub_config.automation.automation_config_path),
        &hub_config,
    )?;

    Ok(preflight::AppConfigStatus::new(
        config_path.to_string_lossy().to_string(),
        hub_config,
    ))
}

/// Renders placeholders that are static at save time. Placeholders that only
/// make sense at run time (e.g. {date}, {invoiceCount}) are left for the
/// automation scripts to render.
pub(crate) fn render_static_placeholders(template: &str, hotel_name: &str) -> String {
    template.replace("{hotelName}", hotel_name)
}

/// Resolved signature line: explicit signature, or the hotel name.
pub(crate) fn resolved_signature(
    templates: &config::OutputTemplatesConfig,
    hotel_name: &str,
) -> String {
    let trimmed = templates.email_signature.trim();
    if trimmed.is_empty() {
        hotel_name.to_string()
    } else {
        trimmed.to_string()
    }
}

fn sync_templates_into_automation_config(
    automation_config_path: &Path,
    hub_config: &config::HubConfig,
) -> Result<(), String> {
    if !automation_config_path.is_file() {
        // Setup has not generated the automation config yet; templates are
        // stored in the app config and applied on the next setup save.
        return Ok(());
    }

    let contents = fs::read_to_string(automation_config_path)
        .map_err(|error| format!("Could not read automation setup file: {error}"))?;
    let mut value: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|error| format!("Automation setup file is not valid: {error}"))?;

    let updated = apply_templates_to_automation_json(&mut value, hub_config);
    if !updated {
        return Ok(());
    }

    let serialized = serde_json::to_string_pretty(&value)
        .map_err(|error| format!("Could not prepare automation setup file: {error}"))?;
    fs::write(automation_config_path, serialized)
        .map_err(|error| format!("Could not write automation setup file: {error}"))
}

/// Merges template-driven keys into the automation config JSON, preserving all
/// other keys untouched. Returns true when something changed.
fn apply_templates_to_automation_json(
    value: &mut serde_json::Value,
    hub_config: &config::HubConfig,
) -> bool {
    let serde_json::Value::Object(root) = value else {
        return false;
    };

    let hotel_name = hub_config.client.display_name.trim();
    let hotel_name = if hotel_name.is_empty() {
        "Your Hotel"
    } else {
        hotel_name
    };
    let subject = render_static_placeholders(&hub_config.templates.gmail_draft_subject, hotel_name);
    let body_template = hub_config.templates.gmail_draft_body.clone();
    let signature = resolved_signature(&hub_config.templates, hotel_name);

    let mut changed = false;

    let gmail = root.entry("gmail").or_insert_with(|| serde_json::json!({}));
    if let serde_json::Value::Object(gmail) = gmail {
        changed |= set_string_key(gmail, "subject", &subject);
        changed |= set_string_key(gmail, "bodyTemplate", &body_template);
    }

    let client = root
        .entry("client")
        .or_insert_with(|| serde_json::json!({}));
    if let serde_json::Value::Object(client) = client {
        changed |= set_string_key(client, "emailSignatureName", &signature);
    }

    changed
}

fn set_string_key(
    object: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: &str,
) -> bool {
    if object.get(key).and_then(|v| v.as_str()) == Some(value) {
        return false;
    }
    object.insert(
        key.to_string(),
        serde_json::Value::String(value.to_string()),
    );
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::OutputTemplatesConfig;

    fn hub_config_with_templates(templates: OutputTemplatesConfig) -> config::HubConfig {
        let mut hub_config = config::default_config();
        hub_config.client.display_name = "Hotel Bellavista".to_string();
        hub_config.templates = templates;
        hub_config
    }

    #[test]
    fn static_placeholders_render_hotel_name_only() {
        let rendered =
            render_static_placeholders("Invoices {date} - {hotelName}", "Hotel Bellavista");

        assert_eq!(rendered, "Invoices {date} - Hotel Bellavista");
    }

    #[test]
    fn signature_falls_back_to_hotel_name() {
        let templates = OutputTemplatesConfig::default();

        assert_eq!(
            resolved_signature(&templates, "Hotel Bellavista"),
            "Hotel Bellavista"
        );

        let custom = OutputTemplatesConfig {
            email_signature: "Front Office".to_string(),
            ..OutputTemplatesConfig::default()
        };
        assert_eq!(
            resolved_signature(&custom, "Hotel Bellavista"),
            "Front Office"
        );
    }

    #[test]
    fn templates_merge_preserves_unrelated_automation_keys() {
        let mut value = serde_json::json!({
            "client": { "displayName": "Hotel Bellavista", "emailSignatureName": "Old" },
            "paths": { "invoiceInputDir": "C:\\somewhere" },
            "gmail": { "subject": "Old subject", "ccEmail": "cc@example.invalid" },
            "safety": { "dryRunDefault": true }
        });
        let hub_config = hub_config_with_templates(OutputTemplatesConfig {
            gmail_draft_subject: "Invoices - {hotelName}".to_string(),
            gmail_draft_body: "Hello {invoiceCount}\n{signature}".to_string(),
            email_signature: String::new(),
        });

        let changed = apply_templates_to_automation_json(&mut value, &hub_config);

        assert!(changed);
        assert_eq!(value["gmail"]["subject"], "Invoices - Hotel Bellavista");
        assert_eq!(
            value["gmail"]["bodyTemplate"],
            "Hello {invoiceCount}\n{signature}"
        );
        assert_eq!(value["gmail"]["ccEmail"], "cc@example.invalid");
        assert_eq!(value["client"]["emailSignatureName"], "Hotel Bellavista");
        assert_eq!(value["client"]["displayName"], "Hotel Bellavista");
        assert_eq!(value["paths"]["invoiceInputDir"], "C:\\somewhere");
        assert_eq!(value["safety"]["dryRunDefault"], true);
    }

    #[test]
    fn templates_merge_reports_no_change_when_already_aligned() {
        let hub_config = hub_config_with_templates(OutputTemplatesConfig {
            gmail_draft_subject: "Invoices - {hotelName}".to_string(),
            gmail_draft_body: "Body".to_string(),
            email_signature: "Team".to_string(),
        });
        let mut value = serde_json::json!({
            "client": { "emailSignatureName": "Team" },
            "gmail": { "subject": "Invoices - Hotel Bellavista", "bodyTemplate": "Body" }
        });

        assert!(!apply_templates_to_automation_json(&mut value, &hub_config));
    }

    #[test]
    fn templates_merge_creates_missing_sections() {
        let hub_config = hub_config_with_templates(OutputTemplatesConfig::default());
        let mut value = serde_json::json!({ "paths": {} });

        let changed = apply_templates_to_automation_json(&mut value, &hub_config);

        assert!(changed);
        assert_eq!(value["gmail"]["subject"], "Invoices - Hotel Bellavista");
        assert!(value["gmail"]["bodyTemplate"]
            .as_str()
            .unwrap()
            .contains("{signature}"));
    }
}
