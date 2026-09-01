/**
 * Development/test timing for Physical QR checkout. Disabled in production unless
 * PHYSICAL_QR_PERF=1. Never logs secrets, tokens, PII, or Stripe payloads.
 */
const ENABLED =
  process.env.PHYSICAL_QR_PERF === "1" ||
  (process.env.NODE_ENV !== "production" && process.env.PHYSICAL_QR_PERF !== "0");

export function physicalQrPerfNow(): number {
  return Date.now();
}

export function logPhysicalQrPerf(
  stage: string,
  durationMs: number,
  extra?: { orderSuffix?: string; zeroCost?: boolean; reused?: boolean; skipped?: boolean },
): void {
  if (!ENABLED) return;
  const parts = [`[PhysicalQR][PERF]`, `stage=${stage}`, `durationMs=${Math.round(durationMs)}`];
  if (extra?.orderSuffix) parts.push(`order=${extra.orderSuffix}`);
  if (extra?.zeroCost === true) parts.push("zeroCost=true");
  if (extra?.zeroCost === false) parts.push("zeroCost=false");
  if (extra?.reused) parts.push("reused=true");
  if (extra?.skipped) parts.push("skipped=true");
  console.info(parts.join(" "));
}

export function physicalQrOrderSuffix(orderId: string): string {
  const id = String(orderId ?? "").trim();
  return id.length <= 6 ? id : id.slice(-6);
}
