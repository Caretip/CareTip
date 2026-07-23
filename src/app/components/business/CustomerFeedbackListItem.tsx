import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CustomerFeedbackRow } from "@/app/lib/api";
import { formatVenueDateTime, resolveBusinessTimezone } from "@/app/lib/businessVenueTime";
import { cn } from "@/lib/utils";

const PREVIEW_MAX_CHARS = 160;

type CustomerFeedbackListItemProps = {
  item: CustomerFeedbackRow;
  className?: string;
};

function StarRating({ rating, className }: { rating: number | null; className?: string }) {
  if (rating == null) return null;
  const rounded = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <div
      className={cn(
        "business-dashboard-feedback-item__rating flex items-center gap-0.5",
        className,
      )}
      aria-label={`${rating} / 5`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i < rounded ? "fill-primary text-primary" : "text-muted-foreground/30",
          )}
          aria-hidden
        />
      ))}
      <span className="ml-1 text-xs font-semibold tabular-nums text-foreground/80">{rating}</span>
    </div>
  );
}

export function CustomerFeedbackListItem({ item, className }: CustomerFeedbackListItemProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const comment = item.comment?.trim() ?? "";
  const hasLongComment = comment.length > PREVIEW_MAX_CHARS;
  const displayComment = useMemo(() => {
    if (!comment) return "";
    if (expanded || !hasLongComment) return comment;
    return `${comment.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…`;
  }, [comment, expanded, hasLongComment]);

  const visitDate = useMemo(() => {
    return formatVenueDateTime(item.createdAt, resolveBusinessTimezone(), i18n.language || "en", {
      dateStyle: "medium",
      timeStyle: null,
    });
  }, [item.createdAt, i18n.language]);

  const customerLabel =
    item.customerName?.trim() || t("business.customerFeedback.anonymousGuest");

  return (
    <article
      className={cn(
        "business-dashboard-feedback-item group rounded-xl border border-border/70 bg-card p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-md sm:p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="business-dashboard-feedback-item__guest">{customerLabel}</h3>
            <p className="business-dashboard-feedback-item__staff">
              <span className="text-muted-foreground/70">
                {t("business.customerFeedback.servedBy")}{" "}
              </span>
              {item.employeeName}
            </p>
          </div>
          <StarRating rating={item.rating} />
        </div>
        <time
          className="business-dashboard-feedback-item__time shrink-0"
          dateTime={item.createdAt}
        >
          {t("business.customerFeedback.visitDate", { date: visitDate })}
        </time>
      </div>

      {comment ? (
        <div className="mt-3 space-y-2">
          <p className="business-dashboard-feedback-item__comment whitespace-pre-wrap">
            {displayComment}
          </p>
          {hasLongComment ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {expanded
                ? t("business.customerFeedback.showLess")
                : t("business.customerFeedback.readFullMessage")}
            </button>
          ) : null}
        </div>
      ) : null}

      {item.tags.length > 0 ? (
        <ul
          className="mt-3 flex flex-wrap gap-1.5"
          aria-label={t("business.customerFeedback.tagsAria")}
        >
          {item.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-muted/80 px-2.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
