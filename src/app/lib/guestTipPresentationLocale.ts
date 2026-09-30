import i18n from "@/i18n/i18n";
import { resolveAppLanguageFromCode, type AppLanguage } from "@/i18n/i18n";

/** Active customer tip-journey locale (`en` | `de`) for checkout + confirmation email. */
export function getGuestTipPresentationLocale(): AppLanguage {
  return resolveAppLanguageFromCode(i18n.language || i18n.resolvedLanguage);
}
