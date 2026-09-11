import { createContext, useContext, useMemo, type ReactNode } from "react";

type BusinessStripeHeaderActionsContextValue = {
  setActions: (node: ReactNode) => void;
};

const BusinessStripeHeaderActionsContext = createContext<BusinessStripeHeaderActionsContextValue | null>(
  null,
);

export function BusinessStripeHeaderActionsProvider({
  setActions,
  children,
}: {
  setActions: (node: ReactNode) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ setActions }), [setActions]);
  return (
    <BusinessStripeHeaderActionsContext.Provider value={value}>
      {children}
    </BusinessStripeHeaderActionsContext.Provider>
  );
}

export function useBusinessStripeHeaderActions() {
  return useContext(BusinessStripeHeaderActionsContext);
}
