import { LegalDocumentType } from "@prisma/client";
import type { LegalDocumentDto, LegalWebhookDocumentInput } from "../legalDocument.service.js";
import { upsertLegalDocument } from "../legalDocument.service.js";
import type { ItRechtAction, ItRechtApiRequest, ItRechtXmlErrorCode, ItRechtXmlResponse } from "./itRechtKanzlei.types.js";
import { IT_RECHT_API_VERSION } from "./itRechtKanzlei.types.js";
import { parseItRechtXmlPayload, resolveItRechtAction } from "./itRechtKanzleiXmlParser.js";

const RECHTSTEXT_TYPE_MAP: Record<string, LegalDocumentType> = {
  impressum: LegalDocumentType.impressum,
  agb: LegalDocumentType.terms_conditions,
  datenschutz: LegalDocumentType.privacy_policy,
};

const TARGET_PATH_BY_TYPE: Record<LegalDocumentType, string> = {
  [LegalDocumentType.privacy_policy]: "/privacy",
  [LegalDocumentType.terms_conditions]: "/terms",
  [LegalDocumentType.impressum]: "/impressum",
};

function publicAppOrigin(): string {
  const base =
    process.env.FRONTEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    "https://caretip.de";
  return base.replace(/\/$/, "");
}

export function authenticateItRechtRequest(request: ItRechtApiRequest): boolean {
  const expectedToken = process.env.LEGAL_PROVIDER_TOKEN?.trim();
  if (expectedToken && request.userAuthToken === expectedToken) {
    return true;
  }

  const expectedUsername = process.env.LEGAL_PROVIDER_USERNAME?.trim();
  const expectedPassword = process.env.LEGAL_PROVIDER_PASSWORD?.trim();
  if (
    expectedUsername &&
    expectedPassword &&
    request.userUsername === expectedUsername &&
    request.userPassword === expectedPassword
  ) {
    return true;
  }

  return false;
}

export function isLegalProviderConfigured(): boolean {
  const token = process.env.LEGAL_PROVIDER_TOKEN?.trim();
  const username = process.env.LEGAL_PROVIDER_USERNAME?.trim();
  const password = process.env.LEGAL_PROVIDER_PASSWORD?.trim();
  return Boolean(token || (username && password));
}

function assertSupportedApiVersion(request: ItRechtApiRequest): void {
  const version = request.apiVersion?.trim();
  if (version && version !== IT_RECHT_API_VERSION) {
    throw Object.assign(new Error("Unknown API Version."), { itRechtErrorCode: 1 as const });
  }
}

export function mapPushToDocumentInput(request: ItRechtApiRequest): LegalWebhookDocumentInput {
  const typeKey = request.rechtstextType?.trim().toLowerCase();
  if (!typeKey) {
    throw Object.assign(new Error("rechtstext_type is required"), { itRechtErrorCode: 4 as const });
  }

  const mappedType = RECHTSTEXT_TYPE_MAP[typeKey];
  if (!mappedType) {
    throw Object.assign(new Error(`Unsupported rechtstext_type: ${typeKey}`), {
      itRechtErrorCode: 4 as const,
    });
  }

  const title = request.rechtstextTitle?.trim();
  if (!title) {
    throw Object.assign(new Error("rechtstext_title is required"), { itRechtErrorCode: 18 as const });
  }

  const language = request.rechtstextLanguage?.trim().toLowerCase();
  if (!language) {
    throw Object.assign(new Error("rechtstext_language is required"), { itRechtErrorCode: 9 as const });
  }

  const country = request.rechtstextCountry?.trim();
  if (!country) {
    throw Object.assign(new Error("rechtstext_country is required"), { itRechtErrorCode: 17 as const });
  }

  let contentHtml = request.rechtstextHtml?.trim();
  if (!contentHtml) {
    const plain = request.rechtstextText?.trim();
    if (!plain) {
      throw Object.assign(new Error("rechtstext_html is required"), { itRechtErrorCode: 6 as const });
    }
    contentHtml = `<pre>${plain.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
  }

  const isImpressum = typeKey === "impressum";
  const hasPdf = Boolean(request.rechtstextPdf?.trim() || request.rechtstextPdfUrl?.trim());
  if (!isImpressum && !hasPdf) {
    throw Object.assign(new Error("rechtstext_pdf or rechtstext_pdf_url is required"), {
      itRechtErrorCode: 7 as const,
    });
  }

  const version =
    request.rechtstextPdfMd5Hash?.trim() ||
    new Date().toISOString().slice(0, 10);

  return {
    type: mappedType,
    language,
    title,
    contentHtml,
    version,
  };
}

export function handleItRechtGetVersion(): ItRechtXmlResponse {
  return { status: "success" };
}

export function handleItRechtGetAccountList(): ItRechtXmlResponse {
  return {
    status: "success",
    accounts: [
      {
        accountId: "0",
        accountName: "",
        locales: ["de", "en"],
        countries: ["DE"],
      },
    ],
  };
}

export async function handleItRechtPush(request: ItRechtApiRequest): Promise<ItRechtXmlResponse> {
  const input = mapPushToDocumentInput(request);
  let saved: LegalDocumentDto;
  try {
    saved = await upsertLegalDocument(input);
  } catch (err) {
    throw Object.assign(new Error("The legal text cannot be saved."), {
      itRechtErrorCode: 50 as const,
      cause: err,
    });
  }

  const targetPath = TARGET_PATH_BY_TYPE[saved.type];
  return {
    status: "success",
    targetUrl: `${publicAppOrigin()}${targetPath}`,
  };
}

export async function processItRechtXmlRequest(rawXml: string): Promise<ItRechtXmlResponse> {
  const request = parseItRechtXmlPayload(rawXml);
  assertSupportedApiVersion(request);

  if (!isLegalProviderConfigured()) {
    return {
      status: "error",
      error: 3,
      errorMessage: "Invalid authentication token.",
    };
  }

  if (!authenticateItRechtRequest(request)) {
    return {
      status: "error",
      error: 3,
      errorMessage: "Invalid authentication token.",
    };
  }

  const action: ItRechtAction | null = resolveItRechtAction(request);
  if (!action) {
    return {
      status: "error",
      error: 10,
      errorMessage: "Invalid action.",
    };
  }

  if (action === "getversion") {
    return handleItRechtGetVersion();
  }

  if (action === "getaccountlist") {
    return handleItRechtGetAccountList();
  }

  return handleItRechtPush(request);
}

export function itRechtErrorCodeFromUnknown(err: unknown): ItRechtXmlErrorCode {
  if (typeof err === "object" && err !== null && "itRechtErrorCode" in err) {
    const code = (err as { itRechtErrorCode: unknown }).itRechtErrorCode;
    if (typeof code === "number") return code as ItRechtXmlErrorCode;
  }
  return 99;
}

export function itRechtErrorMessageFromUnknown(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return "An unexpected error occurred.";
}
