/**
 * Official CareTip public profiles for web + mobile footers.
 * Tracking query params from share sheets are stripped.
 * Env vars override defaults when set.
 */

export const CARETIP_SOCIAL_DEFAULTS = {
  facebook: "https://www.facebook.com/share/1JC9mKEULZ/",
  instagram: "https://www.instagram.com/caretipde",
} as const;

function readEnvUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeSocialUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    for (const key of ["igsh", "utm_source", "utm_medium", "utm_campaign", "utm_content", "mibextid", "fbclid"]) {
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
    url.hash = "";
    return url.toString();
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
  tiktok: sanitizeSocialUrl(readEnvUrl(import.meta.env.VITE_SOCIAL_TIKTOK_URL)),
  linkedin: sanitizeSocialUrl(readEnvUrl(import.meta.env.VITE_SOCIAL_LINKEDIN_URL)),
} as const;
