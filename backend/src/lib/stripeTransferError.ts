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

/**
 * Stripe caches idempotent responses (including errors). Retries after transfer_failed
 * must use a fresh key derived from the failure timestamp.
 */
export function buildEmployeeTipReleaseIdempotencyKey(
  payableId: string,
  row: { status: EmployeeTipPayableStatus; updatedAt: Date },
): string {
  if (row.status === EmployeeTipPayableStatus.transfer_failed) {
    return `emp_tip_release:${payableId}:r${row.updatedAt.getTime()}`;
  }
  return `emp_tip_release:${payableId}`;
}
