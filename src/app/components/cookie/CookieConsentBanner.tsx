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
          aria-describedby="cookie-consent-desc"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogPrimitive.Title id="cookie-consent-title" className={cc.title}>
            {t("cookieConsent.banner.title")}
          </DialogPrimitive.Title>
          <div className={cc.scroll}>
            <div className={cc.copy}>
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
          </div>

          <div className={cc.actions}>
            <div className={cc.actionsRow}>
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
            </div>
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
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
