import type { CustomerFeedbackRow } from "./api";

/** Dominant tag from an in-memory feedback list (e.g. dashboard teaser). */
export function dominantFeedbackTagFromItems(items: CustomerFeedbackRow[]): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [tag, count] of counts) {
    if (count > bestCount) {
      best = tag;
      bestCount = count;
    }
  }
  return best;
}

/** Written-comment rate for a loaded slice (same heuristic as Customer Feedback page). */
export function feedbackCommentRateFromItems(items: CustomerFeedbackRow[]): number | null {
  if (items.length === 0) return null;
  const withComment = items.filter((item) => Boolean(item.comment?.trim())).length;
  return Math.round((withComment / items.length) * 100);
}
