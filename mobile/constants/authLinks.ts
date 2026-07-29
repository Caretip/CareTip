/**
 * Public web destinations for auth footer / secondary actions.
 * Social URLs mirror web `VITE_SOCIAL_*` — configure via EXPO_PUBLIC_SOCIAL_* in EAS/env.
 */

function trimUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

const appBase = trimUrl(process.env.EXPO_PUBLIC_APP_URL) || "https://caretip.de";
const contactFallback = `${appBase}/contact`;

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
  facebook: trimUrl(process.env.EXPO_PUBLIC_SOCIAL_FACEBOOK_URL) || contactFallback,
  instagram: trimUrl(process.env.EXPO_PUBLIC_SOCIAL_INSTAGRAM_URL) || contactFallback,
  tiktok: trimUrl(process.env.EXPO_PUBLIC_SOCIAL_TIKTOK_URL) || contactFallback,
  linkedin: trimUrl(process.env.EXPO_PUBLIC_SOCIAL_LINKEDIN_URL) || contactFallback,
} as const;

export function resolveAuthWebUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${appBase}${normalized}`;
}
