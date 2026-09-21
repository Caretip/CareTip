/**
 * Add login-ready staff to the Phase26 E2E business (mgr_p26_1786691378148).
 * Avatars upload from repo template/ → Supabase (deterministic keys).
 *
 * Run from backend: npx tsx scripts/seed-phase26-extra-staff.ts
 */
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  MANAGER_EMAIL,
  PHASE26_PASSWORD,
  PHASE26_STAFF_PROFILES,
  TAG,
  uploadPhase26StaffAvatar,
} from "./phase26StaffProfiles.js";

/** Seeded via upsert — excludes Sonwa (no login account; update via remediate script). */
const STAFF = PHASE26_STAFF_PROFILES.filter((p) => p.email != null);

async function main() {
  const manager = await prisma.user.findUnique({
    where: { email: MANAGER_EMAIL },
    include: { business: true },
  });
  if (!manager?.business) {
    throw new Error(`No business found for ${MANAGER_EMAIL}`);
  }

  const business = manager.business;
  const location = await prisma.location.findFirst({
    where: { businessId: business.id },
    select: { id: true },
  });

  const passwordHash = await bcrypt.hash(PHASE26_PASSWORD, 10);
  const created: Array<{ name: string; email: string; jobTitle: string }> = [];

  for (const s of STAFF) {
    const slug = s.slug || `${TAG}-${s.key}`.toLowerCase();
    const avatar = await uploadPhase26StaffAvatar(s.key, s.templateFile);

    const user = await prisma.user.upsert({
      where: { email: s.email! },
      update: {
        role: "EMPLOYEE",
        isActive: true,
        isPlatformAdmin: false,
        emailVerified: true,
        hasCompletedOnboarding: true,
        passwordHash,
      },
      create: {
        email: s.email!,
        passwordHash,
        role: "EMPLOYEE",
        isActive: true,
        isPlatformAdmin: false,
        emailVerified: true,
        hasCompletedOnboarding: true,
      },
    });

    await prisma.employee.upsert({
      where: { userId: user.id },
      update: {
        name: s.name,
        jobTitle: s.jobTitle,
        slug,
        bio: s.bio,
        avatar,
        phone: s.phone,
        monthlyGoal: s.monthlyGoal,
        businessId: business.id,
        locationId: location?.id ?? null,
        isActive: true,
        activationStatus: "active",
        isDeleted: false,
        deletedAt: null,
        emailNotifications: true,
        pushNotifications: true,
      },
      create: {
        name: s.name,
        jobTitle: s.jobTitle,
        slug,
        bio: s.bio,
        avatar,
        phone: s.phone,
        monthlyGoal: s.monthlyGoal,
        businessId: business.id,
        userId: user.id,
        locationId: location?.id ?? null,
        isActive: true,
        activationStatus: "active",
        emailNotifications: true,
        pushNotifications: true,
      },
    });

    created.push({ name: s.name, email: s.email!, jobTitle: s.jobTitle });
  }

  const staffCount = await prisma.employee.count({
    where: { businessId: business.id, isDeleted: false },
  });

  console.log(JSON.stringify({ businessId: business.id, businessName: business.name, staffCount, seeded: created }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
