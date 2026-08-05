import Constants, { ExecutionEnvironment } from "expo-constants";

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Keep the OS app icon badge aligned with API unread count. */
export async function syncOsNotificationBadge(count: number): Promise<void> {
  if (isExpoGo) return;
  try {
    const Notifications = await import("expo-notifications");
    const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    await Notifications.setBadgeCountAsync(safe);
  } catch {
    /* non-fatal on simulators / missing native module */
  }
}

export async function clearOsNotificationBadge(): Promise<void> {
  await syncOsNotificationBadge(0);
}
