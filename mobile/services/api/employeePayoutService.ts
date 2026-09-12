import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { InstantPayoutReason } from "@/features/employee/payouts/employeeInstantPayoutPresentation";

export type EmployeePayoutConnectionState =
  | "not_connected"
  | "setup_required"
  | "action_required"
  | "restricted"
  | "connected";

export type EmployeeConnectStatus = {
  connectionState: EmployeePayoutConnectionState;
  stripeConfigured: boolean;
  hasAccount: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  canOpenDashboard: boolean;
  updatedAt: string | null;
  employeeTipPayoutMode?: "direct_to_employee" | "business_distribution";
};

export type EmployeeInstantEligibility = {
  connected: boolean;
  eligible: boolean;
  reason: InstantPayoutReason | string;
  payoutsEnabled: boolean;
  currency: string | null;
  instantAvailableGrossCents: number;
  instantAvailableNetCents: number;
  availableCents: number;
  pendingCents: number;
  balancesRetrieved?: boolean;
  platformFeeCents: number;
  feeConfigured: boolean;
  targetTotalFeeBps: number;
  displayedFeeBps: number | null;
  destinationLast4: string | null;
  destinationKind: "card" | "bank_account" | null;
  canOpenExpressDashboard: boolean;
  minPayoutCents: number;
  stakeholderMinCents?: number;
  stripeMinCents?: number;
  feeSource?: "stripe_platform_pricing" | "unknown";
};

export type EmployeeInstantPayoutResult = {
  requestId: string;
  amountCents: number;
  currency: string;
  status: "pending" | "submitted" | "failed" | string;
  method: "instant";
};

export type EmployeeStripeBankPayoutItem = {
  stripePayoutId?: string | null;
  createdAt: string;
  arrivalDate?: string | null;
  amountCents: number;
  currency: string;
  status: string;
  method: "instant" | "standard" | "unknown";
  destinationLast4?: string | null;
};

export type EmployeePayableActivityItem = {
  id: string;
  createdAt: string;
  status: string;
  payableCents: number;
  transferredCents: number;
  reversedCents: number;
  refundedCents: number;
  remainingPayableCents: number;
  disputedOpenCents: number;
  disputedLostCents: number;
  activityCents: number;
};

export function newEmployeeInstantIdempotencyKey(): string {
  return `eip_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

let employeeInstantPayoutInFlight = false;

export function isEmployeeInstantPayoutInFlight(): boolean {
  return employeeInstantPayoutInFlight;
}

export async function fetchEmployeeConnectStatus(): Promise<EmployeeConnectStatus> {
  const { data } = await apiClient.get<EmployeeConnectStatus>(API_ENDPOINTS.employees.connectStatus);
  return data;
}

export async function fetchEmployeeInstantPayoutEligibility(): Promise<EmployeeInstantEligibility> {
  const { data } = await apiClient.get<EmployeeInstantEligibility>(API_ENDPOINTS.employees.instantPayout);
  return data;
}

export async function requestEmployeeInstantPayout(idempotencyKey: string): Promise<{
  payout: EmployeeInstantPayoutResult;
  eligibility: EmployeeInstantEligibility;
}> {
  if (employeeInstantPayoutInFlight) {
    return Promise.reject(new Error("INSTANT_IN_FLIGHT"));
  }
  employeeInstantPayoutInFlight = true;
  try {
    const { data } = await apiClient.post<{
      payout: EmployeeInstantPayoutResult;
      eligibility: EmployeeInstantEligibility;
    }>(API_ENDPOINTS.employees.instantPayout, { idempotencyKey });
    return data;
  } finally {
    employeeInstantPayoutInFlight = false;
  }
}

export async function fetchEmployeeStripeBankPayouts(): Promise<{
  items: EmployeeStripeBankPayoutItem[];
  stripeReadable: boolean;
}> {
  const { data } = await apiClient.get<{ items: EmployeeStripeBankPayoutItem[]; stripeReadable: boolean }>(
    API_ENDPOINTS.employees.stripePayouts,
    { params: { take: 50 } },
  );
  return data;
}

export async function fetchEmployeePayableActivity(): Promise<{
  items: EmployeePayableActivityItem[];
  total: number;
}> {
  const { data } = await apiClient.get<{ items: EmployeePayableActivityItem[]; total: number }>(
    API_ENDPOINTS.employees.payables,
    { params: { take: 50, skip: 0 } },
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
