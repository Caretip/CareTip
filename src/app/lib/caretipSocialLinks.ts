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

function viteEnv(key: string): unknown {
  try {
    return import.meta.env?.[key];
  } catch {
    return undefined;
  }
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
  facebook: resolveSocialUrl(viteEnv("VITE_SOCIAL_FACEBOOK_URL"), CARETIP_SOCIAL_DEFAULTS.facebook),
  instagram: resolveSocialUrl(viteEnv("VITE_SOCIAL_INSTAGRAM_URL"), CARETIP_SOCIAL_DEFAULTS.instagram),
  tiktok: resolveSocialUrl(viteEnv("VITE_SOCIAL_TIKTOK_URL"), CARETIP_SOCIAL_DEFAULTS.tiktok),
  linkedin: sanitizeSocialUrl(readEnvUrl(viteEnv("VITE_SOCIAL_LINKEDIN_URL"))),
} as const;

/** Verified public profile URLs for Organization JSON-LD `sameAs` (non-empty only). */
export function collectCareTipOrganizationSameAs(): string[] {
  return [
    caretipSocialLinks.facebook,
    caretipSocialLinks.instagram,
    caretipSocialLinks.tiktok,
    caretipSocialLinks.linkedin,
  ].filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}
