import type { OnboardingVerificationStatus } from "./api";

const ACK_PREFIX = "caretip.onboardingVerificationOutcome.";

export type OnboardingVerificationOutcome = "approved" | "rejected";

/** Same-tab fallback when localStorage is unavailable; also blocks concurrent double-toasts. */
const memoryAck = new Map<string, OnboardingVerificationOutcome>();

function ackStorageKey(businessId: string): string {
  return `${ACK_PREFIX}${businessId.trim()}`;
}

function readAck(businessId: string): OnboardingVerificationOutcome | null {
  const id = businessId.trim();
  if (!id) return null;

  const fromMemory = memoryAck.get(id);
  if (fromMemory) return fromMemory;

  try {
    const raw = localStorage.getItem(ackStorageKey(id));
    if (raw === "approved" || raw === "rejected") {
      memoryAck.set(id, raw);
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

function writeAck(businessId: string, outcome: OnboardingVerificationOutcome): void {
  const id = businessId.trim();
  if (!id) return;
  memoryAck.set(id, outcome);
  try {
    localStorage.setItem(ackStorageKey(id), outcome);
  } catch {
    // ignore quota / private mode — memory map still dedupes this tab
  }
}

function clearAck(businessId: string): void {
  const id = businessId.trim();
  if (!id) return;
  memoryAck.delete(id);
  try {
    localStorage.removeItem(ackStorageKey(id));
  } catch {
    // ignore
  }
}

/**
 * Decide whether to surface an onboarding verification outcome toast.
 * One-shot per terminal outcome per business (localStorage + in-memory ack).
 * Clearing on draft/submitted allows a future resubmission outcome to notify again.
 */
export function resolveOnboardingVerificationOutcomeToast(opts: {
  businessId: string | null | undefined;
  next: OnboardingVerificationStatus | null | undefined;
}): OnboardingVerificationOutcome | null {
  const businessId = opts.businessId?.trim() || "";
  if (!businessId || !opts.next) return null;

  if (opts.next === "draft" || opts.next === "submitted") {
    clearAck(businessId);
    return null;
  }

  if (opts.next !== "approved" && opts.next !== "rejected") return null;

  const lastAcked = readAck(businessId);
  if (lastAcked === opts.next) return null;

  // Mark before the caller shows UI so concurrent syncs cannot double-toast.
  writeAck(businessId, opts.next);
  return opts.next;
}

/** Test helper — not used in product paths. */
export function __resetOnboardingVerificationOutcomeAckForTests(businessId: string): void {
  clearAck(businessId);
}
