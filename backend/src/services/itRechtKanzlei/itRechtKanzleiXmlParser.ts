import { XMLParser } from "fast-xml-parser";
import type { ItRechtAction, ItRechtApiRequest } from "./itRechtKanzlei.types.js";
import { decodeItRechtHtml } from "./itRechtKanzleiHtmlDecoder.js";

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
  allowBooleanAttributes: true,
});

function readString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function normalizeAction(raw?: string): ItRechtAction | null {
  const key = raw?.trim().toLowerCase();
  if (!key) return null;
  if (key === "getversion" || key === "version") return "getversion";
  if (key === "getaccountlist") return "getaccountlist";
  if (key === "push") return "push";
  return null;
}

function mapApiNode(node: Record<string, unknown>): ItRechtApiRequest {
  const rawHtml = readString(node.rechtstext_html);
  return {
    apiVersion: readString(node.api_version),
    action: readString(node.action),
    userAuthToken: readString(node.user_auth_token),
    userUsername: readString(node.user_username),
    userPassword: readString(node.user_password),
    userAccountId: readString(node.user_account_id),
    rechtstextType: readString(node.rechtstext_type),
    rechtstextTypeUcase: readString(node.rechtstext_type_ucase),
    rechtstextTitle: readString(node.rechtstext_title),
    rechtstextCountry: readString(node.rechtstext_country),
    rechtstextLanguage: readString(node.rechtstext_language),
    rechtstextLanguageIso6392b: readString(node.rechtstext_language_iso639_2b),
    rechtstextPdfFilenamebaseSuggestion: readString(node.rechtstext_pdf_filenamebase_suggestion),
    rechtstextPdfFilenameSuggestion: readString(node.rechtstext_pdf_filename_suggestion),
    rechtstextPdfLocalizedFilenamebaseSuggestion: readString(
      node.rechtstext_pdf_localized_filenamebase_suggestion,
    ),
    rechtstextText: readString(node.rechtstext_text),
    rechtstextHtml: rawHtml ? decodeItRechtHtml(rawHtml) : undefined,
    rechtstextPdfUrl: readString(node.rechtstext_pdf_url),
    rechtstextPdf: readString(node.rechtstext_pdf),
    rechtstextPdfMd5Hash: readString(node.rechtstext_pdf_md5hash),
  };
}

export function parseItRechtXmlPayload(rawXml: string): ItRechtApiRequest {
  const trimmed = rawXml.trim();
  if (!trimmed) {
    throw Object.assign(new Error("Error processing XML data."), { itRechtErrorCode: 12 as const });
  }

  let parsed: unknown;
  try {
    parsed = parser.parse(trimmed);
  } catch {
    throw Object.assign(new Error("Error processing XML data."), { itRechtErrorCode: 12 as const });
  }

  const root = parsed as Record<string, unknown>;
  const apiNode = root.api;
  if (!apiNode || typeof apiNode !== "object") {
    throw Object.assign(new Error("Error processing XML data."), { itRechtErrorCode: 12 as const });
  }

  return mapApiNode(apiNode as Record<string, unknown>);
}

export function resolveItRechtAction(request: ItRechtApiRequest): ItRechtAction | null {
  return normalizeAction(request.action);
}
