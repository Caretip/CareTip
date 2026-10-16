import { EmployeeTipPayableStatus } from "@prisma/client";

/** Compact, sanitized Stripe transfer error for DB storage (max 180 chars). */
export function formatStripeTransferError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      type?: string;
      code?: string;
      param?: string;
      requestId?: string;
      message?: string;
    };
    const head = [e.type?.replace(/^Stripe/, "") ?? "Error", e.code, e.param, e.requestId]
      .filter(Boolean)
      .join("|")
      .slice(0, 72);
    const msg = (e.message ?? "transfer_failed").replace(/\s+/g, " ").trim().slice(0, 96);
    return head ? `${head}:${msg}`.slice(0, 180) : msg.slice(0, 180);
  }
  if (err instanceof Error) return err.message.slice(0, 180);
  return "transfer_failed";
}

/** Stable key for first attempt and for reconciling uncertain / transferring outcomes. */
export function baseEmployeeTipReleaseIdempotencyKey(payableId: string): string {
  return `emp_tip_release:${payableId}`;
}

/**
 * Stripe caches idempotent responses (including errors). Retries after a *definite*
 * transfer_failed must use a fresh key derived from the failure timestamp.
 * Reconciliation always tries {@link baseEmployeeTipReleaseIdempotencyKey} first.
 */
export function buildEmployeeTipReleaseIdempotencyKey(
  payableId: string,
  row: { status: EmployeeTipPayableStatus; updatedAt: Date },
): string {
  if (row.status === EmployeeTipPayableStatus.transfer_failed) {
    return `emp_tip_release:${payableId}:r${row.updatedAt.getTime()}`;
  }
  return baseEmployeeTipReleaseIdempotencyKey(payableId);
}

/**
 * Network / timeout / 5xx — outcome may have succeeded on Stripe's side.
 * Do not mark transfer_failed (which forces a fresh idempotency key and risks a duplicate transfer).
 */
export function isUncertainEmployeeTipTransferError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    type?: string;
    code?: string;
    statusCode?: number;
    message?: string;
    raw?: { code?: string };
  };
  const code = String(e.code ?? e.raw?.code ?? "").toLowerCase();
  const type = String(e.type ?? "").toLowerCase();
  const msg = String(e.message ?? "").toLowerCase();
  if (type === "stripeconnectionerror" || type === "stripeapiconnectionerror") return true;
  if (code === "econnreset" || code === "etimedout" || code === "econnrefused" || code === "enotfound") {
    return true;
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("socket hang up")) {
    return true;
  }
  const status = e.statusCode;
  if (typeof status === "number" && status >= 500) return true;
  return false;
}

/** Definite Stripe rejection — safe to record transfer_failed and retry with a fresh key later. */
export function isDefiniteEmployeeTipTransferError(err: unknown): boolean {
  if (isUncertainEmployeeTipTransferError(err)) return false;
  if (err && typeof err === "object") {
    const type = String((err as { type?: string }).type ?? "").toLowerCase();
    if (type.includes("stripe") && type.includes("error")) return true;
  }
  if (err instanceof Error && err.message.trim()) return true;
  return Boolean(err);
}
