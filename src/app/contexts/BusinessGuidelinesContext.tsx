import {
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CareTipUsageGuidelinesDialog } from "@/app/components/business/CareTipUsageGuidelinesDialog";
import {
  BusinessGuidelinesReactContext,
  type BusinessGuidelinesContextValue,
} from "@/app/contexts/businessGuidelinesContextRef";

export function BusinessGuidelinesProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openGuidelines = useCallback(() => setOpen(true), []);
  const closeGuidelines = useCallback(() => setOpen(false), []);

  const value = useMemo<BusinessGuidelinesContextValue>(
    () => ({ openGuidelines, closeGuidelines }),
    [openGuidelines, closeGuidelines],
  );

  return (
    <BusinessGuidelinesReactContext.Provider value={value}>
      {children}
      <CareTipUsageGuidelinesDialog open={open} onOpenChange={setOpen} />
    </BusinessGuidelinesReactContext.Provider>
  );
}

export function useBusinessGuidelines() {
  const ctx = useContext(BusinessGuidelinesReactContext);
  if (!ctx) {
    throw new Error("useBusinessGuidelines must be used within BusinessGuidelinesProvider");
  }
  return ctx;
}
