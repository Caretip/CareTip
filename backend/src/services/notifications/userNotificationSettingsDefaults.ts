/**
 * Single source of truth for UserSettings notification defaults.
 * Must match Prisma `UserSettings` @default values and GET /api/me/settings synthesis.
 */
export const DEFAULT_USER_NOTIFICATION_SETTINGS = {
  tipReceivedNotifications: true,
  summaryEmails: false,
  systemAlerts: true,
  notifyNewLogin: true,
} as const;

export type UserNotificationSettingsPrefs = {
  tipReceivedNotifications: boolean;
  summaryEmails: boolean;
  systemAlerts: boolean;
  notifyNewLogin: boolean;
};

/** Effective prefs when a UserSettings row may be missing (treat as schema defaults). */
export function effectiveUserNotificationSettings(
  row: Partial<UserNotificationSettingsPrefs> | null | undefined,
): UserNotificationSettingsPrefs {
  return {
    tipReceivedNotifications:
      row?.tipReceivedNotifications ?? DEFAULT_USER_NOTIFICATION_SETTINGS.tipReceivedNotifications,
    summaryEmails: row?.summaryEmails ?? DEFAULT_USER_NOTIFICATION_SETTINGS.summaryEmails,
    systemAlerts: row?.systemAlerts ?? DEFAULT_USER_NOTIFICATION_SETTINGS.systemAlerts,
    notifyNewLogin: row?.notifyNewLogin ?? DEFAULT_USER_NOTIFICATION_SETTINGS.notifyNewLogin,
  };
}

export function effectiveNotifyNewLogin(
  row: Pick<UserNotificationSettingsPrefs, "notifyNewLogin"> | null | undefined,
): boolean {
  return row?.notifyNewLogin ?? DEFAULT_USER_NOTIFICATION_SETTINGS.notifyNewLogin;
}
