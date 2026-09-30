import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import {
  isAppLanguageChangeActive,
  subscribeAppLanguageChange,
} from "../lib/appLanguageLoading";

/**
 * Language switches update in place — never unmount the route outlet.
 * Marketing/settings switches may still use {@link beginAppLanguageChange}; guest QR uses
 * `changeCustomerJourneyLanguage` (`keepPageVisible`) so this flag stays false there.
 */
export function LanguageChangeLoadingRegistrar({ children }: { children: ReactNode }) {
  useSyncExternalStore(subscribeAppLanguageChange, isAppLanguageChangeActive, () => false);
  return <>{children}</>;
}
