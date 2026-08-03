import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { issueRefreshTokenWithClient } from "./refreshToken.service.js";
import * as auditService from "./audit.service.js";

/** Short-lived one-time tokens for mobile → web session bridge. */
export const MOBILE_WEB_HANDOFF_TTL_MS = 90_000;

export const MOBILE_WEB_HANDOFF_PURPOSES = ["billing"] as const;
export type MobileWebHandoffPurpose = (typeof MOBILE_WEB_HANDOFF_PURPOSES)[number];

/** Server-controlled allowlist — never trust client redirect targets. */
const PURPOSE_DESTINATIONS: Record<MobileWebHandoffPurpose, string> = {
  billing: "/dashboard/billing/subscription",
};

export type MobileWebHandoffFailCode =
  | "invalid_hash"
  | "expired"
  | "already_consumed"
  | "wrong_purpose"
  | "wrong_role"
  | "ip_mismatch"
  | "ua_suspicious";

export class MobileWebHandoffError extends Error {
  readonly code: MobileWebHandoffFailCode;
  readonly userId: string | null;
  readonly meta: Record<string, unknown>;

  constructor(
    code: MobileWebHandoffFailCode,
    opts?: { userId?: string | null; message?: string; meta?: Record<string, unknown> },
  ) {
    super(opts?.message ?? "Handoff link is invalid or has expired.");
    this.name = "MobileWebHandoffError";
    this.code = code;
    this.userId = opts?.userId ?? null;
    this.meta = opts?.meta ?? {};
  }
}

type HandoffRow = {
  id: string;
  user_id: string;
  purpose: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_ip: string | null;
  created_user_agent: string | null;
};

type DbClient = {
  $executeRaw: typeof prisma.$executeRaw;
  $queryRaw: typeof prisma.$queryRaw;
  user: typeof prisma.user;
  refreshToken: typeof prisma.refreshToken;
};

function hashToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

function newHandoffId(): string {
  return `h${randomBytes(16).toString("hex")}`;
}

function getFrontendBaseUrl(): string {
  const u = process.env.FRONTEND_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://localhost:5173";
}

function bindIpEnabled(): boolean {
  const raw = process.env.MOBILE_WEB_HANDOFF_BIND_IP?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return true;
}

function truncateUa(ua: string | null | undefined): string | null {
  const t = (ua ?? "").trim();
  if (!t) return null;
  return t.slice(0, 512);
}

function normalizeIp(ip: string | null | undefined): string | null {
  const t = (ip ?? "").trim();
  if (!t || t === "unknown") return null;
  if (t.startsWith("::ffff:")) return t.slice(7);
  return t;
}

/** True when IPs match exactly or share an IPv4 /24 (carrier NAT friendly). */
export function ipsCompatible(createdIp: string | null, consumeIp: string | null): boolean {
  const a = normalizeIp(createdIp);
  const b = normalizeIp(consumeIp);
  if (!a || !b) return true;
  if (a === b) return true;
  const a4 = a.split(".");
  const b4 = b.split(".");
  if (a4.length === 4 && b4.length === 4) {
    return a4[0] === b4[0] && a4[1] === b4[1] && a4[2] === b4[2];
  }
  return false;
}

