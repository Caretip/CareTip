/**
 * Extract person identity from inbox notification metadata.
 * Tip notifications include `employeeId` + `employeeName` (no avatar URL).
 */

export type NotificationActor = {
  employeeId?: string;
  displayName?: string;
};

export function getNotificationActor(
  metadata: Record<string, unknown> | null | undefined,
): NotificationActor {
  if (!metadata || typeof metadata !== "object") return {};
  const employeeId =
    typeof metadata.employeeId === "string" && metadata.employeeId.trim()
      ? metadata.employeeId.trim()
      : typeof metadata.staffId === "string" && metadata.staffId.trim()
        ? metadata.staffId.trim()
        : typeof metadata.actorId === "string" && metadata.actorId.trim()
          ? metadata.actorId.trim()
          : undefined;
  const displayName =
    typeof metadata.employeeName === "string" && metadata.employeeName.trim()
      ? metadata.employeeName.trim()
      : typeof metadata.actorName === "string" && metadata.actorName.trim()
        ? metadata.actorName.trim()
        : undefined;
  return { employeeId, displayName };
}

export function notificationHasPersonActor(actor: NotificationActor): boolean {
  return Boolean(actor.employeeId || actor.displayName);
}
