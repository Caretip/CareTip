import axios from "axios";
import { config } from "@/constants/config";

export type LegalDocumentKind = "privacy" | "terms" | "impressum";

export type LegalDocumentResponse = {
  type: string;
  language: string;
  title: string;
  contentHtml: string;
  version: string;
  updatedAt: string;
};

const ENDPOINTS: Record<LegalDocumentKind, string> = {
  privacy: "/api/legal/privacy",
  terms: "/api/legal/terms",
  impressum: "/api/legal/impressum",
};

/** Document not yet published by the legal provider (HTTP 404). */
export class LegalDocumentNotFoundError extends Error {
  readonly code = "LEGAL_DOCUMENT_NOT_FOUND" as const;
  constructor() {
    super("Legal document is not available yet.");
    this.name = "LegalDocumentNotFoundError";
  }
}

/** Public legal fetch — no auth headers, no session refresh side effects. */
export async function fetchLegalDocument(
  kind: LegalDocumentKind,
  language: string,
): Promise<LegalDocumentResponse> {
  const lang = language.trim().slice(0, 2) || "en";
  const url = `${config.apiUrl}${ENDPOINTS[kind]}?lang=${encodeURIComponent(lang)}`;

  try {
    const response = await axios.get<LegalDocumentResponse>(url, {
      timeout: config.apiTimeoutMs,
      headers: {
        Accept: "application/json",
        [config.clientHeaderName]: config.clientHeader,
      },
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        throw new LegalDocumentNotFoundError();
      }
    }
    throw error;
  }
}

export function isLegalDocumentNotFound(error: unknown): boolean {
  return error instanceof LegalDocumentNotFoundError;
}

export function isLegalNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const axiosError = error as { response?: unknown; code?: string; message?: string };
  if (axiosError.response) return false;
  const code = axiosError.code;
  return (
    axiosError.message === "Network Error" ||
    code === "ERR_NETWORK" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT"
  );
}