function isLikelyNativeAppUa(ua: string | null): boolean {
  if (!ua) return false;
  const u = ua.toLowerCase();
  if (/okhttp|cfnetwork|darwin\/|dalvik|reactnative|expo|caretip\//.test(u)) return true;
  if (!/mozilla\/\d/.test(u) && u.length > 0) return true;
  return false;
}

function isLikelyBrowserUa(ua: string | null): boolean {
  if (!ua) return false;
  return /mozilla\/\d/i.test(ua);
}

/**
 * Create is native app; consume is in-app browser — UA equality is never expected.
 * Reject only clearly suspicious consume contexts.
 */
export function userAgentsCompatible(
  createdUa: string | null,
  consumeUa: string | null,
): boolean {
  if (!consumeUa) return false;
  if (isLikelyNativeAppUa(createdUa) && isLikelyBrowserUa(consumeUa)) return true;
  if (isLikelyBrowserUa(consumeUa)) return true;
  return consumeUa.trim().length >= 8;
}

function browserFamily(ua: string | null): string {
  if (!ua) return "unknown";
  if (/Edg\//i.test(ua) || /Edge\//i.test(ua)) return "edge";
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return "opera";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Firefox\//i.test(ua)) return "firefox";
  if (/Chrome\//i.test(ua) || /CriOS\//i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua)) return "safari";
  if (isLikelyNativeAppUa(ua)) return "native_app";
  return "unknown";
}

export function isMobileWebHandoffPurpose(raw: unknown): raw is MobileWebHandoffPurpose {
  return typeof raw === "string" && (MOBILE_WEB_HANDOFF_PURPOSES as readonly string[]).includes(raw);
}

export function destinationForPurpose(purpose: MobileWebHandoffPurpose): string {
  return PURPOSE_DESTINATIONS[purpose];
}

/** Structured security audit — always logs; persists to AuditLog when userId is known. */
export async function auditMobileWebHandoff(
  action: string,
  userId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  console.info(`[mobile_web_handoff] ${action}`, { userId, ...metadata });
  if (!userId) return;
  void auditService.writeAuditLog({
    userId,
    action,
    metadata: JSON.stringify(metadata),
  });
}

export function auditHandoffFailure(err: MobileWebHandoffError): void {
  const actionByCode: Record<MobileWebHandoffFailCode, string> = {
    invalid_hash: "mobile_web_handoff.invalid_hash",
    expired: "mobile_web_handoff.expired",
    already_consumed: "mobile_web_handoff.already_consumed",
    wrong_purpose: "mobile_web_handoff.wrong_purpose",
    wrong_role: "mobile_web_handoff.wrong_role",
    ip_mismatch: "mobile_web_handoff.ip_mismatch",
    ua_suspicious: "mobile_web_handoff.ua_suspicious",
  };
  void auditMobileWebHandoff(actionByCode[err.code], err.userId, err.meta);
  if (err.code === "already_consumed") {
    void auditMobileWebHandoff("mobile_web_handoff.replay_attempt", err.userId, err.meta);
  }
}

async function deleteUnusedHandoffs(
  db: DbClient,
  userId: string,
  purpose: string,
): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    DELETE FROM mobile_web_handoff_tokens
    WHERE user_id = ${userId}
      AND purpose = ${purpose}
      AND consumed_at IS NULL
  `);
}

async function insertHandoff(
  db: DbClient,
  row: {
    id: string;
    tokenHash: string;
    userId: string;
    purpose: string;
    expiresAt: Date;
    createdIp: string | null;
    createdUserAgent: string | null;
  },
): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO mobile_web_handoff_tokens (
      id, token_hash, user_id, purpose, expires_at, created_at, consumed_at, created_ip, created_user_agent
    ) VALUES (
      ${row.id},
      ${row.tokenHash},
      ${row.userId},
      ${row.purpose},
      ${row.expiresAt},
      NOW(),
      NULL,
      ${row.createdIp},
      ${row.createdUserAgent}
    )
  `);
}

async function deleteHandoffById(db: DbClient, id: string): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    DELETE FROM mobile_web_handoff_tokens WHERE id = ${id}
  `);
}

async function claimHandoffById(db: DbClient, id: string): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    UPDATE mobile_web_handoff_tokens
    SET consumed_at = NOW()
    WHERE id = ${id}
      AND consumed_at IS NULL
  `);
}

export type CreateMobileWebHandoffResult = {
  url: string;
  expiresAt: string;
  purpose: MobileWebHandoffPurpose;
  destinationPath: string;
};

/**
 * Issue a one-time handoff URL for an already-authenticated manager.
 * Plain token is returned only inside the URL — never stored.
 * Destination is always server-derived from `purpose` (never a client path).
 */
