import { normalizeApiError, type NormalizedApiError } from "@/types/api";

type ErrorListener = (error: NormalizedApiError) => void;

const listeners = new Set<ErrorListener>();

export function subscribeGlobalErrors(listener: ErrorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportGlobalError(error: unknown): NormalizedApiError {
  const normalized = normalizeApiError(error);
  listeners.forEach((listener) => {
    try {
      listener(normalized);
    } catch {
      /* never throw from reporter */
    }
  });
  if (__DEV__) {
    console.warn("[CareTip][API]", normalized.status, normalized.message, normalized.code);
  }
  return normalized;
}
