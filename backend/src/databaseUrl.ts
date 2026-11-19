/**
 * Runtime Postgres URL for PrismaClient (Express): **`DATABASE_URL` only** (Supabase pooler).
 * Transaction pooler uses port **6543** + `pgbouncer=true` + configurable `connection_limit`.
 *
 * `DIRECT_URL` / `directUrl` are intentionally unused — direct `db.*.supabase.co` often fails
 * from deploy environments (P1001). Migrations use session pooler via scripts/sessionDatabaseUrl.mjs.
 *
 * SSL: ensures `sslmode=require` when missing.
 */

let loggedNormalization = false;

const DEFAULT_CONNECTION_LIMIT = 5;
const MIN_CONNECTION_LIMIT = 1;
const MAX_CONNECTION_LIMIT = 15;

export type DatabasePoolDiagnostics = {
  rawUrlHost: string | null;
  normalizedPort: string | null;
  pgbouncer: boolean;
  connectionLimit: number;
  poolTimeoutSeconds: number | null;
  usesSessionPoolerAtRuntime: boolean;
  directUrlConfigured: boolean;
};

function parseConnectionLimit(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_CONNECTION_LIMIT, Math.max(MIN_CONNECTION_LIMIT, n));
}

/** Resolved Prisma pool size for this process (env override → URL param → default). */
export function getDatabaseConnectionLimit(): number {
  if (process.env.DATABASE_CONNECTION_LIMIT?.trim()) {
    return parseConnectionLimit(process.env.DATABASE_CONNECTION_LIMIT, DEFAULT_CONNECTION_LIMIT);
  }
  const raw = process.env.DATABASE_URL?.trim();
  if (raw) {
    try {
      const parsed = new URL(raw.replace(/^postgresql:\/\//i, "http://"));
      const fromUrl = parsed.searchParams.get("connection_limit");
      if (fromUrl) {
        const parsedLimit = parseConnectionLimit(fromUrl, DEFAULT_CONNECTION_LIMIT);
        // Legacy templates used connection_limit=1; dedicated API servers need more than one slot.
        if (parsedLimit === 1 && !process.env.DATABASE_CONNECTION_LIMIT?.trim()) {
          return DEFAULT_CONNECTION_LIMIT;
        }
        return parsedLimit;
      }
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_CONNECTION_LIMIT;
}

/**
 * Merge query params into a postgresql URL without breaking passwords that contain `?` or `&`
 * (falls back to suffix-append when parsing fails).
 */
function ensureQueryParams(raw: string, add: Record<string, string>): string {
  const qIndex = raw.indexOf("?");
  if (qIndex === -1) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(add)) {
      params.set(k, v);
    }
    return `${raw}?${params.toString()}`;
  }

  const base = raw.slice(0, qIndex);
  const query = raw.slice(qIndex + 1);
  const params = new URLSearchParams(query);
  for (const [k, v] of Object.entries(add)) {
    if (!params.has(k)) {
      params.set(k, v);
    }
  }
  return `${base}?${params.toString()}`;
}

function isSupabasePoolerHost(hostname: string): boolean {
  return hostname.includes("pooler.supabase.com");
}

function isLocalDatabaseUrl(lower: string): boolean {
  return (
    /\blocalhost\b/.test(lower) ||
    /\b127\.0\.0\.1\b/.test(lower) ||
    lower.includes("[::1]") ||
    lower.includes("://::1")
  );
}

/** CI / local Postgres test jobs use loopback URLs — production deploys must not. */
function isLocalhostDatabaseAllowed(): boolean {
  return (
    process.env.CI === "true" ||
    process.env.DATABASE_ALLOW_LOCALHOST === "true" ||
    isTestProcess()
  );
}

function applyPoolParams(url: string, connectionLimit: number): string {
  return ensureQueryParams(url, {
    pgbouncer: "true",
    connection_limit: String(connectionLimit),
    pool_timeout: "30",
  });
}

/**
 * Normalize Supabase pooler URLs for Prisma runtime.
 * Rewrites session pooler (5432) → transaction pooler (6543) unless DATABASE_USE_SESSION_POOLER=true.
 */
/** A test process: Node test mode, the isolation wrapper, or any `npm run test:*` script. */
export function isTestProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === "test" ||
    env.CARETIP_TEST_ISOLATION === "1" ||
    (env.npm_lifecycle_event ?? "").startsWith("test")
  );
}

/**
 * A test may use a remote database only when the operator names it exactly:
 * CARETIP_ALLOW_REMOTE_TEST_DATABASE must equal the hostname of DATABASE_URL (a plain "1" or
 * "true" is not accepted), and CI never qualifies. Naming the host is the explicit intent; a
 * stray or inherited variable for a different database does nothing.
 */
export function remoteTestDatabaseAcknowledged(rawUrl: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CI === "true") return false;
  const ack = env.CARETIP_ALLOW_REMOTE_TEST_DATABASE?.trim().toLowerCase() ?? "";
  if (!ack || ack === "1" || ack === "true" || ack === "yes") return false;
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host.length > 0 && ack === host;
}

