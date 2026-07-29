import { create } from "zustand";
import { logSplash } from "@/utils/splashLifecycle";

type StartupState = {
  /** Auth + locale bootstrap finished (success, failure, or timeout). */
  bootstrapSettled: boolean;
  /** Bootstrap exceeded STARTUP_TASK_TIMEOUT_MS — proceed to UI anyway. */
  bootstrapTimedOut: boolean;
  reset: () => void;
  markBootstrapSettled: (reason: string) => void;
  markBootstrapTimedOut: () => void;
};

export const useStartupStore = create<StartupState>((set, get) => ({
  bootstrapSettled: false,
  bootstrapTimedOut: false,
  reset: () => {
    set({ bootstrapSettled: false, bootstrapTimedOut: false });
  },
  markBootstrapSettled: (reason) => {
    if (get().bootstrapSettled) return;
    logSplash("bootstrap.settled", { reason });
    set({ bootstrapSettled: true });
  },
  markBootstrapTimedOut: () => {
    if (get().bootstrapTimedOut) return;
    logSplash("bootstrap.timedOut");
    set({ bootstrapTimedOut: true, bootstrapSettled: true });
  },
}));
