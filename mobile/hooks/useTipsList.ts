import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchBusinessTips, fetchEmployeeTipsList } from "@/services/api/tipsService";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";
import type { TipListParams } from "@/types/tips";

const PAGE_SIZE = 50;

type TipsListOptions = {
  enabled?: boolean;
};

export function useBusinessTipsList(
  params: Omit<TipListParams, "take" | "skip"> = {},
  options: TipsListOptions = {},
) {
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  return useInfiniteQuery({
    queryKey: [...keys.businessTips, params] as const,
    queryFn: ({ pageParam = 0 }) =>
      fetchBusinessTips({ ...params, take: PAGE_SIZE, skip: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      const next = lastPageParam + PAGE_SIZE;
      return next < lastPage.total ? next : undefined;
    },
    enabled: Boolean(userId) && (options.enabled ?? true),
  });
}

export function useEmployeeTipsList(
  params: Omit<TipListParams, "take" | "skip"> = {},
  options: TipsListOptions = {},
) {
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  return useInfiniteQuery({
    queryKey: [...keys.employeeTipList, params] as const,
    queryFn: ({ pageParam = 0 }) =>
      fetchEmployeeTipsList({ ...params, take: PAGE_SIZE, skip: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      const next = lastPageParam + PAGE_SIZE;
      return next < lastPage.total ? next : undefined;
    },
    enabled: Boolean(userId) && (options.enabled ?? true),
  });
}
