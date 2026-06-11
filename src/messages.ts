import type { ReadinessStatus, WorkflowPreflight } from "./types";

export function readinessLabel(status: ReadinessStatus) {
  switch (status) {
    case "ready":
      return "Ready";
    case "warning":
      return "Needs attention";
    case "missingConfiguration":
      return "Setup needs attention";
    case "missingScript":
      return "Cannot run yet";
    case "missingFolder":
      return "Cannot run yet";
    case "permissionProblem":
      return "Cannot run yet";
    case "notChecked":
      return "Not checked";
  }
}

export function friendlyWorkflowLabel(workflow: WorkflowPreflight) {
  switch (workflow.key) {
    case "clientProfile":
      return "Hotel profile";
    case "invoiceWorkflow":
      return "Invoices";
    case "gmailDraftsWorkflow":
      return "Email drafts";
    case "scansioniNetwork":
      return "Scanned documents";
    case "ocrWorkflow":
      return "Document reading";
    case "contractsWorkflow":
      return "Signed contracts";
    default:
      return workflow.label;
  }
}

export function staffMessage(
  message: string,
  status?: ReadinessStatus,
  workflowKey?: string,
) {
  if (status === "ready") return message;
  if (status === "warning") {
    if (message.toLowerCase().includes("do not match")) {
      return "Automation setup does not match FlowHost setup.";
    }
    return "Setup needs review. Ask setup support to check FlowHost.";
  }
  if (status === "notChecked") return "FlowHost has not checked this yet.";
  if (status === "missingConfiguration") {
    if (workflowKey === "gmailCredentialsFile") {
      if (message.toLowerCase().includes("not found")) {
        return "Gmail credentials file not found. Choose the Gmail credentials file.";
      }
      return "Choose the Gmail credentials file. Gmail sign-in can be completed after credentials are selected.";
    }
    if (message.toLowerCase().includes("automation setup file")) {
      return "Automation setup file is missing. Ask setup support to select or create it.";
    }
    return "Setup needs attention. Ask setup support to update FlowHost.";
  }
  if (status === "missingScript") {
    return "The automation setup is missing. Ask setup support to update FlowHost.";
  }
  if (status === "permissionProblem") {
    return "FlowHost cannot access a required folder. Ask setup support to check permissions.";
  }
  if (workflowKey === "scansioniNetwork" && status === "missingFolder") {
    return "The folder used for scanned documents is not reachable.";
  }
  if (status === "missingFolder") {
    return "A required folder is missing. Ask setup support to update FlowHost.";
  }

  return message
    .replace(/\bOCR preprocessing\b/gi, "document reading")
    .replace(/\bOCR\b/g, "document reading")
    .replace(/\btoken\b/gi, "Gmail sign-in")
    .replace(/\bscript\b/gi, "automation setup")
    .replace(/\bconfiguration\b/gi, "setup")
    .replace(/\bnetwork share\b/gi, "shared scan folder")
    .replace(/\bexit code\b/gi, "technical code");
}
