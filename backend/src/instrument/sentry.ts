import * as Sentry from "@sentry/node";
import { sentryBeforeSend } from "./sentryScrub.js";

let initialized = false;

function resolveSentryDsn(): string {
  const raw = process.env.SENTRY_DSN?.trim() ?? "";
  return raw.replace(/^["']|["']$/g, "");
}

function resolveSentryEnvironment(): string {
  return process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || "development";
}

export function initSentry(): void {
  if (initialized) return;

  const dsn = resolveSentryDsn();
  if (!dsn) {
    console.log("[Sentry] Disabled (no DSN configured)");
    return;
  }

  const environment = resolveSentryEnvironment();

  Sentry.init({
    dsn,
    environment,
    release: process.env.SENTRY_RELEASE?.trim() || undefined,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,
    beforeSend: sentryBeforeSend,
  });
  initialized = true;
  console.log("[Sentry] Enabled");
  console.log(`environment=${environment}`);
}

export function isSentryConfigured(): boolean {
  return Boolean(resolveSentryDsn());
}

export function captureServerException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!isSentryConfigured()) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
    }
    // Searchable tags for alert rules (Sentry issue alerts can filter on tags on every plan).
    const prismaCode = prismaErrorCode(error);
    if (prismaCode) scope.setTag("prisma_code", prismaCode);
    if (typeof context?.alert === "string") scope.setTag("caretip_alert", context.alert);
    Sentry.captureException(error);
  });
}

/** Prisma error code (e.g. P2024 = connection pool timeout), if the error carries one. */
export function prismaErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : null;
}

export { Sentry };
