import { prisma } from "../prisma.js";
import { scheduledPayoutRuntimeTestHooksEnabled } from "../lib/scheduledPayoutRuntimeTestHooks.js";
import { logServerError } from "../utils/httpErrors.js";

/** Thrown when a required financial admin audit row could not be persisted. */
export class AuditLogWriteError extends Error {
  constructor() {
    super("audit_log_write_failed");
    this.name = "AuditLogWriteError";
  }
}

/**
 * Append-only audit trail for platform admin and other sensitive actions.
 * Failures are swallowed so logging never breaks the main request.
 */
export async function writeAuditLog(input: {
  /** Null when actor was anonymized/detached (Slice D / T-F03-b). */
  userId: string | null;
  action: string;
  metadata?: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch {
    /* ignore — audit must not break primary flow */
  }
}

let writeAuditLogStrictOverride: ((input: {
  userId: string | null;
  action: string;
  metadata?: string | null;
}) => Promise<void>) | null = null;

/** Test-only: avoid database writes in isolated runtime scripts. */
export function __setWriteAuditLogStrictForTests(
  fn: ((input: {
    userId: string | null;
    action: string;
    metadata?: string | null;
  }) => Promise<void>) | null,
): void {
  if (!scheduledPayoutRuntimeTestHooksEnabled()) {
    return;
  }
  writeAuditLogStrictOverride = fn;
}

/**
 * Required audit for platform scheduled-payout financial mutations.
 * Callers must not report success to the client if this throws (mutation may already have occurred).
 */
export async function writeAuditLogStrict(input: {
  userId: string | null;
  action: string;
  metadata?: string | null;
}): Promise<void> {
  if (writeAuditLogStrictOverride && scheduledPayoutRuntimeTestHooksEnabled()) {
    await writeAuditLogStrictOverride(input);
    return;
  }
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        metadata: input.metadata ?? undefined,
      },
    });
  } catch (err) {
    logServerError("audit.writeStrict", err, { action: input.action });
    throw new AuditLogWriteError();
  }
}
