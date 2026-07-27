import type { AxiosError } from "axios";

export type ApiErrorBody = {
  message?: string;
  code?: string;
  canResend?: boolean;
};

export type NormalizedApiError = {
  status: number | null;
  message: string;
  code?: string;
  isNetworkError: boolean;
  isTimeout: boolean;
  isUnauthorized: boolean;
  raw?: unknown;
};

export function normalizeApiError(error: unknown): NormalizedApiError {
  if (!error || typeof error !== "object") {
    return {
      status: null,
      message: "Something went wrong. Please try again.",
      isNetworkError: false,
      isTimeout: false,
      isUnauthorized: false,
      raw: error,
    };
  }

  const axiosError = error as AxiosError<ApiErrorBody>;
  const status = axiosError.response?.status ?? null;
  const code = axiosError.code;
  const isTimeout = code === "ECONNABORTED" || code === "ETIMEDOUT";
  const isNetworkError =
    !axiosError.response &&
    (axiosError.message === "Network Error" ||
      code === "ERR_NETWORK" ||
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND");
  const serverMessage = axiosError.response?.data?.message;
  const message =
    (typeof serverMessage === "string" && serverMessage.trim()) ||
    (isTimeout
      ? "Request timed out. The server took too long to respond."
      : isNetworkError
        ? "Could not reach the CareTip API. Check Wi‑Fi and that the backend is running."
        : axiosError.message || "Something went wrong. Please try again.");

  return {
    status,
    message,
    code: axiosError.response?.data?.code ?? (typeof code === "string" ? code : undefined),
    isNetworkError,
    isTimeout,
    isUnauthorized: status === 401,
    raw: error,
  };
}
