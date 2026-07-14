import { useRef } from "react";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
  useGlobalAppLoadingActive,
} from "./globalAppLoading";

/**
 * While a global CareTip overlay is already covering the screen, keep it up until
 * critical first-paint data is ready — avoids overlay → skeleton → content double load.
 * Soft navigations (no overlay) are unaffected and may use local skeletons.
 */
export function useExtendGlobalLoaderUntilReady(
  key: string,
  blocking: boolean,
  message?: string,
): boolean {
  const overlayVisible = useGlobalAppLoadingActive();
  const latchedRef = useRef(false);

  if (blocking && overlayVisible) {
    latchedRef.current = true;
  }
  if (!blocking) {
    latchedRef.current = false;
  }

  const hold = blocking && (overlayVisible || latchedRef.current);
  useAppLoadingRegistration(key, APP_LOADING_PRIORITY.ROUTE_GUARD, hold, message);
  return hold || overlayVisible;
}
