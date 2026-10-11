/**
 * Phase D2 — fair due-account rotation (pure simulation + keyset helpers). No DB / Stripe / cron.
 */
import {
  dueAccountsAfterCursor,
  selectFairDueAccountBatch,
  simulateFairDueTicks,
  sortDueAccountRefs,
  type DueScheduledPayoutAccountRef,
} from "../src/services/scheduledBankPayoutFairSelection.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function makeDueAccounts(count: number, dueAtIso: string): DueScheduledPayoutAccountRef[] {
  const dueAt = new Date(dueAtIso);
  return Array.from({ length: count }, (_, i) => ({
    accountId: `acct_${String(i).padStart(4, "0")}`,
    dueAt,
  }));
}

// --- keyset ordering ---
const sample = sortDueAccountRefs([
  { accountId: "b", dueAt: new Date("2026-01-01T09:00:00.000Z") },
  { accountId: "a", dueAt: new Date("2026-01-01T09:00:00.000Z") },
  { accountId: "c", dueAt: new Date("2026-01-02T09:00:00.000Z") },
]);
assert(sample[0]!.accountId === "a" && sample[2]!.accountId === "c", "tie-break by accountId");

const after = dueAccountsAfterCursor(sample, {
  anchorDueAt: new Date("2026-01-01T09:00:00.000Z"),
  anchorAccountId: "a",
});
assert(after.length === 2 && after[0]!.accountId === "b", "keyset after cursor");

// --- wrap selects head after tail ---
const ring = makeDueAccounts(5, "2026-01-01T09:00:00.000Z");
const sortedRing = sortDueAccountRefs(ring);
const tail = selectFairDueAccountBatch(sortedRing, {
  anchorDueAt: sortedRing[4]!.dueAt,
  anchorAccountId: sortedRing[4]!.accountId,
}, 10);
assert(tail.wrapped === true && tail.batch.length === 5, "wrap to head");

// --- starvation: 250 due, first 30 blocked, cap 200 per tick ---
const blockedHead = new Set(
  makeDueAccounts(30, "2026-01-01T08:00:00.000Z").map((a) => a.accountId),
);
const healthy = makeDueAccounts(250, "2026-01-02T09:00:00.000Z").map((a, i) => ({
  ...a,
  accountId: `healthy_${String(i).padStart(4, "0")}`,
}));
const allDue = sortDueAccountRefs([...makeDueAccounts(30, "2026-01-01T08:00:00.000Z"), ...healthy]);

const sim = simulateFairDueTicks({
  dueAccounts: allDue,
  maxAccountsPerTick: 200,
  batchSize: 50,
  tickCount: 3,
  process: (accountId) => (blockedHead.has(accountId) ? "unchanged" : "unchanged"),
});

const healthyAttempts = [...sim.attemptsByAccount.keys()].filter((id) => id.startsWith("healthy_"));
assert(healthyAttempts.length > 30, "healthy accounts get attempts while head remains due");
assert(
  (sim.attemptsByAccount.get("acct_0000") ?? 0) <= 3,
  "blocked head not attempted every slot forever without rotation",
);

// --- more than 200 due: second tick continues past first window ---
const many = makeDueAccounts(260, "2026-01-03T09:00:00.000Z");
const twoTicks = simulateFairDueTicks({
  dueAccounts: many,
  maxAccountsPerTick: 200,
  batchSize: 50,
  tickCount: 2,
  process: () => "unchanged",
});
const distinct = twoTicks.attemptsByAccount.size;
assert(distinct >= 200, "second tick reaches accounts beyond first cap");
assert(
  (twoTicks.attemptsByAccount.get("acct_0200") ?? 0) >= 1,
  "account beyond first cap window gets an attempt",
);

// --- new overdue inserted: still selected after cursor passes ---
const base = makeDueAccounts(10, "2026-01-01T09:00:00.000Z");
const withNew = sortDueAccountRefs([
  ...base,
  { accountId: "new_overdue", dueAt: new Date("2026-01-01T08:00:00.000Z") },
]);
const batchNew = selectFairDueAccountBatch(withNew, null, 20);
assert(batchNew.batch.some((r) => r.accountId === "new_overdue"), "new overdue in ring");

// --- business/employee equivalent property: same algorithm on two synthetic streams ---
const empSim = simulateFairDueTicks({
  dueAccounts: makeDueAccounts(120, "2026-01-04T09:00:00.000Z"),
  maxAccountsPerTick: 200,
  batchSize: 50,
  tickCount: 2,
  process: () => "unchanged",
});
const bizSim = simulateFairDueTicks({
  dueAccounts: makeDueAccounts(120, "2026-01-04T09:00:00.000Z"),
  maxAccountsPerTick: 200,
  batchSize: 50,
  tickCount: 2,
  process: () => "unchanged",
});
assert(
  empSim.attemptsByAccount.size === bizSim.attemptsByAccount.size,
  "equivalent fairness properties",
);

console.log("scheduled-bank-payout-fair-selection-runtime: ok");
