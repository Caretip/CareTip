import i18n from "i18next";
import { resolveApiBaseUrl } from "./apiOrigin";

export type LegalDocumentResponse = {
  type: string;
  language: string;
  title: string;
  contentHtml: string;
  version: string;
  updatedAt: string;
};

export type LegalDocumentKind = "privacy" | "terms" | "impressum";

const ENDPOINTS: Record<LegalDocumentKind, string> = {
  privacy: "/api/legal/privacy",
  terms: "/api/legal/terms",
  impressum: "/api/legal/impressum",
};

function legalApiUrl(path: string, language?: string): string {
  const base = resolveApiBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  const lang = (language ?? i18n.language?.slice(0, 2) ?? "en").trim();
  const url = base ? `${base}${p}` : p;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}lang=${encodeURIComponent(lang)}`;
}

export async function fetchLegalDocument(
  kind: LegalDocumentKind,
  language?: string,
): Promise<LegalDocumentResponse> {
  const res = await fetch(legalApiUrl(ENDPOINTS[kind], language), {
    headers: { Accept: "application/json" },
  });
  const data = (await res.json().catch(() => ({}))) as LegalDocumentResponse & { message?: string };
  if (!res.ok) {
    throw new Error(data.message || "We couldn't load this document. Please try again.");
  }
  if (!data.contentHtml?.trim()) {
    throw new Error("This document is not available yet.");
  }
  return data;
}
