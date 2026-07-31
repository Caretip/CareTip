import { useCallback, useMemo } from "react";
import { useColorScheme } from "react-native";
import { darkColors, lightColors } from "@/theme/colors";
import {
  resolveThemeMode,
  useThemeStore,
  type ResolvedTheme,
  type ThemeMode,
} from "@/store/themeStore";

export function useTheme() {
  const mode = useThemeStore((s) => s.mode);
  const hydrated = useThemeStore((s) => s.hydrated);
  const setMode = useThemeStore((s) => s.setMode);
  const systemScheme = useColorScheme();

  const resolvedMode: ResolvedTheme = useMemo(
    () => resolveThemeMode(mode, systemScheme),
    [mode, systemScheme],
  );

  const colors = resolvedMode === "dark" ? darkColors : lightColors;
  const isDark = resolvedMode === "dark";

  const setThemeMode = useCallback(
    async (next: ThemeMode) => {
      await setMode(next);
    },
    [setMode],
  );

  const toggleLightDark = useCallback(async () => {
    const next: ThemeMode =
      mode === "system"
        ? resolvedMode === "dark"
          ? "light"
          : "dark"
        : mode === "light"
          ? "dark"
          : "light";
    await setMode(next);
  }, [mode, resolvedMode, setMode]);

  return {
    mode,
    resolvedMode,
    colors,
    isDark,
    hydrated,
    setThemeMode,
    toggleLightDark,
  };
}

export type { ThemeMode, ResolvedTheme };
