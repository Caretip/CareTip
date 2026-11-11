// @ts-check

export const DEFAULT_REQUIRED_BUCKETS = ["caretip", "caretip-official"];
export const DEFAULT_SENSITIVE_BUCKETS = ["caretip-kyc", "caretip-dsar"];
export const DEFAULT_DEST_PREFIX = "supabase-storage";

const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export class ConfigError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid storage backup configuration: ${problems.join("; ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/**
 * @typedef {object} S3EndpointConfig
 * @property {string} endpoint
 * @property {string} region
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 */

/**
 * @typedef {object} BackupConfig
 * @property {S3EndpointConfig} source
 * @property {S3EndpointConfig} destination
 * @property {string} destBucket
 * @property {string} destPrefix
 * @property {string[]} requiredBuckets
 * @property {string[]} optionalBuckets
 * @property {Set<string>} sensitiveBuckets
 * @property {number} concurrency
 * @property {number} maxAttempts
 * @property {number} bufferLimitBytes
 * @property {number} requestTimeoutMs
 * @property {number} listPageSize
 * @property {"AES256" | undefined} serverSideEncryption
 * @property {boolean} dryRun
 */

/** @param {string | undefined} raw */
function parseList(raw) {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** @param {string | undefined} raw */
function parseBool(raw) {
  return /^(1|true|yes|on)$/i.test(String(raw ?? "").trim());
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @param {string[]} problems
 */
function parseIntInRange(env, name, fallback, min, max, problems) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return n;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {string[]} problems
 */
function requireVar(env, name, problems) {
  const v = env[name]?.trim();
  if (!v) problems.push(`${name} is required`);
  return v ?? "";
}

/**
 * @param {string} name
 * @param {string} value
 * @param {string[]} problems
 */
function validateHttpsEndpoint(name, value, problems) {
  if (!value) return value;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") problems.push(`${name} must use https`);
    if (u.username || u.password) problems.push(`${name} must not contain credentials`);
    return value.replace(/\/+$/, "");
  } catch {
    problems.push(`${name} must be a valid URL`);
    return value;
  }
}

/**
 * Loads and validates configuration. Error messages name variables only — never their values.
 * @param {Record<string, string | undefined>} env
 * @param {{ dryRunFlag?: boolean }} [opts]
 * @returns {BackupConfig}
 */
export function loadConfig(env, opts = {}) {
  /** @type {string[]} */
  const problems = [];

  const source = {
    endpoint: validateHttpsEndpoint(
      "SUPABASE_S3_ENDPOINT",
      requireVar(env, "SUPABASE_S3_ENDPOINT", problems),
      problems,
    ),
    region: requireVar(env, "SUPABASE_S3_REGION", problems),
    accessKeyId: requireVar(env, "SUPABASE_S3_ACCESS_KEY_ID", problems),
    secretAccessKey: requireVar(env, "SUPABASE_S3_SECRET_ACCESS_KEY", problems),
  };

  const destination = {
    endpoint: validateHttpsEndpoint("B2_S3_ENDPOINT", requireVar(env, "B2_S3_ENDPOINT", problems), problems),
    region: requireVar(env, "B2_S3_REGION", problems),
    accessKeyId: requireVar(env, "B2_ACCESS_KEY_ID", problems),
    secretAccessKey: requireVar(env, "B2_SECRET_ACCESS_KEY", problems),
  };

  const destBucket = requireVar(env, "B2_BUCKET", problems);
  if (destBucket && !BUCKET_NAME_RE.test(destBucket)) problems.push("B2_BUCKET is not a valid bucket name");

  const rawPrefix = env.B2_PREFIX === undefined ? DEFAULT_DEST_PREFIX : env.B2_PREFIX.trim();
  const destPrefix = rawPrefix.replace(/^\/+|\/+$/g, "");
  if (destPrefix.split("/").some((seg) => seg === ".." || seg === ".")) {
    problems.push("B2_PREFIX must not contain '.' or '..' segments");
  }

  const requiredBuckets =
    env.BACKUP_BUCKETS === undefined ? [...DEFAULT_REQUIRED_BUCKETS] : parseList(env.BACKUP_BUCKETS);
  const optionalBuckets = parseList(env.BACKUP_OPTIONAL_BUCKETS);
  if (requiredBuckets.length + optionalBuckets.length === 0) {
    problems.push("BACKUP_BUCKETS or BACKUP_OPTIONAL_BUCKETS must list at least one bucket");
  }
  for (const b of [...requiredBuckets, ...optionalBuckets]) {
    if (!BUCKET_NAME_RE.test(b)) problems.push(`bucket name "${b}" is not valid`);
  }
  const overlap = requiredBuckets.filter((b) => optionalBuckets.includes(b));
  if (overlap.length > 0) {
    problems.push(`buckets listed as both required and optional: ${overlap.join(", ")}`);
  }

  const sensitiveBuckets = new Set(
    env.BACKUP_SENSITIVE_BUCKETS === undefined
      ? DEFAULT_SENSITIVE_BUCKETS
      : parseList(env.BACKUP_SENSITIVE_BUCKETS),
  );

  const sseRaw = (env.B2_SERVER_SIDE_ENCRYPTION ?? "AES256").trim().toUpperCase();
  /** @type {"AES256" | undefined} */
  let serverSideEncryption = "AES256";
  if (sseRaw === "NONE") serverSideEncryption = undefined;
  else if (sseRaw !== "AES256") problems.push("B2_SERVER_SIDE_ENCRYPTION must be AES256 or none");

  const config = {
    source,
    destination,
    destBucket,
    destPrefix,
    requiredBuckets,
    optionalBuckets,
    sensitiveBuckets,
    concurrency: parseIntInRange(env, "BACKUP_CONCURRENCY", 4, 1, 16, problems),
    maxAttempts: parseIntInRange(env, "BACKUP_MAX_ATTEMPTS", 4, 1, 10, problems),
    bufferLimitBytes: parseIntInRange(
      env,
      "BACKUP_BUFFER_LIMIT_BYTES",
      64 * 1024 * 1024,
      1024 * 1024,
      512 * 1024 * 1024,
      problems,
    ),
    requestTimeoutMs: parseIntInRange(env, "BACKUP_REQUEST_TIMEOUT_MS", 120_000, 5_000, 900_000, problems),
    listPageSize: parseIntInRange(env, "BACKUP_LIST_PAGE_SIZE", 1000, 1, 1000, problems),
    serverSideEncryption,
    dryRun: Boolean(opts.dryRunFlag) || parseBool(env.BACKUP_DRY_RUN),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
