/**
 * Child process: release held payables with mocked Stripe (stdout JSON result).
 * Usage: tsx employee-transfer-release-concurrency-worker.ts <employeeId> <payableId>
 *
 * Parent should set CARETIP_EMP_TIP_STRIPE_CREATE_AUDIT_FILE for cross-process create counts.
 * Disposable Postgres only (CARETIP_ISOLATED_POSTGRES_URL); never the .env database.
 */
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

const employeeId = process.argv[2]?.trim();
const payableId = process.argv[3]?.trim();
if (!employeeId || !payableId) {
  console.error("missing employeeId or payableId");
  process.exit(2);
}

await completeIsolatedPostgresBootstrap();
const { __setEmployeeTipTransferCreateFnForTests, releaseHeldPlatformPayablesForEmployee } = await import(
  "../src/services/employeeTipRelease.service.js"
);
const { clearMockEmployeeTipStripeTransferList, installMockEmptyEmployeeTipTransferList } = await import(
  "./lib/mockEmployeeTipStripeTransferList.js"
);

installMockEmptyEmployeeTipTransferList();
__setEmployeeTipTransferCreateFnForTests(async (params) => {
  await new Promise((r) => setTimeout(r, 50 + Math.floor(Math.random() * 80)));
  return { id: `tr_worker_${process.pid}`, amount: params.amount ?? 900 };
});

try {
  const result = await releaseHeldPlatformPayablesForEmployee(employeeId);
  console.log(
    JSON.stringify({
      pid: process.pid,
      payableId,
      result,
    }),
  );
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  __setEmployeeTipTransferCreateFnForTests(null);
  clearMockEmployeeTipStripeTransferList();
}
