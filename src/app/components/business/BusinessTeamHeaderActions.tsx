import { createContext, useContext, useMemo, type ReactNode } from "react";

type BusinessTeamHeaderActionsContextValue = {
  setActions: (node: ReactNode) => void;
};

const BusinessTeamHeaderActionsContext = createContext<BusinessTeamHeaderActionsContextValue | null>(
  null,
);

export function BusinessTeamHeaderActionsProvider({
  setActions,
  children,
}: {
  setActions: (node: ReactNode) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ setActions }), [setActions]);
  return (
    <BusinessTeamHeaderActionsContext.Provider value={value}>
      {children}
    </BusinessTeamHeaderActionsContext.Provider>
  );
}

export function useBusinessTeamHeaderActions() {
  return useContext(BusinessTeamHeaderActionsContext);
}
