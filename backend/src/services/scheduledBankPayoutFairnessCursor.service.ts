/**
 * Phase D2 — durable fairness cursor per stream with compare-and-swap persistence.
 */
import type {
  ScheduledPayoutFairnessCursor,
  ScheduledPayoutFairnessStream,
} from "./scheduledBankPayoutFairSelection.js";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";

export type FairnessCursorExpected =
  | { kind: "absent" }
  | { kind: "present"; anchorDueAt: Date; anchorAccountId: string };

export type FairnessCursorCasResult =
  | { status: "saved" }
  | { status: "stale_rejected" }
  | { status: "legacy_unavailable" };

export type FairnessCursorRotationMode = "durable" | "legacy_unavailable";

type CursorStore = {
  loadWithExpected: (
    stream: ScheduledPayoutFairnessStream,
  ) => Promise<{ cursor: ScheduledPayoutFairnessCursor | null; expected: FairnessCursorExpected }>;
  compareAndSwap: (
    stream: ScheduledPayoutFairnessStream,
    expected: FairnessCursorExpected,
    next: ScheduledPayoutFairnessCursor,
  ) => Promise<FairnessCursorCasResult>;
};

let testStore: CursorStore | null = null;
let legacyMode = false;
let legacyNotified = false;

export function __resetScheduledPayoutFairnessCursorStateForTests(): void {
  testStore = null;
  legacyMode = false;
  legacyNotified = false;
}

export function __setScheduledPayoutFairnessCursorStoreForTests(store: CursorStore | null): void {
  testStore = store;
}

export function isMissingFairnessCursorTableError(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
  return code === "P2021" || code === "42P01";
}

export function getScheduledPayoutFairnessCursorRotationMode(): FairnessCursorRotationMode {
  return legacyMode ? "legacy_unavailable" : "durable";
}

/** Once per process when the cursor table is missing (repeats after restart). */
export function notifyScheduledPayoutFairnessCursorLegacyFallback(context: string): void {
  legacyMode = true;
  if (legacyNotified) return;
  legacyNotified = true;
  console.warn(
    JSON.stringify({
      event: "scheduled_payout_fairness_cursor_legacy",
      rotationMode: "legacy_unavailable",
      context,
      hint: "Apply scheduled_payout_tick_fairness_cursors migration for durable rotation",
    }),
  );
  logServerError(
    "scheduledBankPayout.fairnessCursorTableMissing",
    new Error("Fairness cursor table not migrated; legacy head ordering active for this process"),
    { context, rotationMode: "legacy_unavailable" },
  );
}

function cursorsEqual(
  a: ScheduledPayoutFairnessCursor,
  b: ScheduledPayoutFairnessCursor,
): boolean {
  return (
    a.anchorDueAt.getTime() === b.anchorDueAt.getTime() &&
    a.anchorAccountId === b.anchorAccountId
  );
}

function expectedFromRow(
  row: ScheduledPayoutFairnessCursor | null,
): FairnessCursorExpected {
  if (!row) return { kind: "absent" };
  return {
    kind: "present",
    anchorDueAt: row.anchorDueAt,
    anchorAccountId: row.anchorAccountId,
  };
}

const defaultStore: CursorStore = {
  async loadWithExpected(stream) {
    try {
      const row = await prisma.scheduledPayoutTickFairnessCursor.findUnique({ where: { stream } });
      if (!row) return { cursor: null, expected: { kind: "absent" } };
      const cursor = { anchorDueAt: row.anchorDueAt, anchorAccountId: row.anchorAccountId };
      return { cursor, expected: expectedFromRow(cursor) };
    } catch (err) {
      if (isMissingFairnessCursorTableError(err)) {
        notifyScheduledPayoutFairnessCursorLegacyFallback("load");
        return { cursor: null, expected: { kind: "absent" } };
      }
      throw err;
    }
  },

  async compareAndSwap(stream, expected, next) {
    if (legacyMode) {
      return { status: "legacy_unavailable" };
    }
    try {
      if (expected.kind === "absent") {
        try {
          await prisma.scheduledPayoutTickFairnessCursor.create({
            data: {
              stream,
              anchorDueAt: next.anchorDueAt,
              anchorAccountId: next.anchorAccountId,
            },
          });
          return { status: "saved" };
        } catch (err) {
          if (isMissingFairnessCursorTableError(err)) {
            notifyScheduledPayoutFairnessCursorLegacyFallback("compareAndSwap_create");
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

      const updated = await prisma.scheduledPayoutTickFairnessCursor.updateMany({
        where: {
          stream,
          anchorDueAt: expected.anchorDueAt,
          anchorAccountId: expected.anchorAccountId,
        },
        data: {
          anchorDueAt: next.anchorDueAt,
          anchorAccountId: next.anchorAccountId,
        },
      });
      if (updated.count === 1) return { status: "saved" };
      return { status: "stale_rejected" };
    } catch (err) {
      if (isMissingFairnessCursorTableError(err)) {
        notifyScheduledPayoutFairnessCursorLegacyFallback("compareAndSwap");
        return { status: "legacy_unavailable" };
      }
      throw err;
    }
  },
};

function store(): CursorStore {
  return testStore ?? defaultStore;
}

export async function loadScheduledPayoutFairnessCursorWithExpected(
  stream: ScheduledPayoutFairnessStream,
): Promise<{ cursor: ScheduledPayoutFairnessCursor | null; expected: FairnessCursorExpected }> {
  return store().loadWithExpected(stream);
}

export async function compareAndSwapScheduledPayoutFairnessCursor(
  stream: ScheduledPayoutFairnessStream,
  expected: FairnessCursorExpected,
  next: ScheduledPayoutFairnessCursor,
): Promise<FairnessCursorCasResult> {
  return store().compareAndSwap(stream, expected, next);
}

/** @deprecated Use loadScheduledPayoutFairnessCursorWithExpected */
export async function loadScheduledPayoutFairnessCursor(
  stream: ScheduledPayoutFairnessStream,
): Promise<ScheduledPayoutFairnessCursor | null> {
  const loaded = await loadScheduledPayoutFairnessCursorWithExpected(stream);
  return loaded.cursor;
}

export function logFairnessCursorCasStale(stream: ScheduledPayoutFairnessStream): void {
  console.info(
    JSON.stringify({
      event: "scheduled_payout_fairness_cursor_cas_stale",
      stream,
      outcome:
        "Cursor save rejected; a concurrent tick advanced the cursor. Next tick loads the newer cursor and continues.",
    }),
  );
}

export { cursorsEqual };
