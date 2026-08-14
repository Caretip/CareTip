import type { TFunction } from "i18next";
import { isApiRequestError } from "./apiError";
import { isAbortError } from "./errorMessages";

/** Count independent filter dimensions that restrict the result set (excludes sort-only). */
export function countRestrictiveFilterDimensions(parts: boolean[]): number {
  return parts.filter(Boolean).length;
}

export type ListEmptyStateCopy = {
  title: string;
  description?: string;
};

export type ListLoadErrorKind = "api" | "network" | "permission" | "unknown";

export function classifyFetchError(err: unknown): ListLoadErrorKind {
  if (isApiRequestError(err)) {
    if (err.status === 401 || err.status === 403) return "permission";
    if (err.status === 408 || err.status === 504 || err.status === 0) return "network";
    return "api";
  }
  if (isAbortError(err) || err instanceof TypeError) return "network";
  const message =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === "string"
        ? err.toLowerCase()
        : "";
  if (message.includes("403") || message.includes("unauthorized") || message.includes("forbidden")) {
    return "permission";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("timeout")) {
    return "network";
  }
  return "api";
}

export function listLoadErrorMessage(kind: ListLoadErrorKind, t: TFunction): string {
  switch (kind) {
    case "network":
      return t("common.listFilter.loadError.network");
    case "permission":
      return t("common.listFilter.loadError.permission");
    case "api":
      return t("common.listFilter.loadError.api");
    default:
      return t("common.listFilter.loadError.generic");
  }
}
