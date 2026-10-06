import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/app/components/ui/sheet";
import type { PlatformProductFeedbackAdminItem, PlatformProductFeedbackAdminStatus } from "@/app/lib/api";
import { ProductFeedbackStatusBadge } from "./ProductFeedbackStatusBadge";
import { formatProductFeedbackDate } from "./productFeedbackPresentation";
import { ProductFeedbackStarRating } from "./ProductFeedbackStarRating";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Label } from "@/app/components/ui/label";
import { InlineSpinner } from "@/app/components/dashboard/DashboardSectionLoading";
import { cn } from "@/lib/utils";

const STATUSES: PlatformProductFeedbackAdminStatus[] = ["new", "read", "archived"];

type ProductFeedbackAdminDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedback: PlatformProductFeedbackAdminItem | null;
  loading: boolean;
  statusUpdating: boolean;
  onStatusChange: (status: PlatformProductFeedbackAdminStatus) => void;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="product-feedback-admin-sheet__row">
      <dt className="product-feedback-admin-sheet__row-label">{label}</dt>
      <dd className="product-feedback-admin-sheet__row-value">{value}</dd>
    </div>
  );
}

export function ProductFeedbackAdminDetailSheet({
  open,
  onOpenChange,
  feedback,
  loading,
  statusUpdating,
  onStatusChange,
}: ProductFeedbackAdminDetailSheetProps) {
  const { t, i18n } = useTranslation();

  const commentText =
    feedback?.comment?.trim() || t("productReview.submitted.noComment");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        overlayClassName="product-feedback-admin-sheet-overlay"
        className={cn(
          "product-feedback-admin-sheet",
          "flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(100%,30rem)]",
          "data-[state=closed]:duration-200 data-[state=open]:duration-200",
        )}
      >
        <header className="product-feedback-admin-sheet__header">
          <SheetTitle className="product-feedback-admin-sheet__title">
            {t("productReview.admin.detail.title")}
          </SheetTitle>
          <SheetDescription className="product-feedback-admin-sheet__subtitle">
            {t("productReview.admin.detail.subtitle")}
          </SheetDescription>
          <p className="product-feedback-admin-sheet__meta">{t("productReview.admin.detail.authenticatedUser")}</p>
        </header>

        <div className="product-feedback-admin-sheet__scroll" aria-busy={loading}>
          {loading ? (
            <div className="flex justify-center py-16">
              <InlineSpinner />
            </div>
          ) : feedback ? (
            <div className="product-feedback-admin-sheet__content">
              <div className="product-feedback-admin-sheet__status-row">
                <ProductFeedbackStatusBadge status={feedback.adminStatus} />
                <time
                  className="product-feedback-admin-sheet__date"
                  dateTime={feedback.createdAt}
                >
                  {formatProductFeedbackDate(feedback.createdAt, i18n.language)}
                </time>
              </div>

              <section className="product-feedback-admin-sheet__rating-block" aria-label={t("productReview.admin.detail.rating")}>
                <ProductFeedbackStarRating
                  value={feedback.rating}
                  readOnly
                  showLabel={false}
                  aria-label={t("productReview.admin.detail.ratingAria", { rating: feedback.rating })}
                />
                <p className="product-feedback-admin-sheet__rating-score">
                  {t("productReview.admin.detail.ratingOutOf", { rating: feedback.rating })}
                </p>
              </section>

              <section className="product-feedback-admin-sheet__section" aria-labelledby="pfc-admin-feedback-heading">
                <h3 id="pfc-admin-feedback-heading" className="product-feedback-admin-sheet__section-title">
                  {t("productReview.admin.detail.comment")}
                </h3>
                <div className="product-feedback-admin-sheet__feedback-body">
                  <p className="whitespace-pre-wrap">{commentText}</p>
                </div>
              </section>

              <section className="product-feedback-admin-sheet__section" aria-labelledby="pfc-admin-submission-heading">
                <h3 id="pfc-admin-submission-heading" className="product-feedback-admin-sheet__section-title">
                  {t("productReview.admin.detail.submissionDetails")}
                </h3>
                <dl className="product-feedback-admin-sheet__details">
                  <DetailRow
                    label={t("productReview.admin.detail.email")}
                    value={feedback.userEmail ?? "—"}
                  />
                  <DetailRow
                    label={t("productReview.admin.detail.role")}
                    value={t(`productReview.admin.role.${feedback.submitterRole}`)}
                  />
                  {feedback.businessName ? (
                    <DetailRow
                      label={t("productReview.admin.detail.business")}
                      value={feedback.businessName}
                    />
                  ) : null}
                  {feedback.employeeName ? (
                    <DetailRow
                      label={t("productReview.admin.detail.employee")}
                      value={feedback.employeeName}
                    />
                  ) : null}
                </dl>
              </section>

              <section className="product-feedback-admin-sheet__section product-feedback-admin-sheet__section--last" aria-labelledby="pfc-admin-status-heading">
                <h3 id="pfc-admin-status-heading" className="product-feedback-admin-sheet__section-title">
                  {t("productReview.admin.detail.statusField")}
                </h3>
                <div className="product-feedback-admin-sheet__status-select">
                  <Label htmlFor="pfc-admin-status" className="sr-only">
                    {t("productReview.admin.detail.statusField")}
                  </Label>
                  <Select
                    value={feedback.adminStatus}
                    onValueChange={(v) => onStatusChange(v as PlatformProductFeedbackAdminStatus)}
                    disabled={statusUpdating}
                  >
                    <SelectTrigger id="pfc-admin-status" className="product-feedback-admin-sheet__select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`productReview.admin.status.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
