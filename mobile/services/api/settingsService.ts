import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { MyAccountSettings, TwoFactorSetup, TwoFactorStatus } from "@/types/settings";
import type { EmployeeProfile } from "@/types/employee";

export async function fetchAccountSettings(): Promise<MyAccountSettings> {
  const { data } = await apiClient.get<MyAccountSettings>(API_ENDPOINTS.settings.me);
  return data;
}

export async function patchAccountSettings(
  patch: Partial<MyAccountSettings>,
): Promise<MyAccountSettings> {
  const { data } = await apiClient.patch<MyAccountSettings>(API_ENDPOINTS.settings.me, patch);
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post(API_ENDPOINTS.auth.changePassword, { currentPassword, newPassword });
}

export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
  const { data } = await apiClient.get<TwoFactorStatus>(API_ENDPOINTS.auth.twoFactorStatus);
  return data;
}

export async function setupTwoFactor(): Promise<TwoFactorSetup> {
  const { data } = await apiClient.post<TwoFactorSetup>(API_ENDPOINTS.auth.twoFactorSetup);
  return data;
}

export async function enableTwoFactor(code: string): Promise<TwoFactorStatus> {
  const { data } = await apiClient.post<TwoFactorStatus>(API_ENDPOINTS.auth.twoFactorEnable, { code });
  return data;
}

export async function disableTwoFactor(code: string): Promise<TwoFactorStatus> {
  const { data } = await apiClient.post<TwoFactorStatus>(API_ENDPOINTS.auth.twoFactorDisable, { code });
  return data;
}

export async function patchEmployeeProfile(
  patch: Partial<
    Pick<
      EmployeeProfile,
      "name" | "bio" | "emailNotifications" | "pushNotifications" | "monthlyGoal"
    >
  >,
): Promise<EmployeeProfile> {
  const { data } = await apiClient.patch<EmployeeProfile>(API_ENDPOINTS.employees.me, patch);
  return data;
}

export async function patchBusinessProfile(
  patch: Record<string, unknown>,
): Promise<unknown> {
  const { data } = await apiClient.patch(API_ENDPOINTS.business.profile, patch);
  return data;
}

export async function registerPushToken(token: string): Promise<void> {
  await apiClient.post(API_ENDPOINTS.push.tokens, { token });
}

export async function unregisterPushToken(token: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.push.tokens, { data: { token } });
}
