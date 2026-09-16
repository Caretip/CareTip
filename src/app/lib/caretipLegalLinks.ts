/**
 * Authoritative CareTip legal destinations.
 *
 * Terms of Service and Privacy Policy are third-party managed (IT-Recht Kanzlei)
 * and published into CareTip's LegalDocument store. CareTip's approved public URLs
 * for those documents are the hosted SPA routes below — there is no separate
 * external third-party public URL configured in this repository. HTML content is
 * already language-selected via `?lang=` / i18n on those pages.
 *
 * DPA/AVV and PLV are CareTip-controlled PDFs. Language-specific files are served
 * via `?lang=en|de` (never a bilingual combined PDF for a selected app language).
 */

export type CareTipUiLanguage = "de" | "en";

export const CARETIP_LEGAL_LINKS = {
  terms: {
    path: "/terms",
    /** Relative API used by ApiLegalDocumentPage */
    apiPath: "/api/legal/terms",
  },
  privacy: {
    path: "/privacy",
    apiPath: "/api/legal/privacy",
  },
  imprint: {
    path: "/imprint",
    apiPath: "/api/legal/impressum",
  },
  cookies: {
    path: "/cookies",
  },
  /** CareTip DPA / AVV (language-specific PDF) */
  dpa: {
    path: "/avv",
    apiPdfPath: "/api/legal/avv.pdf",
  },
  /** CareTip Price & Services List / PLV (language-specific PDF) */
  plv: {
    path: "/plv",
    apiPdfPath: "/api/legal/plv.pdf",
  },
  pricing: {
    path: "/pricing",
  },
} as const;

export type CareTipLegalLinkKey = keyof typeof CARETIP_LEGAL_LINKS;

export function normalizeCareTipUiLanguage(raw?: string | null): CareTipUiLanguage {
  const lang = (raw ?? "").trim().toLowerCase();
  if (lang === "en" || lang.startsWith("en-")) return "en";
  return "de";
}

/** Resolve absolute API URL for a CareTip-controlled PDF (view or download). */
export function careTipLegalPdfUrl(
  kind: "dpa" | "plv",
  opts?: { download?: boolean; apiBase?: string; language?: string | null },
): string {
  const lang = normalizeCareTipUiLanguage(opts?.language);
  const basePath = CARETIP_LEGAL_LINKS[kind].apiPdfPath;
  const params = new URLSearchParams();
  params.set("lang", lang);
  if (opts?.download) params.set("download", "1");
  const path = `${basePath}?${params.toString()}`;
  const base = (opts?.apiBase ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}
