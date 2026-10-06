import { ProductFeedbackModalProvider } from "./ProductFeedbackModalContext";
import { ProductFeedbackModal } from "./ProductFeedbackModal";

/** Mount once per manager/employee dashboard shell. */
export function ProductFeedbackModalHost({ children }: { children: React.ReactNode }) {
  return (
    <ProductFeedbackModalProvider>
      {children}
      <ProductFeedbackModal />
    </ProductFeedbackModalProvider>
  );
}
