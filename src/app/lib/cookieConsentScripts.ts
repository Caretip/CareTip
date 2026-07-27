/**
 * Consent-gated third-party scripts — never load marketing/analytics before choice.
 */
import type { CookieConsentRecord } from "./cookieConsent";
import { initGoogleAdsConversion } from "./googleAdsConversion";
import { initSentry } from "./sentry";

let analyticsInitialized = false;
let marketingInitialized = false;
let functionalInitialized = false;

export function resetCookieConsentScriptsForTests(): void {
  analyticsInitialized = false;
  marketingInitialized = false;
  functionalInitialized = false;
}

export function applyCookieConsentScripts(consent: CookieConsentRecord): void {
  if (consent.analytics && !analyticsInitialized) {
    analyticsInitialized = true;
    initSentry();
  }

  if (consent.marketing && !marketingInitialized) {
    marketingInitialized = true;
    initGoogleAdsConversion();
  }

  if (consent.functional && !functionalInitialized) {
    functionalInitialized = true;
    // Reserved for chat widgets, embedded content loaders, etc.
  }
}
