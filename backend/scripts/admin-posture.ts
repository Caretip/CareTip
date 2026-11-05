/**
 * Read-only Super Admin health check. Prints counts only, never addresses or secrets.
 * Exit code 1 when the platform is not resilient: fewer than two active admins, or anyone without MFA.
 *
 *   npx tsx scripts/admin-posture.ts
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { isSealedMfaSecret } from "../src/lib/mfaSecretCrypto.js";

const admins = await prisma.user.findMany({
  where: { role: "SUPER_ADMIN" },
  select: { isActive: true, isPlatformAdmin: true, emailVerified: true, twoFactorEnabled: true, twoFactorSecret: true },
});
const active = admins.filter((a) => a.isActive && a.isPlatformAdmin);
const report = {
  superAdmins: admins.length,
  active: active.length,
  withMfa: active.filter((a) => a.twoFactorEnabled && a.twoFactorSecret).length,
  withoutMfa: active.filter((a) => !a.twoFactorEnabled || !a.twoFactorSecret).length,
  secretsEncrypted: active.filter((a) => a.twoFactorSecret && isSealedMfaSecret(a.twoFactorSecret)).length,
  emailUnverified: active.filter((a) => !a.emailVerified).length,
};
console.log(JSON.stringify(report));
await prisma.$disconnect();
process.exit(report.active >= 2 && report.withoutMfa === 0 ? 0 : 1);
