export type ItRechtAction = "getversion" | "getaccountlist" | "push";

export type ItRechtApiRequest = {
  apiVersion?: string;
  action?: string;
  userAuthToken?: string;
  userUsername?: string;
  userPassword?: string;
  userAccountId?: string;
  rechtstextType?: string;
  rechtstextTypeUcase?: string;
  rechtstextTitle?: string;
  rechtstextCountry?: string;
  rechtstextLanguage?: string;
  rechtstextLanguageIso6392b?: string;
  rechtstextPdfFilenamebaseSuggestion?: string;
  rechtstextPdfFilenameSuggestion?: string;
  rechtstextPdfLocalizedFilenamebaseSuggestion?: string;
  rechtstextPdfUrl?: string;
  rechtstextPdf?: string;
  rechtstextPdfMd5Hash?: string;
  rechtstextText?: string;
  rechtstextHtml?: string;
};

export type ItRechtXmlErrorCode =
  | 1
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 17
  | 18
  | 19
  | 20
  | 50
  | 51
  | 80
  | 81
  | 82
  | 99;

export type ItRechtXmlResponse = {
  status: "success" | "error";
  error?: ItRechtXmlErrorCode;
  errorMessage?: string;
  metaShopVersion?: string;
  metaModulVersion?: string;
  accounts?: Array<{
    accountId: string;
    accountName: string;
    locales?: string[];
    countries?: string[];
  }>;
  targetUrl?: string;
};

export const IT_RECHT_API_VERSION = "1.0";

export function itRechtModuleVersion(): string {
  return process.env.LEGAL_IT_RECHT_MODULE_VERSION?.trim() || "1.0.0";
}

export const IT_RECHT_ERROR_MESSAGES: Partial<Record<ItRechtXmlErrorCode, string>> = {
  1: "Unknown API Version.",
  3: "Invalid authentication token.",
  4: "Unsupported rechtstext_type.",
  5: "rechtstext_text is required.",
  6: "rechtstext_html is required.",
  7: "rechtstext_pdf or rechtstext_pdf_url is empty or invalid.",
  9: "rechtstext_language is required.",
  10: "Invalid action.",
  11: "user_account_id is required.",
  12: "Error processing XML data.",
  17: "rechtstext_country is empty or not available for the selected sales channel.",
  18: "rechtstext_title is required.",
  50: "The legal text cannot be saved.",
  82: "The language is not available for the selected sales channel.",
  99: "An unexpected error occurred.",
};
