import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";

export type EmployeeInstantEligibility = {
  eligible: boolean;
  reason: string;
  instantAvailableNetCents: number;
  minPayoutCents: number;
  platformFeeCents: number;
  feeConfigured: boolean;
  displayedFeeBps: number | null;
};

export type EmployeeStripeBankPayoutItem = {
  createdAt: string;
  amountCents: number;
  currency: string;
  status: string;
  method: "instant" | "standard" | "unknown";
};

function newIdempotencyKey(): string {
  return `eip_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function fetchEmployeeInstantPayoutEligibility(): Promise<EmployeeInstantEligibility> {
  const { data } = await apiClient.get<EmployeeInstantEligibility>(API_ENDPOINTS.employees.instantPayout);
  return data;
}

export async function requestEmployeeInstantPayout(): Promise<{
  eligibility: EmployeeInstantEligibility;
}> {
  const { data } = await apiClient.post<{ eligibility: EmployeeInstantEligibility }>(
    API_ENDPOINTS.employees.instantPayout,
    { idempotencyKey: newIdempotencyKey() },
  );
  return data;
}

export async function fetchEmployeeStripeBankPayouts(): Promise<{
  items: EmployeeStripeBankPayoutItem[];
  stripeReadable: boolean;
}> {
  const { data } = await apiClient.get<{ items: EmployeeStripeBankPayoutItem[]; stripeReadable: boolean }>(
    API_ENDPOINTS.employees.stripePayouts,
    { params: { take: 20 } },
  );
  return data;
}

export async function openEmployeeStripeDashboard(): Promise<{ url: string }> {
  const { data } = await apiClient.post<{ url: string }>(API_ENDPOINTS.employees.connectLoginLink, {});
  return data;
}

export async function startEmployeeStripeUpdate(): Promise<{ url: string }> {
  const { data } = await apiClient.post<{ url: string }>(API_ENDPOINTS.employees.connectAccountLink, {});
  return data;
}

export async function reactivateEmployeeReceiving(): Promise<{ receivingPaused: boolean }> {
  const { data } = await apiClient.post<{ receivingPaused: boolean }>(
    API_ENDPOINTS.employees.reactivateReceiving,
    {},
  );
  return data;
}
