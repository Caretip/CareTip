import { prisma } from "../../prisma.js";
import { hasFeature } from "../subscriptionEntitlement.service.js";
import { PHYSICAL_QR_PROCESSING_TIMEZONE } from "../../lib/physicalQr/processing.js";
import {
  berlinCalendarMonthStart,
  isPhysicalQrFreeOrderUsedThisMonth,
  quotePhysicalQrPrints,
  type PhysicalQrQuote,
} from "../../lib/physicalQr/quote.js";

export {
  PHYSICAL_QR_PACKAGE_CENTS,
  PHYSICAL_QR_PACKAGE_INCLUDED_PRINTS,
  PHYSICAL_QR_EXTRA_PRINT_CENTS,
  PHYSICAL_QR_PRO_FREE_INCLUDED_PRINTS,
  berlinCalendarMonthStart,
  isPhysicalQrFreeOrderUsedThisMonth,
  quotePhysicalQrPrints,
  allocateQuoteAcrossQuantities,
  parseStoredPhysicalQrQuote,
  parsePhysicalQrQuotaClaimedAt,
  orderHasConsumedMonthlyFreeQuota,
  resolvePhysicalQrCheckoutQuote,
  shouldReleasePhysicalQrQuotaOnExpire,
  type PhysicalQrQuote,
  type PhysicalQrStoredQuote,
} from "../../lib/physicalQr/quote.js";

export async function isPhysicalQrPrintingIncludedEligible(businessId: string): Promise<boolean> {
  return hasFeature(businessId, "physicalQrPrintingIncluded");
}

type QuotaRow = { used_at: Date | null; timezone: string | null };

async function readPhysicalQrQuotaRow(businessId: string): Promise<QuotaRow | null> {
  const rows = await prisma.$queryRaw<QuotaRow[]>`
    SELECT physical_qr_free_order_used_at AS used_at, timezone
    FROM businesses
    WHERE id = ${businessId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function readPhysicalQrQuotaState(businessId: string): Promise<{
  usedAt: Date | null;
  timezone: string;
} | null> {
  const row = await readPhysicalQrQuotaRow(businessId);
  if (!row) return null;
  return {
    usedAt: row.used_at ?? null,
    timezone: row.timezone?.trim() || PHYSICAL_QR_PROCESSING_TIMEZONE,
  };
}

/**
 * Defense-in-depth: a PAID order that actually consumed the monthly free quota
 * (flag true) in this Berlin month. PENDING/abandoned orders do not count.
 * Used only when businesses.physical_qr_free_order_used_at still looks unused.
 */
export async function hasPaidPhysicalQrMonthlyFreeOrderThisMonth(
  businessId: string,
  monthStart: Date,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ consumed: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM physical_qr_orders
      WHERE business_id = ${businessId}
        AND payment_status::text = 'PAID'
        AND monthly_free_quota_applied = true
        AND paid_at IS NOT NULL
        AND paid_at >= ${monthStart}
    ) AS consumed
  `;
  return Boolean(rows[0]?.consumed);
}

export async function isPhysicalQrFreeOrderAvailable(
  businessId: string,
  now = new Date(),
): Promise<boolean> {
  if (!(await isPhysicalQrPrintingIncludedEligible(businessId))) return false;
  const row = await readPhysicalQrQuotaRow(businessId);
  if (!row) return false;
  const zone = row.timezone?.trim() || PHYSICAL_QR_PROCESSING_TIMEZONE;
  if (isPhysicalQrFreeOrderUsedThisMonth(row.used_at, now, zone)) return false;
  const monthStart = berlinCalendarMonthStart(now, zone);
  if (await hasPaidPhysicalQrMonthlyFreeOrderThisMonth(businessId, monthStart)) return false;
  return true;
}

/**
 * Atomically consume this Berlin calendar month's free Pro order.
 * Returns true only for the winner. Safe across concurrent checkouts.
 */
export async function tryClaimPhysicalQrMonthlyFreeOrder(input: {
  businessId: string;
  now?: Date;
  timezone?: string;
}): Promise<{ claimed: boolean; claimedAt: Date }> {
  const now = input.now ?? new Date();
  const zone = input.timezone?.trim() || PHYSICAL_QR_PROCESSING_TIMEZONE;
  const monthStart = berlinCalendarMonthStart(now, zone);
  const result = await prisma.$executeRaw`
    UPDATE businesses
    SET physical_qr_free_order_used_at = ${now}
    WHERE id = ${input.businessId}
      AND (physical_qr_free_order_used_at IS NULL OR physical_qr_free_order_used_at < ${monthStart})
  `;
  return { claimed: Number(result) === 1, claimedAt: now };
}

export async function releasePhysicalQrMonthlyFreeOrderClaim(input: {
  businessId: string;
  claimedAt: Date;
  previousUsedAt: Date | null;
}): Promise<void> {
  if (input.previousUsedAt) {
    await prisma.$executeRaw`
      UPDATE businesses
      SET physical_qr_free_order_used_at = ${input.previousUsedAt}
      WHERE id = ${input.businessId}
        AND physical_qr_free_order_used_at = ${input.claimedAt}
    `;
    return;
  }
  await prisma.$executeRaw`
    UPDATE businesses
    SET physical_qr_free_order_used_at = NULL
    WHERE id = ${input.businessId}
      AND physical_qr_free_order_used_at = ${input.claimedAt}
  `;
}

/** Clear this PENDING order's monthly-free flag after a safe claim release. */
export async function clearPhysicalQrOrderMonthlyFreeQuota(orderId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE physical_qr_orders
    SET monthly_free_quota_applied = false,
        pricing_snapshot = CASE
          WHEN pricing_snapshot IS NULL THEN NULL
          ELSE pricing_snapshot - 'quotaClaimedAt'
        END
    WHERE id = ${orderId}
      AND payment_status::text = 'PENDING'
  `;
}

/**
 * Persist Albertina columns without requiring a regenerated Prisma client.
 * monthly_free_quota_applied is consumption, not preview eligibility.
 * It is true only when this order has a quotaClaimedAt from a successful claim.
 */
export async function persistPhysicalQrAlbertinaOrderColumns(input: {
  orderId: string;
  quote: PhysicalQrQuote;
  quotaClaimedAt?: Date | string | null;
  items?: Array<{
    qrTargetUrl: string;
    locationId: string | null;
    locationName: string | null;
  }>;
}): Promise<void> {
  const snapshot: Record<string, unknown> = { ...input.quote };
  let claimedAtIso: string | null = null;
  if (input.quotaClaimedAt) {
    claimedAtIso =
      input.quotaClaimedAt instanceof Date
        ? input.quotaClaimedAt.toISOString()
        : String(input.quotaClaimedAt);
    if (claimedAtIso.trim()) snapshot.quotaClaimedAt = claimedAtIso;
    else claimedAtIso = null;
  }
  const consumed = Boolean(claimedAtIso);
  await prisma.$executeRawUnsafe(
    `UPDATE physical_qr_orders
     SET pricing_snapshot = $1::jsonb, monthly_free_quota_applied = $2
     WHERE id = $3`,
    JSON.stringify(snapshot),
    consumed,
    input.orderId,
  );
  for (const item of input.items ?? []) {
    await prisma.$executeRawUnsafe(
      `UPDATE physical_qr_order_items
       SET location_id = $1, location_name_snapshot = $2
       WHERE order_id = $3 AND qr_target_url_snapshot = $4`,
      item.locationId,
      item.locationName ? item.locationName.slice(0, 160) : null,
      input.orderId,
      item.qrTargetUrl,
    );
  }
}
