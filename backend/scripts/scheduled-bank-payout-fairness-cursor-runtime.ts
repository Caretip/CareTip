/**
 * Phase D2 hardening — cursor CAS + legacy fallback (mocked store, no DB).
 */
import type { ScheduledPayoutFairnessCursor } from "../src/services/scheduledBankPayoutFairSelection.js";
import type { FairnessCursorExpected } from "../src/services/scheduledBankPayoutFairnessCursor.service.js";
import {
  __resetScheduledPayoutFairnessCursorStateForTests,
  __setScheduledPayoutFairnessCursorStoreForTests,
  compareAndSwapScheduledPayoutFairnessCursor,
  cursorsEqual,
  getScheduledPayoutFairnessCursorRotationMode,
  isMissingFairnessCursorTableError,
  loadScheduledPayoutFairnessCursorWithExpected,
  notifyScheduledPayoutFairnessCursorLegacyFallback,
} from "../src/services/scheduledBankPayoutFairnessCursor.service.js";
import {
  simulateFairDueTicks,
  sortDueAccountRefs,
  type DueScheduledPayoutAccountRef,
} from "../src/services/scheduledBankPayoutFairSelection.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

type Row = ScheduledPayoutFairnessCursor;

function createMemoryStore() {
  const rows = new Map<string, Row>();
  return {
    loadWithExpected: async (stream: string) => {
      const row = rows.get(stream);
      if (!row) return { cursor: null, expected: { kind: "absent" as const } };
      return {
        cursor: { ...row },
        expected: {
          kind: "present" as const,
          anchorDueAt: row.anchorDueAt,
          anchorAccountId: row.anchorAccountId,
        },
      };
    },
    compareAndSwap: async (
      stream: string,
      expected: FairnessCursorExpected,
      next: ScheduledPayoutFairnessCursor,
    ) => {
      const current = rows.get(stream);
      if (expected.kind === "absent") {
        if (current) return { status: "stale_rejected" as const };
        rows.set(stream, { ...next });
        return { status: "saved" as const };
      }
      if (!current) return { status: "stale_rejected" as const };
      if (
        current.anchorDueAt.getTime() !== expected.anchorDueAt.getTime() ||
        current.anchorAccountId !== expected.anchorAccountId
      ) {
        return { status: "stale_rejected" as const };
      }
      rows.set(stream, { ...next });
      return { status: "saved" as const };
    },
    rows,
  };
}

__resetScheduledPayoutFairnessCursorStateForTests();

// --- missing table vs permission ---
assert(
  isMissingFairnessCursorTableError({ code: "P2021" }),
  "P2021 is missing table",
);
assert(
  isMissingFairnessCursorTableError({ code: "42P01" }),
  "42P01 is missing table",
);
assert(!isMissingFairnessCursorTableError({ code: "P2002" }), "P2002 not missing table");
assert(!isMissingFairnessCursorTableError({ code: "42501" }), "permission not missing table");

// --- legacy notification once ---
notifyScheduledPayoutFairnessCursorLegacyFallback("test_load");
assert(
  getScheduledPayoutFairnessCursorRotationMode() === "legacy_unavailable",
  "legacy mode set",
);
notifyScheduledPayoutFairnessCursorLegacyFallback("test_again");
assert(getScheduledPayoutFairnessCursorRotationMode() === "legacy_unavailable", "still legacy");

__resetScheduledPayoutFairnessCursorStateForTests();
assert(getScheduledPayoutFairnessCursorRotationMode() === "durable", "reset durable");

// --- CAS stale writer ---
const mem = createMemoryStore();
__setScheduledPayoutFairnessCursorStoreForTests(mem);

const c0: ScheduledPayoutFairnessCursor = {
  anchorDueAt: new Date("2026-01-01T09:00:00.000Z"),
  anchorAccountId: "biz_a",
};
const c1: ScheduledPayoutFairnessCursor = {
  anchorDueAt: new Date("2026-01-02T09:00:00.000Z"),
  anchorAccountId: "biz_b",
};
const c2: ScheduledPayoutFairnessCursor = {
  anchorDueAt: new Date("2026-01-03T09:00:00.000Z"),
  anchorAccountId: "biz_c",
};

const tickA = await loadScheduledPayoutFairnessCursorWithExpected("business");
const tickB = await loadScheduledPayoutFairnessCursorWithExpected("employee");
assert(tickA.expected.kind === "absent" && tickB.expected.kind === "absent", "isolated streams");

const first = await compareAndSwapScheduledPayoutFairnessCursor("business", { kind: "absent" }, c0);
assert(first.status === "saved", "bootstrap save");

const staleLoad = await loadScheduledPayoutFairnessCursorWithExpected("business");
const staleWriterExpected = staleLoad.expected;
assert(staleWriterExpected.kind === "present", "expected present");

await compareAndSwapScheduledPayoutFairnessCursor("business", staleWriterExpected, c1);
const fast = await compareAndSwapScheduledPayoutFairnessCursor(
  "business",
  staleWriterExpected,
  c2,
);
assert(fast.status === "stale_rejected", "stale writer rejected");

const current = mem.rows.get("business")!;
assert(cursorsEqual(current, c1), "newer cursor not overwritten by stale");

const reload = await loadScheduledPayoutFairnessCursorWithExpected("business");
const progress = await compareAndSwapScheduledPayoutFairnessCursor(
  "business",
  reload.expected,
  c2,
);
assert(progress.status === "saved", "next tick progresses after stale reject");
assert(cursorsEqual(mem.rows.get("business")!, c2), "cursor advanced");

// --- concurrent bootstrap ---
mem.rows.clear();
const boot1 = await compareAndSwapScheduledPayoutFairnessCursor("employee", { kind: "absent" }, c0);
const boot2 = await compareAndSwapScheduledPayoutFairnessCursor("employee", { kind: "absent" }, c1);
assert(boot1.status === "saved" && boot2.status === "stale_rejected", "concurrent bootstrap");

// --- H2 finite set wrap revisits earlier keys ---
const early: DueScheduledPayoutAccountRef[] = [
  { accountId: "early_1", dueAt: new Date("2026-01-01T08:00:00.000Z") },
  { accountId: "early_2", dueAt: new Date("2026-01-01T08:00:00.000Z") },
];
const tail = Array.from({ length: 8 }, (_, i) => ({
  accountId: `tail_${i}`,
  dueAt: new Date("2026-01-05T09:00:00.000Z"),
}));
const ring = sortDueAccountRefs([...early, ...tail]);
const wrapSim = simulateFairDueTicks({
  dueAccounts: ring,
  maxAccountsPerTick: 5,
  batchSize: 5,
  tickCount: 4,
  process: () => "unchanged",
});
assert(
  (wrapSim.attemptsByAccount.get("early_1") ?? 0) >= 1,
  "earlier sort keys revisited after tail traversal",
);
assert(wrapSim.wrapCount >= 1, "wrap occurred");

__setScheduledPayoutFairnessCursorStoreForTests(null);
__resetScheduledPayoutFairnessCursorStateForTests();

console.log("scheduled-bank-payout-fairness-cursor-runtime: ok");
