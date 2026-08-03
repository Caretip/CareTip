import { useQuery } from "@tanstack/react-query";
import { fetchBusinessCustomerFeedback } from "@/services/api/feedbackService";
import { queryStaleTimes } from "@/services/api/queryClient";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import { useAuth } from "@/hooks/useAuth";

export function useBusinessCustomerFeedback(take = 3) {
  const { isAuthenticated } = useAuth();
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  return useQuery({
    queryKey: [...keys.businessFeedback, take] as const,
    queryFn: () => fetchBusinessCustomerFeedback({ take, skip: 0 }),
    enabled: Boolean(isAuthenticated && userId),
    staleTime: queryStaleTimes.feedback,
  });
}
