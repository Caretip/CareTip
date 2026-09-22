import type { AppLanguage } from "@/i18n";

export function parseMobileWebHandoffLang(raw: string | null | undefined): AppLanguage | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "de" || v === "en") return v;
  return null;
}

/** Append a validated locale hint to the server-issued handoff URL (no secrets). */
export function appendMobileWebHandoffLangParam(url: string, lang: string): string {
  const normalized = parseMobileWebHandoffLang(lang) ?? "de";
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("lang", normalized);
    return parsed.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}lang=${normalized}`;
  }
}
