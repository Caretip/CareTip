import { randomUUID } from "node:crypto";
import { getSocketIO } from "./socketServer.js";

/** Sprint 5A — canonical realtime event names. */
export const REALTIME_EVENTS = {
  TIP_RECEIVED: "tip.received",
  QR_SCANNED: "qr.scanned",
  GOAL_UPDATED: "goal.updated",
  EMPLOYEE_UPDATED: "employee.updated",
  NOTIFICATION_CREATED: "notification.created",
  BILLING_UPDATED: "billing.updated",
  /** Activity Center live channel — alongside domain tip/QR events during migration. */
  ACTIVITY_CREATED: "activity.created",
} as const;

export type RealtimeEntityIds = {
  businessId?: string;
  employeeId?: string;
  locationId?: string;
  tableId?: string;
  userId?: string;
  transactionId?: string;
  scanId?: string;
  notificationId?: string;
  goalId?: string;
};

export type RealtimeEventEnvelope<T = unknown> = {
  event: string;
  eventId: string;
  timestamp: string;
  businessId: string | null;
  entityIds: RealtimeEntityIds;
  payload: T;
};

export function buildRealtimeEnvelope<T>(
  event: string,
  entityIds: RealtimeEntityIds,
  payload: T,
): RealtimeEventEnvelope<T> {
  return {
    event,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    businessId: entityIds.businessId ?? null,
    entityIds,
    payload,
  };
}

type EmitTarget = { room: string };

function businessRoom(businessId: string): EmitTarget {
  return { room: `business:${businessId}` };
}

function userRoom(userId: string): EmitTarget {
  return { room: `user:${userId}` };
}

function employeeRoom(employeeId: string): EmitTarget {
  return { room: `employee:${employeeId}` };
}

/** Emit canonical envelope to one or more rooms (Sprint 5A). */
export function emitRealtimeEvent<T>(
  targets: EmitTarget[],
  event: string,
  entityIds: RealtimeEntityIds,
  payload: T,
): RealtimeEventEnvelope<T> {
  const io = getSocketIO();
  const envelope = buildRealtimeEnvelope(event, entityIds, payload);
  if (!io) return envelope;
  for (const { room } of targets) {
    io.to(room).emit(event, envelope);
  }
  return envelope;
}

export function emitTipReceivedCanonical(
  businessId: string,
  employeeId: string,
  payload: unknown,
): void {
  const targets = [businessRoom(businessId), employeeRoom(employeeId)];
  emitRealtimeEvent(targets, REALTIME_EVENTS.TIP_RECEIVED, { businessId, employeeId }, payload);
}

/** Activity Center — emit only after BusinessActivityEvent insert (SSOT). */
export function emitActivityCreatedCanonical(businessId: string, payload: unknown) {
  return emitRealtimeEvent(
    [businessRoom(businessId)],
    REALTIME_EVENTS.ACTIVITY_CREATED,
    { businessId },
    payload,
  );
}

export function emitQrScannedCanonical(
  businessId: string,
  entityIds: Omit<RealtimeEntityIds, "businessId">,
  payload: unknown,
): void {
  emitRealtimeEvent(
    [businessRoom(businessId)],
    REALTIME_EVENTS.QR_SCANNED,
    { businessId, ...entityIds },
    payload,
  );
}

export function emitEmployeeUpdatedCanonical(businessId: string, reason: string, employeeId?: string): void {
  emitRealtimeEvent(
    [businessRoom(businessId)],
    REALTIME_EVENTS.EMPLOYEE_UPDATED,
    { businessId, employeeId },
    { reason, at: new Date().toISOString() },
  );
}

export function emitGoalUpdatedCanonical(
  businessId: string,
  employeeId: string,
  goalId: string,
  payload: unknown,
): void {
  emitRealtimeEvent(
    [businessRoom(businessId), employeeRoom(employeeId)],
    REALTIME_EVENTS.GOAL_UPDATED,
    { businessId, employeeId, goalId },
    payload,
  );
}

export function emitBillingUpdatedCanonical(businessId: string, payload: unknown): void {
  emitRealtimeEvent(
    [businessRoom(businessId)],
    REALTIME_EVENTS.BILLING_UPDATED,
    { businessId },
    payload,
  );
}

export function emitNotificationCreatedCanonical(
  userId: string,
  businessId: string | null,
  payload: unknown,
): void {
  emitRealtimeEvent(
    [userRoom(userId)],
    REALTIME_EVENTS.NOTIFICATION_CREATED,
    { userId, businessId: businessId ?? undefined },
    payload,
  );
}

/** Map business_data_updated reasons to canonical employee/location events for activity feed. */
export function emitCanonicalFromBusinessDataReason(
  businessId: string,
  reason: string,
  employeeId?: string,
): void {
  if (
    reason.includes("employee") ||
    reason.includes("staff") ||
    reason.includes("invite") ||
    reason.includes("roster")
  ) {
    emitEmployeeUpdatedCanonical(businessId, reason, employeeId);
  }
  if (reason === "subscription_tier_updated") {
    emitBillingUpdatedCanonical(businessId, { reason, at: new Date().toISOString() });
  }
}
