// Load env FIRST so DATABASE_URL exists before any Prisma import (see ./loadEnv.js for merge order).
import "dotenv/config";
import "./loadEnv.js";
import { initSentry } from "./instrument/sentry.js";
import { startShortLivedCacheMaintenance } from "./utils/shortLivedCache.js";

initSentry();
startShortLivedCacheMaintenance();

import { createServer } from "http";
import { join } from "path";
import express from "express";
import "express-async-errors";
import cors from "cors";
import { corsMiddlewareOptions } from "./config/cors.js";
import { Role } from "@prisma/client";
import { prisma } from "./prisma.js";
import { authMiddleware, requireRole, requireVerifiedEmail } from "./middleware/auth.middleware.js";
import { requireCompletedOnboarding } from "./middleware/requireCompletedOnboarding.middleware.js";
import * as businessController from "./controllers/business.controller.js";
import authRoutes from "./routes/auth.routes.js";
import businessRoutes from "./routes/business.routes.js";
import employeeRoutes from "./routes/employee.routes.js";
import goalsRoutes from "./routes/goals.routes.js";
import staffRoutes from "./routes/staff.routes.js";
import tipsRoutes from "./routes/tips.routes.js";
import transactionsRoutes from "./routes/transactions.routes.js";
import locationsRoutes from "./routes/locations.routes.js";
import tablesRoutes from "./routes/tables.routes.js";
import tippingContextRoutes from "./routes/tippingContext.routes.js";
import qrScanRoutes from "./routes/qrScan.routes.js";
import platformRoutes from "./routes/platform.routes.js";
import stripeWebhookRoutes from "./webhooks/stripe.webhook.js";
import paymentRoutes from "./routes/payment.routes.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import testRoutes from "./routes/test.routes.js";
import meRoutes from "./routes/settings.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import connectRoutes from "./routes/connect.routes.js";
import mobileRoutes from "./routes/mobile.routes.js";
import pushRoutes from "./routes/push.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import commercialRoutes from "./routes/commercial.routes.js";
import supportTicketRoutes from "./routes/supportTicket.routes.js";
import landingAiRoutes from "./routes/landingAi.routes.js";
import leadRoutes from "./routes/lead.routes.js";
import legalRoutes from "./routes/legal.routes.js";
import { initSocketServer } from "./socket/socketServer.js";
import { errorHandler } from "./middleware/errorHandler.middleware.js";
import { jsonParseErrorHandler } from "./middleware/jsonParseError.middleware.js";
import { getImageUploadStorageDiagnostics } from "./services/upload.service.js";
import { blockSensitiveStaticUploadPaths } from "./middleware/blockSensitiveStaticUploads.middleware.js";
import {
  ensureSupabaseStorageBucketReady,
  ensureSupabaseKycBucketReady,
  isSupabaseStorageConfigured,
} from "./lib/supabaseStorageClient.js";
import {
  assertProductionEmailEnv,
  getEmailHealthDiagnostics,
} from "./config/emailEnv.js";
import { getObservabilityHealthDiagnostics } from "./config/observabilityEnv.js";
import { securityHeadersMiddleware } from "./middleware/securityHeaders.middleware.js";
import { authenticatedApiRateLimit } from "./middleware/securityRateLimit.middleware.js";
import socketRoutes from "./routes/socket.routes.js";
import internalJobsRoutes from "./routes/internalJobs.routes.js";
import * as healthController from "./controllers/health.controller.js";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.disable("x-powered-by");

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(securityHeadersMiddleware);

async function assertEnvForAuth(): Promise<void> {
  const jwt = process.env.JWT_SECRET?.trim();
  if (!jwt) {
    console.error(
      'FATAL: JWT_SECRET is missing or empty. Set JWT_SECRET="your_super_secret_key" in backend/.env (non-empty string).'
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    const expiredRefresh = process.env.ALLOW_EXPIRED_ACCESS_TOKEN_REFRESH?.trim().toLowerCase();
    if (expiredRefresh === "true" || expiredRefresh === "1") {
      console.warn(
        "[auth] ALLOW_EXPIRED_ACCESS_TOKEN_REFRESH is set but permanently disabled in production.",
      );
    }
  }
  try {
    await prisma.$connect();
  } catch (e) {
    const errObj = e && typeof e === "object" ? (e as { code?: string; errorCode?: string }) : null;
    const code = String(errObj?.errorCode ?? errObj?.code ?? "");
    const hint =
      code === "P1001"
        ? " Check **Session pooler** URL (port **5432**), Supabase project **not paused**, firewall/VPN allows **outbound 5432**, password correct. Copy URL from Supabase → Connect → **Session mode**."
        : code === "P1000"
          ? " **Wrong password or bad URL.** User must be `postgres.PROJECT_REF` for the pooler. No empty password between `:` and `@`. Copy from Supabase → Connect → Session pooler. Reset DB password under Project Settings → Database if needed."
          : "";
    console.error(
      `FATAL: Cannot connect to PostgreSQL.${hint} Check .env and that the database is reachable.`,
      e,
    );
    process.exit(1);
  }
  const googleAudiences =
    process.env.GOOGLE_CLIENT_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ??
    [];
  const googleClientId =
    googleAudiences[0] ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!googleClientId) {
    console.warn(
      "[auth] GOOGLE_CLIENT_ID is not set — POST /api/auth/oauth will return 503 for Google sign-in.",
    );
  } else {
    const suffixes = (googleAudiences.length > 0
      ? googleAudiences
      : [googleClientId]
    ).map((id) => `…${id.slice(-24)}`);
    console.log(`[auth] Google OAuth audience(s): ${suffixes.join(", ")}`);
  }

  assertProductionEmailEnv();

  // Do not $disconnect — shared prisma singleton is used for the whole process.
}

