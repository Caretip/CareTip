/**
 * Render-visible logs for POST /api/auth/facebook/start (no secrets, tokens, state, or cookies).
 */

export const FACEBOOK_OAUTH_START_LOG_PREFIX = "[facebook-oauth-start]";

export type FacebookOAuthStartServerEvent =
  | "START_REQUEST_RECEIVED"
  | "START_STATE_CREATED"
  | "START_REDIRECT_CREATED"
  | "START_RESPONSE"
  | "START_FAILURE"
  | "START_EXCEPTION";

export function sanitizeFacebookRedirectTargetForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

export function logFacebookOAuthStartServer(
  event: FacebookOAuthStartServerEvent,
  fields: Record<string, unknown> & { requestId: string },
): void {
  const payload = {
    event,
    at: new Date().toISOString(),
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    ...fields,
  };
  if (event === "START_EXCEPTION" || event === "START_FAILURE") {
    console.error(FACEBOOK_OAUTH_START_LOG_PREFIX, event, JSON.stringify(payload));
    return;
  }
  console.info(FACEBOOK_OAUTH_START_LOG_PREFIX, event, JSON.stringify(payload));
}
