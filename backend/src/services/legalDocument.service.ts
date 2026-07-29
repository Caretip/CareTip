import { LegalDocumentType } from "@prisma/client";
import { prisma } from "../prisma.js";
import { isLegalHtmlEmpty, sanitizeLegalHtml } from "../utils/legalHtmlSanitizer.js";
import { logServerError } from "../utils/httpErrors.js";

export type LegalDocumentDto = {
  type: LegalDocumentType;
  language: string;
  title: string;
  contentHtml: string;
  version: string;
  updatedAt: string;
};

export type LegalWebhookDocumentInput = {
  type: string;
  language?: string;
  title: string;
  contentHtml: string;
  version: string;
};

const TYPE_ALIASES: Record<string, LegalDocumentType> = {
  privacy: LegalDocumentType.privacy_policy,
  privacy_policy: LegalDocumentType.privacy_policy,
  "privacy-policy": LegalDocumentType.privacy_policy,
  terms: LegalDocumentType.terms_conditions,
  terms_conditions: LegalDocumentType.terms_conditions,
  "terms-and-conditions": LegalDocumentType.terms_conditions,
  terms_of_service: LegalDocumentType.terms_conditions,
  impressum: LegalDocumentType.impressum,
  imprint: LegalDocumentType.impressum,
};

export function normalizeLegalDocumentType(raw: string): LegalDocumentType | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return TYPE_ALIASES[key] ?? null;
}

function normalizeLanguage(raw?: string): string {
  const lang = (raw ?? "en").trim().toLowerCase();
  if (!lang) return "en";
  return lang.slice(0, 8);
}

export function parseWebhookDocuments(body: unknown): LegalWebhookDocumentInput[] {
  if (!body || typeof body !== "object") return [];

  const record = body as Record<string, unknown>;

  if (Array.isArray(record.documents)) {
    return record.documents
      .map((item) => parseSingleWebhookDocument(item))
      .filter((item): item is LegalWebhookDocumentInput => item !== null);
  }

  const single = parseSingleWebhookDocument(body);
  return single ? [single] : [];
}

function parseSingleWebhookDocument(raw: unknown): LegalWebhookDocumentInput | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const type =
    typeof item.type === "string"
      ? item.type
      : typeof item.documentType === "string"
        ? item.documentType
        : typeof item.document_type === "string"
          ? item.document_type
          : null;

  const title =
    typeof item.title === "string"
      ? item.title
      : typeof item.name === "string"
        ? item.name
        : null;

  const contentHtml =
    typeof item.contentHtml === "string"
      ? item.contentHtml
      : typeof item.content_html === "string"
        ? item.content_html
        : typeof item.html === "string"
          ? item.html
          : typeof item.content === "string"
            ? item.content
            : null;

  const version =
    typeof item.version === "string"
      ? item.version
      : typeof item.revision === "string"
        ? item.revision
        : typeof item.updatedAt === "string"
          ? item.updatedAt
          : typeof item.updated_at === "string"
            ? item.updated_at
            : null;

  if (!type || !title || !contentHtml || !version) return null;

  return {
    type,
    language: typeof item.language === "string" ? item.language : typeof item.locale === "string" ? item.locale : "en",
    title: title.trim(),
    contentHtml,
    version: version.trim(),
  };
}

export async function upsertLegalDocument(input: LegalWebhookDocumentInput): Promise<LegalDocumentDto> {
  const type = normalizeLegalDocumentType(input.type);
  if (!type) {
    throw Object.assign(new Error("Unsupported legal document type"), { status: 400 });
  }

  const language = normalizeLanguage(input.language);
  const title = input.title.trim();
  const version = input.version.trim();
  const contentHtml = sanitizeLegalHtml(input.contentHtml);

  if (!title || !version) {
    throw Object.assign(new Error("Title and version are required"), { status: 400 });
  }
  if (isLegalHtmlEmpty(contentHtml)) {
    throw Object.assign(new Error("Document content is empty after sanitization"), { status: 400 });
  }

  const row = await prisma.legalDocument.upsert({
    where: {
      type_language: { type, language },
    },
    create: {
      type,
      language,
      title,
      contentHtml,
      version,
    },
    update: {
      title,
      contentHtml,
      version,
    },
  });

  return toDto(row);
}

export async function upsertLegalDocumentsFromWebhook(body: unknown): Promise<LegalDocumentDto[]> {
  const documents = parseWebhookDocuments(body);
  if (documents.length === 0) {
    throw Object.assign(new Error("No valid legal documents in payload"), { status: 400 });
  }

  const results: LegalDocumentDto[] = [];
  for (const doc of documents) {
    results.push(await upsertLegalDocument(doc));
  }
  return results;
}

export async function getLatestLegalDocument(
  type: LegalDocumentType,
  language?: string,
): Promise<LegalDocumentDto | null> {
  const preferred = normalizeLanguage(language);
  const fallbacks = preferred === "en" ? [preferred] : [preferred, "en"];

  for (const lang of fallbacks) {
    const row = await prisma.legalDocument.findUnique({
      where: { type_language: { type, language: lang } },
    });
    if (row) return toDto(row);
  }

  return null;
}

function toDto(row: {
  type: LegalDocumentType;
  language: string;
  title: string;
  contentHtml: string;
  version: string;
  updatedAt: Date;
}): LegalDocumentDto {
  return {
    type: row.type,
    language: row.language,
    title: row.title,
    contentHtml: sanitizeLegalHtml(row.contentHtml),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function logLegalWebhookFailure(message: string, meta?: Record<string, unknown>): void {
  logServerError("legal.webhook", new Error(message), meta);
}
