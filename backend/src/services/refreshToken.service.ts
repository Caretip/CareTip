import crypto from "crypto";
import { prisma } from "../prisma.js";
import { bumpAuthTokenVersion } from "./authTokenVersion.service.js";

const COOKIE_NAME = "caretip_refresh";
/** Readable by native clients that cannot access HttpOnly Set-Cookie (same opaque token). */
export const CARETIP_REFRESH_HEADER = "X-CareTip-Refresh";

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Default 7 days; override with `REFRESH_TOKEN_EXPIRES_DAYS` (1–365). */
export function refreshTokenTtlDays(): number {
  const raw = process.env.REFRESH_TOKEN_EXPIRES_DAYS?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0 && n <= 365) return Math.floor(n);
  return 7;
}

/** Hard limit on one login, however often it refreshes. `REFRESH_ABSOLUTE_LIFETIME_DAYS` (1-365). */
export function refreshAbsoluteLifetimeMs(): number {
  const raw = process.env.REFRESH_ABSOLUTE_LIFETIME_DAYS?.trim();
  const n = raw ? Number(raw) : NaN;
  const days = Number.isFinite(n) && n > 0 && n <= 365 ? Math.floor(n) : 90;
  return days * 24 * 60 * 60 * 1000;
}

/**
 * The login's start time travels inside the token. It cannot be forged, because a token is only
 * accepted if its full hash is on file, and it needs no extra column.
 */
function buildSessionToken(startedAtMs: number): string {
  return `${startedAtMs.toString(36)}.${crypto.randomBytes(48).toString("base64url")}`;
}

/** Tokens from before this format have no start time: their limit counts from their next rotation. */
function sessionStartFromToken(token: string, fallbackMs: number): number {
  const match = /^([0-9a-z]{6,12})\.[A-Za-z0-9_-]{40,}$/.exec(token);
  if (!match) return fallbackMs;
  const started = Number.parseInt(match[1], 36);
  return Number.isFinite(started) && started > 0 && started <= fallbackMs ? started : fallbackMs;
}

function nowPlusDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function defaultRefreshCookieMaxAgeMs(): number {
  return refreshTokenTtlDays() * 24 * 60 * 60 * 1000;
}

/** Align `Set-Cookie` max-age with DB expiry (floor at 60s). */
export function refreshCookieMaxAgeMs(expiresAt: Date): number {
  return Math.max(60_000, expiresAt.getTime() - Date.now());
}

export function refreshCookieName(): string {
  return COOKIE_NAME;
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=");
    if (!k) continue;
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setRefreshCookie(
  res: {
    cookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    setHeader?: (name: string, value: string) => void;
    req?: { headers?: { origin?: string } };
  },
  value: string,
  opts?: { maxAgeMs?: number }
): void {
  const isProd = process.env.NODE_ENV === "production";
  const maxAge = typeof opts?.maxAgeMs === "number" ? opts.maxAgeMs : defaultRefreshCookieMaxAgeMs();
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    secure: isProd,
    // None stays for password/Google/Apple sessions that still Set-Cookie on the API host.
    // Facebook redirect now stores this same cookie on the SPA origin; None is still sent
    // on that same-origin refresh. Domain is intentionally unset (host-only).
    sameSite: isProd ? "none" : "lax",
    path: "/",
    maxAge,
  });
  // Expo / React Native cannot reliably read Set-Cookie; mirror the same refresh token. Browsers
  // always send Origin on these POSTs and must not get it: on same-origin /api, script could read
  // the header, which would undo HttpOnly.
  if (!res.req?.headers?.origin) {
    res.setHeader?.(CARETIP_REFRESH_HEADER, value);
  }
}

export function clearRefreshCookie(
  res: {
    cookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    setHeader?: (name: string, value: string) => void;
  },
): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
  res.setHeader?.(CARETIP_REFRESH_HEADER, "");
}

