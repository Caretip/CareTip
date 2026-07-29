import { QueryClient } from "@tanstack/react-query";
import { config } from "@/constants/config";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status =
          typeof error === "object" &&
          error !== null &&
          "response" in error &&
          typeof (error as { response?: { status?: number } }).response?.status === "number"
            ? (error as { response?: { status?: number } }).response?.status
            : null;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      staleTime: 45_000,
      gcTime: 10 * 60_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      networkMode: "offlineFirst",
      /** Avoid stampedes when many screens mount after login. */
      structuralSharing: true,
    },
    mutations: {
      retry: 0,
      networkMode: "online",
    },
  },
});

/** Per-domain stale windows — reduce remount refetches without stale UI. */
export const queryStaleTimes = {
  live: 45_000,
  profile: 5 * 60_000,
  settings: 5 * 60_000,
  inventory: 3 * 60_000,
  feedback: 2 * 60_000,
  tipDetail: 10 * 60_000,
  roster: 3 * 60_000,
} as const;

export const queryKeys = {
  businessProfile: ["business", "profile"] as const,
  businessStats: ["business", "stats"] as const,
  businessQrAnalytics: ["business", "qr-analytics"] as const,
  businessFeedback: ["business", "feedback"] as const,
  businessActivity: ["business", "activity"] as const,
  businessQr: ["business", "qr"] as const,
  businessTips: ["business", "tips"] as const,
  businessEmployees: (businessId: string) => ["business", "employees", businessId] as const,
  employeeMe: ["employees", "me"] as const,
  employeeTips: ["employees", "tips"] as const,
  employeeTipList: ["employees", "tipList"] as const,
  notifications: ["notifications"] as const,
  notificationUnread: ["notifications", "unread"] as const,
  accountSettings: ["settings", "account"] as const,
  twoFactor: ["settings", "2fa"] as const,
  brandedQr: (mode: "employee" | "manager", targetUrl: string) =>
    ["brandedQr", mode, targetUrl] as const,
  tipDetail: (audience: "business" | "employee", tipId: string) =>
    ["tip-detail", audience, tipId] as const,
} as const;

export const queryDefaults = {
  apiTimeoutMs: config.apiTimeoutMs,
};
