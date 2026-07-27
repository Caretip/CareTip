export type ActivityEventSource =
  | "TIPS"
  | "QR"
  | "GOALS"
  | "STAFF"
  | "PAYMENTS"
  | "SYSTEM";

export type ActivityEventPriority = "LOW" | "NORMAL" | "HIGH";

export type ActivityCenterFilter = "all" | "today" | "TIPS" | "QR" | "PAYMENTS";

export type BusinessActivityFeedItem = {
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

export type BusinessActivityListResult = {
  items: BusinessActivityFeedItem[];
  nextCursor: string | null;
};
