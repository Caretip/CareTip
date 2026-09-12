import { prisma } from "../prisma.js";
import { toEmployeePayoutConnectionState } from "../lib/employeePayoutConnectState.js";
import { stripeAccountSuffix } from "./connectAccountOwnership.service.js";

const ROSTER_TAKE = 200;

export type ManagerEmployeeStripeConnection = {
  id: string;
  name: string;
  connectionState: ReturnType<typeof toEmployeePayoutConnectionState>;
  accountSuffix: string | null;
};

/**
 * Snapshot of this business's employee Stripe connection states from DB only.
 * Does not call Stripe. Never returns full stripeAccountId.
 */
export async function listEmployeeStripeConnectionsForBusiness(
  businessId: string,
): Promise<{ employees: ManagerEmployeeStripeConnection[]; truncated: boolean }> {
  const rows = await prisma.employee.findMany({
    where: { businessId, isDeleted: false },
    select: {
      id: true,
      name: true,
      stripeAccount: {
        select: {
          stripeAccountId: true,
          stripeConnectStatus: true,
          stripePayoutsEnabled: true,
        },
      },
    },
    orderBy: { name: "asc" },
    take: ROSTER_TAKE,
  });

  const employees = rows.map((row) => {
    const accountId = row.stripeAccount?.stripeAccountId?.trim() ?? "";
    const hasAccount = Boolean(accountId);
    const suffix = hasAccount ? stripeAccountSuffix(accountId) : "";
    return {
      id: row.id,
      name: row.name,
      connectionState: toEmployeePayoutConnectionState(
        row.stripeAccount?.stripeConnectStatus ?? null,
        hasAccount,
        row.stripeAccount?.stripePayoutsEnabled === true,
      ),
      accountSuffix: suffix || null,
    };
  });

  return { employees, truncated: rows.length >= ROSTER_TAKE };
}
