import { Copy, KeyRound, Play, ScanText, ShieldCheck } from "lucide-react";

import type { AutomationAction } from "./types";

export const invoiceAction: AutomationAction = {
  label: "Process invoices & create Gmail drafts",
  commandName: "process_invoices_and_drafts",
  workflowKey: "invoiceWorkflow",
  icon: Play,
  requiresConfirmation: true,
  confirmationTitle: "Process invoices?",
  confirmationMessage:
    "InnPilot will process invoice files and create Gmail drafts. No emails will be sent automatically.",
};

export const contractAction: AutomationAction = {
  label: "Process signed contracts",
  commandName: "process_signed_contracts",
  workflowKey: "contractsWorkflow",
  icon: ShieldCheck,
  requiresConfirmation: true,
  confirmationTitle: "Process signed contracts?",
  confirmationMessage: "InnPilot will process signed contracts and organize files.",
};

export const gmailReconnectAction: AutomationAction = {
  label: "Reconnect Gmail",
  commandName: "reconnect_gmail",
  workflowKey: "gmailDraftsWorkflow",
  icon: KeyRound,
  requiresConfirmation: true,
  confirmationTitle: "Reconnect Gmail?",
  confirmationMessage:
    "InnPilot will reset Gmail access and may ask you to sign in again. No emails will be sent automatically.",
};

export const maintenanceActions: AutomationAction[] = [
  {
    label: "Copy scanned documents",
    commandName: "copy_scansioni",
    workflowKey: "scansioniNetwork",
    icon: Copy,
    requiresConfirmation: true,
    confirmationTitle: "Copy scanned documents?",
    confirmationMessage: "InnPilot will copy scanned documents from the shared folder.",
  },
  {
    label: "Read scanned documents",
    commandName: "ocr_preprocessing",
    workflowKey: "ocrWorkflow",
    icon: ScanText,
    requiresConfirmation: true,
    confirmationTitle: "Read scanned documents?",
    confirmationMessage: "InnPilot will read scanned documents and write text output.",
  },
];

export const automationActions = [
  invoiceAction,
  contractAction,
  gmailReconnectAction,
  ...maintenanceActions,
];
