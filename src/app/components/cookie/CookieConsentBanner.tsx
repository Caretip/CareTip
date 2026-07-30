import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCookieConsent } from "../../context/CookieConsentContext";
import { Button } from "../ui/button";
import { DialogPortal } from "../ui/dialog";
import { cn } from "@/lib/utils";
import { cookieConsentClasses as cc } from "./cookieConsentPresentation";

export function CookieConsentBanner() {
  const { t } = useTranslation();
  const { bannerVisible, acceptAll, rejectNonEssential, openSettings } = useCookieConsent();

  if (!bannerVisible) return null;

  return (
    <DialogPrimitive.Root open={bannerVisible}>
      <DialogPortal>
        <DialogPrimitive.Overlay className={cc.backdrop} />
        <DialogPrimitive.Content
          className={cc.panel}
          aria-labelledby="cookie-consent-title"
          aria-describedby="cookie-consent-desc"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className={cc.scroll}>
            <div className={cc.grid}>
              <div className={cc.copy}>
                <DialogPrimitive.Title id="cookie-consent-title" className={cc.title}>
                  {t("cookieConsent.banner.title")}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description id="cookie-consent-desc" asChild>
                  <div>
                    <p className={cc.body}>{t("cookieConsent.banner.description")}</p>
                    <p className={cc.body}>{t("cookieConsent.banner.descriptionSecondary")}</p>
                  </div>
                </DialogPrimitive.Description>
                <p className={cc.privacy}>
                  <Link to="/privacy" className={cc.privacyLink}>
                    {t("cookieConsent.banner.privacyPolicy")}
                  </Link>
                </p>
              </div>

              <div className={cc.actions}>
                <Button
                  type="button"
                  variant="default"
                  size="lg"
                  onClick={acceptAll}
                  className={cn(cc.action, "text-base font-bold")}
                >
                  {t("cookieConsent.banner.acceptAll")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={rejectNonEssential}
                  className={cn(cc.action, "text-base font-semibold")}
                >
                  {t("cookieConsent.banner.reject")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={openSettings}
                  className={cn(cc.action, "text-base font-semibold")}
                >
                  {t("cookieConsent.banner.settings")}
                </Button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
