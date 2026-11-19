import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cookie } from "lucide-react";
import { useCookieConsent } from "../../context/CookieConsentContext";
import { DialogPortal } from "../ui/dialog";
import { cookieConsentClasses as cc } from "./cookieConsentPresentation";

/**
 * Compact consent bar: one sentence and three text actions instead of a card with buttons.
 * Reject and Accept share the same size and weight (equal prominence, as German regulators expect);
 * only colour separates them. Behaviour is unchanged: non-modal, no dismiss by Escape or outside click.
 */
export function CookieConsentBanner() {
  const { t } = useTranslation();
  const { bannerVisible, acceptAll, rejectNonEssential, openSettings } = useCookieConsent();

  if (!bannerVisible) return null;

  return (
    <DialogPrimitive.Root open={bannerVisible} modal={false}>
      <DialogPortal>
        <DialogPrimitive.Overlay className={cc.backdropPassive} />
        <DialogPrimitive.Content
          className={cc.bar}
          aria-describedby="cookie-consent-desc"
          // Land focus on the bar itself (no ring), not on its first action: Tab then reaches the choices.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">{t("cookieConsent.banner.title")}</DialogPrimitive.Title>

          <span className={cc.barMark} aria-hidden>
            <Cookie size={16} strokeWidth={2.2} />
          </span>

          <DialogPrimitive.Description id="cookie-consent-desc" className={cc.barText}>
            {t("cookieConsent.banner.compact")}{" "}
            <Link to="/privacy" className={cc.barPrivacy}>
              {t("cookieConsent.banner.privacyShort")}
            </Link>
          </DialogPrimitive.Description>

          <div className={cc.barActions} role="group" aria-label={t("cookieConsent.banner.actionsLabel")}>
            <button
              type="button"
              onClick={openSettings}
              className={`${cc.barAction} ${cc.barActionQuiet}`}
              aria-label={t("cookieConsent.banner.settings")}
            >
              {t("cookieConsent.banner.settingsShort")}
            </button>
            <button
              type="button"
              onClick={rejectNonEssential}
              className={cc.barAction}
              aria-label={t("cookieConsent.banner.reject")}
            >
              {t("cookieConsent.banner.rejectShort")}
            </button>
            <button type="button" onClick={acceptAll} className={`${cc.barAction} ${cc.barActionAccept}`}>
              {t("cookieConsent.banner.acceptAll")}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
