/** GDPR / TTDSG cookie consent — local persistence (no tracking cookies until choice). */

export const COOKIE_CONSENT_STORAGE_KEY = "caretip_cookie_consent";
/** Bump when categories or legal basis change — may re-prompt visitors. */
export const COOKIE_CONSENT_VERSION = 1;

export type CookieConsentRecord = {
  essential: true;
  analytics: boolean;
  functional: boolean;
  marketing: boolean;
  consentDate: string;
  consentVersion: number;
};

export type CookieConsentDraft = Omit<CookieConsentRecord, "essential" | "consentDate" | "consentVersion"> & {
  essential?: true;
};

export const DEFAULT_REJECT_CONSENT: CookieConsentRecord = {
  essential: true,
  analytics: false,
  functional: false,
  marketing: false,
  consentDate: "",
  consentVersion: COOKIE_CONSENT_VERSION,
};

export const ACCEPT_ALL_CONSENT: Omit<CookieConsentDraft, "essential"> = {
  analytics: true,
  functional: true,
  marketing: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function parseCookieConsent(raw: unknown): CookieConsentRecord | null {
  if (!isRecord(raw)) return null;
  if (raw.essential !== true) return null;
  if (typeof raw.analytics !== "boolean") return null;
  if (typeof raw.functional !== "boolean") return null;
  if (typeof raw.marketing !== "boolean") return null;
  if (typeof raw.consentDate !== "string" || !raw.consentDate.trim()) return null;
  const version = typeof raw.consentVersion === "number" ? raw.consentVersion : 0;
  if (version !== COOKIE_CONSENT_VERSION) return null;
  return {
    essential: true,
    analytics: raw.analytics,
    functional: raw.functional,
    marketing: raw.marketing,
    consentDate: raw.consentDate,
    consentVersion: version,
  };
}

export function readCookieConsent(): CookieConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    return parseCookieConsent(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeCookieConsent(draft: CookieConsentDraft): CookieConsentRecord {
  const record: CookieConsentRecord = {
    essential: true,
    analytics: Boolean(draft.analytics),
    functional: Boolean(draft.functional),
    marketing: Boolean(draft.marketing),
    consentDate: new Date().toISOString(),
    consentVersion: COOKIE_CONSENT_VERSION,
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      /* quota / private mode */
    }
  }
  return record;
}

export function hasCookieConsentChoice(): boolean {
  return readCookieConsent() != null;
}

export const COOKIE_CONSENT_OPEN_EVENT = "caretip:open-cookie-settings";
export const COOKIE_CONSENT_CHANGED_EVENT = "caretip:cookie-consent-changed";

export function openCookieConsentSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_OPEN_EVENT));
}

export function emitCookieConsentChanged(consent: CookieConsentRecord): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: consent }));
}
