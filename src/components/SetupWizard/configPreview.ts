import type { SetupDraft } from "./setupDraft";
import { defaultPathsForWorkspace, joinWorkspace, resolveWorkspacePath } from "./setupDraft";

export function buildConfigPreview(draft: SetupDraft) {
  const defaults = defaultPathsForWorkspace(draft.workspaceBase, draft.contractYear || "2026");
  const invoiceInput = resolveWorkspacePath(
    draft.workspaceBase,
    draft.invoiceInputFolder,
    "Invoices",
    "Input",
  );
  const invoiceOutput = resolveWorkspacePath(
    draft.workspaceBase,
    draft.invoiceOutputFolder,
    "Invoices",
    "ReadyToSend",
  );
  const invoiceArchive = resolveWorkspacePath(
    draft.workspaceBase,
    draft.invoiceArchiveFolder,
    "Invoices",
    "Archive",
  );
  const invoiceLogs = resolveWorkspacePath(
    draft.workspaceBase,
    draft.invoiceLogFolder,
    "Invoices",
    "Logs",
  );
  const scansCache = resolveWorkspacePath(
    draft.workspaceBase,
    draft.scansLocalCacheFolder,
    "Scans",
    "IncomingCache",
  );
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
  const contractLogs = resolveWorkspacePath(
    draft.workspaceBase,
    draft.contractLogFolder,
    "Contracts",
    "Logs",
  );
  const gmailCredentialsFile = draft.gmailCredentialsFile || defaults.gmailCredentialsFile;
  const gmailTokenFile = draft.gmailTokenFile || defaults.gmailTokenFile;

  return {
    innPilotAppConfig: {
      client: {
        displayName: draft.hotelDisplayName,
      },
      invoiceDeliveryMode: draft.invoiceDeliveryMode,
      invoiceFileSelectionMode: draft.invoiceFileSelectionMode,
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
        tokenPath: gmailTokenFile,
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
        gmailCredentialsFile,
        gmailTokenFile,
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
        fileSelectionMode: draft.invoiceFileSelectionMode,
        inputGlob: draft.invoiceInputPatterns[0] || "*.pdf",
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
