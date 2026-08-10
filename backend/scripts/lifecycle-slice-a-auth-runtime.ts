/**
 * GDPR lifecycle Slice A — auth hardening + session termination (F-05, F-06).
 * Run: npm run test:lifecycle-slice-a (from backend/)
 */
import { createHash, randomBytes } from "node:crypto";
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import {
  terminateUserSessions,
  userMayAuthenticate,
} from "../src/services/accountAccess.service.js";
import { requestPasswordReset, resetPasswordWithToken } from "../src/services/passwordReset.service.js";
import { issueRefreshToken } from "../src/services/refreshToken.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function hashToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

async function main() {
  if (!userMayAuthenticate({ isActive: true })) fail("active user may authenticate");
  else pass("active user may authenticate");

  if (userMayAuthenticate({ isActive: false })) fail("inactive must not authenticate");
  else pass("inactive must not authenticate");

  if (userMayAuthenticate(null)) fail("null must not authenticate");
  else pass("null must not authenticate");

  const suffix = randomBytes(6).toString("hex");
  const email = `lifecycle-slice-a-${suffix}@example.com`;
  let userId: string | null = null;

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUV", // placeholder bcrypt-shaped
        role: "EMPLOYEE",
        isActive: true,
        emailVerified: true,
      },
      select: { id: true, authTokenVersion: true },
    });
    userId = user.id;

    await issueRefreshToken(userId);
    const plainReset = randomBytes(24).toString("base64url");
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(plainReset),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(randomBytes(24).toString("base64url")),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.pushDeviceToken.create({
      data: {
        userId,
        token: `fcm-test-${suffix}`,
        platform: "android",
      },
    });

    await terminateUserSessions(userId, { disconnectSockets: false });

    const after = await prisma.user.findUnique({
      where: { id: userId },
      select: { authTokenVersion: true },
    });
    if (!after || after.authTokenVersion <= user.authTokenVersion) {
      fail("terminateUserSessions must bump authTokenVersion");
    } else {
      pass("terminateUserSessions bumps authTokenVersion");
    }

    const refreshLeft = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    if (refreshLeft !== 0) fail("refresh tokens must be revoked");
    else pass("refresh tokens revoked");

    const resetLeft = await prisma.passwordResetToken.count({ where: { userId } });
    const verifyLeft = await prisma.emailVerificationToken.count({ where: { userId } });
    const pushLeft = await prisma.pushDeviceToken.count({ where: { userId } });
    if (resetLeft !== 0 || verifyLeft !== 0 || pushLeft !== 0) {
      fail("reset/verify/push tokens must be deleted on terminate");
    } else {
      pass("reset/verify/push tokens deleted on terminate");
    }

    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

    // Inactive: requestPasswordReset must not create a new token (F-05).
    await requestPasswordReset(email);
    const resetAfterInactive = await prisma.passwordResetToken.count({ where: { userId } });
    if (resetAfterInactive !== 0) fail("inactive requestPasswordReset must not create tokens");
    else pass("inactive requestPasswordReset creates no tokens");

    // Seed a reset token then try complete while inactive.
    const plain2 = randomBytes(24).toString("base64url");
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(plain2),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    let resetBlocked = false;
    try {
      await resetPasswordWithToken(plain2, "NewSecurePass1!");
    } catch {
      resetBlocked = true;
    }
    if (!resetBlocked) fail("inactive resetPasswordWithToken must fail");
    else pass("inactive resetPasswordWithToken rejected");

    const { verifyEmailWithToken } = await import("../src/services/emailVerification.service.js");
    const plainVerify = randomBytes(24).toString("base64url");
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(plainVerify),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    let verifyBlocked = false;
    try {
      await verifyEmailWithToken(plainVerify);
    } catch {
      verifyBlocked = true;
    }
    if (!verifyBlocked) fail("inactive verifyEmailWithToken must fail");
    else pass("inactive verifyEmailWithToken rejected");
  } catch (err) {
    fail(`integration setup/run: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (userId) {
      await prisma.passwordResetToken.deleteMany({ where: { userId } });
      await prisma.emailVerificationToken.deleteMany({ where: { userId } });
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.pushDeviceToken.deleteMany({ where: { userId } });
      await prisma.mobileWebHandoffToken.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
