import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ProductFeedbackModalContextValue = {
  open: boolean;
  openProductFeedback: () => void;
  closeProductFeedback: () => void;
  setProductFeedbackOpen: (open: boolean) => void;
};

const ProductFeedbackModalContext = createContext<ProductFeedbackModalContextValue | null>(null);

export function ProductFeedbackModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openProductFeedback = useCallback(() => setOpen(true), []);
  const closeProductFeedback = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({
      open,
      openProductFeedback,
      closeProductFeedback,
      setProductFeedbackOpen: setOpen,
    }),
    [open, openProductFeedback, closeProductFeedback],
  );

  return <ProductFeedbackModalContext.Provider value={value}>{children}</ProductFeedbackModalContext.Provider>;
}

export function useProductFeedbackModal(): ProductFeedbackModalContextValue {
  const ctx = useContext(ProductFeedbackModalContext);
  if (!ctx) {
    throw new Error("useProductFeedbackModal must be used within ProductFeedbackModalProvider");
  }
  return ctx;
}
