import AsyncStorage from "@react-native-async-storage/async-storage";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";

export const COOKIE_CONSENT_VERSION = 1;

export type CookieConsentRecord = {
  essential: true;
  analytics: boolean;
  functional: boolean;
  marketing: boolean;
  consentDate: string;
  consentVersion: number;
};

export type CookieConsentDraft = Omit<
  CookieConsentRecord,
  "essential" | "consentDate" | "consentVersion"
> & {
  essential?: true;
};

export function parseCookieConsent(raw: unknown): CookieConsentRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<CookieConsentRecord>;
  if (
    record.essential !== true ||
    typeof record.analytics !== "boolean" ||
    typeof record.functional !== "boolean" ||
    typeof record.marketing !== "boolean" ||
    typeof record.consentDate !== "string" ||
    typeof record.consentVersion !== "number"
  ) {
    return null;
  }
  if (record.consentVersion !== COOKIE_CONSENT_VERSION) return null;
  return record as CookieConsentRecord;
}

export async function readCookieConsent(): Promise<CookieConsentRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFERENCE_KEYS.cookieConsent);
    if (!raw) return null;
    return parseCookieConsent(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeCookieConsent(
  draft: CookieConsentDraft,
): Promise<CookieConsentRecord> {
  const record: CookieConsentRecord = {
    essential: true,
    analytics: draft.analytics,
    functional: draft.functional,
    marketing: draft.marketing,
    consentDate: new Date().toISOString(),
    consentVersion: COOKIE_CONSENT_VERSION,
  };
  await AsyncStorage.setItem(PREFERENCE_KEYS.cookieConsent, JSON.stringify(record));
  return record;
}

export async function hasCookieConsentChoice(): Promise<boolean> {
  return (await readCookieConsent()) != null;
}
