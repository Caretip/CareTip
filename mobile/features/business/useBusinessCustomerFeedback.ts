import { useQuery } from "@tanstack/react-query";
import { fetchBusinessCustomerFeedback } from "@/services/api/feedbackService";
import { queryKeys, queryStaleTimes } from "@/services/api/queryClient";
import { useAuth } from "@/hooks/useAuth";

export function useBusinessCustomerFeedback(take = 3) {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: [...queryKeys.businessFeedback, take] as const,
    queryFn: () => fetchBusinessCustomerFeedback({ take, skip: 0 }),
    enabled: isAuthenticated,
    staleTime: queryStaleTimes.feedback,
  });
}
