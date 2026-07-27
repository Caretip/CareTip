/**
 * Runtime configuration — mirrors web `VITE_API_URL` SSOT.
 * Never hardcode production secrets here.
 */

export type AppEnv = "development" | "staging" | "production";

const DEFAULT_API_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 20_000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveAppEnv(raw: string | undefined): AppEnv {
  const value = (raw ?? "development").trim().toLowerCase();
  if (value === "production" || value === "prod") return "production";
  if (value === "staging" || value === "preview" || value === "beta") return "staging";
  return "development";
}

const appEnv = resolveAppEnv(process.env.EXPO_PUBLIC_APP_ENV);
const apiUrl = trimTrailingSlash(
  (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).trim() || DEFAULT_API_URL,
);

/**
 * Production builds must talk HTTPS to the CareTip API.
 * Fail closed in release so beta/prod never silently use cleartext LAN URLs.
 */
function assertApiUrlSafeForEnv(env: AppEnv, url: string): void {
  if (env !== "production") return;
  if (url.startsWith("https://")) return;
  throw new Error(
    `[CareTip] EXPO_PUBLIC_API_URL must be https:// in production (got "${url}"). ` +
      `Set EAS secrets / env for the production profile.`,
  );
}

assertApiUrlSafeForEnv(appEnv, apiUrl);

export const config = {
  appEnv,
  isProduction: appEnv === "production",
  isStaging: appEnv === "staging",
  isDevelopment: appEnv === "development",
  apiUrl,
  appUrl: trimTrailingSlash((process.env.EXPO_PUBLIC_APP_URL ?? "").trim()),
  apiTimeoutMs:
    Number.parseInt(process.env.EXPO_PUBLIC_API_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10) ||
    DEFAULT_TIMEOUT_MS,
  /** Optional EAS project id for Expo push tokens in standalone builds. */
  easProjectId: (process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "").trim() || undefined,
  /** Matches web CSRF guard header required by refresh/logout. */
  clientHeader: "1" as const,
  clientHeaderName: "X-CareTip-Client" as const,
} as const;
