import type { SetupDraft } from "./setupDraft";
import { joinWorkspace } from "./setupDraft";

export function buildConfigPreview(draft: SetupDraft) {
  const invoiceInput = joinWorkspace(draft.workspaceBase, "Invoices", "Input");
  const invoiceOutput = joinWorkspace(draft.workspaceBase, "Invoices", "ReadyToSend");
  const invoiceArchive = joinWorkspace(draft.workspaceBase, "Invoices", "Archive");
  const invoiceLogs = joinWorkspace(draft.workspaceBase, "Invoices", "Logs");
  const scansCache = joinWorkspace(draft.workspaceBase, "Scans", "IncomingCache");
  const scansText = draft.ocrTextOutputFolder || joinWorkspace(draft.workspaceBase, "Scans", "TextOutput");
  const contractOutput =
    draft.signedContractsOutputFolder ||
    joinWorkspace(draft.workspaceBase, "Contracts", draft.contractYear || "2026", "Signed");
  const contractLogs = joinWorkspace(draft.workspaceBase, "Contracts", "Logs");

  return {
    innPilotAppConfig: {
      client: {
        displayName: draft.hotelDisplayName,
      },
      automation: {
        automationRootFolder: "C:\\InnPilot\\automation",
        automationConfigPath: joinWorkspace(draft.workspaceBase, "automation", "config.local.json"),
        pythonExecutable: "python",
      },
      folders: {
        invoiceInputFolder: invoiceInput,
        invoiceOutputFolder: invoiceOutput,
        invoiceArchiveFolder: invoiceArchive,
        invoiceLogFolder: invoiceLogs,
        scansioniNetworkShare: draft.sharedScanFolder,
        scansioniLocalCacheFolder: scansCache,
        ocrTextOutputFolder: scansText,
        contractsOutputFolder: contractOutput,
        contractLogFolder: contractLogs,
      },
      gmail: {
        tokenPath: draft.gmailTokenFile,
      },
      safety: {
        dryRunDefault: draft.safeMode,
        requireConfirmationForFileMoves: true,
        redactLogs: draft.redactLogs,
      },
    },
    automationConfig: {
      client: {
        displayName: draft.hotelDisplayName,
        emailSignatureName: draft.emailSignatureName,
      },
      paths: {
        invoiceInputDir: invoiceInput,
        invoiceOutputDir: invoiceOutput,
        invoiceArchiveDir: invoiceArchive,
        invoiceLogDir: invoiceLogs,
        gmailCredentialsFile: draft.gmailCredentialsFile,
        gmailTokenFile: draft.gmailTokenFile,
        contractInputShortcut: "",
        contractInputDir: draft.sharedScanFolder,
        contractDestinationDir: contractOutput,
        contractOcrTextDir: scansText,
        contractLogDir: contractLogs,
      },
      gmail: {
        subject: draft.gmailSubject,
        ccEmail: draft.ccEmail,
      },
      invoice: {
        inputGlob: draft.invoiceInputPattern,
        recipientRules: draft.recipientRules
          .filter((rule) => rule.matchText.trim() || rule.email.trim())
          .map((rule) => ({
            match: rule.matchText,
            email: rule.email,
          })),
      },
      contracts: {
        scannerFilePrefix: draft.scannerFilenamePrefix,
        contractMarker: draft.contractMarkerText,
        year: draft.contractYear,
      },
      safety: {
        dryRunDefault: draft.safeMode,
        archiveSuccessfulOriginals: draft.archiveOriginals,
        redactLogs: draft.redactLogs,
      },
    },
  };
}
