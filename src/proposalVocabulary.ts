/*
  Business vocabulary for the proposal review screen.

  The backend speaks in configuration field keys ("invoiceInputFolder"). A hotel
  manager should never have to. This module is the single place that translates
  those keys into business meaning and groups them the way the hotel thinks
  about its own work.

  It changes presentation only. The values shown, the eligibility of the
  proposal and the approval itself all remain backend decisions. An unknown key
  degrades to a readable form rather than being hidden, so a backend that gains
  a new field never silently drops it from review.
*/

import type { TranslationKey } from "./i18n";

export type ProposalGroupId = "invoices" | "scans" | "documents" | "email" | "general";

export type FieldVocabulary = {
  group: ProposalGroupId;
  labelKey: TranslationKey;
  /** One line of business meaning, shown under the label instead of a path. */
  meaningKey: TranslationKey;
  /** True when the proposed value is a filesystem path we should keep hidden. */
  isPath: boolean;
};

export const PROPOSAL_GROUP_ORDER: ProposalGroupId[] = [
  "invoices",
  "scans",
  "documents",
  "email",
  "general",
];

export const PROPOSAL_GROUP_LABEL: Record<ProposalGroupId, TranslationKey> = {
  invoices: "review.groupInvoices",
  scans: "review.groupScans",
  documents: "review.groupDocuments",
  email: "review.groupEmail",
  general: "review.groupGeneral",
};

const VOCABULARY: Record<string, FieldVocabulary> = {
  invoiceInputFolder: {
    group: "invoices",
    labelKey: "field.invoiceInput",
    meaningKey: "field.invoiceInputMeaning",
    isPath: true,
  },
  invoiceOutputFolder: {
    group: "invoices",
    labelKey: "field.invoiceOutput",
    meaningKey: "field.invoiceOutputMeaning",
    isPath: true,
  },
  invoiceArchiveFolder: {
    group: "invoices",
    labelKey: "field.invoiceArchive",
    meaningKey: "field.invoiceArchiveMeaning",
    isPath: true,
  },
  invoiceLogFolder: {
    group: "invoices",
    labelKey: "field.invoiceLog",
    meaningKey: "field.invoiceLogMeaning",
    isPath: true,
  },
  invoiceFileSelectionMode: {
    group: "invoices",
    labelKey: "field.invoiceFiles",
    meaningKey: "field.invoiceFilesMeaning",
    isPath: false,
  },
  invoiceDeliveryMode: {
    group: "email",
    labelKey: "field.invoiceDelivery",
    meaningKey: "field.invoiceDeliveryMeaning",
    isPath: false,
  },
  sharedScanFolder: {
    group: "scans",
    labelKey: "field.sharedScans",
    meaningKey: "field.sharedScansMeaning",
    isPath: true,
  },
  scansLocalCacheFolder: {
    group: "scans",
    labelKey: "field.scanCache",
    meaningKey: "field.scanCacheMeaning",
    isPath: true,
  },
  ocrTextOutputFolder: {
    group: "scans",
    labelKey: "field.ocrOutput",
    meaningKey: "field.ocrOutputMeaning",
    isPath: true,
  },
  signedContractsOutputFolder: {
    group: "documents",
    labelKey: "field.signedContracts",
    meaningKey: "field.signedContractsMeaning",
    isPath: true,
  },
  contractLogFolder: {
    group: "documents",
    labelKey: "field.contractLog",
    meaningKey: "field.contractLogMeaning",
    isPath: true,
  },
  hotelDisplayName: {
    group: "general",
    labelKey: "field.hotelName",
    meaningKey: "field.hotelNameMeaning",
    isPath: false,
  },
  safeMode: {
    group: "general",
    labelKey: "field.safeMode",
    meaningKey: "field.safeModeMeaning",
    isPath: false,
  },
  archiveOriginals: {
    group: "general",
    labelKey: "field.archiveOriginals",
    meaningKey: "field.archiveOriginalsMeaning",
    isPath: false,
  },
  redactLogs: {
    group: "general",
    labelKey: "field.redactLogs",
    meaningKey: "field.redactLogsMeaning",
    isPath: false,
  },
};

export function lookupField(field: string): FieldVocabulary | null {
  return VOCABULARY[field] ?? null;
}

/**
 * Readable fallback for a field the vocabulary does not know yet
 * ("someNewFolder" -> "Some new folder"). Better a plain label than a
 * disappeared change.
 */
export function humanizeFieldKey(field: string) {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function groupForField(field: string): ProposalGroupId {
  return lookupField(field)?.group ?? "general";
}

/**
 * The manager-facing value for a change.
 *
 * For folders we deliberately do not show the path: the business meaning plus
 * "Available" carries the decision. The real path stays one disclosure away.
 */
export function isPathField(field: string) {
  return lookupField(field)?.isPath ?? false;
}
