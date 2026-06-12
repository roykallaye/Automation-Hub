import type { SetupDraft } from "./setupDraft";
import { joinWorkspace, resolveWorkspacePath } from "./setupDraft";

export function buildConfigPreview(draft: SetupDraft) {
  const invoiceInput = joinWorkspace(draft.workspaceBase, "Invoices", "Input");
  const invoiceOutput = joinWorkspace(draft.workspaceBase, "Invoices", "ReadyToSend");
  const invoiceArchive = joinWorkspace(draft.workspaceBase, "Invoices", "Archive");
  const invoiceLogs = joinWorkspace(draft.workspaceBase, "Invoices", "Logs");
  const scansCache = joinWorkspace(draft.workspaceBase, "Scans", "IncomingCache");
  const sharedScanFolder = resolveWorkspacePath(
    draft.workspaceBase,
    draft.sharedScanFolder,
    "Scans",
    "IncomingCache",
  );
  const scansText = resolveWorkspacePath(
    draft.workspaceBase,
    draft.ocrTextOutputFolder,
    "Scans",
    "TextOutput",
  );
  const contractOutput = resolveWorkspacePath(
    draft.workspaceBase,
    draft.signedContractsOutputFolder,
    "Contracts",
    draft.contractYear || "2026",
    "Signed",
  );
  const contractLogs = joinWorkspace(draft.workspaceBase, "Contracts", "Logs");

  return {
    innPilotAppConfig: {
      client: {
        displayName: draft.hotelDisplayName,
      },
      invoiceDeliveryMode: draft.invoiceDeliveryMode,
      automation: {
        automationRootFolder: "C:\\InnPilot\\automation",
        automationConfigPath: joinWorkspace(draft.workspaceBase, "automation", "config.local.json"),
        pythonExecutable: draft.pythonExecutable,
      },
      folders: {
        invoiceInputFolder: invoiceInput,
        invoiceOutputFolder: invoiceOutput,
        invoiceArchiveFolder: invoiceArchive,
        invoiceLogFolder: invoiceLogs,
        scansioniNetworkShare: sharedScanFolder,
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
        contractInputDir: sharedScanFolder,
        contractDestinationDir: contractOutput,
        contractOcrTextDir: scansText,
        contractLogDir: contractLogs,
      },
      gmail: {
        subject: draft.gmailSubject,
        ccEmail: draft.ccEmail,
      },
      invoice: {
        deliveryMode: draft.invoiceDeliveryMode,
        inputGlob: draft.invoiceInputPatterns[0] || "Funzione Pubblica amministrazione*.pdf",
        inputGlobs: draft.invoiceInputPatterns.filter((pattern) => pattern.trim()),
        recipientRules: draft.recipientRules
          .filter((rule) => rule.matchText.trim() || rule.email.trim())
          .map((rule) => ({
            match: rule.matchText,
            email: rule.email,
          })),
      },
      contracts: {
        scannerFilePrefix: draft.scannerFilenamePrefixes[0] || "Sharp MFP",
        scannerFilePrefixes: draft.scannerFilenamePrefixes.filter((prefix) => prefix.trim()),
        contractMarker: draft.contractMarkerTexts[0] || "Oggetto: Contratto di lavoro subordinato a tempo determinato",
        contractMarkers: draft.contractMarkerTexts.filter((marker) => marker.trim()),
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
