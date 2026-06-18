import type { HubConfig, InvoiceDeliveryMode, InvoiceFileSelectionMode, SetupMode } from "../../types";

export type RecipientRuleDraft = {
  id: string;
  matchText: string;
  email: string;
};

export type SetupDraft = {
  setupMode: SetupMode;
  hotelDisplayName: string;
  emailSignatureName: string;
  workspaceBase: string;
  pythonExecutable: string;
  invoiceDeliveryMode: InvoiceDeliveryMode;
  invoiceFileSelectionMode: InvoiceFileSelectionMode;
  gmailSubject: string;
  ccEmail: string;
  gmailCredentialsFile: string;
  gmailTokenFile: string;
  invoiceInputFolder: string;
  invoiceOutputFolder: string;
  invoiceArchiveFolder: string;
  invoiceLogFolder: string;
  invoiceInputPatterns: string[];
  recipientRules: RecipientRuleDraft[];
  contractYear: string;
  scannerFilenamePrefixes: string[];
  contractMarkerTexts: string[];
  sharedScanFolder: string;
  scansLocalCacheFolder: string;
  ocrTextOutputFolder: string;
  signedContractsOutputFolder: string;
  contractLogFolder: string;
  safeMode: boolean;
  archiveOriginals: boolean;
  redactLogs: boolean;
};

export const folderPreviewItems = [
  "Invoices/Input",
  "Invoices/ReadyToSend",
  "Invoices/Archive",
  "Invoices/Logs",
  "Gmail/Token",
  "Gmail/Credentials",
  "Scans/IncomingCache",
  "Scans/TextOutput",
  "Contracts/<year>/Signed",
  "Contracts/Logs",
  "Support/Diagnostics",
  "automation",
];

export function defaultPathsForWorkspace(base: string, year: string) {
  return {
    invoiceInputFolder: joinWorkspace(base, "Invoices", "Input"),
    invoiceOutputFolder: joinWorkspace(base, "Invoices", "ReadyToSend"),
    invoiceArchiveFolder: joinWorkspace(base, "Invoices", "Archive"),
    invoiceLogFolder: joinWorkspace(base, "Invoices", "Logs"),
    gmailCredentialsFile: joinWorkspace(base, "Gmail", "Credentials", "gmail_credentials.json"),
    gmailTokenFile: joinWorkspace(base, "Gmail", "Token", "gmail_token.json"),
    sharedScanFolder: joinWorkspace(base, "Scans", "IncomingCache"),
    scansLocalCacheFolder: joinWorkspace(base, "Scans", "IncomingCache"),
    ocrTextOutputFolder: joinWorkspace(base, "Scans", "TextOutput"),
    signedContractsOutputFolder: joinWorkspace(base, "Contracts", year || "2026", "Signed"),
    contractLogFolder: joinWorkspace(base, "Contracts", "Logs"),
  };
}

export function createSetupDraft(config?: HubConfig | null): SetupDraft {
  const workspaceBase = "C:\\InnPilot\\workspace";
  const year = new Date().getFullYear().toString();
  const defaults = defaultPathsForWorkspace(workspaceBase, year);
  const configuredPython = config?.automation.pythonExecutable?.trim();

  return {
    setupMode: "newWorkspace",
    hotelDisplayName: config?.client.displayName || "Your Hotel",
    emailSignatureName: config?.client.displayName
      ? `${config.client.displayName} Team`
      : "Your Hotel Team",
    workspaceBase,
    pythonExecutable:
      configuredPython && configuredPython.toLowerCase() !== "python"
        ? configuredPython
        : managedPythonExecutable(),
    invoiceDeliveryMode: config?.invoiceDeliveryMode || "gmailDrafts",
    invoiceFileSelectionMode: config?.invoiceFileSelectionMode || "allPdfs",
    gmailSubject: "Invoices - Your Hotel",
    ccEmail: "",
    gmailCredentialsFile:
      config?.gmail.tokenPath.replace(/gmail_token\.json$/i, "gmail_credentials.json") ||
      defaults.gmailCredentialsFile,
    gmailTokenFile: config?.gmail.tokenPath || defaults.gmailTokenFile,
    invoiceInputFolder: config?.folders.invoiceInputFolder || defaults.invoiceInputFolder,
    invoiceOutputFolder: config?.folders.invoiceOutputFolder || defaults.invoiceOutputFolder,
    invoiceArchiveFolder: config?.folders.invoiceArchiveFolder || defaults.invoiceArchiveFolder,
    invoiceLogFolder: config?.folders.invoiceLogFolder || defaults.invoiceLogFolder,
    invoiceInputPatterns: ["*.pdf"],
    recipientRules: [
      {
        id: createRuleId(),
        matchText: "",
        email: "",
      },
    ],
    contractYear: year,
    scannerFilenamePrefixes: ["Sharp MFP"],
    contractMarkerTexts: ["Oggetto: Contratto di lavoro subordinato a tempo determinato"],
    sharedScanFolder: config?.folders.scansioniNetworkShare || defaults.sharedScanFolder,
    scansLocalCacheFolder:
      config?.folders.scansioniLocalCacheFolder || defaults.scansLocalCacheFolder,
    ocrTextOutputFolder:
      config?.folders.ocrTextOutputFolder || defaults.ocrTextOutputFolder,
    signedContractsOutputFolder:
      config?.folders.contractsOutputFolder || defaults.signedContractsOutputFolder,
    contractLogFolder: config?.folders.contractLogFolder || defaults.contractLogFolder,
    safeMode: config?.safety.dryRunDefault ?? true,
    archiveOriginals: true,
    redactLogs: config?.safety.redactLogs ?? true,
  };
}