export async function createMobileWebHandoff(input: {
  userId: string;
  purpose: MobileWebHandoffPurpose;
  createdIp?: string | null;
  createdUserAgent?: string | null;
}): Promise<CreateMobileWebHandoffResult> {
  const userId = input.userId.trim();
  if (!userId) {
    throw new MobileWebHandoffError("wrong_role", { message: "Authentication required" });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
      emailVerified: true,
      hasCompletedOnboarding: true,
    },
  });

  if (!user || user.isActive !== true) {
    throw new MobileWebHandoffError("wrong_role", {
      userId,
      message: "Authentication required",
    });
  }
  if (user.role !== "MANAGER") {
    throw new MobileWebHandoffError("wrong_role", {
      userId,
      message: "Insufficient permissions",
      meta: { purpose: input.purpose, role: user.role },
    });
  }
  if (user.emailVerified !== true) {
    throw new Error("Email verification required");
  }
  if (user.hasCompletedOnboarding !== true) {
    throw new Error("Onboarding incomplete");
  }

  const plainToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(plainToken);
  const expiresAt = new Date(Date.now() + MOBILE_WEB_HANDOFF_TTL_MS);
  const destinationPath = destinationForPurpose(input.purpose);
  const createdIp = normalizeIp(input.createdIp);
  const createdUserAgent = truncateUa(input.createdUserAgent);

  await prisma.$transaction(async (tx) => {
    const db = tx as unknown as DbClient;
    await deleteUnusedHandoffs(db, userId, input.purpose);
    await insertHandoff(db, {
      id: newHandoffId(),
      tokenHash,
      userId,
      purpose: input.purpose,
      expiresAt,
      createdIp,
      createdUserAgent,
    });
  });

  const url =
    `${getFrontendBaseUrl()}/mobile-auth` +
    `?token=${encodeURIComponent(plainToken)}` +
    `&purpose=${encodeURIComponent(input.purpose)}`;

  return {
    url,
    expiresAt: expiresAt.toISOString(),
    purpose: input.purpose,
    destinationPath,
  };
}

export type ConsumedMobileWebHandoff = {
  userId: string;
  purpose: MobileWebHandoffPurpose;
  destinationPath: string;
  refreshToken: string;
  refreshTokenId: string;
  refreshExpiresAt: Date;
};

/**
 * Atomically claim handoff token (SELECT FOR UPDATE → validate → soft-consume)
 * and mint a refresh session in the same transaction.
 *
 * Soft-consume (`consumed_at`) enables replay detection; rows are purged by cleanup job.
 * Platform auth policy is multi-session: issuing a web refresh does NOT revoke mobile refresh tokens.
 *
 * Table access uses parameterized SQL so this module stays type-safe even when the IDE
 * TypeScript server has a stale Prisma client (before/without a TS server restart).
 */
