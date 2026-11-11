/** Financial writes must never be replayed automatically after an ambiguous network failure. */
import assert from "node:assert/strict";
import { isUnsafeToReplay } from "../src/app/lib/api";

const unsafe: Array<[string, string]> = [
  ["/api/me/connect/instant-payout", "POST"],
  ["/api/me/employee-connect/instant-payout", "POST"],
  ["/api/me/connect/bank-payout-schedule", "PATCH"],
  ["/api/me/connect/employee-tip-payout-mode", "PATCH"],
  ["/api/me/connect/tip-distribution/batches", "POST"],
  ["/api/me/billing/checkout", "POST"],
  ["/api/me/billing/cancel", "POST"],
  ["/api/business/physical-qr/orders/abc/checkout", "POST"],
  ["/api/payments/create-tip-session", "POST"],
];
for (const [path, method] of unsafe) assert.equal(isUnsafeToReplay(path, method), true, path);

const safe: Array<[string, string | undefined]> = [
  ["/api/me/connect/financial-summary", "GET"],
  ["/api/me/billing", undefined],
  ["/api/me/connect/instant-payout", "GET"],
  ["/api/auth/signin", "POST"],
  ["/api/me/notifications/setup/evaluate", "POST"],
];
for (const [path, method] of safe) assert.equal(isUnsafeToReplay(path, method), false, path);

console.log("financial-write-no-replay: ok");
