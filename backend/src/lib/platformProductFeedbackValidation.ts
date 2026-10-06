export const PLATFORM_PRODUCT_FEEDBACK_COMMENT_MAX = 2000;

export type ParsedPlatformProductFeedbackPayload = {
  rating: number;
  comment: string | null;
};

export type PlatformProductFeedbackValidationError = {
  ok: false;
  message: string;
};

export type PlatformProductFeedbackValidationResult =
  | { ok: true; value: ParsedPlatformProductFeedbackPayload }
  | PlatformProductFeedbackValidationError;

const FORBIDDEN_OWNERSHIP_KEYS = [
  "userId",
  "user_id",
  "businessId",
  "business_id",
  "employeeId",
  "employee_id",
  "submitterRole",
  "submitter_role",
  "adminStatus",
  "admin_status",
] as const;

export function assertNoClientOwnershipFields(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const key of FORBIDDEN_OWNERSHIP_KEYS) {
    if (key in body) {
      return "Client-provided ownership fields are not allowed.";
    }
  }
  return null;
}

export function parsePlatformProductFeedbackPayload(
  body: unknown,
): PlatformProductFeedbackValidationResult {
  const ownershipErr = assertNoClientOwnershipFields(body);
  if (ownershipErr) return { ok: false, message: ownershipErr };

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid request body." };
  }

  const record = body as Record<string, unknown>;
  const ratingRaw = record.rating;
  const rating =
    typeof ratingRaw === "number"
      ? ratingRaw
      : typeof ratingRaw === "string"
        ? Number(ratingRaw)
        : NaN;

  if (!Number.isFinite(rating) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, message: "rating must be an integer between 1 and 5." };
  }

  let comment: string | null = null;
  if (record.comment !== undefined && record.comment !== null) {
    if (typeof record.comment !== "string") {
      return { ok: false, message: "comment must be a string." };
    }
    const trimmed = record.comment.trim();
    if (trimmed.length === 0) {
      return { ok: false, message: "comment cannot be empty." };
    }
    if (trimmed.length > PLATFORM_PRODUCT_FEEDBACK_COMMENT_MAX) {
      return { ok: false, message: "comment is too long." };
    }
    comment = trimmed;
  }

  return { ok: true, value: { rating, comment } };
}

export function parsePlatformProductFeedbackAdminStatus(
  raw: unknown,
): PlatformProductFeedbackAdminStatusParsed | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "new" || v === "read" || v === "archived") return v;
  return null;
}

export type PlatformProductFeedbackAdminStatusParsed = "new" | "read" | "archived";

export function computeRatingDistribution(
  rows: readonly { rating: number }[],
): Record<"1" | "2" | "3" | "4" | "5", number> {
  const dist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const row of rows) {
    const k = String(row.rating) as keyof typeof dist;
    if (k in dist) dist[k] += 1;
  }
  return dist;
}

export function computeAverageRating(rows: readonly { rating: number }[]): number | null {
  if (rows.length === 0) return null;
  const sum = rows.reduce((acc, r) => acc + r.rating, 0);
  return Math.round((sum / rows.length) * 10) / 10;
}
