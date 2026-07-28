export {
  formatUserFacingError,
  isPermissionError,
} from "@/utils/userFacingError";

import { formatUserFacingError } from "@/utils/userFacingError";

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function friendlyErrorMessage(
  error: unknown,
  fallback: string,
  t?: TranslateFn,
): string {
  return formatUserFacingError(error, fallback, t);
}