/** Nothing listens here: queries fail with "connection refused" instead of reaching a real database. */
export const TEST_GUARD_DATABASE_URL = "postgresql://test-guard@127.0.0.1:9/refused_non_local_database";
let warnedTestGuard = false;

export function getDatabaseUrlForPrisma(): string {
  const raw = process.env.DATABASE_URL?.trim();
  // Test scripts load the real .env files. A test may only use a loopback (disposable) database,
  // unless CARETIP_ALLOW_REMOTE_TEST_DATABASE=1 names a dedicated remote test database. The URL is
  // never printed.
  if (raw && isTestProcess() && !isLocalDatabaseUrl(raw.toLowerCase()) && !remoteTestDatabaseAcknowledged(raw)) {
    if (!warnedTestGuard) {
      warnedTestGuard = true;
      console.warn(
        "[database] test run with a non-local DATABASE_URL: database access is blocked. " +
          "Use scripts/safe-test.mjs with CARETIP_ISOLATED_POSTGRES_URL for database tests.",
      );
    }
    return TEST_GUARD_DATABASE_URL;
  }
  if (!raw) {
    throw new Error(
      "DATABASE_URL is required. Set it in .env to your Supabase pooler URL (see backend/.env.example).",
    );
  }

  const connectionLimit = getDatabaseConnectionLimit();

  const lower = raw.toLowerCase();
  if (isLocalDatabaseUrl(lower)) {
    if (!isLocalhostDatabaseAllowed()) {
      throw new Error(
        "DATABASE_URL must not use localhost or loopback. Use the Supabase pooler hostname from your project settings.",
      );
    }
    return raw.replace(/\/postgres\?\?/i, "/postgres?");
  }

  let url = raw.replace(/\/postgres\?\?/i, "/postgres?");

  if (!/sslmode=/i.test(url)) {
    url = ensureQueryParams(url, { sslmode: "require" });
  }

  let usedSessionPooler = false;
  try {
    const parsed = new URL(url);
    if (isSupabasePoolerHost(parsed.hostname)) {
      const port = parsed.port || "5432";
      const forceSession = process.env.DATABASE_USE_SESSION_POOLER === "true";

      if ((port === "5432" || port === "") && !forceSession) {
        parsed.port = "6543";
        parsed.searchParams.set("pgbouncer", "true");
        parsed.searchParams.set("connection_limit", String(connectionLimit));
        if (!parsed.searchParams.has("pool_timeout")) {
          parsed.searchParams.set("pool_timeout", "30");
        }
        url = parsed.toString();
        usedSessionPooler = true;
      } else if (port === "6543") {
        if (!parsed.searchParams.has("pgbouncer")) {
          parsed.searchParams.set("pgbouncer", "true");
        }
        parsed.searchParams.set("connection_limit", String(connectionLimit));
        if (!parsed.searchParams.has("pool_timeout")) {
          parsed.searchParams.set("pool_timeout", "30");
        }
        url = parsed.toString();
      } else if (port === "5432" && forceSession) {
        parsed.searchParams.set("connection_limit", String(connectionLimit));
        url = parsed.toString();
        usedSessionPooler = true;
      }
    } else if (url.includes("pooler.supabase.com:6543")) {
      url = applyPoolParams(url, connectionLimit);
    }
  } catch {
    if (url.includes("pooler.supabase.com:6543")) {
      url = applyPoolParams(url, connectionLimit);
    } else if (url.includes("pooler.supabase.com:5432")) {
      url = url.replace(":5432/", ":6543/");
      url = applyPoolParams(url, connectionLimit);
      usedSessionPooler = true;
    }
  }

  if (usedSessionPooler && !loggedNormalization) {
    loggedNormalization = true;
    console.warn(
      `[database] DATABASE_URL used Supabase session pooler (5432). Runtime Prisma uses transaction pooler (6543) with connection_limit=${connectionLimit}. Set DATABASE_USE_SESSION_POOLER=true only if you intend session mode.`,
    );
  }

  return url;
}

/** Non-secret pool configuration for ops audits and load tests. */
export function getDatabasePoolDiagnostics(): DatabasePoolDiagnostics {
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  let rawUrlHost: string | null = null;
  let normalizedPort: string | null = null;
  let pgbouncer = false;
  let poolTimeoutSeconds: number | null = null;

  if (raw) {
    try {
      const parsed = new URL(raw.replace(/^postgresql:\/\//i, "http://"));
      rawUrlHost = parsed.hostname;
    } catch {
      rawUrlHost = null;
    }
  }

  try {
    const normalized = new URL(getDatabaseUrlForPrisma().replace(/^postgresql:\/\//i, "http://"));
    normalizedPort = normalized.port || "5432";
    pgbouncer = normalized.searchParams.get("pgbouncer") === "true";
    const pt = normalized.searchParams.get("pool_timeout");
    poolTimeoutSeconds = pt ? Number.parseInt(pt, 10) : null;
  } catch {
    normalizedPort = null;
  }

  return {
    rawUrlHost,
    normalizedPort,
    pgbouncer,
    connectionLimit: getDatabaseConnectionLimit(),
    poolTimeoutSeconds,
    usesSessionPoolerAtRuntime: normalizedPort === "6543",
    directUrlConfigured: Boolean(process.env.DIRECT_URL?.trim()),
  };
}
