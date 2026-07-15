/**
 * BusinessActivityEvent service — Activity Center SSOT (writes + list).
 *
 * ARCHITECTURE INVARIANT:
 * - Activity Center feed reads ONLY this model (listBusinessActivityEvents).
 * - Writers project domain operations here; list path must never join Tip/Transaction/QR/Goals/etc.
 * - Live path: write → activity.created only (legacy tip/QR sockets remain for other surfaces).
 * See docs/ARCHITECTURE_ACTIVITY_CENTER.md
 */
import {
  ActivityEventPriority,
  ActivityEventSource,
  type BusinessActivityEvent,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../../prisma.js";
import { isPrismaUniqueViolation } from "../../utils/prismaErrors.js";
import { emitActivityCreatedCanonical } from "../../socket/realtimeContracts.js";
import { scheduleActivityProjection } from "./activityProjection.isolation.js";

/** Curated Activity Center event types (writers owned by domain modules). */
export const ACTIVITY_EVENT_TYPES = {
  TIP_RECEIVED: "tip.received",
  QR_SCANNED: "qr.scanned",
  GOAL_ACHIEVED: "goal.achieved",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_REFUNDED: "payment.refunded",
  EMPLOYEE_INVITED: "employee.invited",
  EMPLOYEE_JOINED: "employee.joined",
} as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[keyof typeof ACTIVITY_EVENT_TYPES];

const TITLE_KEY_BY_TYPE: Record<string, string> = {
  [ACTIVITY_EVENT_TYPES.TIP_RECEIVED]: "activity.tip.received",
  [ACTIVITY_EVENT_TYPES.QR_SCANNED]: "activity.qr.scanned",
  [ACTIVITY_EVENT_TYPES.GOAL_ACHIEVED]: "activity.goal.achieved",
  [ACTIVITY_EVENT_TYPES.PAYMENT_FAILED]: "activity.payment.failed",
  [ACTIVITY_EVENT_TYPES.PAYMENT_REFUNDED]: "activity.payment.refunded",
  [ACTIVITY_EVENT_TYPES.EMPLOYEE_INVITED]: "activity.employee.invited",
  [ACTIVITY_EVENT_TYPES.EMPLOYEE_JOINED]: "activity.employee.joined",
};

const DEFAULT_PRIORITY_BY_TYPE: Partial<Record<string, ActivityEventPriority>> = {
  [ACTIVITY_EVENT_TYPES.TIP_RECEIVED]: ActivityEventPriority.NORMAL,
  [ACTIVITY_EVENT_TYPES.QR_SCANNED]: ActivityEventPriority.NORMAL,
  [ACTIVITY_EVENT_TYPES.GOAL_ACHIEVED]: ActivityEventPriority.HIGH,
  [ACTIVITY_EVENT_TYPES.PAYMENT_FAILED]: ActivityEventPriority.HIGH,
  [ACTIVITY_EVENT_TYPES.PAYMENT_REFUNDED]: ActivityEventPriority.HIGH,
  [ACTIVITY_EVENT_TYPES.EMPLOYEE_INVITED]: ActivityEventPriority.LOW,
  [ACTIVITY_EVENT_TYPES.EMPLOYEE_JOINED]: ActivityEventPriority.LOW,
};

export type WriteBusinessActivityEventInput = {
  businessId: string;
  type: string;
  source: ActivityEventSource;
  priority?: ActivityEventPriority;
  occurredAt: Date;
  dedupeKey: string;
  summary: Prisma.InputJsonValue;
  subjectType?: string | null;
  subjectId?: string | null;
  actorEmployeeId?: string | null;
  actorUserId?: string | null;
  locationId?: string | null;
  tableId?: string | null;
};

export type WriteBusinessActivityEventResult =
  | { inserted: true; event: BusinessActivityEvent }
  | { inserted: false; event: null };

export type ActivityFeedItemDto = {
  id: string;
  type: string;
  source: ActivityEventSource;
  priority: ActivityEventPriority;
  occurredAt: string;
  titleKey: string;
  params: Record<string, unknown>;
  subject: { type: string; id: string } | null;
  actorEmployeeId: string | null;
  locationId: string | null;
  tableId: string | null;
};

export type ListBusinessActivityOptions = {
  limit?: number;
  cursor?: string | null;
  source?: ActivityEventSource | "all" | null;
};

export type ListBusinessActivityResult = {
  items: ActivityFeedItemDto[];
  nextCursor: string | null;
};

type ActivityCursor = { t: string; id: string };

function encodeActivityCursor(occurredAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: occurredAt.toISOString(), id }), "utf8").toString(
    "base64url",
  );
}

