import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";

export type BillingHandoffSession = {
  url: string;
  expiresAt: string;
  purpose: string;
  destinationPath: string;
};

/**
 * Request a short-lived authenticated web billing URL.
 * The URL contains a one-time handoff token — never the mobile access JWT.
 */
export async function createBillingHandoffSession(): Promise<BillingHandoffSession> {
  const { data } = await apiClient.post<BillingHandoffSession>(
    API_ENDPOINTS.mobile.createBillingSession,
    { purpose: "billing" },
  );
  if (!data?.url?.startsWith("http")) {
    throw new Error("Billing session URL was not returned.");
  }
  return data;
}
