/**
 * Password reset must invalidate existing sessions (audit High finding).
 * Mirrors change-password: revokeAllRefreshTokensForUser + authTokenVersion bump.
 *
 * Run from backend/: npm run test:password-reset-session
 */
import { createHash, randomBytes } from "node:crypto";
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import type { Role } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { resetPasswordWithToken } from "../src/services/passwordReset.service.js";
import {
  issueRefreshToken,
  rotateRefreshToken,
} from "../src/services/refreshToken.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const OLD_PASSWORD = "OldSecurePass1!";
const NEW_PASSWORD = "NewSecurePass1!";

function hashToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

async function runRoleCase(role: Role, label: string): Promise<void> {
  const suffix = randomBytes(6).toString("hex");
  const email = `pwd-reset-session-${label}-${suffix}@example.com`;
  let userId: string | null = null;

  try {
    const passwordHash = await bcrypt.hash(OLD_PASSWORD, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        isPlatformAdmin: role === "SUPER_ADMIN",
        isActive: true,
        emailVerified: true,
        accountStatus: "active",
      },
      select: { id: true, authTokenVersion: true },
    });
    userId = user.id;
    const tvBefore = user.authTokenVersion;

    const session = await issueRefreshToken(userId);
    const plainReset = randomBytes(32).toString("base64url");
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(plainReset),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await resetPasswordWithToken(plainReset, NEW_PASSWORD);

    const after = await prisma.user.findUnique({
      where: { id: userId },
      select: { authTokenVersion: true, passwordHash: true },
    });
    if (!after) {
      fail(`${label}: user missing after reset`);
      return;
    }

    if (after.authTokenVersion <= tvBefore) {
      fail(`${label}: authTokenVersion must increase after reset`);
    } else {
      pass(`${label}: authTokenVersion bumped`);
    }

    const activeRefresh = await prisma.refreshToken.count({
      where: { userId, revokedAt: null },
    });
    if (activeRefresh !== 0) {
      fail(`${label}: refresh tokens must be revoked`);
    } else {
      pass(`${label}: refresh tokens revoked`);
    }

    const rotated = await rotateRefreshToken(session.token);
    if (rotated != null) {
      fail(`${label}: old refresh token must be rejected`);
    } else {
      pass(`${label}: old refresh token rejected`);
    }

    if (!after.passwordHash?.startsWith("$2b$10$") && !after.passwordHash?.startsWith("$2a$10$")) {
      fail(`${label}: stored hash must be bcrypt cost 10`);
    } else {
      pass(`${label}: bcrypt cost 10 hash format`);
    }

    const oldOk = await bcrypt.compare(OLD_PASSWORD, after.passwordHash!);
    const newOk = await bcrypt.compare(NEW_PASSWORD, after.passwordHash!);
    if (oldOk) fail(`${label}: old password must not verify`);
    else pass(`${label}: old password rejected`);
    if (!newOk) fail(`${label}: new password must verify`);
    else pass(`${label}: new password accepted`);

    let reuseRejected = false;
    try {
      await resetPasswordWithToken(plainReset, "AnotherSecure1!");
    } catch {
      reuseRejected = true;
    }
    if (!reuseRejected) fail(`${label}: reset token must be single-use`);
    else pass(`${label}: reset token single-use`);
  } catch (err) {
    fail(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (userId) {
      await prisma.passwordResetToken.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  }
}

async function main() {
  await runRoleCase("MANAGER", "manager");
  await runRoleCase("EMPLOYEE", "employee");
  await runRoleCase("SUPER_ADMIN", "admin");

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  await prisma.$disconnect().catch(() => undefined);
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
