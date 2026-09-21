/**
 * Security regression — refresh-token reuse detection (backend authoritative).
 * Run: npm run test:auth-refresh-reuse-detection (from backend/)
 *
 * Proves a genuinely reused refresh token enters the existing reuse-detection path
 * and revokes all active refresh sessions for the user. Does NOT modify rotation logic.
 */
import { randomBytes } from "node:crypto";
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { issueRefreshToken, rotateRefreshToken } from "../src/services/refreshToken.service.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function countActiveRefreshSessions(userId: string): Promise<number> {
  return prisma.refreshToken.count({
    where: { userId, revokedAt: null },
  });
}

async function main(): Promise<void> {
  const suffix = randomBytes(6).toString("hex");
  const email = `refresh-reuse-sec-${suffix}@caretip-test.local`;
  let userId: string | null = null;

  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash("TestPass1!", 10),
        role: "MANAGER",
        isActive: true,
        emailVerified: true,
        accountStatus: "active",
      },
      select: { id: true },
    });
    userId = user.id;

    const r1 = await issueRefreshToken(userId);
    const rotated = await rotateRefreshToken(r1.token);
    if (!rotated?.newToken || rotated.newToken === r1.token) {
      fail("rotation: first rotate must issue a distinct replacement token");
    } else {
      pass("rotation: R1 → R2 succeeds");
    }

    const activeAfterRotate = await countActiveRefreshSessions(userId);
    if (activeAfterRotate !== 1) {
      fail(`rotation: exactly one active refresh session expected after rotate (got ${activeAfterRotate})`);
    } else {
      pass("rotation: only the replacement refresh session remains active");
    }

    const r1Row = await prisma.refreshToken.findFirst({
      where: { userId, revokedAt: { not: null } },
      orderBy: { revokedAt: "desc" },
      select: { replacedByTokenId: true },
    });
    if (!r1Row?.replacedByTokenId) {
      fail("rotation: revoked R1 must record replacedByTokenId (reuse detection prerequisite)");
    } else {
      pass("rotation: revoked R1 has replacedByTokenId set");
    }

    const reuse = await rotateRefreshToken(r1.token);
    if (reuse != null) {
      fail("reuse detection: replayed R1 must return null (no new session issued)");
    } else {
      pass("reuse detection: replayed R1 rejected");
    }

    const activeAfterReuse = await countActiveRefreshSessions(userId);
    if (activeAfterReuse !== 0) {
      fail(`reuse detection: all refresh sessions must be revoked after reuse (got ${activeAfterReuse} active)`);
    } else {
      pass("reuse detection: all user refresh sessions revoked after stale R1 replay");
    }

    const r2StillValid = rotated?.newToken ? await rotateRefreshToken(rotated.newToken) : null;
    if (r2StillValid != null) {
      fail("reuse detection: R2 must also be revoked after reuse cascade");
    } else {
      pass("reuse detection: previously valid R2 no longer rotates after reuse cascade");
    }
  } catch (err) {
    fail(`unexpected: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(
    failed.length === 0
      ? "auth-refresh-reuse-detection-runtime: ok"
      : `auth-refresh-reuse-detection-runtime: ${failed.length} failed`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
