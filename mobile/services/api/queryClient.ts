import { QueryClient } from "@tanstack/react-query";
import { config } from "@/constants/config";
import { shouldRetryQuery } from "@/utils/queryRetry";

export { getQueryErrorStatus, shouldRetryQuery } from "@/utils/queryRetry";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
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

export {
  createUserQueryKeys,
  useUserQueryKeys,
  getUserQueryKeys,
  publicQueryKeys,
} from "./queryKeys";

export const queryDefaults = {
  apiTimeoutMs: config.apiTimeoutMs,
};