export function createRuleId() {
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function joinWorkspace(base: string, ...parts: string[]) {
  const cleanBase = base.trim().replace(/[\\/]+$/g, "");
  return [cleanBase, ...parts].filter(Boolean).join("\\");
}

export function isAbsoluteWindowsPath(path: string) {
  const trimmed = path.trim();
  return /^[a-zA-Z]:[\\/]/.test(trimmed) || /^\\\\[^\\]/.test(trimmed);
}

export function repairConcatenatedAbsolutePath(path: string) {
  const trimmed = path.trim();
  const embeddedDrive = trimmed.match(/[a-zA-Z]:[\\/].*?([a-zA-Z]:[\\/].*)/);
  return embeddedDrive?.[1] ?? trimmed;
}

export function resolveWorkspacePath(base: string, value: string, ...fallbackParts: string[]) {
  const trimmed = repairConcatenatedAbsolutePath(value);
  if (!trimmed) return joinWorkspace(base, ...fallbackParts);
  if (isAbsoluteWindowsPath(trimmed)) return trimmed;
  return joinWorkspace(base, ...trimmed.split(/[\\/]+/).filter(Boolean));
}

export function managedPythonExecutable() {
  return "C:\\InnPilot\\.venv\\Scripts\\python.exe";
}

export function workspaceFolders(draft: SetupDraft) {
  const defaults = defaultPathsForWorkspace(draft.workspaceBase, draft.contractYear || "2026");
  const folders = [
    ["Invoices/Input", draft.invoiceInputFolder || defaults.invoiceInputFolder],
    ["Invoices/ReadyToSend", draft.invoiceOutputFolder || defaults.invoiceOutputFolder],
    ["Invoices/Archive", draft.invoiceArchiveFolder || defaults.invoiceArchiveFolder],
    ["Invoices/Logs", draft.invoiceLogFolder || defaults.invoiceLogFolder],
    ["Gmail/Token", folderFromFilePath(draft.gmailTokenFile || defaults.gmailTokenFile)],
    ["Gmail/Credentials", folderFromFilePath(draft.gmailCredentialsFile || defaults.gmailCredentialsFile)],
    ["Scans/IncomingCache", draft.scansLocalCacheFolder || defaults.scansLocalCacheFolder],
    ["Scans/TextOutput", draft.ocrTextOutputFolder || defaults.ocrTextOutputFolder],
    ["Contracts/<year>/Signed", draft.signedContractsOutputFolder || defaults.signedContractsOutputFolder],
    ["Contracts/Logs", draft.contractLogFolder || defaults.contractLogFolder],
    ["Support/Diagnostics", joinWorkspace(draft.workspaceBase, "Support", "Diagnostics")],
    ["automation", joinWorkspace(draft.workspaceBase, "automation")],
  ];

  return folders.map(([relativePath, fullPath]) => ({
    relativePath: relativePath.replace("<year>", draft.contractYear || "2026"),
    fullPath,
  }));
}

export function folderFromFilePath(path: string) {
  const repaired = repairConcatenatedAbsolutePath(path).replace(/[\\/]+$/g, "");
  const index = Math.max(repaired.lastIndexOf("\\"), repaired.lastIndexOf("/"));
  return index > 0 ? repaired.slice(0, index) : repaired;
}
