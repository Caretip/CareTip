/** Shared FlatList tuning — tips, notifications, activity feeds. */
export const LIST_PERF = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 10,
  windowSize: 7,
  removeClippedSubviews: true,
} as const;

/** Smaller lists (QR studio, compact pickers). */
export const LIST_PERF_COMPACT = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 6,
  windowSize: 5,
  removeClippedSubviews: true,
} as const;
