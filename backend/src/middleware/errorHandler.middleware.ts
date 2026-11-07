import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { clientSafeMessage, CLIENT_FALLBACK } from "../utils/httpErrors.js";
import { requestIdOf } from "./requestId.middleware.js";

/**
 * Last middleware: logs server errors and returns JSON. Requires `express-async-errors` so async route rejections reach here.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof multer.MulterError) {
    const multerStatus = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const context = {
      method: req.method,
      path: req.originalUrl ?? req.url,
      status: multerStatus,
      requestId: requestIdOf(res),
    };
    console.error("❌ BACKEND ERROR (multer):", context, err.code, err.message);
    if (err.stack) console.error(err.stack);
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image is too large (max 5 MB)."
        : err.code === "LIMIT_UNEXPECTED_FILE"
          ? "Unexpected upload field. Use the correct file field name."
          : err.message || "Upload failed.";
    res
      .status(multerStatus)
      .json({ message: clientSafeMessage(new Error(msg), CLIENT_FALLBACK.generic), requestId: requestIdOf(res) });
    return;
  }

  let status =
    typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;

  if (status === 500 && err instanceof Error) {
    const m = err.message;
    if (m.startsWith("Unsupported image type") || m.startsWith("Logo must be an image")) {
      status = 400;
    }
  }

  // Log detailed errors on server only (do not expose stack traces / DB internals to clients).
  const context = {
    method: req.method,
    path: req.originalUrl ?? req.url,
    status,
    requestId: requestIdOf(res),
  };
  console.error("❌ BACKEND ERROR:", context, err);
  if (err instanceof Error && err.stack) console.error(err.stack);

  if (status >= 500) {
    void import("../instrument/sentry.js").then(({ captureServerException }) => {
      captureServerException(err, context);
    });
  }

  // Keep response shape stable: frontend reads `message` (see src/app/lib/api.ts handleRes).
  // For expected client errors (4xx), return allow-listed / Prisma-classified messages.
  // For 5xx and unknown failures, keep a generic client message while logging details above.
  const message =
    status >= 400 && status < 500
      ? clientSafeMessage(err, CLIENT_FALLBACK.generic)
      : CLIENT_FALLBACK.generic;

  // `requestId` lets support match a report to the log line above; it carries no user data.
  res.status(status).json({ message, requestId: requestIdOf(res) });
};
