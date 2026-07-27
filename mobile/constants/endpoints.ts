/**
 * Existing CareTip backend routes — SSOT.
 * Do not invent new endpoints; consume what the web app already uses.
 */

export const API_ENDPOINTS = {
  auth: {
    signIn: "/api/auth/signin",
    login: "/api/auth/login",
    refresh: "/api/auth/refresh",
    logout: "/api/auth/logout",
    patchMe: "/api/auth/me",
    changePassword: "/api/auth/change-password",
    twoFactorStatus: "/api/auth/2fa/status",
    twoFactorSetup: "/api/auth/2fa/setup",
    twoFactorEnable: "/api/auth/2fa/enable",
    twoFactorDisable: "/api/auth/2fa/disable",
  },
  authMfa: {
    setup: "/api/auth/login/mfa/setup",
    enable: "/api/auth/login/mfa/enable",
    verify: "/api/auth/login/mfa/verify",
  },
  business: {
    profile: "/api/business/profile",
    stats: "/api/business/me/stats",
    activity: "/api/business/activity",
    qrAnalytics: "/api/business/qr-analytics",
    locations: "/api/locations",
    tables: "/api/tables",
    employees: "/api/employees",
  },
  employees: {
    me: "/api/employees/me",
    tips: "/api/tips/employee",
    tipList: "/api/tips/employee/list",
  },
  tips: {
    business: "/api/tips/business",
    employee: "/api/tips/employee",
    employeeList: "/api/tips/employee/list",
  },
  notifications: {
    list: "/api/me/notifications",
    unreadCount: "/api/me/notifications/unread-count",
    readAll: "/api/me/notifications/read-all",
    read: (id: string) => `/api/me/notifications/${id}/read`,
    delete: (id: string) => `/api/me/notifications/${id}`,
  },
  settings: {
    me: "/api/me/settings",
  },
  push: {
    config: "/api/push/config",
    tokens: "/api/push/tokens",
    tokensAll: "/api/push/tokens/all",
  },
} as const;
