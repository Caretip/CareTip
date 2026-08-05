export {
  formatUserFacingError,
  isAuthenticationError,
  isOnboardingIncompleteError,
  isPermissionError,
  isSubscriptionRequiredError,
} from "@/utils/userFacingError";

import { formatUserFacingError } from "@/utils/userFacingError";

/** @deprecated Prefer formatUserFacingError — kept for existing call sites. */
export function friendlyErrorMessage(
  error: unknown,
  fallback: string,
  t?: (key: string, params?: Record<string, string | number>) => string,
): string {
  return formatUserFacingError(error, fallback, t);
}
