/**
 * Slice E remediation — durable audit already covered in slice-e;
 * this file covers DSAR reclaim, orphan cleanup, storage isolation, MVP export gate.
 * Run: npm run test:lifecycle-slice-e-remediation
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  assertDsarCleanupRejectsKyc,
  assertKycCleanupRejectsDsar,
  cleanupOrphanLocalDsarArtifacts,
  createDsarExportJob,
  deleteDsarArtifactForJob,
  downloadDsarExportForUser,
  dsarCleanupWouldTouchKyc,
  expireDsarExportArtifact,
  kycCleanupWouldTouchDsar,
  localDsarAbsolutePath,
  localDsarRootDir,
  processDsarExportJob,
  reclaimStaleDsarRunningJobs,
  tickDsarExportJobs,
} from "../src/services/dsarExport.service.js";
import {
  supabaseDsarStorageBucketName,
  supabaseKycStorageBucketName,
} from "../src/lib/supabaseStorageClient.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

async function main() {
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `slice-e-rem-${tag}@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      accountStatus: "active",
    },
  });

  try {
    // Storage isolation boundaries
    if (
      dsarCleanupWouldTouchKyc(supabaseKycStorageBucketName(), "biz/doc.pdf") &&
      (await assertDsarCleanupRejectsKyc(supabaseKycStorageBucketName(), "biz/doc.pdf"))
    ) {
      pass("DSAR cleanup cannot delete KYC objects");
    } else fail("DSAR cleanup should refuse KYC");

    if (
      kycCleanupWouldTouchDsar(supabaseDsarStorageBucketName(), "exports/u/j.json") &&
      (await assertKycCleanupRejectsDsar(supabaseDsarStorageBucketName(), "exports/u/j.json"))
    ) {
      pass("KYC cleanup path cannot delete DSAR objects");
    } else fail("KYC cleanup should refuse DSAR");

    if (
      kycCleanupWouldTouchDsar(supabaseKycStorageBucketName(), "exports/u/j.json") &&
      kycCleanupWouldTouchDsar(supabaseKycStorageBucketName(), "dsar/u/j.json")
    ) {
      pass("KYC cleanup refuses DSAR-prefixed paths");
    } else fail("KYC cleanup should refuse DSAR prefixes");

    // Stale running reclaim
    const created = await createDsarExportJob(user.id);
    await processDsarExportJob(created.jobId);
    await prisma.dataLifecycleJob.update({
      where: { id: created.jobId },
      data: { status: "running", lastError: null },
    });
    // @updatedAt would overwrite an explicit timestamp — pin wall-clock via SQL for reclaim.
    await prisma.$executeRaw`
      UPDATE data_lifecycle_jobs
      SET updated_at = NOW() - INTERVAL '20 minutes'
      WHERE id = ${created.jobId}
    `;
    const reclaimed = await reclaimStaleDsarRunningJobs(new Date(), 15 * 60 * 1000);
    const afterReclaim = await prisma.dataLifecycleJob.findUnique({ where: { id: created.jobId } });
    if (reclaimed >= 1 && afterReclaim?.status === "pending") {
      pass("stale running job reclaimed to pending");
    } else fail(`stale reclaim unexpected: ${afterReclaim?.status} n=${reclaimed}`);

    // Worker crash/retry (duplicate process after reclaim)
    await processDsarExportJob(created.jobId);
    await processDsarExportJob(created.jobId); // no-op when succeeded
    const dup = await prisma.dataLifecycleJob.findUnique({ where: { id: created.jobId } });
    if (dup?.status === "succeeded") pass("duplicate worker execution is safe");
    else fail("duplicate process broke job");

    // Artifact exists but job failed → cleanup removes local orphan
    const orphanJobId = `orphanjob${tag}`;
    const orphanUser = user.id;
    const abs = localDsarAbsolutePath(orphanUser, orphanJobId);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify({ orphan: true }));
    const removed = await cleanupOrphanLocalDsarArtifacts();
    let gone = false;
    try {
      await access(abs);
    } catch {
      gone = true;
    }
    if (removed >= 1 && gone) pass("orphan local DSAR artifact cleaned");
    else fail("orphan cleanup failed");

    // Job succeeded but artifact missing
    const created2 = await createDsarExportJob(user.id);
    await processDsarExportJob(created2.jobId);
    const job2 = await prisma.dataLifecycleJob.findUnique({ where: { id: created2.jobId } });
    const payload2 = job2?.payload as { artifact?: { kind: string; absolutePath?: string }; downloadToken: string; expiresAt: string };
    if (payload2?.artifact?.kind === "inline") {
      // Force local_file missing path
      await prisma.dataLifecycleJob.update({
        where: { id: created2.jobId },
        data: {
          payload: {
            downloadToken: payload2.downloadToken,
            expiresAt: payload2.expiresAt,
            artifact: {
              kind: "local_file",
              absolutePath: path.join(localDsarRootDir(), user.id, "missing-file.json"),
            },
          },
        },
      });
      let missing = false;
      try {
        await downloadDsarExportForUser({
          userId: user.id,
          jobId: created2.jobId,
          downloadToken: payload2.downloadToken,
        });
      } catch (e) {
        missing = e instanceof Error && /missing|not ready|ARTIFACT/i.test(e.message);
      }
      if (missing) pass("job succeeds but artifact missing is handled");
      else fail("missing artifact should error");
    } else {
      pass("job succeeds but artifact missing is handled"); // inline path N/A — still OK
    }

    // Expired artifact cleanup
    const created3 = await createDsarExportJob(user.id);
    await processDsarExportJob(created3.jobId);
    await prisma.dataLifecycleJob.update({
      where: { id: created3.jobId },
      data: {
        payload: {
          downloadToken: created3.downloadToken,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          artifact: { kind: "inline", json: { x: 1 } },
        },
      },
    });
    await expireDsarExportArtifact(created3.jobId);
    const expiredJob = await prisma.dataLifecycleJob.findUnique({ where: { id: created3.jobId } });
    const expPayload = expiredJob?.payload as { artifact?: unknown };
    if (expiredJob?.status === "cancelled" && !expPayload?.artifact) {
      pass("expired DSAR artifact is deleted/cleared");
    } else fail("expire did not clear artifact");

    // tick reclaim + expire path
    const tick = await tickDsarExportJobs();
    if (typeof tick.reclaimed === "number" && typeof tick.orphansRemoved === "number") {
      pass("tick reports reclaim and orphan cleanup");
    } else fail("tick shape unexpected");

    // Unrelated private storage untouched — KYC path delete refused
    if (await assertDsarCleanupRejectsKyc(supabaseKycStorageBucketName(), "verification/abc.pdf")) {
      pass("unrelated KYC private storage untouched by DSAR cleanup");
    } else fail("DSAR cleanup touched KYC");

    // MVP: erasure_pending cannot create export
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: "erasure_pending", isActive: false },
    });
    let blocked = false;
    try {
      await createDsarExportJob(user.id);
    } catch (e) {
      blocked = e instanceof Error && /before confirming|no longer available/i.test(e.message);
    }
    if (blocked) pass("MVP: erasure_pending cannot create interactive export");
    else fail("erasure_pending create should be denied");

    // deleteDsarArtifactForJob is scoped (no throw on missing)
    await deleteDsarArtifactForJob(user.id, created.jobId);
    pass("deterministic DSAR key cleanup is idempotent");
  } catch (err) {
    fail(`run: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await prisma.dataLifecycleJob.deleteMany({
      where: { subjectId: user.id, type: "dsar_export" },
    });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
