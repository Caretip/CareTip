/**
 * Google Ads conversion tracking — inactive until VITE_GOOGLE_ADS_CONVERSION_ID is set.
 * Does not load scripts or send events in production unless configured.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const ADS_ID = (import.meta.env.VITE_GOOGLE_ADS_CONVERSION_ID as string | undefined)?.trim() ?? "";
const ADS_LABEL = (import.meta.env.VITE_GOOGLE_ADS_CONVERSION_LABEL as string | undefined)?.trim() ?? "";

let initStarted = false;

export function isGoogleAdsConversionConfigured(): boolean {
  return ADS_ID.length > 0;
}

/** Load gtag.js once when conversion ID is configured (opt-in via env). */
export function initGoogleAdsConversion(): void {
  if (typeof window === "undefined" || !ADS_ID || initStarted) return;
  initStarted = true;

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", ADS_ID);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ADS_ID)}`;
  document.head.appendChild(script);
}

export type GoogleAdsConversionEvent =
  | "demo_lead_submitted"
  | "signup_completed"
  | "billing_checkout_completed";

const EVENT_LABELS: Partial<Record<GoogleAdsConversionEvent, string>> = {
  demo_lead_submitted: import.meta.env.VITE_GOOGLE_ADS_LABEL_DEMO as string | undefined,
  signup_completed: import.meta.env.VITE_GOOGLE_ADS_LABEL_SIGNUP as string | undefined,
  billing_checkout_completed: import.meta.env.VITE_GOOGLE_ADS_LABEL_BILLING as string | undefined,
};

/** Fire a conversion event when Ads is configured and marketing consent is granted. */
export function trackGoogleAdsConversion(event: GoogleAdsConversionEvent): void {
  if (typeof window === "undefined" || !ADS_ID || !window.gtag) return;
  void import("./cookieConsent").then(({ readCookieConsent }) => {
    if (!readCookieConsent()?.marketing) return;
    const label = (EVENT_LABELS[event] ?? ADS_LABEL).trim();
    if (!label) return;
    window.gtag?.("event", "conversion", {
      send_to: `${ADS_ID}/${label}`,
    });
  });
}
