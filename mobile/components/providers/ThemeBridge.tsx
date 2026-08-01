import { useEffect, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { darkColors, lightColors } from "@/theme/colors";
import { ThemeContextProvider } from "@/theme/ThemeContext";
import { resolveThemeMode, useThemeStore } from "@/store/themeStore";

/** Hydrates theme preference, provides palette context, syncs status bar. */
export function ThemeBridge({ children }: { children: ReactNode }) {
  const hydrate = useThemeStore((s) => s.hydrate);
  const mode = useThemeStore((s) => s.mode);
  const hydrated = useThemeStore((s) => s.hydrated);
  const setMode = useThemeStore((s) => s.setMode);
  const systemScheme = useColorScheme();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const resolvedMode = useMemo(
    () => resolveThemeMode(mode, systemScheme),
    [mode, systemScheme],
  );
  const colors = resolvedMode === "dark" ? darkColors : lightColors;
  const isDark = resolvedMode === "dark";

  const value = useMemo(
    () => ({
      mode,
      resolvedMode,
      colors,
      isDark,
      hydrated,
      setThemeMode: setMode,
      toggleLightDark: async () => {
        const next =
          mode === "system"
            ? resolvedMode === "dark"
              ? "light"
              : "dark"
            : mode === "light"
              ? "dark"
              : "light";
        await setMode(next);
      },
    }),
    [colors, hydrated, isDark, mode, resolvedMode, setMode],
  );

  return (
    <ThemeContextProvider value={value}>
      <StatusBar style={resolvedMode === "dark" ? "light" : "dark"} />
      {children}
    </ThemeContextProvider>
  );
}
