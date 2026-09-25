import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { applyDocumentSeo } from "@/app/lib/seo/documentSeo";
import { resolveRouteSeo } from "@/app/lib/seo/resolveRouteSeo";
import { resolveAppLanguageFromCode } from "@/i18n/i18n";

/**
 * Central route-level SEO — titles, descriptions, canonical, robots, OG, JSON-LD.
 * Mounted once in RootLayout; does not alter routing or auth.
 */
export function CareTipRouteSeo() {
  const { pathname, search } = useLocation();
  const { t, i18n } = useTranslation();
  const language = resolveAppLanguageFromCode(i18n.language || i18n.resolvedLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    const seo = resolveRouteSeo(pathname, search, t);
    applyDocumentSeo(seo);
  }, [pathname, search, t, language]);

  return null;
}
