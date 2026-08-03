import { useQuery } from "@tanstack/react-query";
import { fetchBrandedQrImage } from "@/services/api/brandedQrService";
import type { BrandedQrViewerMode } from "@/types/qr";
import { useAuthUserId, useUserQueryKeys } from "@/services/api/queryKeys";

type UseBrandedQrImageOptions = {
  mode: BrandedQrViewerMode;
  targetUrl: string;
  enabled?: boolean;
  /** Increment on pull-to-refresh to bypass disk cache and revalidate with server. */
  reloadKey?: number;
};

export function useBrandedQrImage({
  mode,
  targetUrl,
  enabled = true,
  reloadKey = 0,
}: UseBrandedQrImageOptions) {
  const userId = useAuthUserId();
  const keys = useUserQueryKeys();
  const trimmedUrl = targetUrl.trim();
  const active = Boolean(userId) && enabled && Boolean(trimmedUrl);

  return useQuery({
    queryKey: [...keys.brandedQr(mode, trimmedUrl), reloadKey] as const,
    queryFn: () =>
      fetchBrandedQrImage({
        mode,
        targetUrl: trimmedUrl,
        bustCache: reloadKey > 0,
      }),
    enabled: active,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
