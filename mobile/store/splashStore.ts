import { create } from "zustand";
import { logSplash } from "@/utils/splashLifecycle";

type SplashState = {
  firstScreenReady: boolean;
  firstScreenSource: string | null;
  reset: () => void;
  markFirstScreenReady: (source: string) => void;
};

export const useSplashStore = create<SplashState>((set, get) => ({
  firstScreenReady: false,
  firstScreenSource: null,
  reset: () => {
    set({ firstScreenReady: false, firstScreenSource: null });
  },
  markFirstScreenReady: (source) => {
    if (get().firstScreenReady) {
      logSplash("firstScreen.duplicate", { source });
      return;
    }
    logSplash("firstScreen.ready", { source });
    set({ firstScreenReady: true, firstScreenSource: source });
  },
}));
