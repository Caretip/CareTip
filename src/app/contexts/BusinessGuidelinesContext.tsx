import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CareTipUsageGuidelinesDialog } from "@/app/components/business/CareTipUsageGuidelinesDialog";

type BusinessGuidelinesContextValue = {
  openGuidelines: () => void;
  closeGuidelines: () => void;
};

const BusinessGuidelinesContext = createContext<BusinessGuidelinesContextValue | null>(null);

export function BusinessGuidelinesProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openGuidelines = useCallback(() => setOpen(true), []);
  const closeGuidelines = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ openGuidelines, closeGuidelines }),
    [openGuidelines, closeGuidelines],
  );

  return (
    <BusinessGuidelinesContext.Provider value={value}>
      {children}
      <CareTipUsageGuidelinesDialog open={open} onOpenChange={setOpen} />
    </BusinessGuidelinesContext.Provider>
  );
}

export function useBusinessGuidelines() {
  const ctx = useContext(BusinessGuidelinesContext);
  if (!ctx) {
    throw new Error("useBusinessGuidelines must be used within BusinessGuidelinesProvider");
  }
  return ctx;
}