type RefreshTokenDb = {
  refreshToken: {
    create: (args: {
      data: {
        tokenHash: string;
        userId: string;
        expiresAt: Date;
        revokedAt: null;
        replacedByTokenId: null;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
};

/** Issue a refresh row using an optional transaction client (multi-session — does not revoke others). */
export async function issueRefreshTokenWithClient(
  db: RefreshTokenDb,
  userId: string,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = buildSessionToken(Date.now());
  const tokenHash = sha256Hex(token);
  const expiresAt = nowPlusDays(refreshTokenTtlDays());
  const row = await db.refreshToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
    },
    select: { id: true },
  });
  return { id: row.id, token, expiresAt };
}

export async function issueRefreshToken(
  userId: string,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  return issueRefreshTokenWithClient(prisma, userId);
}

/** Revoke all active refresh sessions for a user (e.g. reused / stolen refresh token). */
export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await bumpAuthTokenVersion(userId);
  // Live sockets were authorised at connect time, so they must end with the sessions.
  const { disconnectUserSockets } = await import("../socket/socketServer.js");
  disconnectUserSockets(userId);
}

/**
 * Revoke other devices' refresh sessions, keeping `keepSessionId`.
 * Does not bump authTokenVersion so the current access JWT stays valid until expiry.
 */
export async function revokeOtherRefreshTokensForUser(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const keep = keepSessionId.trim();
  if (!userId.trim() || !keep) return 0;
  const owned = await prisma.refreshToken.findFirst({
    where: { id: keep, userId },
    select: { id: true },
  });
  if (!owned) return 0;
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null, NOT: { id: keep } },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function refreshSessionIdFromRawToken(token: string): Promise<string | null> {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const tokenHash = sha256Hex(raw);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });
  if (!row || row.revokedAt != null || row.expiresAt.getTime() <= Date.now()) return null;
  return row.id;
}

/**
 * Window in which the previous token of a rotation may still be exchanged — once — for the
 * current head of its own replacement chain. Covers refresh responses lost after the rotation
 * committed (reload mid-refresh, dropped mobile connection, proxy timeout).
 */
export const REFRESH_ROTATION_GRACE_MS = 60_000;

/** Bounded walk along `replacedByTokenId` while recovering within the grace window. */
const GRACE_CHAIN_MAX_HOPS = 5;

export type RefreshRejectReason = "not_found" | "expired" | "revoked_logout" | "reuse_detected";

export type RefreshRotationOutcome =
  | {
      kind: "rotated";
      userId: string;
      newId: string;
      newToken: string;
      newExpiresAt: Date;
      /** Set when a recently replaced token recovered its chain inside the grace window. */
      recoveredFromSessionId?: string;
      msSinceRotation?: number;
    }
  | {
      kind: "rejected";
      reason: RefreshRejectReason;
      userId?: string;
      revokedSessions?: number;
      msSinceRotation?: number;
    }
  /** Another request rotated the same token first. Nothing was changed by this request. */
  | { kind: "conflict"; userId: string };

/**
 * The refresh-token store could not be read or written. Not evidence the session is invalid.
 * `committed: false` — this request changed nothing durable, so a retry is safe.
 */
export class RefreshTokenStoreUnavailableError extends Error {
  readonly name = "RefreshTokenStoreUnavailableError";
  constructor(
    readonly committed: boolean,
    readonly storeError: unknown,
  ) {
    super("Refresh token store unavailable");
  }
}

type RotationRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
};

const ROTATION_ROW_SELECT = {
  id: true,
  userId: true,
  expiresAt: true,
  revokedAt: true,
  replacedByTokenId: true,
} as const;

