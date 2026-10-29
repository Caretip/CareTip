/**
 * Employee controls for a newly recorded tip.
 * In-app and push default on (current behavior). Email defaults off (new channel).
 */
export type EmployeeTipNotificationPrefs = {
  tipInAppNotifications: boolean;
  tipPushNotifications: boolean;
  tipEmailNotifications: boolean;
};

export const DEFAULT_EMPLOYEE_TIP_NOTIFICATION_PREFS: EmployeeTipNotificationPrefs = {
  tipInAppNotifications: true,
  tipPushNotifications: true,
  tipEmailNotifications: false,
};

/**
 * Behavior before `tip_*_notifications` columns exist.
 * Inbox stays on, tip push follows the existing push switch, and email stays off.
 */
export function employeeTipPrefsBeforeChannelColumns(
  pushNotifications: boolean,
): EmployeeTipNotificationPrefs {
  return {
    tipInAppNotifications: true,
    tipPushNotifications: pushNotifications,
    tipEmailNotifications: false,
  };
}

export function effectiveEmployeeTipNotificationPrefs(
  row: Partial<EmployeeTipNotificationPrefs> | null | undefined,
): EmployeeTipNotificationPrefs {
  return {
    tipInAppNotifications:
      row?.tipInAppNotifications ?? DEFAULT_EMPLOYEE_TIP_NOTIFICATION_PREFS.tipInAppNotifications,
    tipPushNotifications:
      row?.tipPushNotifications ?? DEFAULT_EMPLOYEE_TIP_NOTIFICATION_PREFS.tipPushNotifications,
    tipEmailNotifications:
      row?.tipEmailNotifications ?? DEFAULT_EMPLOYEE_TIP_NOTIFICATION_PREFS.tipEmailNotifications,
  };
}

/** Each channel is independent. A false value never forces another channel off. */
export function resolveEmployeeTipDeliveryChannels(
  prefs: EmployeeTipNotificationPrefs,
): { in_app: boolean; push: boolean; email: boolean } {
  return {
    in_app: prefs.tipInAppNotifications,
    push: prefs.tipPushNotifications,
    email: prefs.tipEmailNotifications,
  };
}

/**
 * Private tip copy for email and browser push.
 * No tipper name, amount, or payment reference.
 * The in-app inbox keeps the existing localized tip template.
 */
export function employeeTipEmailCopy(locale: "de" | "en"): { title: string; bodyText: string } {
  if (locale === "de") {
    return {
      title: "Sie haben ein neues Trinkgeld erhalten",
      bodyText: "Ein neues Trinkgeld wurde in CareTip erfasst. Öffnen Sie CareTip, um es anzusehen.",
    };
  }
  return {
    title: "You received a new tip",
    bodyText: "A new tip was recorded in CareTip. Open CareTip to view it.",
  };
}
