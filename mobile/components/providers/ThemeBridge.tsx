import { useEffect, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useThemeStore } from "@/store/themeStore";

/** Hydrates theme preference and syncs status bar with resolved scheme. */
export function ThemeBridge({ children }: { children: ReactNode }) {
  const hydrate = useThemeStore((s) => s.hydrate);
  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useColorScheme();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const resolved =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;

  return (
    <>
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      {children}
    </>
  );
}
