import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { BillingSyncSnapshot } from "@/utils/billingReturnSyncPolicy";

export type BillingSyncStatus = BillingSyncSnapshot & {
  isTrial?: boolean;
  hasStripeBilling?: boolean;
};

/**
 * GET /api/me/billing/sync-status — manager-only.
 * May activate the Stripe mirror when webhook lag leaves status at none.
 */
export async function fetchBillingSyncStatus(expectedPlan?: string): Promise<BillingSyncStatus> {
  const { data } = await apiClient.get<BillingSyncStatus>(API_ENDPOINTS.billing.syncStatus, {
    params: expectedPlan ? { expectedPlan } : undefined,
  });
  return data;
}
