import { useThemeContext } from "@/theme/ThemeContext";

export type { ThemeMode, ResolvedTheme } from "@/store/themeStore";

/** Active theme palette and controls — requires ThemeBridge. */
export function useTheme() {
  return useThemeContext();
}
