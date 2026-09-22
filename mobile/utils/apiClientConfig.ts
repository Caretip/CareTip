import type { AxiosRequestConfig } from "axios";

/**
 * Screen- or query-scoped API calls should not trip the global offline banner when
 * they already surface errors locally (ErrorState, AccessErrorState, toasts).
 * Session refresh failures still report globally from the refresh path.
 */
export type CaretipAxiosRequestConfig = AxiosRequestConfig & {
  __caretipRetried?: boolean;
  __caretipSuppressGlobalError?: boolean;
};

export function withSuppressGlobalApiError<T extends AxiosRequestConfig>(
  config: T = {} as T,
): CaretipAxiosRequestConfig {
  return { ...config, __caretipSuppressGlobalError: true };
}
