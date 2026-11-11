/**
 * Scheduled jobs must be safe to declare: destructive work needs its flags, and two runs at once must
 * not process the same item. Reconciliation must never create money movement. Needs a loopback DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("REFUSING: scheduled-job-safety needs a disposable loopback database");
  process.exit(1);
}
process.env.JWT_SECRET ||= "job-safety-secret-job-safety-secret-job-safety";
for (const name of Object.keys(process.env)) if (name.startsWith("DATA_LIFECYCLE_")) delete process.env[name];

const { prisma } = await import("../src/prisma.js");
const { tickAnonymizationJobs } = await import("../src/services/anonymization.service.js");
const { tickKycSecureDestroyJobs } = await import("../src/services/kycSecureDestroy.service.js");
const { tickDsarExportJobs } = await import("../src/services/dsarExport.service.js");
const { INTERNAL_JOBS } = await import("../src/config/internalJobs.manifest.js");

const rnd = () => Math.random().toString(36).slice(2, 10);
const hash = await bcrypt.hash("Runtime-Synthetic-Pw-9!x", 4);
const user = await prisma.user.create({ data: { email: `job-${rnd()}@runtime.invalid`, passwordHash: hash, role: "MANAGER", emailVerified: true, deletionRequestedAt: new Date(Date.now() - 90 * 864e5), anonymizeEligibleAt: new Date(Date.now() - 864e5), business: { create: { name: `J ${rnd()}`, slug: `j-${rnd()}` } } }, include: { business: true } });
const tip = await prisma.transaction.create({ data: { amount: 5, status: "success", businessId: user.business!.id, stripePaymentIntentId: `pi_runtime_${rnd()}` } });
const anonJob = await prisma.dataLifecycleJob.create({ data: { type: "anonymize_user", status: "pending", subjectType: "user", subjectId: user.id } });
const kycJob = await prisma.dataLifecycleJob.create({ data: { type: "kyc_secure_destroy", status: "pending", subjectType: "business", subjectId: user.business!.id } });

// No flags: destructive ticks change nothing.
await tickAnonymizationJobs();
await tickKycSecureDestroyJobs();
const after = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true, anonymizedAt: true } });
assert.equal(after?.email, user.email, "no erasure without its flags");
assert.equal(after?.anonymizedAt, null);
assert.equal((await prisma.dataLifecycleJob.findUnique({ where: { id: anonJob.id } }))?.status, "pending", "erasure stays queued");
assert.equal((await prisma.dataLifecycleJob.findUnique({ where: { id: kycJob.id } }))?.status, "pending", "KYC destruction stays queued");
assert.equal(await prisma.transaction.count({ where: { id: tip.id } }), 1, "financial record kept");
console.log("PASS destructive jobs do nothing without their flags");

// Two runs at once: one export job is built once.
const owner = await prisma.user.create({ data: { email: `dsar-${rnd()}@runtime.invalid`, passwordHash: hash, role: "MANAGER", emailVerified: true, business: { create: { name: `D ${rnd()}`, slug: `d-${rnd()}` } } } });
const dsar = await prisma.dataLifecycleJob.create({ data: { type: "dsar_export", status: "pending", subjectType: "user", subjectId: owner.id, payload: {} } });
await Promise.all([tickDsarExportJobs(), tickDsarExportJobs(), tickDsarExportJobs()]);
const finished = await prisma.dataLifecycleJob.findUnique({ where: { id: dsar.id } });
assert.ok(finished && finished.attempts <= 1, `one claim only, saw ${finished?.attempts} attempts`);
assert.notEqual(finished?.status, "pending");
console.log("PASS concurrent runs claim a job once");

// Reconciliation jobs must not be able to create money movement.
const here = dirname(fileURLToPath(import.meta.url));
for (const file of ["stripeConnectPayoutReconciliation.service.ts", "businessDistributionIntegrity.service.ts", "employeeTipReleaseReconciliation.service.ts"]) {
  const src = readFileSync(join(here, "../src/services", file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.ok(!/\.(transfers|payouts|refunds|charges|paymentIntents)\.create\(/.test(src), `${file} must not create Stripe money objects`);
}
console.log("PASS reconciliation cannot create money movement");

for (const job of INTERNAL_JOBS.filter((j) => j.destructive)) assert.ok(job.gate?.length, job.path);
console.log("scheduled-job-safety: ok");
await prisma.$disconnect();
process.exit(0);
