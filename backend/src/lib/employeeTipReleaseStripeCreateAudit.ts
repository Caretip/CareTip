/**
 * Cross-process audit log for mocked transfers.create (integration tests only).
 * Set CARETIP_EMP_TIP_STRIPE_CREATE_AUDIT_FILE to a shared path.
 */
import { appendFileSync, readFileSync } from "node:fs";

export type EmployeeTipStripeCreateAuditEntry = {
  pid: number;
  payableId: string | null;
  idempotencyKey: string;
  at: string;
};

const inProcessEntries: EmployeeTipStripeCreateAuditEntry[] = [];

export function recordEmployeeTipStripeCreateAudit(entry: {
  payableId: string | null;
  idempotencyKey: string;
}): void {
  const row: EmployeeTipStripeCreateAuditEntry = {
    pid: process.pid,
    payableId: entry.payableId,
    idempotencyKey: entry.idempotencyKey,
    at: new Date().toISOString(),
  };
  inProcessEntries.push(row);
  const path = process.env.CARETIP_EMP_TIP_STRIPE_CREATE_AUDIT_FILE?.trim();
  if (path) {
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
  }
}

export function __clearEmployeeTipStripeCreateAuditForTests(): void {
  inProcessEntries.length = 0;
}

export function __getEmployeeTipStripeCreateAuditForTests(): EmployeeTipStripeCreateAuditEntry[] {
  return [...inProcessEntries];
}

export function readEmployeeTipStripeCreateAuditFile(path: string): EmployeeTipStripeCreateAuditEntry[] {
  try {
    const text = readFileSync(path, "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EmployeeTipStripeCreateAuditEntry);
  } catch {
    return [];
  }
}
