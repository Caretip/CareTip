/**
 * Runtime configuration — mirrors web `VITE_API_URL` SSOT.
 * Never hardcode production secrets here.
 */

export type AppEnv = "development" | "staging" | "production";

/** Render production API — same origin as web `VITE_API_URL` in deployed builds. */
export const PRODUCTION_API_URL = "https://caretip.onrender.com";

const DEFAULT_DEV_API_URL = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 20_000;

const DEV_API_HOST_PATTERN =
  /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d+\.\d+|0\.0\.0\.0/i;

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

function resolveApiUrl(env: AppEnv): string {
  const fromEnv = trimTrailingSlash((process.env.EXPO_PUBLIC_API_URL ?? "").trim());
  if (fromEnv) return fromEnv;
  if (env === "production" || env === "staging") return PRODUCTION_API_URL;
  return DEFAULT_DEV_API_URL;
}

const apiUrl = resolveApiUrl(appEnv);

/**
 * Release builds must use HTTPS and must not embed LAN/emulator loopback URLs.
 * Fail closed so EAS preview/production never ship with localhost baked in.
 */
function assertApiUrlSafeForEnv(env: AppEnv, url: string): void {
  if (env === "development") return;
  if (!url.startsWith("https://")) {
    throw new Error(
      `[CareTip] EXPO_PUBLIC_API_URL must be https:// for ${env} builds (got "${url}"). ` +
        `Set EAS env / eas.json for the profile.`,
    );
  }
  if (DEV_API_HOST_PATTERN.test(url)) {
    throw new Error(
      `[CareTip] EXPO_PUBLIC_API_URL must not use a development host in ${env} builds (got "${url}").`,
    );
  }
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
  /** Google OAuth web client ID — same as web VITE_GOOGLE_CLIENT_ID (required for idToken). */
  googleWebClientId: (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "").trim() || undefined,
  /** iOS native client ID (optional; falls back to GoogleService-Info.plist when set). */
  googleIosClientId: (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "").trim() || undefined,
} as const;
