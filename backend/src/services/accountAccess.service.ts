/**
 * Account access gates and session termination (GDPR lifecycle Slice A + C).
 */

import type { AccountStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { revokeAllRefreshTokensForUser } from "./refreshToken.service.js";
import { removeAllPushDeviceTokensForUser } from "./push/deviceTokens.service.js";
import { disconnectUserSockets } from "../socket/socketServer.js";

export type AuthenticateGateUser = {
  id?: string;
  isActive: boolean;
  accountStatus?: AccountStatus | null;
};

/** True when the user may receive new credentials / complete auth flows. */
export function userMayAuthenticate(user: AuthenticateGateUser | null | undefined): boolean {
  if (!user) return false;
  if (user.accountStatus != null && user.accountStatus !== "active") {
    return false;
  }
  return user.isActive === true;
}

export type TerminateUserSessionsOptions = {
  /** When false, skip socket disconnect (e.g. unit tests without IO). Default true. */
  disconnectSockets?: boolean;
};

/**
 * Kill interactive access artifacts after deactivate / erasure start.
 * Always safe under legal hold (Amendment A2): auth/session data is not preserved.
 */
export async function terminateUserSessions(
  userId: string,
  opts?: TerminateUserSessionsOptions,
): Promise<void> {
  const id = String(userId ?? "").trim();
  if (!id) return;

  await revokeAllRefreshTokensForUser(id);

  await Promise.all([
    prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: id } }),
    prisma.mobileWebHandoffToken.deleteMany({ where: { userId: id } }),
    removeAllPushDeviceTokensForUser(id),
  ]);

  if (opts?.disconnectSockets !== false) {
    disconnectUserSockets(id);
  }
}