export type RefreshRotationDb = {
  refreshToken: {
    findUnique(args: {
      where: { tokenHash: string } | { id: string };
      select: typeof ROTATION_ROW_SELECT;
    }): Promise<RotationRow | null>;
    create(args: {
      data: {
        tokenHash: string;
        userId: string;
        expiresAt: Date;
        revokedAt: null;
        replacedByTokenId: null;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
    updateMany(args: {
      where: { id: string; revokedAt: null } | { userId: string; revokedAt: null };
      data: { revokedAt: Date; replacedByTokenId?: string };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: { id: string } }): Promise<{ count: number }>;
  };
};

let rotationDbOverride: RefreshRotationDb | null = null;
let rotationClockOverride: (() => number) | null = null;

function rotationDb(): RefreshRotationDb {
  return rotationDbOverride ?? (prisma as unknown as RefreshRotationDb);
}

function rotationNow(): number {
  return rotationClockOverride ? rotationClockOverride() : Date.now();
}

/** Isolated tests only — swaps the store/clock used by rotation. */
export const refreshTokenServiceTestHooks = {
  setDb(db: RefreshRotationDb | null): void {
    rotationDbOverride = db;
  },
  setClock(clock: (() => number) | null): void {
    rotationClockOverride = clock;
  },
};

/**
 * Create a replacement for `current` and revoke `current` only if it is still active.
 * Insert-first ordering: a failure before the conditional update leaves `current` usable.
 */
async function replaceActiveSession(
  db: RefreshRotationDb,
  current: RotationRow,
  now: number,
  sessionStartedAtMs: number,
): Promise<{ kind: "replaced"; newId: string; newToken: string; newExpiresAt: Date } | { kind: "conflict" }> {
  const newPlain = buildSessionToken(sessionStartedAtMs);
  const newExpiresAt = new Date(
    Math.min(
      now + refreshTokenTtlDays() * 24 * 60 * 60 * 1000,
      sessionStartedAtMs + refreshAbsoluteLifetimeMs(),
    ),
  );

  let created: { id: string };
  try {
    created = await db.refreshToken.create({
      data: {
        tokenHash: sha256Hex(newPlain),
        userId: current.userId,
        expiresAt: newExpiresAt,
        revokedAt: null,
        replacedByTokenId: null,
      },
      select: { id: true },
    });
  } catch (e) {
    throw new RefreshTokenStoreUnavailableError(false, e);
  }

  let updated: { count: number };
  try {
    updated = await db.refreshToken.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: new Date(now), replacedByTokenId: created.id },
    });
  } catch (e) {
    // The revoke may or may not have committed; the grace window covers a retry with the old token.
    throw new RefreshTokenStoreUnavailableError(true, e);
  }

  if (updated.count !== 1) {
    // Lost the race: drop our never-issued row so the winner's chain stays the only active one.
    await db.refreshToken.deleteMany({ where: { id: created.id } }).catch(() => undefined);
    return { kind: "conflict" };
  }
  return { kind: "replaced", newId: created.id, newToken: newPlain, newExpiresAt };
}

/** Follow the replacement chain from a rotated token to its current head. */
async function findChainHead(db: RefreshRotationDb, start: RotationRow): Promise<RotationRow | null> {
  let row = start;
  for (let hop = 0; hop < GRACE_CHAIN_MAX_HOPS; hop++) {
    if (!row.replacedByTokenId) return row;
    const next = await db.refreshToken.findUnique({
      where: { id: row.replacedByTokenId },
      select: ROTATION_ROW_SELECT,
    });
    if (!next || next.userId !== start.userId) return null;
    if (next.revokedAt == null) return next;
    if (next.replacedByTokenId == null) return next;
    row = next;
  }
  return null;
}

/**
 * Rotate a refresh token and report exactly why it was or was not rotated.
 *
 * - Active token: replaced (insert new, conditionally revoke old). Losing a concurrent race → `conflict`.
 * - Token revoked by logout/password change (no replacement link): rejected, never recovered.
 * - Token rotated within `graceMs` whose chain head is still active: the head is replaced and the
 *   caller receives the new head (one active session per chain). Outside the window: reuse cascade.
 * - Store failures throw {@link RefreshTokenStoreUnavailableError}; they never look like an invalid token.
 *
 * Avoids interactive transactions (Supabase transaction pooler P2028); the conditional update is the
 * single commit point.
 */
