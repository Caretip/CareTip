import { ActivityEventSource } from "@prisma/client";
import { getSocketIO } from "./socketServer.js";
import { emitTipReceivedCanonical } from "./realtimeContracts.js";
import {
  ACTIVITY_EVENT_TYPES,
  projectBusinessActivityEvent,
} from "../services/activity/businessActivityEvent.service.js";
import { scheduleGoalAchievedProjectionsForTip } from "../services/activity/goalActivity.projection.js";

export interface NewTipPayload {
  tip: {
    id: string;
    amount: number;
    status: string;
    createdAt: string;
  };
  /** May be null after staff detach/erasure (Slice D). */
  employeeId: string | null;
  employeeName: string;
  /** Guest/tipper name from payment metadata or transaction row (may be empty). */
  customerName?: string | null;
  /** When set, push notifications skip an employee lookup. */
  employeeUserId?: string;
  businessId: string;
  /** When set, push notifications skip a business lookup. */
  businessManagerUserId?: string;
  currentMonthTotal: number;
  monthlyGoal: number | null;
}

/**
 * Emits only to the employee and business rooms derived from the tip row (server-side).
 */
export function emitNewTip(payload: NewTipPayload): void {
  const io = getSocketIO();
  if (io) {
    if (payload.employeeId) {
      emitTipReceivedCanonical(payload.businessId, payload.employeeId, payload);
      /** Legacy alias — single emit per room (Sprint 8.1; replaces new_tip + duplicate tip_received). */
      io.to(`employee:${payload.employeeId}`).emit("tip_received", payload);
    }
    io.to(`business:${payload.businessId}`).emit("tip_received", payload);
  }

  /** Activity Center projection — coexists with tip sockets; UI migrates in Phase C. */
  projectBusinessActivityEvent({
    businessId: payload.businessId,
    type: ACTIVITY_EVENT_TYPES.TIP_RECEIVED,
    source: ActivityEventSource.TIPS,
    occurredAt: new Date(payload.tip.createdAt),
    dedupeKey: `tip:${payload.tip.id}:received`,
    subjectType: "tip",
    subjectId: payload.tip.id,
    actorEmployeeId: payload.employeeId,
    summary: {
      amountEur: payload.tip.amount,
      employeeName: payload.employeeName,
      customerName: payload.customerName ?? null,
      status: payload.tip.status,
    },
  });

  /** Phase B — goal.achieved on threshold cross (isolated; never fails tip path). */
  if (payload.employeeId) {
    scheduleGoalAchievedProjectionsForTip({
      tipId: payload.tip.id,
      tipAmount: payload.tip.amount,
      tipCreatedAt: new Date(payload.tip.createdAt),
      employeeId: payload.employeeId,
      employeeName: payload.employeeName,
      businessId: payload.businessId,
    });
  }

  void import("../services/push/notification.triggers.js").then(({ onTipReceived }) => {
    onTipReceived(payload);
  });

  void import("../services/business.service.js").then(({ invalidateBusinessStatsTipCaches }) => {
    invalidateBusinessStatsTipCaches(payload.businessId);
  });
  if (payload.employeeId) {
    void import("../services/employeeTipsDashboard.service.js").then(({ invalidateEmployeeDashboardCache }) => {
      invalidateEmployeeDashboardCache(payload.employeeId!);
    });
  }
  void import("../services/platform.service.js").then(({ invalidatePlatformMetricsCache }) => {
    invalidatePlatformMetricsCache();
  });
  void import("./socketEmitters.js").then(({ emitPlatformMetricsUpdated }) => {
    emitPlatformMetricsUpdated("new_tip");
  });
}
