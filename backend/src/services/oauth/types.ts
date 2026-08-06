/** Shared OAuth identity after provider-specific verification. */

export type OAuthProviderId = "google" | "apple" | "facebook";

export type VerifiedIdentity = {
  provider: OAuthProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
};

export function isOAuthProviderId(value: unknown): value is OAuthProviderId {
  return value === "google" || value === "apple" || value === "facebook";
}
