import { useSyncExternalStore } from "react";
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from "@/lib/authLogoutTransition";

/** True from Sign Out tap until session teardown finishes — drives layout/nav, not a splash. */
export function useAuthLogoutTransitionActive(): boolean {
  return useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
}
