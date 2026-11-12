/**
 * Cross-instance lease for payment operations (checkout creation, Stripe customer creation,
 * subscription mirror sync, reconciliation runs).
 *
 * A lease is a row in `payment_operation_leases`, taken with one atomic INSERT … ON CONFLICT so two
 * backend instances can never both hold it. It deliberately is not a session/advisory lock: those do
 * not survive the transaction pooler, and holding a transaction open across a Stripe API call would
 * pin a pooled connection. A crashed holder is recovered when `expiresAt` passes.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma.js";

export class PaymentOperationBusyError extends Error {
  readonly code = "PAYMENT_OPERATION_IN_PROGRESS";
  constructor(readonly leaseKey: string) {
    super("Another request is already processing this payment operation. Please try again in a moment.");
  }
}

export type PaymentOperationLeaseHandle = { key: string; token: string };

/** Atomically takes `key` if it is free or expired. Returns null when another holder owns it. */
export async function tryAcquirePaymentOperationLease(
  key: string,
  ttlMs: number,
): Promise<PaymentOperationLeaseHandle | null> {
  const token = randomUUID();
  // Columns are `timestamp` (UTC wall clock, as Prisma writes them). Convert explicitly so the
  // comparison does not depend on the database session TimeZone.
  const expiresAtIso = new Date(Date.now() + ttlMs).toISOString();
  const rows = await prisma.$queryRaw<Array<{ token: string }>>`
    INSERT INTO payment_operation_leases (key, token, acquired_at, expires_at)
    VALUES (${key}, ${token}, (now() AT TIME ZONE 'UTC'), (${expiresAtIso}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT (key) DO UPDATE
      SET token = EXCLUDED.token, acquired_at = EXCLUDED.acquired_at, expires_at = EXCLUDED.expires_at
      WHERE payment_operation_leases.expires_at < (now() AT TIME ZONE 'UTC')
    RETURNING token`;
  return rows[0]?.token === token ? { key, token } : null;
}

export async function releasePaymentOperationLease(handle: PaymentOperationLeaseHandle): Promise<void> {
  await prisma.paymentOperationLease.deleteMany({ where: { key: handle.key, token: handle.token } });
}

/** Extends a held lease (long operations). Returns false when ownership was lost. */
export async function renewPaymentOperationLease(
  handle: PaymentOperationLeaseHandle,
  ttlMs: number,
): Promise<boolean> {
  const updated = await prisma.paymentOperationLease.updateMany({
    where: { key: handle.key, token: handle.token },
    data: { expiresAt: new Date(Date.now() + ttlMs) },
  });
  return updated.count === 1;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` while holding `key`. Waits up to `waitMs` for a current holder to finish, then throws
 * PaymentOperationBusyError. The lease is released when `fn` settles; if the process dies, it expires.
 */
export async function withPaymentOperationLease<T>(
  key: string,
  opts: { ttlMs: number; waitMs: number; pollMs?: number },
  fn: (handle: PaymentOperationLeaseHandle) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + opts.waitMs;
  const pollMs = opts.pollMs ?? 150;
  let handle = await tryAcquirePaymentOperationLease(key, opts.ttlMs);
  while (!handle) {
    if (Date.now() >= deadline) throw new PaymentOperationBusyError(key);
    await sleep(pollMs + Math.floor(Math.random() * pollMs));
    handle = await tryAcquirePaymentOperationLease(key, opts.ttlMs);
  }
  try {
    return await fn(handle);
  } finally {
    await releasePaymentOperationLease(handle).catch(() => {
      /* expires on its own */
    });
  }
}
