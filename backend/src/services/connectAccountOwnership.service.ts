import { prisma } from "../prisma.js";

export type ConnectAccountAttribution =
  | { kind: "business"; businessId: string }
  | { kind: "employee"; employeeId: string; employeeStripeAccountId: string }
  | { kind: "collision"; businessId: string; employeeId: string }
  | { kind: "unknown" };

/**
 * Attribute a Stripe connected-account id from DB mappings only.
 * Never uses client input or Checkout metadata.
 */
export async function attributeStripeConnectAccount(
  stripeAccountId: string,
): Promise<ConnectAccountAttribution> {
  const accountId = stripeAccountId.trim();
  if (!accountId.startsWith("acct_")) return { kind: "unknown" };

  const [business, employeeRow] = await Promise.all([
    prisma.business.findFirst({
      where: { stripeAccountId: accountId },
      select: { id: true },
    }),
    prisma.employeeStripeAccount.findUnique({
      where: { stripeAccountId: accountId },
      select: { id: true, employeeId: true },
    }),
  ]);

  if (business && employeeRow) {
    console.error("[stripe.connect] account_id_collision", {
      businessId: business.id,
      employeeId: employeeRow.employeeId,
      accountSuffix: accountId.slice(-8),
    });
    return {
      kind: "collision",
      businessId: business.id,
      employeeId: employeeRow.employeeId,
    };
  }
  if (business) return { kind: "business", businessId: business.id };
  if (employeeRow) {
    return {
      kind: "employee",
      employeeId: employeeRow.employeeId,
      employeeStripeAccountId: employeeRow.id,
    };
  }
  return { kind: "unknown" };
}

export function stripeAccountSuffix(accountId: string): string {
  const trimmed = accountId.trim();
  if (trimmed.length < 4) return "";
  return trimmed.slice(-4);
}
