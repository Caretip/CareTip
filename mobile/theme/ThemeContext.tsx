import { createContext, useContext, type ReactNode } from "react";
import type { ColorPalette } from "./colors";
import type { ResolvedTheme, ThemeMode } from "@/store/themeStore";

export type ThemeContextValue = {
  mode: ThemeMode;
  resolvedMode: ResolvedTheme;
  colors: ColorPalette;
  isDark: boolean;
  hydrated: boolean;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleLightDark: () => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeContextProvider({
  value,
  children,
}: {
  value: ThemeContextValue;
  children: ReactNode;
}) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeContextProvider");
  }
  return ctx;
}
