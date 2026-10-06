import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { useProductFeedbackModal } from "./ProductFeedbackModalContext";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { InlineSpinner } from "@/app/components/dashboard/DashboardSectionLoading";

const ProductFeedbackModalContent = lazy(() =>
  import("./ProductFeedbackModalContent").then((m) => ({ default: m.ProductFeedbackModalContent })),
);

export function ProductFeedbackModal() {
  const { t } = useTranslation();
  const { open, setProductFeedbackOpen } = useProductFeedbackModal();
  const isMobile = useMediaQuery("(max-width: 639px)");

  return (
    <Dialog open={open} onOpenChange={setProductFeedbackOpen}>
      <DialogContent
        overlayClassName="product-feedback-modal-overlay"
        className={cn(
          "product-feedback-modal-dialog gap-0 overflow-hidden border p-0 sm:max-w-none",
          isMobile &&
            "top-auto bottom-0 left-[50%] max-h-[min(92vh,680px)] w-[calc(100%-1rem)] max-w-none translate-x-[-50%] translate-y-0 rounded-b-none data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          !isMobile && "rounded-[1.25rem]",
        )}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t("productReview.modal.composerHeadline")}</DialogTitle>
        <DialogDescription className="sr-only">{t("productReview.modal.composerLead")}</DialogDescription>
        <Suspense
          fallback={
            <div className="product-feedback-modal__shell" aria-busy="true">
              <div className="flex min-h-[20rem] items-center justify-center">
                <InlineSpinner />
              </div>
            </div>
          }
        >
          <ProductFeedbackModalContent open={open} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
