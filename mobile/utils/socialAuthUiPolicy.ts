import type { OAuthProvider } from "@/types/auth";

/**
 * Login and signup must render the same CareTip social row.
 * Native SDK availability is enforced in runSocialAuth (toast), not by hiding the row.
 */
export function shouldRenderSocialAuthRow(): boolean {
  return true;
}

/** iOS: Apple → Google → Facebook. Android/web: Google → Facebook → Apple. */
export function socialProvidersForPlatform(os: "ios" | "android" | "web"): OAuthProvider[] {
  if (os === "ios") {
    return ["apple", "google", "facebook"];
  }
  return ["google", "facebook", "apple"];
}

/** Login must not send intendedRole — backend ignores it, but clients must match web. */
export function oauthPayloadForMode(isLogin: boolean, intendedRole?: "MANAGER" | "EMPLOYEE") {
  return {
    isLogin,
    ...(isLogin || !intendedRole ? {} : { intendedRole }),
  };
}
