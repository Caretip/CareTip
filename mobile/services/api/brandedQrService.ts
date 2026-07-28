import { apiClient } from "@/services/api/client";
import type { AxiosError } from "axios";
import { API_ENDPOINTS } from "@/constants/endpoints";
import type { BrandedQrViewerMode } from "@/types/qr";
import { normalizeApiError } from "@/types/api";
import {
  brandedQrStorageKey,
  loadBrandedQrImageCache,
  saveBrandedQrImageCache,
} from "@/utils/brandedQrImageCache";

export type BrandedQrImageResult = {
  dataUri: string;
  etag: string;
  fromCache: boolean;
  fallback?: "standard";
  lastUpdated?: string;
};

type BrandedQrApiSuccess = {
  success: true;
  imageUrl: string;
  lastUpdated: string;
  brandingVersion: string;
  fallback?: "standard";
};

type BrandedQrApiError = {
  success: false;
  message: string;
  code?: string;
};

export class BrandedQrFetchError extends Error {
  readonly status: number | null;
  readonly code?: string;

  constructor(message: string, status: number | null, code?: string) {
    super(message);
    this.name = "BrandedQrFetchError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchBrandedQrImage(options: {
  mode: BrandedQrViewerMode;
  targetUrl: string;
  bustCache?: boolean;
}): Promise<BrandedQrImageResult> {
  const { mode, targetUrl, bustCache } = options;
  const trimmedUrl = targetUrl.trim();
  if (!trimmedUrl && mode === "manager") {
    throw new BrandedQrFetchError("targetUrl is required for manager branded QR", 400);
  }

  const storageKey = brandedQrStorageKey(mode, trimmedUrl);
  const disk = bustCache ? null : await loadBrandedQrImageCache(storageKey);

  const path =
    mode === "employee"
      ? API_ENDPOINTS.employees.brandedQr
      : API_ENDPOINTS.business.brandedQr;

  try {
    const { data, headers } = await apiClient.get<BrandedQrApiSuccess | BrandedQrApiError>(path, {
      params: mode === "manager" ? { targetUrl: trimmedUrl } : undefined,
      headers: disk?.etag ? { "If-None-Match": `"${disk.etag}"` } : undefined,
      validateStatus: (status) => status === 200 || status === 304,
    });

    if (data && typeof data === "object" && "success" in data && data.success === false) {
      throw new BrandedQrFetchError(data.message || "Branded QR not found", 404, data.code);
    }

    if (disk && (headers.etag === `"${disk.etag}"` || headers.etag === disk.etag)) {
      return { dataUri: disk.dataUri, etag: disk.etag, fromCache: true };
    }

    const payload = data as BrandedQrApiSuccess;
    if (!payload?.imageUrl) {
      throw new BrandedQrFetchError("Branded QR not found", 404, "BRANDED_QR_NOT_FOUND");
    }

    const etag = payload.brandingVersion || disk?.etag || "";
    if (etag) {
      await saveBrandedQrImageCache(storageKey, { dataUri: payload.imageUrl, etag });
    }

    return {
      dataUri: payload.imageUrl,
      etag,
      fromCache: false,
      fallback: payload.fallback,
      lastUpdated: payload.lastUpdated,
    };
  } catch (error) {
    if (disk && !bustCache) {
      return { dataUri: disk.dataUri, etag: disk.etag, fromCache: true };
    }

    if (error instanceof BrandedQrFetchError) throw error;

    const axiosErr = error as AxiosError<BrandedQrApiError>;
    const status = axiosErr.response?.status ?? normalizeApiError(error).status;
    const apiBody = axiosErr.response?.data;
    const message =
      (typeof apiBody?.message === "string" && apiBody.message.trim()) ||
      normalizeApiError(error).message;
    const code = typeof apiBody?.code === "string" ? apiBody.code : undefined;
    throw new BrandedQrFetchError(message, status, code);
  }
}
