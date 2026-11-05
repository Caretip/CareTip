import type { Request, Response, NextFunction } from "express";
import * as auditService from "../services/audit.service.js";

/**
 * Logs a platform admin API access after `requirePlatformAdmin` succeeds.
 * Place **after** `requirePlatformAdmin` on specific routes, or use {@link auditPlatformAccess}.
 */
export function auditAdminAction(action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const uid = req.user?.userId ?? req.user?.id;
    if (uid) {
      const meta = JSON.stringify({
        method: req.method,
        path: req.originalUrl ?? req.url,
      });
      void auditService.writeAuditLog({ userId: uid, action, metadata: meta });
    }
    next();
  };
}

/**
 * Audit entry for any authenticated platform route, written once the outcome is known, so the
 * trail shows what happened rather than what was attempted. Bodies are never logged: they can hold
 * personal data and secrets.
 */
export function auditPlatformAccess(req: Request, res: Response, next: NextFunction) {
  const uid = req.user?.userId ?? req.user?.id;
  if (uid) {
    const startedAt = Date.now();
    res.once("finish", () => {
      void auditService.writeAuditLog({
        userId: uid,
        action: "platform.api",
        metadata: JSON.stringify({
          method: req.method,
          path: req.originalUrl ?? req.url,
          target: req.params,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      });
    });
  }
  next();
}