// Webhook must use raw body for Stripe signature verification
app.use("/api/webhook", express.raw({ type: "application/json" }), stripeWebhookRoutes);
app.use("/api/webhooks", express.raw({ type: "application/json" }), stripeWebhookRoutes);

app.use(cors(corsMiddlewareOptions));
app.use(
  express.json({
    verify(req, _res, buf) {
      if (buf.length > 0 && buf.length <= 4096) {
        (req as import("express").Request & { _rawJsonBody?: string })._rawJsonBody = buf.toString("utf8");
      }
    },
  }),
);
app.use(jsonParseErrorHandler);

/** Public probes — no auth; mounted before broad /api rate limit. */
app.get("/api/health", healthController.getApiHealth);
app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});
/** Optional Apple domain verification file for Sign in with Apple (Services ID Return URL host). */
app.get("/.well-known/apple-developer-domain-association.txt", (_req, res) => {
  const content = process.env.APPLE_DOMAIN_ASSOCIATION_CONTENT?.trim();
  if (!content) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(content);
});

app.use("/api", authenticatedApiRateLimit);

app.use(blockSensitiveStaticUploadPaths);
app.use(
  "/uploads",
  express.static(join(process.cwd(), "uploads"), {
    maxAge: process.env.NODE_ENV === "production" ? 86400000 : 0,
    immutable: false,
    setHeaders(res, filePath) {
      if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  }),
);

if (process.env.NODE_ENV !== "production") {
  app.use("/api/test", testRoutes);
}
app.use("/api/auth", authRoutes);
app.use("/api/mobile", mobileRoutes);
app.use("/api/me", meRoutes);
app.use("/api/me", billingRoutes);
app.use("/api/me", connectRoutes);
app.use("/api/me/notifications", notificationsRoutes);
/** Registered on the app (not the sub-router) so `/me/stats` is never interpreted as `/:businessId`. */
app.get(
  "/api/business/me/stats",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireCompletedOnboarding,
  businessController.getMyStats
);
app.get(
  "/api/business/qr-analytics",
  authMiddleware,
  requireVerifiedEmail,
  requireRole(Role.MANAGER),
  requireCompletedOnboarding,
  businessController.getMyQrAnalytics
);
app.use("/api/business", businessRoutes);
app.use("/api/business/commercial", commercialRoutes);
app.use("/api/business/support", supportTicketRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/goals", goalsRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/tips", tipsRoutes);
app.use("/api/transactions", transactionsRoutes);
app.use("/api/locations", locationsRoutes);
app.use("/api/tables", tablesRoutes);
app.use("/api/tipping-context", tippingContextRoutes);
app.use("/api/qr", qrScanRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/landing-ai", landingAiRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/legal", legalRoutes);
app.use("/api/socket", socketRoutes);
app.use("/api/platform", platformRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/internal/jobs", internalJobsRoutes);
/** Alias for SuperAdmin clients (same handlers as `/api/platform`). */
app.use("/api/admin", platformRoutes);

app.get("/health", (req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  const secret = process.env.HEALTH_CHECK_SECRET?.trim();
  const detailed =
    !isProd ||
    (Boolean(secret) && req.get("x-health-secret") === secret);

  if (!detailed) {
    return res.json({ status: "ok" });
  }

  const email = getEmailHealthDiagnostics();
  const observability = getObservabilityHealthDiagnostics();
  const uploads = getImageUploadStorageDiagnostics();
  const ok = !isProd || email.configured;
  return res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    email,
    observability,
    uploads,
  });
});

/** API-only root — no SPA; points clients to health + API prefixes. */
app.get("/", (_req, res) => {
  res.json({
    name: "CareTip API",
    status: "ok",
    health: "/api/health",
    message: "API-only backend. Use the CareTip web or mobile client.",
  });
});

app.use((req, res) => {
  res.status(404).json({
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

app.use(errorHandler);

const httpServer = createServer(app);
initSocketServer(httpServer);

void assertEnvForAuth().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Caretip API running on http://localhost:${PORT}`);
    const billingOn = process.env.SUBSCRIPTION_BILLING_ENABLED?.trim().toLowerCase();
    const billingEnabled =
      billingOn === "true" || billingOn === "1" || billingOn === "yes" || billingOn === "on";
    if (billingEnabled && !process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
      console.warn(
        "[billing] SUBSCRIPTION_BILLING_ENABLED=true but STRIPE_WEBHOOK_SECRET is unset. " +
          "Stripe webhooks will not verify locally until you run `stripe listen` and set the secret. " +
          "Checkout return sync (/api/me/billing/sync-status) still activates mirrors from Stripe.",
      );
    }
    if (
      process.env.NODE_ENV === "production" &&
      process.env.RENDER &&
      !getImageUploadStorageDiagnostics().supabaseStorageConfigured
    ) {
      console.warn(
        "[upload] Render: Supabase Storage is not configured. Files in ./uploads are lost on redeploy and are not shared across multiple instances. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see backend/.env.example) so logos and avatars use durable object storage.",
      );
    }
    if (isSupabaseStorageConfigured()) {
      void ensureSupabaseStorageBucketReady().catch((e) => {
        console.error("[upload] Supabase bucket startup check failed:", e instanceof Error ? e.message : e);
      });
      void ensureSupabaseKycBucketReady().catch((e) => {
        console.error("[upload] Supabase KYC bucket startup check failed:", e instanceof Error ? e.message : e);
      });
    }
  });
});
