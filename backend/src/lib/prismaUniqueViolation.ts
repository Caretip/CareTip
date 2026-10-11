/** True when Prisma P2002 is on subscription_events.stripe_event_id (billing webhook dedupe). */
export function isPrismaUniqueViolationOnStripeEventId(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as { code?: string; meta?: { target?: unknown } };
  if (record.code !== "P2002") return false;
  const target = record.meta?.target;
  if (Array.isArray(target)) {
    return target.some(
      (field) => field === "stripe_event_id" || field === "stripeEventId",
    );
  }
  if (typeof target === "string") {
    return target.includes("stripe_event_id");
  }
  return false;
}
