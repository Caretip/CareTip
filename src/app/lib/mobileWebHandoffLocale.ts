import type { AppLanguage } from "@/i18n/i18n";
import { changeAppLanguage } from "@/i18n/i18n";
import { I18N_STORAGE_KEY } from "@/i18n/constants";

/** Valid locale hint from mobile → web handoff (never used for auth decisions). */
export function parseMobileWebHandoffLang(raw: string | null | undefined): AppLanguage | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "de" || v === "en") return v;
  return null;
}

export function persistMobileWebHandoffLang(lang: AppLanguage): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(I18N_STORAGE_KEY, lang);
    document.documentElement.setAttribute("lang", lang);
  } catch {
    /* private mode */
  }
}

/** Apply `?lang=` from the handoff URL before React loaders paint. */
export async function applyMobileWebHandoffLocaleFromSearch(
  params: URLSearchParams,
): Promise<AppLanguage | null> {
  const lang = parseMobileWebHandoffLang(params.get("lang"));
  if (!lang) return null;
  persistMobileWebHandoffLang(lang);
  await changeAppLanguage(lang);
  return lang;
}

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
