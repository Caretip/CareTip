import { CookieConsentBanner } from "./CookieConsentBanner";
import { CookieConsentSettingsModal } from "./CookieConsentSettingsModal";

/** Global GDPR cookie UI — mount once at app root. */
export function CookieConsentRoot() {
  return (
    <>
      <CookieConsentBanner />
      <CookieConsentSettingsModal />
    </>
  );
}
