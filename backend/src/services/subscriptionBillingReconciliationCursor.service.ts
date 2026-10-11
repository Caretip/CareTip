/**
 * Durable keyset cursor for fair subscription billing reconciliation rotation.
 */
import { prisma } from "../prisma.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";

export const BILLING_RECONCILIATION_CURSOR_STREAM = "billing_reconciliation";

export type BillingReconciliationCursor = {
  anchorCreatedAt: Date;
  anchorBusinessId: string;
};

export type BillingReconciliationCursorExpected =
  | { kind: "absent" }
  | { kind: "present"; anchorCreatedAt: Date; anchorBusinessId: string };

export type BillingReconciliationCursorCasResult =
  | { status: "saved" }
  | { status: "stale_rejected" }
  | { status: "legacy_unavailable" };

type CursorStore = {
  loadWithExpected: () => Promise<{
    cursor: BillingReconciliationCursor | null;
    expected: BillingReconciliationCursorExpected;
  }>;
  compareAndSwap: (
    expected: BillingReconciliationCursorExpected,
    next: BillingReconciliationCursor | null,
  ) => Promise<BillingReconciliationCursorCasResult>;
};

let testStore: CursorStore | null = null;
let legacyMode = false;

export function __resetBillingReconciliationCursorStateForTests(): void {
  testStore = null;
  legacyMode = false;
}

export function __setBillingReconciliationCursorStoreForTests(store: CursorStore | null): void {
  testStore = store;
}

export function isMissingBillingReconciliationCursorTableError(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
  return code === "P2021" || code === "42P01";
}

function expectedFromRow(row: BillingReconciliationCursor | null): BillingReconciliationCursorExpected {
  if (!row) return { kind: "absent" };
  return {
    kind: "present",
    anchorCreatedAt: row.anchorCreatedAt,
    anchorBusinessId: row.anchorBusinessId,
  };
}

const defaultStore: CursorStore = {
  async loadWithExpected() {
    if (legacyMode) {
      return { cursor: null, expected: { kind: "absent" } };
    }
    try {
      const row = await prisma.subscriptionBillingReconciliationCursor.findUnique({
        where: { stream: BILLING_RECONCILIATION_CURSOR_STREAM },
      });
      if (!row) return { cursor: null, expected: { kind: "absent" } };
      const cursor = {
        anchorCreatedAt: row.anchorCreatedAt,
        anchorBusinessId: row.anchorBusinessId,
      };
      return { cursor, expected: expectedFromRow(cursor) };
    } catch (err) {
      if (isMissingBillingReconciliationCursorTableError(err)) {
        legacyMode = true;
        logTrialSync("billing_reconciliation.cursor_legacy", { reason: "table_missing" });
        return { cursor: null, expected: { kind: "absent" } };
      }
      throw err;
    }
  },

  async compareAndSwap(expected, next) {
    if (legacyMode) {
      return { status: "legacy_unavailable" };
    }
    try {
      if (next === null) {
        if (expected.kind === "absent") {
          return { status: "saved" };
        }
        const deleted = await prisma.subscriptionBillingReconciliationCursor.deleteMany({
          where: {
            stream: BILLING_RECONCILIATION_CURSOR_STREAM,
            anchorCreatedAt: expected.anchorCreatedAt,
            anchorBusinessId: expected.anchorBusinessId,
          },
        });
        return deleted.count === 1 ? { status: "saved" } : { status: "stale_rejected" };
      }

      if (expected.kind === "absent") {
        try {
          await prisma.subscriptionBillingReconciliationCursor.create({
            data: {
              stream: BILLING_RECONCILIATION_CURSOR_STREAM,
              anchorCreatedAt: next.anchorCreatedAt,
              anchorBusinessId: next.anchorBusinessId,
            },
          });
          return { status: "saved" };
        } catch (err) {
          if (isMissingBillingReconciliationCursorTableError(err)) {
            legacyMode = true;
            return { status: "legacy_unavailable" };
          }
          const code =
            err && typeof err === "object" && "code" in err
              ? String((err as { code?: string }).code)
              : "";
          if (code === "P2002") {
            return { status: "stale_rejected" };
          }
          throw err;
        }
      }

      const updated = await prisma.subscriptionBillingReconciliationCursor.updateMany({
        where: {
          stream: BILLING_RECONCILIATION_CURSOR_STREAM,
          anchorCreatedAt: expected.anchorCreatedAt,
          anchorBusinessId: expected.anchorBusinessId,
        },
        data: {
          anchorCreatedAt: next.anchorCreatedAt,
          anchorBusinessId: next.anchorBusinessId,
        },
      });
      return updated.count === 1 ? { status: "saved" } : { status: "stale_rejected" };
    } catch (err) {
      if (isMissingBillingReconciliationCursorTableError(err)) {
        legacyMode = true;
        return { status: "legacy_unavailable" };
      }
      throw err;
    }
  },
};

function store(): CursorStore {
  return testStore ?? defaultStore;
}

export async function loadBillingReconciliationCursorWithExpected(): Promise<{
  cursor: BillingReconciliationCursor | null;
  expected: BillingReconciliationCursorExpected;
}> {
  return store().loadWithExpected();
}

export async function compareAndSwapBillingReconciliationCursor(
  expected: BillingReconciliationCursorExpected,
  next: BillingReconciliationCursor | null,
): Promise<BillingReconciliationCursorCasResult> {
  return store().compareAndSwap(expected, next);
}

export function logBillingReconciliationCursorCasStale(): void {
  logTrialSync("billing_reconciliation.cursor_cas_stale", {
    outcome: "stale_rejected",
  });
}
