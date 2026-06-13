import type {
  InvoiceDeliveryMode,
  InvoiceFileSelectionMode,
  ReadinessStatus,
  WorkflowPreflight,
} from "./types";
import type { TranslationKey } from "./i18n";

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Short label for the configured invoice delivery mode. */
export function deliveryModeLabel(mode?: InvoiceDeliveryMode | null, t?: T) {
  if (mode === "prepareOnly") return t ? t("delivery.prepareOnly") : "Prepare files only";
  if (mode === "sendAutomatically") {
    return t ? t("delivery.sendAutomatically") : "Send automatically (not available)";
  }
  return t ? t("delivery.gmailDrafts") : "Create Gmail drafts";
}

/** One-line promise of what the invoice workflow will do in this mode. */
export function deliveryModePromise(mode?: InvoiceDeliveryMode | null, t?: T) {
  if (mode === "prepareOnly") {
    return t
      ? t("delivery.prepareOnlyPromise")
      : "Prepares invoice PDFs from the invoice folder. Gmail is skipped.";
  }
  if (mode === "sendAutomatically") {
    return t
      ? t("delivery.sendAutomaticallyPromise")
      : "Automatic sending is not available yet. Choose another delivery mode.";
  }
  return t
    ? t("delivery.gmailDraftsPromise")
    : "Prepares invoice PDFs from the invoice folder and creates Gmail drafts for review.";
}

/** One-line reassurance of what will NOT happen in this mode. */
export function deliveryModeReassurance(mode?: InvoiceDeliveryMode | null, t?: T) {
  if (mode === "prepareOnly") {
    return t ? t("delivery.prepareOnlyReassurance") : "No drafts are created and no emails are sent.";
  }
  return t ? t("delivery.draftsOnlyReassurance") : "Drafts only - no emails are sent.";
}

export type PreRunFact = {
  text: string;
  /** "does" = what the run will do; "wont" = explicit reassurance. */
  kind: "does" | "wont";
};

/**
 * Plain-language "what will happen" facts shown before a run starts.
 * Mode-aware: every fact states whether files move, whether Gmail is
 * contacted, and whether emails are sent.
 */
export function preRunFacts(
  commandName: string,
  deliveryMode?: InvoiceDeliveryMode | null,
  fileSelectionMode?: InvoiceFileSelectionMode | null,
  safeModeOn?: boolean,
  t?: T,
): PreRunFact[] {
  const facts: PreRunFact[] = [];

  if (commandName === "process_invoices_and_drafts") {
    if (fileSelectionMode === "filenamePatterns") {
      facts.push({
        kind: "does",
        text: t
          ? t("invoiceSelection.filenamePatternsFact")
          : "Looks only at PDFs whose names match your invoice filters.",
      });
    } else {
      facts.push({
        kind: "does",
        text: t
          ? t("invoiceSelection.allPdfsFact")
          : "Looks at every PDF in the invoice input folder.",
      });
    }
    if (deliveryMode === "prepareOnly") {
      facts.push({ kind: "does", text: t ? t("confirm.invoicePrepareOnly") : "Prepares invoice files for you to send yourself." });
      facts.push({ kind: "wont", text: t ? t("confirm.noGmailNoEmail") : "Gmail is not contacted. No drafts, no emails." });
    } else {
      facts.push({ kind: "does", text: t ? t("confirm.invoiceGmailDrafts") : "Prepares invoice files and creates Gmail drafts for review." });
      facts.push({ kind: "wont", text: t ? t("confirm.draftsOnlyNoSend") : "Drafts only - no emails are sent." });
    }
  } else if (commandName === "process_signed_contracts") {
    facts.push({ kind: "does", text: t ? t("confirm.contractsDoes") : "Reads scanned documents and organizes signed contracts." });
    facts.push({ kind: "wont", text: t ? t("confirm.gmailNotContacted") : "Gmail is not contacted. No emails are sent." });
  } else if (commandName === "copy_scansioni") {
    facts.push({ kind: "does", text: t ? t("confirm.copyScansDoes") : "Copies scanned documents from the shared folder." });
    facts.push({ kind: "wont", text: t ? t("confirm.copyScansWont") : "Originals stay in place. Gmail is not contacted." });
  } else if (commandName === "ocr_preprocessing") {
    facts.push({ kind: "does", text: t ? t("confirm.ocrDoes") : "Reads scanned documents and writes text files." });
    facts.push({ kind: "wont", text: t ? t("confirm.ocrWont") : "Scans are not changed. Gmail is not contacted." });
  } else if (commandName === "reconnect_gmail") {
    facts.push({ kind: "does", text: t ? t("confirm.reconnectDoes") : "Checks Gmail sign-in and may ask you to sign in again." });
    facts.push({ kind: "wont", text: t ? t("confirm.reconnectWont") : "No drafts are created and no emails are sent." });
  }

  if (safeModeOn) {
    facts.push({ kind: "wont", text: t ? t("confirm.safeMode") : "Safe mode is on - hotel files are not changed." });
  }

  return facts;
}

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
      return "Automation setup does not match InnPilot setup.";
    }
    return "Setup needs review. Ask setup support to check InnPilot.";
  }
  if (status === "notChecked") return "InnPilot has not checked this yet.";
  if (status === "missingConfiguration") {
    if (workflowKey === "pythonExecutable") {
      return "Python needs setup. Open Support for installation steps.";
    }
    if (workflowKey === "pythonPackages") {
      return "Python packages need installing. Open Support for the install command.";
    }
    if (workflowKey === "gmailCredentialsFile") {
      if (message.toLowerCase().includes("not found")) {
        return "Gmail credentials file not found. Choose the Gmail credentials file.";
      }
      return "Choose the Gmail credentials file. Gmail sign-in can be completed after credentials are selected.";
    }
    if (message.toLowerCase().includes("automation setup file")) {
      return "Automation setup file is missing. Ask setup support to select or create it.";
    }
    return "Setup needs attention. Ask setup support to update InnPilot.";
  }
  if (status === "missingScript") {
    return "The automation setup is missing. Ask setup support to update InnPilot.";
  }
  if (status === "permissionProblem") {
    return "InnPilot cannot access a required folder. Ask setup support to check permissions.";
  }
  if (workflowKey === "scansioniNetwork" && status === "missingFolder") {
    return "The folder used for scanned documents is not reachable.";
  }
  if (status === "missingFolder") {
    return "A required folder is missing. Ask setup support to update InnPilot.";
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
