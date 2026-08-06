/** Shared OAuth provider ids for CareTip web (matches POST /api/auth/oauth). */
export type OAuthProviderId = "google" | "apple" | "facebook";

/** Desktop web order: Google → Facebook → Apple. */
export const OAUTH_PROVIDER_ORDER: readonly OAuthProviderId[] = [
  "google",
  "facebook",
  "apple",
] as const;

export function appleOAuthWebClientId(): string {
  return import.meta.env.VITE_APPLE_CLIENT_ID?.trim() ?? "";
}

export function facebookOAuthWebAppId(): string {
  return import.meta.env.VITE_FACEBOOK_APP_ID?.trim() ?? "";
}

export function providerDisplayName(provider: OAuthProviderId): string {
  switch (provider) {
    case "google":
      return "Google";
    case "apple":
      return "Apple";
    case "facebook":
      return "Facebook";
  }
}
