/**
 * Seed tips, feedback, and goals for Jordan, Luca, and Maria on the Phase26 E2E venue.
 * Run from backend: npx tsx scripts/seed-phase26-trio-ops.ts
 */
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const TAG = "p26_1786691378148";
const EMAILS = [
  `jordan.${TAG}@caretip-test.local`,
  `luca.${TAG}@caretip-test.local`,
  `maria.${TAG}@caretip-test.local`,
] as const;

const AMOUNTS = [5, 8, 10, 12, 15, 20];
const COMMENTS = [
  "Wonderful service, thank you.",
  "Friendly and professional all evening.",
  "Took great care of our table.",
];
const TAGS = ["Excellent service", "Very friendly", "Attentive"];

function daysAgo(n: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 12, 0, 0);
  return d;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { in: [...EMAILS] } },
    include: {
      employee: true,
    },
  });

  if (users.length !== 3) {
    throw new Error(`Expected 3 employees, found ${users.length}. Seed staff first.`);
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(12, 0, 0, 0);

  const summary: Array<{ email: string; tips: number; feedback: number }> = [];

  for (const user of users) {
    const emp = user.employee;
    if (!emp) throw new Error(`No employee row for ${user.email}`);

    const key = user.email.split(".")[0]!;
    const loc = emp.locationId;
    const table = loc
      ? await prisma.table.findFirst({ where: { locationId: loc }, select: { id: true } })
      : null;

    const existingGoal = await prisma.employeeGoal.findFirst({
      where: { employeeId: emp.id },
      orderBy: { updatedAt: "desc" },
    });
    const goalAmount = emp.monthlyGoal ?? 450;
    if (existingGoal) {
      await prisma.employeeGoal.update({
        where: { id: existingGoal.id },
        data: { goalAmount, goalPeriod: "monthly", startDate: monthStart, status: "active" },
      });
    } else {
      await prisma.employeeGoal.create({
        data: {
          employeeId: emp.id,
          name: "Monthly tips",
          goalAmount,
          goalPeriod: "monthly",
          startDate: monthStart,
          status: "active",
        },
      });
    }

    await prisma.transaction.deleteMany({
      where: {
        employeeId: emp.id,
        stripePaymentIntentId: { startsWith: `pi_seed_${TAG}_${key}_` },
      },
    });

    let tips = 0;
    let feedback = 0;
    for (let i = 0; i < 10; i++) {
      const pi = `pi_seed_${TAG}_${key}_${String(i + 1).padStart(2, "0")}`;
      const receipt = `CT-26-${key.slice(0, 3).toUpperCase()}${String(i + 1).padStart(2, "0")}${TAG.slice(-4)}`;
      const amount = AMOUNTS[i % AMOUNTS.length]!;
      const createdAt = daysAgo(1 + (i % 12), 11 + (i % 8));

      const tx = await prisma.transaction.create({
        data: {
          amount,
          status: "success",
          payoutStatus: "pending",
          stripePaymentIntentId: pi,
          receiptNumber: receipt,
          employeeId: emp.id,
          businessId: emp.businessId,
          locationId: loc,
          tableId: table?.id ?? null,
          createdAt,
        },
      });
      tips++;

      if (i % 2 === 0) {
        await prisma.tipFeedback.create({
          data: {
            transactionId: tx.id,
            businessId: emp.businessId,
            employeeId: emp.id,
            locationId: loc,
            tableId: table?.id ?? null,
            rating: 4 + (i % 2),
            comment: COMMENTS[i % COMMENTS.length]!,
            tags: [TAGS[i % TAGS.length]!],
            customerName: null,
            createdAt,
          },
        });
        feedback++;
      }
    }

    summary.push({ email: user.email, tips, feedback });
  }

  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
