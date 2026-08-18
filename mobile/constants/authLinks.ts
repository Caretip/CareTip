/**
 * Public web destinations for auth footer / secondary actions.
 * Social URLs mirror web CareTip profiles. EXPO_PUBLIC_SOCIAL_* can override.
 */

function trimUrl(value: string | undefined): string {
  return (value ?? "").trim();
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
    return trimmed.replace(/\/+$/, "");
  }
}

const CARETIP_SOCIAL_DEFAULTS = {
  facebook: "https://www.facebook.com/share/1JC9mKEULZ/",
  instagram: "https://www.instagram.com/caretipde",
} as const;

const appBase = trimUrl(process.env.EXPO_PUBLIC_APP_URL).replace(/\/+$/, "") || "https://caretip.de";

export const authWebPaths = {
  about: "/about",
  contact: "/contact",
  faq: "/faq",
  privacy: "/privacy",
  terms: "/terms",
  forgotPassword: "/forgot-password",
  signup: "/signup",
  join: "/join",
} as const;

export const authSocialLinks = {
  facebook:
    sanitizeSocialUrl(trimUrl(process.env.EXPO_PUBLIC_SOCIAL_FACEBOOK_URL)) || CARETIP_SOCIAL_DEFAULTS.facebook,
  instagram:
    sanitizeSocialUrl(trimUrl(process.env.EXPO_PUBLIC_SOCIAL_INSTAGRAM_URL)) || CARETIP_SOCIAL_DEFAULTS.instagram,
  tiktok: sanitizeSocialUrl(trimUrl(process.env.EXPO_PUBLIC_SOCIAL_TIKTOK_URL)),
  linkedin: sanitizeSocialUrl(trimUrl(process.env.EXPO_PUBLIC_SOCIAL_LINKEDIN_URL)),
} as const;

export function resolveAuthWebUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${appBase}${normalized}`;
}
