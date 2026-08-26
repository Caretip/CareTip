/**
 * Official CareTip public profiles for web + mobile footers.
 * Tracking query params from share sheets are stripped.
 * Env vars override defaults when set.
 */

export const CARETIP_SOCIAL_DEFAULTS = {
  facebook: "https://www.facebook.com/share/1JC9mKEULZ/",
  instagram: "https://www.instagram.com/caretipde",
  tiktok: "https://www.tiktok.com/@caretip1",
} as const;

function readEnvUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeSocialUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    for (const key of [
      "igsh",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "mibextid",
      "fbclid",
      "_r",
      "_t",
    ]) {
      url.searchParams.delete(key);
    }
    const host = url.hostname.replace(/^www\./, "");
    if (host === "instagram.com") {
      const handle = url.pathname.split("/").filter(Boolean)[0];
      return handle ? `https://www.instagram.com/${handle}` : trimmed;
    }
    if (host === "facebook.com") {
      url.hash = "";
      const path = url.pathname.replace(/\/+$/, "");
      return `https://www.facebook.com${path || "/"}`;
    }
    if (host === "tiktok.com") {
      const handle = url.pathname.split("/").filter(Boolean)[0];
      return handle ? `https://www.tiktok.com/${handle}` : "https://www.tiktok.com/@caretip1";
    }
    url.hash = "";
    return url.toString().replace(/\?$/, "");
  } catch {
    return trimmed;
  }
}

function resolveSocialUrl(envValue: unknown, fallback: string): string {
  return sanitizeSocialUrl(readEnvUrl(envValue)) || fallback;
}

export const caretipSocialLinks = {
  facebook: resolveSocialUrl(import.meta.env.VITE_SOCIAL_FACEBOOK_URL, CARETIP_SOCIAL_DEFAULTS.facebook),
  instagram: resolveSocialUrl(import.meta.env.VITE_SOCIAL_INSTAGRAM_URL, CARETIP_SOCIAL_DEFAULTS.instagram),
  tiktok: resolveSocialUrl(import.meta.env.VITE_SOCIAL_TIKTOK_URL, CARETIP_SOCIAL_DEFAULTS.tiktok),
  linkedin: sanitizeSocialUrl(readEnvUrl(import.meta.env.VITE_SOCIAL_LINKEDIN_URL)),
} as const;
