/** Secure storage keys — never store tokens in AsyncStorage. */

export const STORAGE_KEYS = {
  accessToken: "caretip_access_token",
  refreshToken: "caretip_refresh_token",
  userSnapshot: "caretip_user_snapshot",
} as const;

/** Non-secret preference keys (AsyncStorage). */
export const PREFERENCE_KEYS = {
  businessDashboardTimeframe: "caretip_pref_business_dashboard_tf",
  businessAnalyticsTimeframe: "caretip_pref_business_analytics_tf",
  employeeDashboardTimeframe: "caretip_pref_employee_dashboard_tf",
  qrStudioTimeframe: "caretip_pref_qr_studio_tf",
  language: "caretip_pref_language",
  theme: "caretip_pref_theme",
} as const;
