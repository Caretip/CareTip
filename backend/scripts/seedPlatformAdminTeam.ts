/**
 * Idempotent seed for additional platform admin accounts (shared platform, separate logins).
 *
 * Creates or updates accounts listed in SEED_ADMIN_EMAILS (comma-separated).
 *
 * Requirements:
 *   SEED_ADMIN_EMAILS, SEED_ADMIN_PASSWORD (≥ 12 chars), ADMIN_SEED_SECRET (≥ 8 chars)
 *   Production: ALLOW_ADMIN_SEED_IN_PRODUCTION=true
 *
 * Usage (from backend/):
 *   npm run admin:seed-team
 *   npm run admin:seed-team -- --reset-passwords
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import {
  getPlatformAdminTeamMembers,
  listPlatformAdminAccounts,
  requireSeedAdminPassword,
  seedPlatformAdminTeam,
} from "../prisma/seedPlatformAdminTeam.js";

const seedSecret = process.env.ADMIN_SEED_SECRET?.trim();
if (!seedSecret || seedSecret.length < 8) {
  console.error(
    "Refusing to run: set ADMIN_SEED_SECRET in your environment (at least 8 characters).",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && process.env.ALLOW_ADMIN_SEED_IN_PRODUCTION !== "true") {
  console.error(
    "Refusing to run in production. Set ALLOW_ADMIN_SEED_IN_PRODUCTION=true only when intentional.",
  );
  process.exit(1);
}

const resetPasswords = process.argv.includes("--reset-passwords");

try {
  requireSeedAdminPassword();
  getPlatformAdminTeamMembers();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

async function main() {
  console.log("Seeding platform admin team (idempotent)…\n");

  const result = await seedPlatformAdminTeam(prisma, { resetPasswords });
  const teamMembers = getPlatformAdminTeamMembers();

  console.log("Accounts configured:");
  for (const member of teamMembers) {
    const pwNote = result.passwordReset.includes(member.email)
      ? "(password set — see README or env override)"
      : "(password unchanged)";
    console.log(`  • ${member.displayName} <${member.email}> ${pwNote}`);
  }

  if (result.created.length) {
    console.log("\nCreated:", result.created.join(", "));
  }
  if (result.updated.length) {
    console.log("Updated:", result.updated.join(", "));
  }
  if (result.passwordPreserved.length) {
    console.log("Passwords preserved (existing users):", result.passwordPreserved.join(", "));
  }

  const admins = await listPlatformAdminAccounts(prisma);
  console.log("\nAll platform admins in database:");
  for (const row of admins) {
    console.log(
      `  ${row.email} | active=${row.isActive} | mfa=${row.twoFactorEnabled ? "enabled" : "not yet"}`,
    );
  }

  console.log("\nNext steps:");
  console.log("  1. Sign in at /platform-admin/login with each account.");
  console.log("  2. Complete Google Authenticator setup on first login (required per account).");
  console.log("  3. Change temporary passwords after first sign-in.");
  console.log("  4. Verify sign-in with SEED_ADMIN_PASSWORD for each SEED_ADMIN_EMAILS entry.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
