export type ItRechtAction = "getversion" | "getaccountlist" | "push";

export type ItRechtApiRequest = {
  apiVersion?: string;
  action?: string;
  userAuthToken?: string;
  userUsername?: string;
  userPassword?: string;
  userAccountId?: string;
  rechtstextType?: string;
  rechtstextTitle?: string;
  rechtstextCountry?: string;
  rechtstextLanguage?: string;
  rechtstextText?: string;
  rechtstextHtml?: string;
  rechtstextPdfUrl?: string;
  rechtstextPdf?: string;
  rechtstextPdfMd5Hash?: string;
};

export type ItRechtXmlErrorCode =
  | 1
  | 3
  | 4
  | 5
  | 6
  | 7
  | 9
  | 10
  | 11
  | 12
  | 17
  | 18
  | 50
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
export const IT_RECHT_MODULE_VERSION = "1.0.0";
