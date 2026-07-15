import { logServerError } from "../../utils/httpErrors.js";
import {
  writeBusinessActivityEvent,
  type WriteBusinessActivityEventInput,
  type WriteBusinessActivityEventResult,
} from "./businessActivityEvent.service.js";

/**
 * Activity Projection Isolation (Phase B).
 *
 * Domain services must never await projection inside a critical path that can
 * fail payments, activation, invites, or tip success. Pattern:
 * 1. Domain transaction commits successfully
 * 2. schedule* is called (sync return)
 * 3. Projection runs async; errors are logged/monitored and swallowed
 */

/** Fire-and-forget insert. Never throws to the caller. */
export function scheduleActivityProjection(input: WriteBusinessActivityEventInput): void {
  void writeBusinessActivityEvent(input)
    .then((result: WriteBusinessActivityEventResult) => {
      if (!result.inserted) {
        // Unique dedupe — expected on retries; no monitoring noise.
        return;
      }
    })
    .catch((err: unknown) => {
      logServerError("activity.projection.insert", err, {
        type: input.type,
        businessId: input.businessId,
        dedupeKey: input.dedupeKey,
        source: input.source,
      });
    });
}

/**
 * Fire-and-forget for multi-step projection work (e.g. goal crossing evaluation).
 * Never throws to the caller.
 */
export function scheduleIsolatedActivityWork(
  label: string,
  work: () => Promise<void>,
  meta?: Record<string, unknown>,
): void {
  void Promise.resolve()
    .then(work)
    .catch((err: unknown) => {
      logServerError(`activity.projection.${label}`, err, meta ?? {});
    });
}
