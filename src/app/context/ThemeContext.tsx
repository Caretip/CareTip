import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

/** User-selected theme preference. */
export type ThemePreference = "light" | "dark" | "system";

/** Resolved paint mode applied to the document. */
export type ResolvedTheme = "light" | "dark";

/** @deprecated Use `ThemePreference` or `ResolvedTheme`. */
export type ThemeMode = ResolvedTheme;

type ThemeContextValue = {
  /** Stored user preference (light, dark, or follow OS). */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** Active paint mode after resolving system preference. */
  resolvedTheme: ResolvedTheme;
  /** @deprecated Alias for `resolvedTheme`. */
  mode: ResolvedTheme;
  /** @deprecated Use `setPreference`. */
  setMode: (mode: ResolvedTheme) => void;
};

export const THEME_STORAGE_KEY = "caretip-theme";
/** Used when nothing is stored yet. Toggle still offers light / dark / system. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function parseStoredPreference(raw: string | null): ThemePreference {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return DEFAULT_THEME_PREFERENCE;
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return getSystemTheme();
  return preference;
}

function readStoredPreference(): ThemePreference {
  try {
    return parseStoredPreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.add("theme-transition");
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  root.dataset.theme = resolved;
  window.setTimeout(() => root.classList.remove("theme-transition"), 250);
}

function getInitialPreference(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_THEME_PREFERENCE;
  return readStoredPreference();
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => getInitialPreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getInitialPreference()));

  useEffect(() => {
    const resolved = resolveTheme(preference);
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // ignore
    }
  }, [preference]);

  useEffect(() => {
    if (preference !== "system") return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = resolveTheme("system");
      setResolvedTheme(resolved);
      applyResolvedTheme(resolved);
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo<ThemeContextValue>(() => {
    const setPreference = (next: ThemePreference) => setPreferenceState(next);
    const setMode = (next: ResolvedTheme) => setPreferenceState(next);
    return {
      preference,
      setPreference,
      resolvedTheme,
      mode: resolvedTheme,
      setMode,
    };
  }, [preference, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
