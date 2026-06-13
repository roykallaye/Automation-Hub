import type { OutputTemplates } from "./types";

/*
  Output template defaults and preview rendering.

  Templates are stored locally in config.json (see OutputTemplatesConfig in
  src-tauri/src/config.rs — keep the defaults in sync). Placeholders use
  single braces and are rendered by the automation scripts at run time.
  Editing or saving templates never runs a workflow and never sends email.
*/

export const DEFAULT_TEMPLATES: OutputTemplates = {
  gmailDraftSubject: "Invoices - {hotelName}",
  gmailDraftBody:
    "Dear Partner,\n" +
    "\n" +
    "please find attached the invoices related to our mutual guests' stays at our hotel.\n" +
    "For any additional information, please contact us.\n" +
    "\n" +
    "Kind regards,\n" +
    "{signature}\n",
  emailSignature: "",
};

export type TemplateVariable = {
  token: string;
  label: string;
  description: string;
};

export const SUBJECT_VARIABLES: TemplateVariable[] = [
  {
    token: "{hotelName}",
    label: "Hotel name",
    description: "Your hotel's display name.",
  },
];

export const BODY_VARIABLES: TemplateVariable[] = [
  {
    token: "{hotelName}",
    label: "Hotel name",
    description: "Your hotel's display name.",
  },
  {
    token: "{date}",
    label: "Date",
    description: "The day the invoices are prepared.",
  },
  {
    token: "{invoiceCount}",
    label: "Invoice count",
    description: "How many invoice files are attached.",
  },
  {
    token: "{signature}",
    label: "Signature",
    description: "Your saved signature, or the hotel name when empty.",
  },
];

export type TemplateSampleContext = {
  hotelName: string;
  signature: string;
  invoiceCount: number;
  date: string;
};

export function sampleContext(hotelName: string, signature: string): TemplateSampleContext {
  return {
    hotelName: hotelName.trim() || "Your Hotel",
    signature: signature.trim() || hotelName.trim() || "Your Hotel",
    invoiceCount: 3,
    date: new Intl.DateTimeFormat(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date()),
  };
}

/** Mirrors render_email_body in automation/invoices/process_fatture.py. */
export function renderTemplatePreview(template: string, context: TemplateSampleContext) {
  // split/join instead of replaceAll: the TS target lib is ES2020.
  return template
    .split("{hotelName}")
    .join(context.hotelName)
    .split("{signature}")
    .join(context.signature)
    .split("{invoiceCount}")
    .join(String(context.invoiceCount))
    .split("{date}")
    .join(context.date);
}
