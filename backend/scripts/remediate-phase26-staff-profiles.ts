/**
 * In-place Phase26 staff profile refresh for Maria Testerin only.
 * Updates display names + avatars (repo template/ → Supabase). Preserves IDs, emails, slugs, tips.
 *
 * Run from backend:
 *   npx tsx scripts/remediate-phase26-staff-profiles.ts
 *   npx tsx scripts/remediate-phase26-staff-profiles.ts --dry-run
 */
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import {
  MANAGER_EMAIL,
  PHASE26_STAFF_PROFILES,
  uploadPhase26StaffAvatar,
} from "./phase26StaffProfiles.js";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const manager = await prisma.user.findUnique({
    where: { email: MANAGER_EMAIL },
    include: { business: true },
  });

  if (!manager?.business) {
    throw new Error(`No business found for manager ${MANAGER_EMAIL}`);
  }

  const business = manager.business;
  if (manager.email !== MANAGER_EMAIL) {
    throw new Error("Manager email guard failed.");
  }

  const employees = await prisma.employee.findMany({
    where: { businessId: business.id, isDeleted: false },
    select: { id: true, slug: true, name: true, userId: true },
  });

  if (employees.length !== PHASE26_STAFF_PROFILES.length) {
    throw new Error(
      `Expected ${PHASE26_STAFF_PROFILES.length} active employees, found ${employees.length}. Aborting.`,
    );
  }

  const bySlug = new Map(employees.map((e) => [e.slug ?? "", e]));
  const results: Array<{
    slug: string;
    employeeId: string;
    previousName: string;
    newName: string;
    avatarUploaded: boolean;
    tableAssignmentsUpdated: number;
  }> = [];

  for (const profile of PHASE26_STAFF_PROFILES) {
    const employee = bySlug.get(profile.slug);
    if (!employee) {
      throw new Error(`Missing employee slug ${profile.slug} on business ${business.id}`);
    }

    let avatarUrl: string | undefined;
    if (!dryRun) {
      avatarUrl = await uploadPhase26StaffAvatar(profile.key, profile.templateFile);
      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          name: profile.name,
          avatar: avatarUrl,
        },
      });

      const tableUpdate = await prisma.employeeTableAssignment.updateMany({
        where: { employeeId: employee.id },
        data: { employeeName: profile.name },
      });

      results.push({
        slug: profile.slug,
        employeeId: employee.id,
        previousName: employee.name,
        newName: profile.name,
        avatarUploaded: true,
        tableAssignmentsUpdated: tableUpdate.count,
      });
    } else {
      results.push({
        slug: profile.slug,
        employeeId: employee.id,
        previousName: employee.name,
        newName: profile.name,
        avatarUploaded: false,
        tableAssignmentsUpdated: 0,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        businessId: business.id,
        businessName: business.name,
        managerEmail: MANAGER_EMAIL,
        updated: results,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
