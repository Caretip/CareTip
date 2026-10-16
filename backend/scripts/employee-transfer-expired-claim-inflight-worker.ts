/**
 * Child process for expired-claim / in-flight Stripe race tests.
 * Usage: tsx employee-transfer-expired-claim-inflight-worker.ts <employeeId> <payableId>
 *
 * Parent sets:
 * - CARETIP_EMP_TIP_STRIPE_CREATE_AUDIT_FILE
 * - CARETIP_EMP_TIP_CREATE_BARRIER_FILE (optional — blocks until file contains "release")
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
  return { id: `tr_inflight_${process.pid}`, amount: params.amount ?? 900 };
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
