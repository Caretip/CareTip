import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

/** A forwarded id is reused only when it is short and made of log-safe characters. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/**
 * Gives every request a correlation id: echoed as `X-Request-Id`, written to server error logs and
 * returned in error bodies, so a support report can be matched to the server log line.
 * Carries no user, session or payment data.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.get("x-request-id")?.trim();
  const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};

export function requestIdOf(res: { locals?: Record<string, unknown> }): string | undefined {
  const id = res.locals?.requestId;
  return typeof id === "string" ? id : undefined;
}
