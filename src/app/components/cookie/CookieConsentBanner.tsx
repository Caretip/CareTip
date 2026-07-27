import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useCookieConsent } from "../../context/CookieConsentContext";
import { cn } from "@/lib/utils";
import { caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";

export function CookieConsentBanner() {
  const { t } = useTranslation();
  const { bannerVisible, acceptAll, rejectNonEssential, openSettings } = useCookieConsent();

  if (!bannerVisible) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[9990] border-t border-border/80 bg-card/95 p-4 shadow-[0_-8px_32px_rgba(15,23,42,0.12)] backdrop-blur-md sm:p-5 dark:bg-card/98 dark:shadow-[0_-8px_32px_rgba(0,0,0,0.45)]"
      role="dialog"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-desc"
      aria-modal="false"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
        <div className="min-w-0 flex-1 space-y-2">
          <h2 id="cookie-consent-title" className="text-base font-semibold text-foreground sm:text-lg">
            {t("cookieConsent.banner.title")}
          </h2>
          <p id="cookie-consent-desc" className="text-sm leading-relaxed text-muted-foreground">
            {t("cookieConsent.banner.description")}
          </p>
          <p className="text-xs text-muted-foreground">
            <Link to="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
              {t("cookieConsent.banner.privacyPolicy")}
            </Link>
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto lg:justify-end">
          <button type="button" onClick={acceptAll} className={cn(caretipBtnPrimary, "w-full sm:w-auto sm:min-w-[9rem]")}>
            {t("cookieConsent.banner.acceptAll")}
          </button>
          <button
            type="button"
            onClick={rejectNonEssential}
            className={cn(caretipBtnSecondary, "w-full sm:w-auto sm:min-w-[9rem]")}
          >
            {t("cookieConsent.banner.reject")}
          </button>
          <button
            type="button"
            onClick={openSettings}
            className={cn(
              caretipBtnSecondary,
              "w-full border-dashed sm:w-auto sm:min-w-[9rem]",
            )}
          >
            {t("cookieConsent.banner.settings")}
          </button>
        </div>
      </div>
    </div>
  );
}
