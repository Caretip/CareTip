import type { PlatformProductFeedbackAdminStatus } from "@/app/lib/api";

export const PRODUCT_FEEDBACK_RATINGS = [1, 2, 3, 4, 5] as const;

export type ProductFeedbackRatingValue = (typeof PRODUCT_FEEDBACK_RATINGS)[number];

export function adminStatusLabelKey(status: PlatformProductFeedbackAdminStatus): string {
  return `productReview.admin.status.${status}`;
}

export function adminStatusTone(
  status: PlatformProductFeedbackAdminStatus,
): "neutral" | "attention" | "muted" {
  if (status === "new") return "attention";
  if (status === "read") return "neutral";
  return "muted";
}

export function ratingLabelKey(rating: number): string {
  return `productReview.rating.scale.${rating}`;
}

export function formatProductFeedbackDate(iso: string, locale?: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
