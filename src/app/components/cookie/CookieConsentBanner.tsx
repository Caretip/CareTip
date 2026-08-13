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
    <DialogPrimitive.Root open={bannerVisible} modal={false}>
      <DialogPortal>
        <DialogPrimitive.Overlay className={cc.backdropPassive} />
        <DialogPrimitive.Content
          className={cc.panelBanner}
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
                  variant="outline"
                  size="sm"
                  onClick={openSettings}
                  className={cn(cc.action, "font-semibold")}
                >
                  {t("cookieConsent.banner.settings")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={rejectNonEssential}
                  className={cn(cc.action, "font-semibold")}
                >
                  {t("cookieConsent.banner.reject")}
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={acceptAll}
                  className={cn(cc.actionPrimary, "font-bold")}
                >
                  {t("cookieConsent.banner.acceptAll")}
                </Button>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
