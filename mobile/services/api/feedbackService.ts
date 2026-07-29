import { apiClient } from "@/services/api/client";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { CustomerFeedbackResponse } from "@/types/feedback";

export async function fetchBusinessCustomerFeedback(params?: {
  take?: number;
  skip?: number;
  employeeId?: string;
}): Promise<CustomerFeedbackResponse> {
  const { data } = await apiClient.get<CustomerFeedbackResponse>(API_ENDPOINTS.feedback.business, {
    params,
  });
  return data;
}
