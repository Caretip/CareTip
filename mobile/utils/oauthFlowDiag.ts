/**
 * Temporary Google login/signup flow diagnostics.
 * Never logs tokens, passwords, client secrets, or invite-code values.
 */

import { config } from "@/constants/config";

let oauthRequestCount = 0;

export function nextOAuthRequestCount(): number {
  oauthRequestCount += 1;
  return oauthRequestCount;
}

export function shouldLogOAuthFlowDiag(): boolean {
  return __DEV__ || config.appEnv !== "production";
}

export function logOAuthFlowDiag(
  event: string,
  details: {
    flow: "login" | "signup";
    provider: string;
    requestCount?: number;
    isLogin: boolean;
    intendedRole?: string | null;
    hasInviteCode: boolean;
    status?: number | null;
    code?: string | null;
    source?: string;
  },
): void {
  if (!shouldLogOAuthFlowDiag()) return;
  console.log(`[CareTip][OAuthFlow] ${event}`, {
    flow: details.flow,
    provider: details.provider,
    requestCount: details.requestCount ?? oauthRequestCount,
    isLogin: details.isLogin,
    intendedRole: details.intendedRole ?? null,
    hasInviteCode: details.hasInviteCode,
    ...(details.status !== undefined ? { status: details.status } : {}),
    ...(details.code !== undefined ? { code: details.code } : {}),
    ...(details.source ? { source: details.source } : {}),
  });
}
