/**
 * Create or update a Super Admin user (role SUPER_ADMIN, isPlatformAdmin true, isActive true).
 * Does not use the public register API — run on a secure machine with DATABASE_URL set.
 *
 * Requirements:
 * - `ADMIN_SEED_SECRET` must be set in the environment (proves intentional, scripted access).
 * - In production (`NODE_ENV=production`), set `ALLOW_ADMIN_SEED_IN_PRODUCTION=true` or the script exits.
 * - By default only one SUPER_ADMIN may exist; set `ALLOW_MULTIPLE_SUPER_ADMINS=true` to allow more.
 *
 * - An account that is not already a platform admin is refused: this script never promotes one.
 * - An existing admin's password is left alone unless ALLOW_ADMIN_PASSWORD_RESET=true.
 * - In production, ADMIN_SEED_OPERATOR and ADMIN_SEED_REASON are required for the audit record.
 *
 * Usage (from backend directory). Prefer the env var: arguments end up in shell history.
 *   ADMIN_INITIAL_PASSWORD=... node scripts/createAdmin.js <email>
 *
 * Or with npm from repo root:
 *   cd backend && ADMIN_INITIAL_PASSWORD=... npm run admin:create -- admin@example.com
 *
 * The new admin must enrol MFA at first sign-in. See docs/ops/super-admin-procedures.md.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";

const email = process.argv[2]?.trim().toLowerCase();
const password = process.env.ADMIN_INITIAL_PASSWORD ?? process.argv[3];
const production = process.env.NODE_ENV === "production";
const operator = process.env.ADMIN_SEED_OPERATOR?.trim();
const reason = process.env.ADMIN_SEED_REASON?.trim();

const seedSecret = process.env.ADMIN_SEED_SECRET?.trim();
if (!seedSecret || seedSecret.length < 8) {
  console.error(
    "Refusing to run: set ADMIN_SEED_SECRET in your environment (at least 8 characters).",
  );
  console.error("Add it to backend/.env or export it before running this script.");
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && process.env.ALLOW_ADMIN_SEED_IN_PRODUCTION !== "true") {
  console.error(
    "Refusing to run in production. Set ALLOW_ADMIN_SEED_IN_PRODUCTION=true only when you intentionally seed an admin on a server.",
  );
  process.exit(1);
}

if (!email || !password) {
  console.error("Usage: ADMIN_INITIAL_PASSWORD=... node scripts/createAdmin.js <email>");
  process.exit(1);
}

if (password.length < 12) {
  console.error("Refusing to run: the password must be at least 12 characters.");
  process.exit(1);
}

if (production && (process.argv[3] || !operator || !reason)) {
  console.error("Refusing to run in production: use ADMIN_INITIAL_PASSWORD, and set ADMIN_SEED_OPERATOR and ADMIN_SEED_REASON.");
  process.exit(1);
}

async function main() {
  const allowMultiple = process.env.ALLOW_MULTIPLE_SUPER_ADMINS === "true";
  if (!allowMultiple) {
    const other = await prisma.user.findFirst({
      where: {
        role: "SUPER_ADMIN",
        email: { not: email },
      },
      select: { id: true, email: true },
    });
    if (other) {
      console.error(
        "Another SUPER_ADMIN already exists. Set ALLOW_MULTIPLE_SUPER_ADMINS=true to create additional platform admins.",
      );
      process.exit(1);
    }
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, isPlatformAdmin: true } });
  if (existing && (existing.role !== "SUPER_ADMIN" || !existing.isPlatformAdmin)) {
    console.error("Refusing to run: this email belongs to a non-admin account. Admins must be separate accounts.");
    process.exit(1);
  }
  if (existing && process.env.ALLOW_ADMIN_PASSWORD_RESET !== "true") {
    console.error("Refusing to run: this admin already exists. Set ALLOW_ADMIN_PASSWORD_RESET=true to change the password.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const saved = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, authTokenVersion: { increment: 1 } },
        select: { id: true },
      })
    : await prisma.user.create({
        data: {
          email,
          passwordHash,
          role: "SUPER_ADMIN",
          isPlatformAdmin: true,
          isActive: true,
          emailVerified: true,
        },
        select: { id: true },
      });
  await prisma.auditLog.create({
    data: {
      userId: saved.id,
      action: existing ? "platform.admin.password_reset_by_script" : "platform.admin.created_by_script",
      metadata: JSON.stringify({ operator: operator ?? null, reason: reason ?? null }),
    },
  });
  console.log("Super Admin user saved.");
}

main()
  .catch((e) => {
    const msg = String(e?.message ?? e);
    if (
      msg.includes("invalid input value for enum") &&
      msg.includes("SUPER_ADMIN")
    ) {
      console.error(msg);
      console.error(
        "\nThe database Role enum is missing SUPER_ADMIN. Fix by applying migrations:\n" +
          "  cd backend && npm run db:migrate:deploy\n" +
          "Or run in Supabase → SQL Editor:\n" +
          '  ALTER TYPE "Role" ADD VALUE IF NOT EXISTS \'SUPER_ADMIN\';\n',
      );
      process.exit(1);
    }
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
