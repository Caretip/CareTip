import type { ReactNode } from "react";

/**
 * Language switches update in place — no branded full-screen loader.
 */
export function LanguageChangeLoadingRegistrar({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
