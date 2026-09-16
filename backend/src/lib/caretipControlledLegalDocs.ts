import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CareTip-controlled legal PDFs (AVV/DPA + PLV).
 *
 * Source templates in `template/` are bilingual (DE section then EN section).
 * Deployed assets are language-specific page extractions of that supplied content
 * (no rewritten legal wording):
 *   caretip-plv-{de|en}.pdf, caretip-avv-{de|en}.pdf
 */

export type CareTipControlledLegalDocId = "avv" | "plv";
export type CareTipLegalLanguage = "de" | "en";

export type CareTipControlledLegalDocMeta = {
  id: CareTipControlledLegalDocId;
  language: CareTipLegalLanguage;
  /** Stable public path for SPA routing */
  path: "/avv" | "/plv";
  /** API path that streams the PDF (includes lang query) */
  apiPath: string;
  filename: string;
  /** From PLV document header; omitted for AVV (no calendar version in template). */
  validFrom?: string;
  contentSha256: string;
  titleEn: string;
  titleDe: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve assets whether cwd is repo root or backend/. */
function resolveLegalAssetsDir(): string {
  const candidates = [
    join(process.cwd(), "assets", "legal-documents"),
    join(process.cwd(), "backend", "assets", "legal-documents"),
    join(__dirname, "..", "..", "assets", "legal-documents"),
  ];
  for (const dir of candidates) {
    if (
      existsSync(join(dir, "caretip-plv-de.pdf")) &&
      existsSync(join(dir, "caretip-plv-en.pdf")) &&
      existsSync(join(dir, "caretip-avv-de.pdf")) &&
      existsSync(join(dir, "caretip-avv-en.pdf"))
    ) {
      return dir;
    }
  }
  return candidates[0];
}

const FILE_BY_ID_LANG: Record<CareTipControlledLegalDocId, Record<CareTipLegalLanguage, string>> = {
  avv: {
    de: "caretip-avv-de.pdf",
    en: "caretip-avv-en.pdf",
  },
  plv: {
    de: "caretip-plv-de.pdf",
    en: "caretip-plv-en.pdf",
  },
};

let cachedDir: string | null = null;
const shaCache = new Map<string, string>();

function assetsDir(): string {
  if (!cachedDir) cachedDir = resolveLegalAssetsDir();
  return cachedDir;
}

export function normalizeCareTipLegalLanguage(raw?: string | null): CareTipLegalLanguage {
  const lang = (raw ?? "").trim().toLowerCase();
  if (lang === "en" || lang.startsWith("en-")) return "en";
  if (lang === "de" || lang.startsWith("de-")) return "de";
  return "de";
}

export function readCareTipControlledPdf(
  id: CareTipControlledLegalDocId,
  language?: string | null,
): Buffer {
  const lang = normalizeCareTipLegalLanguage(language);
  const file = join(assetsDir(), FILE_BY_ID_LANG[id][lang]);
  if (!existsSync(file)) {
    throw new Error(`Legal PDF missing: ${FILE_BY_ID_LANG[id][lang]}`);
  }
  return readFileSync(file);
}

export function careTipControlledPdfSha256(
  id: CareTipControlledLegalDocId,
  language?: string | null,
): string {
  const lang = normalizeCareTipLegalLanguage(language);
  const key = `${id}:${lang}`;
  const cached = shaCache.get(key);
  if (cached) return cached;
  const hash = createHash("sha256").update(readCareTipControlledPdf(id, lang)).digest("hex");
  shaCache.set(key, hash);
  return hash;
}

/** PLV template states "Gültig ab / Valid from: August 2026". */
export const CARETIP_PLV_VALID_FROM = "2026-08";

export function getCareTipControlledLegalDocMeta(
  id: CareTipControlledLegalDocId,
  language?: string | null,
): CareTipControlledLegalDocMeta {
  const lang = normalizeCareTipLegalLanguage(language);
  const contentSha256 = careTipControlledPdfSha256(id, lang);
  if (id === "avv") {
    return {
      id: "avv",
      language: lang,
      path: "/avv",
      apiPath: `/api/legal/avv.pdf?lang=${lang}`,
      filename: lang === "de" ? "CareTip-AVV.pdf" : "CareTip-DPA.pdf",
      contentSha256,
      titleEn: "Data Processing Agreement (DPA)",
      titleDe: "Vereinbarung zur Auftragsverarbeitung (AVV)",
    };
  }
  return {
    id: "plv",
    language: lang,
    path: "/plv",
    apiPath: `/api/legal/plv.pdf?lang=${lang}`,
    filename: lang === "de" ? "CareTip-PLV.pdf" : "CareTip-Price-Services-List.pdf",
    validFrom: CARETIP_PLV_VALID_FROM,
    contentSha256,
    titleEn: "Price & Services List",
    titleDe: "Preis- und Leistungsverzeichnis",
  };
}

export function listCareTipControlledLegalDocs(
  language?: string | null,
): CareTipControlledLegalDocMeta[] {
  const lang = normalizeCareTipLegalLanguage(language);
  return [
    getCareTipControlledLegalDocMeta("avv", lang),
    getCareTipControlledLegalDocMeta("plv", lang),
  ];
}

export function parseCareTipControlledLegalDocId(raw: unknown): CareTipControlledLegalDocId | null {
  if (raw === "avv" || raw === "dpa" || raw === "avv-dpa") return "avv";
  if (raw === "plv") return "plv";
  return null;
}
