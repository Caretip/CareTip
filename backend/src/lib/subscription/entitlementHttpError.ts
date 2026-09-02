/** Structured 403 bodies for subscription / plan / quota denials. */

export class EntitlementDeniedError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown> & { success: false; code: string; message: string };

  constructor(
    status: number,
    payload: Record<string, unknown> & { success: false; code: string; message: string },
  ) {
    super(payload.message);
    this.name = "EntitlementDeniedError";
    this.status = status;
    this.payload = payload;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isEntitlementDeniedError(err: unknown): err is EntitlementDeniedError {
  return err instanceof EntitlementDeniedError;
}
