import { LegalDocumentType } from "@prisma/client";
import type { LegalWebhookDocumentInput } from "../legalDocument.service.js";
import { getLatestLegalDocument, upsertLegalDocument } from "../legalDocument.service.js";
import {
  getItRechtAccountList,
  isItRechtMultishopEnabled,
  resolveItRechtAccount,
} from "./itRechtKanzleiAccountConfig.js";
import {
  isValidRechtstextPdfBase64,
  isValidRechtstextPdfUrl,
} from "./itRechtKanzleiPdfValidator.js";
import type { ItRechtAction, ItRechtApiRequest, ItRechtXmlErrorCode, ItRechtXmlResponse } from "./itRechtKanzlei.types.js";
import { IT_RECHT_API_VERSION, IT_RECHT_ERROR_MESSAGES } from "./itRechtKanzlei.types.js";
import { parseItRechtXmlPayload, resolveItRechtAction } from "./itRechtKanzleiXmlParser.js";
import { loadLegalProviderTokenExpected, tokensMatchItRechtAuth } from "./itRechtKanzleiTokenAuth.js";

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

function itRechtError(code: ItRechtXmlErrorCode, message?: string): never {
  throw Object.assign(new Error(message ?? IT_RECHT_ERROR_MESSAGES[code] ?? "An error occurred."), {
    itRechtErrorCode: code,
  });
}

export function authenticateItRechtRequest(request: ItRechtApiRequest): boolean {
  if (tokensMatchItRechtAuth(request.userAuthToken)) {
    return true;
  }

  const expectedUsername = process.env.LEGAL_PROVIDER_USERNAME?.trim();
  const expectedPassword = process.env.LEGAL_PROVIDER_PASSWORD?.trim();
  if (
    expectedUsername &&
    expectedPassword &&
    request.userUsername?.trim() === expectedUsername &&
    request.userPassword?.trim() === expectedPassword
  ) {
    return true;
  }

  return false;
}

export function isLegalProviderConfigured(): boolean {
  const token = loadLegalProviderTokenExpected();
  const username = process.env.LEGAL_PROVIDER_USERNAME?.trim();
  const password = process.env.LEGAL_PROVIDER_PASSWORD?.trim();
  return Boolean(token || (username && password));
}

function assertSupportedApiVersion(request: ItRechtApiRequest): void {
  const version = request.apiVersion?.trim();
  if (version && version !== IT_RECHT_API_VERSION) {
    itRechtError(1);
  }
}

function assertPushPdfFields(request: ItRechtApiRequest, isImpressum: boolean): void {
  if (isImpressum) return;

  const pdfBody = request.rechtstextPdf?.trim();
  const pdfUrl = request.rechtstextPdfUrl?.trim();

  if (!pdfBody && !pdfUrl) {
    itRechtError(7);
  }

  if (pdfBody && !isValidRechtstextPdfBase64(pdfBody)) {
    itRechtError(7);
  }

  if (pdfUrl && !isValidRechtstextPdfUrl(pdfUrl)) {
    itRechtError(7);
  }
}

function assertPushAccount(request: ItRechtApiRequest): ReturnType<typeof resolveItRechtAccount> {
  if (isItRechtMultishopEnabled()) {
    const accountId = request.userAccountId?.trim();
    if (!accountId) {
      itRechtError(11);
    }
    const account = resolveItRechtAccount(accountId);
    if (!account) {
      itRechtError(11);
    }
    return account;
  }

  return resolveItRechtAccount(request.userAccountId);
}

function assertPushLocaleAndCountry(
  request: ItRechtApiRequest,
  account: ReturnType<typeof resolveItRechtAccount>,
): void {
  const language = request.rechtstextLanguage?.trim().toLowerCase();
  if (!language) {
    itRechtError(9);
  }

  if (!request.rechtstextLanguageIso6392b?.trim()) {
    itRechtError(9);
  }

  const country = request.rechtstextCountry?.trim();
  if (!country) {
    itRechtError(17);
  }

  if (account?.locales && account.locales.length > 0) {
    const allowed = account.locales.map((locale) => locale.toLowerCase());
    if (!allowed.includes(language!)) {
      itRechtError(82);
    }
  }

  if (account?.countries && account.countries.length > 0) {
    const allowed = account.countries.map((c) => c.toUpperCase());
    if (!allowed.includes(country!.toUpperCase())) {
      itRechtError(17);
    }
  }
}

export function mapPushToDocumentInput(request: ItRechtApiRequest): LegalWebhookDocumentInput {
  const typeKey = request.rechtstextType?.trim().toLowerCase();
  if (!typeKey) {
    itRechtError(4);
  }

  const mappedType = RECHTSTEXT_TYPE_MAP[typeKey!];
  if (!mappedType) {
    itRechtError(4);
  }

  const account = assertPushAccount(request);
  assertPushLocaleAndCountry(request, account);

  const title = request.rechtstextTitle?.trim();
  if (!title) {
    itRechtError(18);
  }

  if (!request.rechtstextText?.trim()) {
    itRechtError(5);
  }

  const contentHtml = request.rechtstextHtml?.trim();
  if (!contentHtml) {
    itRechtError(6);
  }

  const isImpressum = typeKey === "impressum";
  assertPushPdfFields(request, isImpressum);

  const version =
    request.rechtstextPdfMd5Hash?.trim() ||
    new Date().toISOString().slice(0, 10);

  return {
    type: mappedType!,
    language: request.rechtstextLanguage!.trim().toLowerCase(),
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
    accounts: getItRechtAccountList(),
  };
}

export async function handleItRechtPush(request: ItRechtApiRequest): Promise<ItRechtXmlResponse> {
  const input = mapPushToDocumentInput(request);
  const typeKey = request.rechtstextType!.trim().toLowerCase();
  const mappedType = RECHTSTEXT_TYPE_MAP[typeKey]!;
  try {
    const existed = await getLatestLegalDocument(mappedType, input.language);
    const saved = await upsertLegalDocument(input);
    const targetPath = TARGET_PATH_BY_TYPE[saved.type];
    const targetUrl = `${publicAppOrigin()}${targetPath}`;
    return {
      status: "success",
      targetUrl,
      pushAudit: {
        created: !existed,
        rechtstextType: typeKey,
        language: input.language ?? request.rechtstextLanguage!.trim().toLowerCase(),
        country: request.rechtstextCountry!.trim(),
        accountId: request.userAccountId?.trim(),
        targetUrl,
      },
    };
  } catch (err) {
    if (typeof err === "object" && err !== null && "itRechtErrorCode" in err) {
      throw err;
    }
    itRechtError(50);
  }
}

export async function processItRechtXmlRequest(rawXml: string): Promise<ItRechtXmlResponse> {
  const request = parseItRechtXmlPayload(rawXml);
  assertSupportedApiVersion(request);

  if (!isLegalProviderConfigured()) {
    return {
      status: "error",
      error: 3,
      errorMessage: IT_RECHT_ERROR_MESSAGES[3]!,
    };
  }

  if (!authenticateItRechtRequest(request)) {
    return {
      status: "error",
      error: 3,
      errorMessage: IT_RECHT_ERROR_MESSAGES[3]!,
    };
  }

  const action: ItRechtAction | null = resolveItRechtAction(request);
  if (!action) {
    return {
      status: "error",
      error: 10,
      errorMessage: IT_RECHT_ERROR_MESSAGES[10]!,
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
  return IT_RECHT_ERROR_MESSAGES[99]!;
}
