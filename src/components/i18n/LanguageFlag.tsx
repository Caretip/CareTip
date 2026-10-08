import flagDe from "@/assets/flags/flag-de.svg";
import flagGb from "@/assets/flags/flag-gb.svg";
import type { AppLanguage } from "@/i18n/i18n";
import { cn } from "@/lib/utils";

const FLAG_BY_LANGUAGE: Record<AppLanguage, string> = {
  en: flagGb,
  de: flagDe,
};

type LanguageFlagProps = {
  language: AppLanguage;
  className?: string;
};

/** Deterministic locale flag (SVG asset — not Unicode emoji). */
export function LanguageFlag({ language, className }: LanguageFlagProps) {
  return (
    <img
      src={FLAG_BY_LANGUAGE[language]}
      alt=""
      aria-hidden
      width={20}
      height={14}
      decoding="async"
      className={cn("caretip-language-flag", className)}
    />
  );
}
