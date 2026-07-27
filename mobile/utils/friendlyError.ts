import { normalizeApiError } from "@/types/api";

const MESSAGE_MAP: Record<string, string> = {
  "Insufficient permissions":
    "This section isn’t available for your account role. Switch accounts or open CareTip on the web for full tools.",
  "Authentication required": "Please sign in again to continue.",
  "Account pending verification": "Your venue is still pending verification.",
};

export function isPermissionError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") {
    return (
      error === "Insufficient permissions" ||
      /403|forbidden|permission/i.test(error)
    );
  }
  const normalized = normalizeApiError(error);
  if (normalized.status === 403) return true;
  const raw = normalized.message || "";
  return (
    raw === "Insufficient permissions" || /forbidden|permission/i.test(raw)
  );
}

export function friendlyErrorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (typeof error === "string") {
    return MESSAGE_MAP[error] ?? error;
  }
  const normalized = normalizeApiError(error);
  const raw = normalized.message || fallback;
  return MESSAGE_MAP[raw] ?? raw;
}
