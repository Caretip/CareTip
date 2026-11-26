import { logServerError } from "../utils/httpErrors.js";

/**
 * Without a handler, Node ends the process on an unhandled promise rejection. One forgotten
 * `await` in a rarely used path, reached repeatedly by an attacker, would then restart the API in
 * a loop. Sentry installs similar handlers when a DSN is set; this makes the behaviour the same
 * without it. An uncaught exception still ends the process (its state may be broken); Render
 * restarts it.
 */
let installed = false;

export function installProcessErrorHandlers(): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    logServerError("process.unhandledRejection", reason);
  });
  process.on("uncaughtException", (err) => {
    logServerError("process.uncaughtException", err);
    setTimeout(() => process.exit(1), 1_000).unref();
  });
}
