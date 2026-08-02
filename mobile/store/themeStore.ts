import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { PREFERENCE_KEYS } from "@/constants/storageKeys";
import { STARTUP_TASK_TIMEOUT_MS } from "@/constants/startup";
import { withTimeoutFallback } from "@/utils/withTimeout";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

type ThemeState = {
  mode: ThemeMode;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "dark",
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const stored = await withTimeoutFallback(
        AsyncStorage.getItem(PREFERENCE_KEYS.theme),
        STARTUP_TASK_TIMEOUT_MS,
        "theme.mode.read",
        null,
      );
      if (stored === "light" || stored === "dark" || stored === "system") {
        set({ mode: stored, hydrated: true });
        return;
      }
    } catch {
      /* non-fatal */
    }
    set({ hydrated: true });
  },
  setMode: async (mode) => {
    set({ mode });
    try {
      await AsyncStorage.setItem(PREFERENCE_KEYS.theme, mode);
    } catch {
      /* non-fatal */
    }
  },
}));

export function resolveThemeMode(
  preference: ThemeMode,
  systemScheme: "light" | "dark" | null | undefined,
): ResolvedTheme {
  if (preference === "system") {
    return systemScheme === "dark" ? "dark" : "light";
  }
  return preference;
}