export async function rotateRefreshTokenWithOutcome(
  token: string,
  opts?: { graceMs?: number },
): Promise<RefreshRotationOutcome> {
  const raw = String(token ?? "").trim();
  if (!raw) return { kind: "rejected", reason: "not_found" };
  const graceMs = Math.max(0, opts?.graceMs ?? 0);
  const db = rotationDb();
  const now = rotationNow();

  let existing: RotationRow | null;
  try {
    existing = await db.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(raw) },
      select: ROTATION_ROW_SELECT,
    });
  } catch (e) {
    throw new RefreshTokenStoreUnavailableError(false, e);
  }
  if (!existing) return { kind: "rejected", reason: "not_found" };

  const sessionStartedAtMs = sessionStartFromToken(raw, now);
  if (now - sessionStartedAtMs >= refreshAbsoluteLifetimeMs()) {
    return { kind: "rejected", reason: "expired", userId: existing.userId };
  }

  if (existing.revokedAt == null) {
    if (existing.expiresAt.getTime() <= now) {
      return { kind: "rejected", reason: "expired", userId: existing.userId };
    }
    const result = await replaceActiveSession(db, existing, now, sessionStartedAtMs);
    if (result.kind === "conflict") return { kind: "conflict", userId: existing.userId };
    return {
      kind: "rotated",
      userId: existing.userId,
      newId: result.newId,
      newToken: result.newToken,
      newExpiresAt: result.newExpiresAt,
    };
  }

  // Explicit logout / password change / prior reuse cascade: revoked without a replacement.
  if (existing.replacedByTokenId == null) {
    return { kind: "rejected", reason: "revoked_logout", userId: existing.userId };
  }

  const msSinceRotation = now - existing.revokedAt.getTime();
  const withinGrace =
    graceMs > 0 &&
    msSinceRotation >= 0 &&
    msSinceRotation <= graceMs &&
    existing.expiresAt.getTime() > now;

  if (withinGrace) {
    let head: RotationRow | null;
    try {
      head = await findChainHead(db, existing);
    } catch (e) {
      throw new RefreshTokenStoreUnavailableError(false, e);
    }
    if (!head || head.revokedAt != null) {
      // Chain ended in a logout/revocation — nothing to recover, nothing left to revoke.
      return { kind: "rejected", reason: "revoked_logout", userId: existing.userId, msSinceRotation };
    }
    if (head.expiresAt.getTime() <= now) {
      return { kind: "rejected", reason: "expired", userId: existing.userId, msSinceRotation };
    }
    const result = await replaceActiveSession(db, head, now, sessionStartedAtMs);
    if (result.kind === "conflict") return { kind: "conflict", userId: existing.userId };
    return {
      kind: "rotated",
      userId: existing.userId,
      newId: result.newId,
      newToken: result.newToken,
      newExpiresAt: result.newExpiresAt,
      recoveredFromSessionId: existing.id,
      msSinceRotation,
    };
  }

  // Replay of a replaced token outside the grace window: treat as theft.
  let revoked: { count: number };
  try {
    revoked = await db.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date(now) },
    });
  } catch (e) {
    throw new RefreshTokenStoreUnavailableError(true, e);
  }
  return {
    kind: "rejected",
    reason: "reuse_detected",
    userId: existing.userId,
    revokedSessions: revoked.count,
    msSinceRotation,
  };
}

/**
 * Strict rotation (no grace window): any replay of a replaced token revokes every session.
 * Returns null for every non-rotated outcome, including store failures.
 */
export async function rotateRefreshToken(
  token: string
): Promise<{ userId: string; newId: string; newToken: string; newExpiresAt: Date } | null> {
  try {
    const outcome = await rotateRefreshTokenWithOutcome(token);
    if (outcome.kind !== "rotated") return null;
    return {
      userId: outcome.userId,
      newId: outcome.newId,
      newToken: outcome.newToken,
      newExpiresAt: outcome.newExpiresAt,
    };
  } catch (e) {
    console.warn("[refreshToken.rotate]", e instanceof Error ? e.name : "error");
    return null;
  }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = sha256Hex(String(token ?? "").trim());
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes a refresh session and returns the owning user id in one round-trip when possible.
 * Used by logout so push-token cleanup can run after the HTTP response is sent.
 */
export async function revokeRefreshTokenAndGetUserId(token: string): Promise<string | null> {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const tokenHash = sha256Hex(raw);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { userId: true, revokedAt: true },
  });
  if (!row) return null;
  if (!row.revokedAt) {
    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }
  return row.userId;
}

/** Resolve user id for logout when only the raw refresh cookie value is available. */
export async function userIdForRefreshToken(token: string): Promise<string | null> {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const tokenHash = sha256Hex(raw);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });
  return row?.userId ?? null;
}
