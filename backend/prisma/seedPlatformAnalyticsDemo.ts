import "dotenv/config";
import bcrypt from "bcrypt";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

function clampInt(n: number, min: number, max: number) {
  const x = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.min(Math.max(x, min), max);
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]) {
  return arr[randInt(0, arr.length - 1)]!;
}

function makeSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 40);
}

async function main() {
  // Safety: never run unless explicitly enabled.
  if (process.env.SEED_PLATFORM_ANALYTICS_DEMO !== "true") {
    console.log(
      "Seed skipped. Set SEED_PLATFORM_ANALYTICS_DEMO=true to generate demo analytics data.",
    );
    return;
  }

  const days = clampInt(Number(process.env.SEED_DAYS ?? 45), 14, 120);
  /** Default 0 — `npm run db:seed` already provisions 5 curated demo businesses. */
  const businessesCount = clampInt(Number(process.env.SEED_BUSINESSES ?? 0), 0, 15);
  const defaultPassword = process.env.SEED_PASSWORD?.trim();
  if (!defaultPassword) {
    throw new Error(
      "Set SEED_PASSWORD before running the platform analytics demo seed. No default password is allowed.",
    );
  }
  if (defaultPassword.length < 12) {
    throw new Error("SEED_PASSWORD must be at least 12 characters.");
  }
  const platformAdminEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (!platformAdminEmail) {
    throw new Error("Set SEED_PLATFORM_ADMIN_EMAIL before running the platform analytics demo seed.");
  }
  const demoManagerEmail = process.env.SEED_DEMO_MANAGER_EMAIL?.trim().toLowerCase();
  const demoEmployeeEmail = process.env.SEED_DEMO_EMPLOYEE_EMAIL?.trim().toLowerCase();
  if (!demoManagerEmail || !demoEmployeeEmail) {
    throw new Error(
      "Set SEED_DEMO_MANAGER_EMAIL and SEED_DEMO_EMPLOYEE_EMAIL (must match your main demo seed accounts).",
    );
  }
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  console.log(
    "Platform analytics supplement: optional extra businesses/tips. Main demo uses `npm run db:seed` (5 businesses × 5 staff).",
  );

  if (businessesCount === 0) {
    console.log("SEED_BUSINESSES=0 — skipping synthetic business creation; adding platform-wide tip volume only.");
  }

  // Ensure the platform admin exists and is active.
  await prisma.user.upsert({
    where: { email: platformAdminEmail },
    update: { role: "SUPER_ADMIN", isPlatformAdmin: true, isActive: true, emailVerified: true },
    create: {
      email: platformAdminEmail,
      passwordHash,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      isActive: true,
      emailVerified: true,
    },
  });

  // Do not overwrite the curated Brasserie demo — only ensure accounts exist if main seed was skipped.

  const demoManager = await prisma.user.findUnique({ where: { email: demoManagerEmail } });
  const demoBusiness = demoManager
    ? await prisma.business.findUnique({ where: { userId: demoManager.id } })
    : null;
  const demoEmployee = await prisma.employee.findFirst({
    where: { user: { email: demoEmployeeEmail } },
    select: { id: true },
  });

  if (!demoBusiness || !demoEmployee) {
    console.warn(
      "Walkthrough demo not found. Run `npm run db:seed` first for the curated 5-business demo environment.",
    );
  }

  const businessNames = [
    "Cafe Sonnenberg",
    "The Copper Spoon",
    "Bistro Linden",
    "Hotel Aurora",
    "Salon Nova",
    "Brasserie Hafenblick",
    "Riverside Grill",
    "Olive & Thyme",
    "Kaffeehaus Mitte",
    "Skyline Lounge",
    "La Piazza",
  ] as const;

  const employeeFirstNames = [
    "Sarah",
    "Marcus",
    "Elena",
    "Noah",
    "Amina",
    "Luca",
    "Mia",
    "Jonas",
    "Sofia",
    "Tariq",
    "Isla",
    "Kai",
    "Lea",
    "Nina",
    "Omar",
  ] as const;

  const employeeLastNames = [
    "Chen",
    "Johnson",
    "Rodriguez",
    "Müller",
    "Schmidt",
    "Klein",
    "Weber",
    "Fischer",
    "Wagner",
    "Hoffmann",
    "Dubois",
    "Rossi",
    "Silva",
    "Nowak",
  ] as const;

  const jobTitles = ["Server", "Bartender", "Host", "Barista", "Reception"] as const;

  const createdBusinesses: Array<{ id: string; name: string }> = [];
  const createdEmployees: Array<{ id: string; businessId: string }> = [];

  for (let i = 0; i < businessesCount; i += 1) {
    const name = businessNames[i % businessNames.length]!;
    const slug = `${makeSlug(name)}-${i + 1}`;
    const ownerEmail = `owner+${slug}@caretip.de`;

    const owner = await prisma.user.upsert({
      where: { email: ownerEmail },
      update: { role: "MANAGER", isPlatformAdmin: false, isActive: true, emailVerified: true },
      create: {
        email: ownerEmail,
        passwordHash,
        role: "MANAGER",
        isPlatformAdmin: false,
        isActive: true,
        emailVerified: true,
      },
    });

    const business = await prisma.business.upsert({
      where: { userId: owner.id },
      update: { name, slug, verificationStatus: "verified" },
      create: {
        name,
        slug,
        verificationStatus: "verified",
        userId: owner.id,
        inviteCode: `DEMO${String(i + 1).padStart(2, "0")}`,
        subscriptionTier: "premium",
      },
    });

    createdBusinesses.push({ id: business.id, name: business.name });

    const employeesForBiz = randInt(4, 8);
    for (let j = 0; j < employeesForBiz; j += 1) {
      const fullName = `${pick(employeeFirstNames)} ${pick(employeeLastNames)}`;
      const empEmail = `staff+${slug}-${j + 1}@caretip.de`;
      const user = await prisma.user.upsert({
        where: { email: empEmail },
        update: { role: "EMPLOYEE", isPlatformAdmin: false, isActive: true, emailVerified: true },
        create: {
          email: empEmail,
          passwordHash,
          role: "EMPLOYEE",
          isPlatformAdmin: false,
          isActive: true,
          emailVerified: true,
        },
      });

      const employee = await prisma.employee.upsert({
        where: { userId: user.id },
        update: { name: fullName, jobTitle: pick(jobTitles), businessId: business.id },
        create: {
          name: fullName,
          jobTitle: pick(jobTitles),
          businessId: business.id,
          userId: user.id,
          activationStatus: "active",
          isActive: true,
        },
      });

      createdEmployees.push({ id: employee.id, businessId: business.id });
    }
  }

  if (createdEmployees.length === 0) {
    const existing = await prisma.employee.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, businessId: true },
      take: 200,
    });
    createdEmployees.push(...existing);
  }

  if (createdEmployees.length === 0) {
    console.log("No employees available for analytics supplement — run `npm run db:seed` first.");
    return;
  }

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  // Generate realistic activity: some days quiet, weekends busier.
  const transactions: Array<{
    amount: number;
    status: "success" | "pending" | "failed";
    payoutStatus: "pending" | "failed" | "not_applicable";
    employeeId: string;
    businessId: string;
    createdAt: Date;
  }> = [];

  for (let di = 0; di < days; di += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + di);
    const dow = day.getDay(); // 0 Sun ... 6 Sat
    const weekendBoost = dow === 0 || dow === 5 || dow === 6 ? 1.35 : 1.0;

    const base = randInt(18, 45); // platform-wide transactions/day baseline
    const dayTxCount = Math.max(0, Math.floor(base * weekendBoost + randInt(-8, 10)));

    for (let t = 0; t < dayTxCount; t += 1) {
      const emp = pick(createdEmployees);
      const roll = Math.random();
      const status: "success" | "pending" | "failed" =
        roll < 0.82 ? "success" : roll < 0.92 ? "pending" : "failed";
      const amount =
        Math.round(
          (Math.random() * 28 + 4 + (status === "success" ? Math.random() * 2 : 0)) * 100,
        ) / 100;

      const createdAt = new Date(day);
      createdAt.setHours(randInt(10, 23), randInt(0, 59), randInt(0, 59), 0);

      transactions.push({
        amount,
        status,
        payoutStatus: status === "success" ? "pending" : status === "failed" ? "failed" : "not_applicable",
        employeeId: emp.id,
        businessId: emp.businessId,
        createdAt,
      });
    }
  }

  // Idempotent-ish per day: remove prior seed tips in the same date window, then insert fresh.
  // This keeps charts stable on reruns without touching real production data (script is env-guarded).
  await prisma.transaction.deleteMany({
    where: {
      createdAt: { gte: start, lte: new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1) },
      stripePaymentIntentId: null,
      NOT: {
        OR: [{ id: { startsWith: "wdemotip" } }, { id: { startsWith: "demotip-" } }],
      },
    },
  });
  if (transactions.length > 0) {
    await prisma.transaction.createMany({ data: transactions });
  }

  // Ensure demo@caretip.de / employee@caretip.de dashboards always show tips + goal in the *current month*.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0, 0));
  if (demoEmployee && demoBusiness) {
    const existingDemoGoal = await prisma.employeeGoal.findFirst({
      where: { employeeId: demoEmployee.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (existingDemoGoal) {
      await prisma.employeeGoal.update({
        where: { id: existingDemoGoal.id },
        data: {
          name: "Monthly tip goal",
          goalAmount: 350,
          goalPeriod: "monthly",
          startDate: monthStart,
          status: "active",
        },
      });
    } else {
      await prisma.employeeGoal.create({
        data: {
          employeeId: demoEmployee.id,
          name: "Monthly tip goal",
          goalAmount: 350,
          goalPeriod: "monthly",
          startDate: monthStart,
          status: "active",
        },
      });
    }

    const demoTips: Array<{
      id: string;
      amount: number;
      status: "success" | "pending" | "failed";
      payoutStatus: "pending" | "failed" | "not_applicable";
      employeeId: string;
      businessId: string;
      createdAt: Date;
      stripePaymentIntentId: string | null;
    }> = [];
    for (let i = 0; i < 18; i += 1) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - (i % 12));
      d.setUTCHours(12 + (i % 6), 10 + (i % 40), 0, 0);
      const roll = i % 10;
      const status: "success" | "pending" | "failed" = roll < 8 ? "success" : roll === 8 ? "pending" : "failed";
      demoTips.push({
        id: `seed-demo-tip-${String(i + 1).padStart(3, "0")}`,
        amount: Math.round((6 + Math.random() * 22) * 100) / 100,
        status,
        payoutStatus: status === "success" ? "pending" : status === "failed" ? "failed" : "not_applicable",
        employeeId: demoEmployee.id,
        businessId: demoBusiness.id,
        createdAt: d,
        stripePaymentIntentId: null,
      });
    }
    for (const t of demoTips) {
      await prisma.transaction.upsert({
        where: { id: t.id },
        update: {
          amount: t.amount,
          status: t.status,
          payoutStatus: t.payoutStatus,
          employeeId: t.employeeId,
          businessId: t.businessId,
          createdAt: t.createdAt,
          stripePaymentIntentId: null,
        },
        create: t,
      });
    }
  }

  console.log("Platform analytics demo seed completed.");
  console.log(`- Platform admin ensured: ${platformAdminEmail}`);
  console.log(`- Demo manager ensured: ${demoManagerEmail}`);
  console.log(`- Demo employee ensured: ${demoEmployeeEmail}`);
  console.log(`- Businesses created/updated: ${createdBusinesses.length}`);
  console.log(`- Employees created/updated: ${createdEmployees.length}`);
  console.log(`- Tips inserted: ${transactions.length}`);
  console.log(`- Range: last ${days} days`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