function decodeActivityCursor(raw: string): ActivityCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      parsed == null ||
      typeof parsed !== "object" ||
      typeof (parsed as ActivityCursor).t !== "string" ||
      typeof (parsed as ActivityCursor).id !== "string"
    ) {
      return null;
    }
    const t = (parsed as ActivityCursor).t;
    if (Number.isNaN(Date.parse(t))) return null;
    return { t, id: (parsed as ActivityCursor).id };
  } catch {
    return null;
  }
}

function titleKeyForType(type: string): string {
  return TITLE_KEY_BY_TYPE[type] ?? `activity.${type}`;
}

function summaryAsParams(summary: Prisma.JsonValue): Record<string, unknown> {
  if (summary != null && typeof summary === "object" && !Array.isArray(summary)) {
    return summary as Record<string, unknown>;
  }
  return {};
}

export function toActivityFeedItemDto(row: BusinessActivityEvent): ActivityFeedItemDto {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    priority: row.priority,
    occurredAt: row.occurredAt.toISOString(),
    titleKey: titleKeyForType(row.type),
    params: summaryAsParams(row.summary),
    subject:
      row.subjectType && row.subjectId
        ? { type: row.subjectType, id: row.subjectId }
        : null,
    actorEmployeeId: row.actorEmployeeId,
    locationId: row.locationId,
    tableId: row.tableId,
  };
}

/**
 * Sole write path for Activity Center projection.
 * Unique (businessId, dedupeKey) → no-op (no duplicate row / socket).
 * On insert → emit activity.created to business:{businessId}.
 */
export async function writeBusinessActivityEvent(
  input: WriteBusinessActivityEventInput,
): Promise<WriteBusinessActivityEventResult> {
  const priority =
    input.priority ??
    DEFAULT_PRIORITY_BY_TYPE[input.type] ??
    ActivityEventPriority.NORMAL;

  try {
    const event = await prisma.businessActivityEvent.create({
      data: {
        businessId: input.businessId,
        type: input.type,
        source: input.source,
        priority,
        occurredAt: input.occurredAt,
        dedupeKey: input.dedupeKey.slice(0, 191),
        summary: input.summary,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        actorEmployeeId: input.actorEmployeeId ?? null,
        actorUserId: input.actorUserId ?? null,
        locationId: input.locationId ?? null,
        tableId: input.tableId ?? null,
      },
    });

    emitActivityCreatedCanonical(input.businessId, toActivityFeedItemDto(event));
    return { inserted: true, event };
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      return { inserted: false, event: null };
    }
    throw err;
  }
}

/** Fire-and-forget projection — isolated; never throws into domain writers. */
export function projectBusinessActivityEvent(input: WriteBusinessActivityEventInput): void {
  scheduleActivityProjection(input);
}

/**
 * List feed from BusinessActivityEvent only — no domain-table joins.
 * Newest-first by occurredAt, then id. Cursor = (occurredAt, id).
 */
export async function listBusinessActivityEvents(
  businessId: string,
  options?: ListBusinessActivityOptions,
): Promise<ListBusinessActivityResult> {
  const limitRaw = options?.limit ?? 30;
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 30, 1), 100);

  const sourceFilter =
    options?.source && options.source !== "all" ? options.source : undefined;

  const cursor =
    typeof options?.cursor === "string" && options.cursor.trim()
      ? decodeActivityCursor(options.cursor.trim())
      : null;
  if (options?.cursor && !cursor) {
    const err = new Error("Invalid activity cursor");
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }

  const cursorOccurredAt = cursor ? new Date(cursor.t) : null;

  const rows = await prisma.businessActivityEvent.findMany({
    where: {
      businessId,
      ...(sourceFilter ? { source: sourceFilter } : {}),
      ...(cursorOccurredAt && cursor
        ? {
            OR: [
              { occurredAt: { lt: cursorOccurredAt } },
              {
                AND: [{ occurredAt: cursorOccurredAt }, { id: { lt: cursor.id } }],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeActivityCursor(last.occurredAt, last.id) : null;

  return {
    items: page.map(toActivityFeedItemDto),
    nextCursor,
  };
}

export { ActivityEventSource, ActivityEventPriority };
