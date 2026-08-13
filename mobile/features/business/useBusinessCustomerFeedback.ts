import { useQuery } from "@tanstack/react-query";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { fetchBusinessCustomerFeedback } from "@/services/api/feedbackService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { isPremiumAnalyticsTier } from "@/utils/businessStatsScope";

/**
 * Customer feedback is Premium (`customerFeedback`). Do not call on Basic.
 */
export function useBusinessCustomerFeedback(take = 3) {
  const { isAuthenticated } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const scoped = Boolean(isAuthenticated && userId);

  const profileQuery = useQuery({
    queryKey: keys.businessProfile,
    queryFn: fetchBusinessProfile,
    enabled: scoped,
    staleTime: queryStaleTimes.profile,
  });

  const premiumTier = isPremiumAnalyticsTier(profileQuery.data?.subscriptionTier);
  const isGated = profileQuery.isSuccess && !premiumTier;

  const feedbackQuery = useQuery({
    queryKey: [...keys.businessFeedback, take] as const,
    queryFn: () => fetchBusinessCustomerFeedback({ take, skip: 0 }),
    enabled: scoped && premiumTier && profileQuery.isSuccess,
    staleTime: queryStaleTimes.feedback,
  });

  return {
    data: feedbackQuery.data,
    error: feedbackQuery.error,
    isLoading:
      (profileQuery.isLoading && !profileQuery.data) ||
      (Boolean(premiumTier) && feedbackQuery.isLoading && !feedbackQuery.data),
    isRefreshing: feedbackQuery.isRefetching,
    premiumTier,
    isGated,
    refetch: feedbackQuery.refetch,
  };
}
