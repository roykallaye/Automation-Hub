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

export function createSetupDraft(config?: HubConfig | null): SetupDraft {
  const workspaceBase = "C:\\FlowHost Workspace";
  const year = new Date().getFullYear().toString();

  return {
    hotelDisplayName: config?.client.displayName || "Life Hotel",
    emailSignatureName: config?.client.displayName
      ? `${config.client.displayName} Team`
      : "Life Hotel Team",
    workspaceBase,
    gmailSubject: "Invoices - Life Hotel",
    ccEmail: "",
    gmailCredentialsFile:
      config?.gmail.tokenPath.replace(/gmail_token\.json$/i, "gmail_credentials.json") ||
      joinWorkspace(workspaceBase, "Gmail", "Credentials", "gmail_credentials.json"),
    gmailTokenFile:
      config?.gmail.tokenPath || joinWorkspace(workspaceBase, "Gmail", "Token", "gmail_token.json"),
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
      config?.folders.ocrTextOutputFolder || joinWorkspace(workspaceBase, "Scans", "TextOutput"),
    signedContractsOutputFolder:
      config?.folders.contractsOutputFolder ||
      joinWorkspace(workspaceBase, "Contracts", year, "Signed"),
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
