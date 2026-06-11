import type { HubConfig } from "../../types";

export type RecipientRuleDraft = {
  id: string;
  matchText: string;
  email: string;
};

export type SetupDraft = {
  hotelDisplayName: string;
  emailSignatureName: string;
  workspaceBase: string;
  gmailSubject: string;
  ccEmail: string;
  gmailCredentialsFile: string;
  gmailTokenFile: string;
  invoiceInputPattern: string;
  recipientRules: RecipientRuleDraft[];
  contractYear: string;
  scannerFilenamePrefix: string;
  contractMarkerText: string;
  sharedScanFolder: string;
  ocrTextOutputFolder: string;
  signedContractsOutputFolder: string;
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
];

export function defaultPathsForWorkspace(base: string, year: string) {
  return {
    gmailCredentialsFile: joinWorkspace(base, "Gmail", "Credentials", "gmail_credentials.json"),
    gmailTokenFile: joinWorkspace(base, "Gmail", "Token", "gmail_token.json"),
    ocrTextOutputFolder: joinWorkspace(base, "Scans", "TextOutput"),
    signedContractsOutputFolder: joinWorkspace(base, "Contracts", year || "2026", "Signed"),
  };
}

export function createSetupDraft(config?: HubConfig | null): SetupDraft {
  const workspaceBase = "C:\\InnPilot\\workspace";
  const year = new Date().getFullYear().toString();
  const defaults = defaultPathsForWorkspace(workspaceBase, year);

  return {
    hotelDisplayName: config?.client.displayName || "Your Hotel",
    emailSignatureName: config?.client.displayName
      ? `${config.client.displayName} Team`
      : "Your Hotel Team",
    workspaceBase,
    gmailSubject: "Invoices - Your Hotel",
    ccEmail: "",
    gmailCredentialsFile:
      config?.gmail.tokenPath.replace(/gmail_token\.json$/i, "gmail_credentials.json") ||
      defaults.gmailCredentialsFile,
    gmailTokenFile: config?.gmail.tokenPath || defaults.gmailTokenFile,
    invoiceInputPattern: "Funzione Pubblica amministrazione*.pdf",
    recipientRules: [
      {
        id: createRuleId(),
        matchText: "",
        email: "",
      },
    ],
    contractYear: year,
    scannerFilenamePrefix: "Sharp MFP",
    contractMarkerText: "Oggetto: Contratto di lavoro subordinato a tempo determinato",
    sharedScanFolder: config?.folders.scansioniNetworkShare || "",
    ocrTextOutputFolder:
      config?.folders.ocrTextOutputFolder || defaults.ocrTextOutputFolder,
    signedContractsOutputFolder:
      config?.folders.contractsOutputFolder || defaults.signedContractsOutputFolder,
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

export function workspaceFolders(draft: SetupDraft) {
  return folderPreviewItems.map((relativePath) => {
    const resolvedRelativePath = relativePath.replace("<year>", draft.contractYear || "2026");
    return {
      relativePath: resolvedRelativePath,
      fullPath: joinWorkspace(draft.workspaceBase, ...resolvedRelativePath.split("/")),
    };
  });
}
