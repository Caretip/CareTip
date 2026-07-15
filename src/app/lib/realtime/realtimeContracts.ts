/** Sprint 5A — client mirror of backend realtime contracts. */

export const REALTIME_EVENTS = {
  TIP_RECEIVED: "tip.received",
  QR_SCANNED: "qr.scanned",
  GOAL_UPDATED: "goal.updated",
  EMPLOYEE_UPDATED: "employee.updated",
  NOTIFICATION_CREATED: "notification.created",
  BILLING_UPDATED: "billing.updated",
  /** Activity Center live channel — Phase C FE listens to this only for the feed. */
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

export type LiveNewTipPayload = {
  tip: { id: string; amount: number; status: string; createdAt: string };
  employeeId: string;
  employeeName?: string;
  /** Guest/tipper name when available from payment metadata or transaction row. */
  customerName?: string | null;
  businessId: string;
  currentMonthTotal?: number;
  monthlyGoal?: number | null;
};

export const SOCKET_RECONNECTED_EVENT = "caretip:socket-reconnected";
/** Fired on every successful socket connect, including first connect after login. */
export const SOCKET_CONNECTED_EVENT = "caretip:socket-connected";
