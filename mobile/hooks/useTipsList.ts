import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchBusinessTips, fetchEmployeeTipsList } from "@/services/api/tipsService";
import { queryKeys } from "@/services/api/queryClient";
import type { TipListParams } from "@/types/tips";

const PAGE_SIZE = 50;

export function useBusinessTipsList(params: Omit<TipListParams, "take" | "skip"> = {}) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.businessTips, params] as const,
    queryFn: ({ pageParam = 0 }) =>
      fetchBusinessTips({ ...params, take: PAGE_SIZE, skip: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      const next = lastPageParam + PAGE_SIZE;
      return next < lastPage.total ? next : undefined;
    },
  });
}

export function useEmployeeTipsList(params: Omit<TipListParams, "take" | "skip"> = {}) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.employeeTipList, params] as const,
    queryFn: ({ pageParam = 0 }) =>
      fetchEmployeeTipsList({ ...params, take: PAGE_SIZE, skip: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      const next = lastPageParam + PAGE_SIZE;
      return next < lastPage.total ? next : undefined;
    },
  });
}
