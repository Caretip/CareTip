import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export const INVALID_CONTACT_COUNTRY = "INVALID_CONTACT_COUNTRY" as const;
export const INVALID_CONTACT_PHONE = "INVALID_CONTACT_PHONE" as const;
export const INVALID_WEBSITE_URL = "INVALID_WEBSITE_URL" as const;

export type ContactFieldErrorCode =
  | typeof INVALID_CONTACT_COUNTRY
  | typeof INVALID_CONTACT_PHONE
  | typeof INVALID_WEBSITE_URL;

export function listSupportedCountryIsos(): CountryCode[] {
  return [...getCountries()].sort((a, b) => a.localeCompare(b));
}

export function callingCodeForCountry(iso: CountryCode): string {
  return `+${getCountryCallingCode(iso)}`;
}

function isBlank(raw: string | null | undefined): boolean {
  return raw == null || String(raw).trim() === "";
}

function hasUnsafeChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function inferCountryFromPhone(raw: string | null | undefined): CountryCode | null {
  const trimmed = raw == null ? "" : String(raw).trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed);
  if (parsed?.country && isSupportedCountry(parsed.country)) return parsed.country;
  return null;
}

export function normalizeOptionalContactPhone(
  raw: string | null | undefined,
  countryRaw?: string | null,
): { ok: true; e164: string | null; country: CountryCode | null } | { ok: false; code: ContactFieldErrorCode } {
  const phoneTrim = raw == null ? "" : String(raw).trim();
  const countryTrim = countryRaw == null ? "" : String(countryRaw).trim().toUpperCase();

  if (!phoneTrim) {
    return { ok: true, e164: null, country: null };
  }
  if (hasUnsafeChars(phoneTrim) || hasUnsafeChars(countryTrim)) {
    return { ok: false, code: INVALID_CONTACT_PHONE };
  }
  if (countryTrim) {
    if (countryTrim.length !== 2 || !isSupportedCountry(countryTrim)) {
      return { ok: false, code: INVALID_CONTACT_COUNTRY };
    }
  }

  const parsed = countryTrim
    ? parsePhoneNumberFromString(phoneTrim, countryTrim as CountryCode)
    : parsePhoneNumberFromString(phoneTrim);

  if (!parsed || !parsed.isValid() || !parsed.country || !isSupportedCountry(parsed.country)) {
    return { ok: false, code: INVALID_CONTACT_PHONE };
  }
  if (countryTrim && parsed.country !== countryTrim) {
    return { ok: false, code: INVALID_CONTACT_PHONE };
  }
  return { ok: true, e164: parsed.format("E.164"), country: parsed.country };
}

const ALLOWED_WEBSITE_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeOptionalWebsiteUrl(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; code: typeof INVALID_WEBSITE_URL } {
  if (isBlank(raw)) return { ok: true, value: null };
  const trimmed = String(raw).trim();
  if (hasUnsafeChars(trimmed) || /\s/.test(trimmed)) {
    return { ok: false, code: INVALID_WEBSITE_URL };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: INVALID_WEBSITE_URL };
  }
  if (!ALLOWED_WEBSITE_PROTOCOLS.has(url.protocol)) {
    return { ok: false, code: INVALID_WEBSITE_URL };
  }
  if (url.username || url.password) {
    return { ok: false, code: INVALID_WEBSITE_URL };
  }
  if (/%(?:00|0a|0d)/i.test(trimmed)) {
    return { ok: false, code: INVALID_WEBSITE_URL };
  }
  const host = url.hostname.trim().toLowerCase();
  if (!isPlausibleWebsiteHostname(host)) {
    return { ok: false, code: INVALID_WEBSITE_URL };
  }
  return { ok: true, value: url.href };
}

function isPlausibleWebsiteHostname(host: string): boolean {
  if (!host || host === "." || host.startsWith(".") || host.endsWith(".") || host.includes("..")) {
    return false;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) return false;
  const labels = host.split(".");
  if (labels.some((label) => label.length === 0)) return false;
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,}$/i.test(tld);
}
