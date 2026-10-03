import { createContext, useContext, type ReactNode } from "react";

const MarketingShellContext = createContext(false);

export function MarketingShellProvider({ children }: { children: ReactNode }) {
  return <MarketingShellContext.Provider value={true}>{children}</MarketingShellContext.Provider>;
}

export function useMarketingShell(): boolean {
  return useContext(MarketingShellContext);
}
