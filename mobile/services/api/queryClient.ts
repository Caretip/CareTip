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

export const queryKeys = {
  session: ["session"] as const,
  businessProfile: ["business", "profile"] as const,
  businessStats: ["business", "stats"] as const,
  businessActivity: ["business", "activity"] as const,
  businessQr: ["business", "qr"] as const,
  businessTips: ["business", "tips"] as const,
  employeeMe: ["employees", "me"] as const,
  employeeTips: ["employees", "tips"] as const,
  employeeTipList: ["employees", "tipList"] as const,
  notifications: ["notifications"] as const,
  notificationUnread: ["notifications", "unread"] as const,
  accountSettings: ["settings", "account"] as const,
  twoFactor: ["settings", "2fa"] as const,
  locations: ["locations"] as const,
  tables: ["tables"] as const,
} as const;

export const queryDefaults = {
  apiTimeoutMs: config.apiTimeoutMs,
};
