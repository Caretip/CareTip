/** Client mirror of backend realtime contracts — aligned with web. */

export const REALTIME_EVENTS = {
  TIP_RECEIVED: "tip.received",
  QR_SCANNED: "qr.scanned",
  GOAL_UPDATED: "goal.updated",
  EMPLOYEE_UPDATED: "employee.updated",
  NOTIFICATION_CREATED: "notification.created",
  BILLING_UPDATED: "billing.updated",
  ACTIVITY_CREATED: "activity.created",
} as const;

export type RealtimeEventEnvelope<T = unknown> = {
  event?: string;
  eventId?: string;
  timestamp?: string;
  businessId?: string | null;
  payload?: T;
};