export async function consumeMobileWebHandoff(input: {
  plainToken: string;
  consumeIp?: string | null;
  consumeUserAgent?: string | null;
}): Promise<ConsumedMobileWebHandoff> {
  const token = String(input.plainToken ?? "").trim();
  if (!token) {
    throw new MobileWebHandoffError("invalid_hash", { meta: { reason: "empty" } });
  }

  const tokenHash = hashToken(token);
  const consumeIp = normalizeIp(input.consumeIp);
  const consumeUserAgent = truncateUa(input.consumeUserAgent);

  type TxResult =
    | { ok: true; value: ConsumedMobileWebHandoff }
    | { ok: false; error: MobileWebHandoffError };

  const outcome = await prisma.$transaction(async (tx): Promise<TxResult> => {
    const db = tx as unknown as DbClient;
    const rows = await db.$queryRaw<HandoffRow[]>(Prisma.sql`
      SELECT id, user_id, purpose, expires_at, consumed_at, created_ip, created_user_agent
      FROM mobile_web_handoff_tokens
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `);
    const row = rows[0];

    if (!row) {
      return {
        ok: false,
        error: new MobileWebHandoffError("invalid_hash", {
          meta: { tokenHashPrefix: tokenHash.slice(0, 12) },
        }),
      };
    }

    if (row.consumed_at != null) {
      return {
        ok: false,
        error: new MobileWebHandoffError("already_consumed", {
          userId: row.user_id,
          meta: {
            purpose: row.purpose,
            consumedAt: row.consumed_at.toISOString(),
          },
        }),
      };
    }

    if (row.expires_at.getTime() <= Date.now()) {
      await deleteHandoffById(db, row.id);
      return {
        ok: false,
        error: new MobileWebHandoffError("expired", {
          userId: row.user_id,
          meta: { purpose: row.purpose, expiresAt: row.expires_at.toISOString() },
        }),
      };
    }

    if (!isMobileWebHandoffPurpose(row.purpose)) {
      await deleteHandoffById(db, row.id);
      return {
        ok: false,
        error: new MobileWebHandoffError("wrong_purpose", {
          userId: row.user_id,
          meta: { purpose: row.purpose },
        }),
      };
    }

    if (bindIpEnabled() && !ipsCompatible(row.created_ip, consumeIp)) {
      await claimHandoffById(db, row.id);
      return {
        ok: false,
        error: new MobileWebHandoffError("ip_mismatch", {
          userId: row.user_id,
          meta: {
            purpose: row.purpose,
            createdIp: row.created_ip,
            consumeIp,
          },
        }),
      };
    }

    if (!userAgentsCompatible(row.created_user_agent, consumeUserAgent)) {
      await claimHandoffById(db, row.id);
      return {
        ok: false,
        error: new MobileWebHandoffError("ua_suspicious", {
          userId: row.user_id,
          meta: {
            purpose: row.purpose,
            createdFamily: browserFamily(row.created_user_agent),
            consumeFamily: browserFamily(consumeUserAgent),
          },
        }),
      };
    }

    const claimed = await claimHandoffById(db, row.id);
    if (claimed !== 1) {
      return {
        ok: false,
        error: new MobileWebHandoffError("already_consumed", {
          userId: row.user_id,
          meta: { purpose: row.purpose, reason: "claim_race" },
        }),
      };
    }

    const user = await db.user.findUnique({
      where: { id: row.user_id },
      select: { id: true, isActive: true, role: true },
    });
    if (!user || user.isActive !== true || user.role !== "MANAGER") {
      return {
        ok: false,
        error: new MobileWebHandoffError("wrong_role", {
          userId: row.user_id,
          meta: {
            purpose: row.purpose,
            role: user?.role ?? null,
            isActive: user?.isActive ?? null,
          },
        }),
      };
    }

    const rt = await issueRefreshTokenWithClient(tx, user.id);

    return {
      ok: true,
      value: {
        userId: user.id,
        purpose: row.purpose,
        destinationPath: destinationForPurpose(row.purpose),
        refreshToken: rt.token,
        refreshTokenId: rt.id,
        refreshExpiresAt: rt.expiresAt,
      },
    };
  });

  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

/**
 * Purge expired and already-consumed handoff rows so the table cannot grow unbounded.
 * Safe to run on a cron (e.g. hourly).
 */
export async function purgeStaleMobileWebHandoffTokens(): Promise<{ deleted: number }> {
  const retainConsumedMs = 60 * 60 * 1000;
  const consumedBefore = new Date(Date.now() - retainConsumedMs);
  const now = new Date();

  const deleted = await prisma.$executeRaw(Prisma.sql`
    DELETE FROM mobile_web_handoff_tokens
    WHERE expires_at < ${now}
       OR (consumed_at IS NOT NULL AND consumed_at < ${consumedBefore})
  `);

  if (deleted > 0) {
    console.info("[mobile_web_handoff] purge_stale", { deleted });
  }
  return { deleted: Number(deleted) };
}
