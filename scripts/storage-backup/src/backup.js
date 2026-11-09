// @ts-check
import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { keyRefFor } from "./logger.js";

/**
 * Read-only on the source (List/Get) and additive on the destination (List/Head/Put).
 * There is intentionally no delete, copy-over-source, or sync-with-delete operation.
 */
export const ALLOWED_COMMANDS = Object.freeze({
  source: ["ListObjectsV2Command", "GetObjectCommand"],
  destination: ["ListObjectsV2Command", "HeadObjectCommand", "PutObjectCommand"],
});

export const META_SOURCE_ETAG = "source-etag";
export const META_SOURCE_LAST_MODIFIED = "source-last-modified";
export const META_SHA256 = "sha256";

/** @typedef {{ send: (command: any) => Promise<any> }} S3Like */
/**
 * @typedef {object} BackupContext
 * @property {S3Like} source
 * @property {S3Like} destination
 * @property {import("./config.js").BackupConfig} config
 * @property {import("./logger.js").Logger} logger
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => number} [now]
 * @property {AbortSignal} [signal]
 */
/**
 * @typedef {object} BucketSummary
 * @property {string} bucket
 * @property {boolean} optional
 * @property {"ok" | "failed" | "skipped_missing"} status
 * @property {number} listed
 * @property {number} copied
 * @property {number} unchanged
 * @property {number} wouldCopy
 * @property {number} vanished
 * @property {number} failed
 * @property {number} bytesCopied
 * @property {number} durationMs
 * @property {{ stage: string, name: string, code?: string, httpStatus?: number } | undefined} [error]
 */

export class VerificationError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(`verification failed: ${reason}`);
    this.name = "VerificationError";
    this.reason = reason;
  }
}

/** @param {unknown} etag */
export function normalizeEtag(etag) {
  return typeof etag === "string" ? etag.replace(/^W\//, "").replace(/"/g, "").trim() : "";
}

/** @param {unknown} value */
function toIso(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Destination key: `{prefix}/{sourceBucket}/{sourceKey}` — the source key is preserved verbatim.
 * @param {string} prefix
 * @param {string} bucket
 * @param {string} key
 */
export function destinationKey(prefix, bucket, key) {
  return `${prefix ? `${prefix}/` : ""}${bucket}/${key}`;
}

/** @param {any} err */
function httpStatus(err) {
  const s = err?.$metadata?.httpStatusCode;
  return typeof s === "number" ? s : undefined;
}

/**
 * Safe error summary: name / code / HTTP status only. Messages are never logged because SDK
 * messages can echo request details.
 * @param {any} err
 */
export function describeError(err) {
  /** @type {{ name: string, code?: string, httpStatus?: number }} */
  const out = { name: String(err?.name ?? "Error").slice(0, 80) };
  const code = err?.Code ?? err?.code;
  if (typeof code === "string" && code) out.code = code.slice(0, 80);
  const status = httpStatus(err);
  if (status !== undefined) out.httpStatus = status;
  return out;
}

/** @param {any} err */
function isMissingKey(err) {
  return err?.name === "NoSuchKey" || err?.Code === "NoSuchKey" || err?.name === "NotFound";
}

/** @param {any} err */
function isMissingBucket(err) {
  if (err?.name === "NoSuchBucket" || err?.Code === "NoSuchBucket") return true;
  if (typeof err?.message === "string" && /bucket not found/i.test(err.message)) return true;
  return httpStatus(err) === 404;
}

const RETRYABLE_NAMES = new Set([
  "VerificationError",
  "TimeoutError",
  "RequestTimeout",
  "RequestTimeoutException",
  "ThrottlingException",
  "SlowDown",
  "InternalError",
  "ServiceUnavailable",
]);
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
]);

/** @param {any} err */
export function isRetryable(err) {
  if (err?.name === "AbortError") return false;
  if (RETRYABLE_NAMES.has(err?.name) || RETRYABLE_CODES.has(err?.code)) return true;
  const status = httpStatus(err);
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

/**
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{ attempts: number, sleep: (ms: number) => Promise<void>, baseDelayMs?: number, maxDelayMs?: number, onRetry?: (err: unknown, attempt: number) => void }} opts
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts) {
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 15_000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.attempts || !isRetryable(err)) throw err;
      opts.onRetry?.(err, attempt);
      const delay = Math.min(max, base * 2 ** (attempt - 1));
      await opts.sleep(Math.round(delay * (0.5 + Math.random() / 2)));
    }
  }
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<void>} fn
 */
async function mapPool(items, concurrency, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** @param {AbortSignal | undefined} signal */
function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error("backup aborted");
    err.name = "AbortError";
    throw err;
  }
}

/**
 * @param {BackupContext} ctx
 * @param {string} bucket
 * @returns {Promise<Map<string, number>>} source-relative key -> size
 */
async function indexDestination(ctx, bucket) {
  const { config } = ctx;
  const prefix = destinationKey(config.destPrefix, bucket, "");
  /** @type {Map<string, number>} */
  const index = new Map();
  /** @type {string | undefined} */
  let token;
  do {
    throwIfAborted(ctx.signal);
    const page = await withRetry(
      () =>
        ctx.destination.send(
          new ListObjectsV2Command({
            Bucket: config.destBucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: config.listPageSize,
          }),
        ),
      retryOpts(ctx),
    );
    for (const obj of page.Contents ?? []) {
      if (typeof obj.Key === "string" && obj.Key.startsWith(prefix)) {
        index.set(obj.Key.slice(prefix.length), Number(obj.Size ?? 0));
      }
    }
    if (page.IsTruncated && !page.NextContinuationToken) {
      throw new Error("destination listing truncated without continuation token");
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return index;
}

/** @param {BackupContext} ctx */
function retryOpts(ctx) {
  return {
    attempts: ctx.config.maxAttempts,
    sleep: ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
}

/**
 * Why an object must be copied, or null when the destination already holds this version.
 * @param {BackupContext} ctx
 * @param {string} bucket
 * @param {{ Key: string, Size?: number, ETag?: string, LastModified?: Date | string }} item
 * @param {Map<string, number>} destIndex
 * @returns {Promise<string | null>}
 */
async function copyReason(ctx, bucket, item, destIndex) {
  const destSize = destIndex.get(item.Key);
  if (destSize === undefined) return "new";
  if (destSize !== Number(item.Size ?? 0)) return "size_changed";

  let head;
  try {
    head = await withRetry(
      () =>
        ctx.destination.send(
          new HeadObjectCommand({
            Bucket: ctx.config.destBucket,
            Key: destinationKey(ctx.config.destPrefix, bucket, item.Key),
          }),
        ),
      retryOpts(ctx),
    );
  } catch (err) {
    if (isMissingKey(err) || httpStatus(err) === 404) return "new";
    throw err;
  }
  const meta = head.Metadata ?? {};
  const sourceEtag = normalizeEtag(item.ETag);
  if (sourceEtag) return meta[META_SOURCE_ETAG] === sourceEtag ? null : "etag_changed";
  const lastModified = toIso(item.LastModified);
  return lastModified && meta[META_SOURCE_LAST_MODIFIED] === lastModified ? null : "last_modified_changed";
}

/**
 * Streams one object from source to destination and verifies the stored copy.
 * @param {BackupContext} ctx
 * @param {string} bucket
 * @param {{ Key: string, Size?: number, ETag?: string, LastModified?: Date | string }} item
 * @returns {Promise<number>} bytes written
 */
async function copyObject(ctx, bucket, item) {
  const { config } = ctx;
  const destKey = destinationKey(config.destPrefix, bucket, item.Key);
  const get = await ctx.source.send(new GetObjectCommand({ Bucket: bucket, Key: item.Key }));
  const body = get.Body;
  let consumed = false;
  try {
    if (!body) throw new VerificationError("source_body_missing");
    const size = Number(get.ContentLength ?? item.Size ?? 0);
    const sourceEtag = normalizeEtag(get.ETag) || normalizeEtag(item.ETag);
    const lastModified = toIso(get.LastModified ?? item.LastModified);

    /** @type {Record<string, string>} */
    const metadata = {};
    if (sourceEtag) metadata[META_SOURCE_ETAG] = sourceEtag;
    if (lastModified) metadata[META_SOURCE_LAST_MODIFIED] = lastModified;

    const base = {
      Bucket: config.destBucket,
      Key: destKey,
      ContentType: get.ContentType,
      CacheControl: get.CacheControl,
      ContentDisposition: get.ContentDisposition,
      ContentEncoding: get.ContentEncoding,
      ContentLanguage: get.ContentLanguage,
      ServerSideEncryption: config.serverSideEncryption,
    };

    let sha256 = "";
    if (size <= config.bufferLimitBytes) {
      const bytes = await body.transformToByteArray();
      consumed = true;
      if (bytes.byteLength !== size) throw new VerificationError("source_length_mismatch");
      sha256 = createHash("sha256").update(bytes).digest("hex");
      metadata[META_SHA256] = sha256;
      const contentMd5 = createHash("md5").update(bytes).digest("base64");
      await ctx.destination.send(
        new PutObjectCommand({ ...base, Body: bytes, ContentLength: size, ContentMD5: contentMd5, Metadata: metadata }),
      );
    } else {
      consumed = true;
      await ctx.destination.send(
        new PutObjectCommand({ ...base, Body: body, ContentLength: size, Metadata: metadata }),
      );
    }

    const head = await ctx.destination.send(new HeadObjectCommand({ Bucket: config.destBucket, Key: destKey }));
    if (Number(head.ContentLength) !== size) throw new VerificationError("size_mismatch");
    const storedMeta = head.Metadata ?? {};
    if (sourceEtag && storedMeta[META_SOURCE_ETAG] !== sourceEtag) throw new VerificationError("etag_metadata_mismatch");
    if (sha256 && storedMeta[META_SHA256] !== sha256) throw new VerificationError("sha256_metadata_mismatch");
    return size;
  } finally {
    if (!consumed && body && typeof body.destroy === "function") body.destroy();
  }
}

/**
 * @param {BackupContext} ctx
 * @param {string} bucket
 * @param {{ Key: string, Size?: number, ETag?: string, LastModified?: Date | string }} item
 * @param {Map<string, number>} destIndex
 * @param {BucketSummary} summary
 */
async function processObject(ctx, bucket, item, destIndex, summary) {
  const keyRef = keyRefFor(bucket, item.Key, ctx.config.sensitiveBuckets);
  let stage = "compare";
  let attempts = 0;
  try {
    throwIfAborted(ctx.signal);
    const reason = await copyReason(ctx, bucket, item, destIndex);
    if (!reason) {
      summary.unchanged++;
      return;
    }
    if (ctx.config.dryRun) {
      summary.wouldCopy++;
      return;
    }
    stage = "copy";
    const bytes = await withRetry((attempt) => {
      attempts = attempt;
      throwIfAborted(ctx.signal);
      return copyObject(ctx, bucket, item);
    }, {
      ...retryOpts(ctx),
      onRetry: (err, attempt) =>
        ctx.logger.warn("object.retry", { bucket, keyRef, attempt, ...describeError(err) }),
    });
    summary.copied++;
    summary.bytesCopied += bytes;
  } catch (err) {
    if (stage === "copy" && isMissingKey(err)) {
      summary.vanished++;
      ctx.logger.info("object.vanished", { bucket, keyRef });
      return;
    }
    summary.failed++;
    ctx.logger.warn("object.failed", {
      bucket,
      keyRef,
      stage,
      attempts,
      ...describeError(err),
      ...(err instanceof VerificationError ? { reason: err.reason } : {}),
    });
  }
}

/**
 * Backs up one source bucket. Never throws: failures are reported in the returned summary.
 * @param {BackupContext} ctx
 * @param {string} bucket
 * @param {{ optional: boolean }} opts
 * @returns {Promise<BucketSummary>}
 */
export async function backupBucket(ctx, bucket, opts) {
  const now = ctx.now ?? Date.now;
  const started = now();
  /** @type {BucketSummary} */
  const summary = {
    bucket,
    optional: opts.optional,
    status: "ok",
    listed: 0,
    copied: 0,
    unchanged: 0,
    wouldCopy: 0,
    vanished: 0,
    failed: 0,
    bytesCopied: 0,
    durationMs: 0,
  };
  ctx.logger.info("bucket.start", { bucket, optional: opts.optional, dryRun: ctx.config.dryRun });

  const finish = () => {
    summary.durationMs = now() - started;
    const level = summary.status === "failed" ? "error" : summary.status === "skipped_missing" ? "warn" : "info";
    ctx.logger[level]("bucket.finish", { ...summary });
    return summary;
  };

  /** @type {Map<string, number>} */
  let destIndex;
  try {
    destIndex = await indexDestination(ctx, bucket);
  } catch (err) {
    summary.status = "failed";
    summary.error = { stage: "destination_list", ...describeError(err) };
    return finish();
  }

  /** @type {string | undefined} */
  let token;
  let firstPage = true;
  try {
    do {
      throwIfAborted(ctx.signal);
      let page;
      try {
        page = await withRetry(
          () =>
            ctx.source.send(
              new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: ctx.config.listPageSize }),
            ),
          retryOpts(ctx),
        );
      } catch (err) {
        if (firstPage && isMissingBucket(err)) {
          summary.status = opts.optional ? "skipped_missing" : "failed";
          summary.error = { stage: "source_missing", ...describeError(err) };
          return finish();
        }
        throw err;
      }
      firstPage = false;
      const items = (page.Contents ?? []).filter(
        /** @param {any} o */ (o) => typeof o.Key === "string" && o.Key.length > 0,
      );
      summary.listed += items.length;
      await mapPool(items, ctx.config.concurrency, (item) => processObject(ctx, bucket, item, destIndex, summary));
      if (page.IsTruncated && !page.NextContinuationToken) {
        throw new Error("source listing truncated without continuation token");
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  } catch (err) {
    summary.status = "failed";
    summary.error = { stage: "source_list", ...describeError(err) };
  }

  if (summary.failed > 0) summary.status = "failed";
  return finish();
}

/**
 * Runs every configured bucket sequentially and reports an exit code (0 = all ok, 1 = any failure).
 * @param {BackupContext} ctx
 */
export async function runBackup(ctx) {
  const now = ctx.now ?? Date.now;
  const started = now();
  const { config } = ctx;
  ctx.logger.info("run.start", {
    requiredBuckets: config.requiredBuckets,
    optionalBuckets: config.optionalBuckets,
    destBucket: config.destBucket,
    destPrefix: config.destPrefix,
    dryRun: config.dryRun,
    concurrency: config.concurrency,
  });

  /** @type {BucketSummary[]} */
  const buckets = [];
  const plan = [
    ...config.requiredBuckets.map((bucket) => ({ bucket, optional: false })),
    ...config.optionalBuckets.map((bucket) => ({ bucket, optional: true })),
  ];
  for (const { bucket, optional } of plan) {
    if (ctx.signal?.aborted) break;
    buckets.push(await backupBucket(ctx, bucket, { optional }));
  }

  const aborted = Boolean(ctx.signal?.aborted);
  const totals = buckets.reduce(
    (acc, b) => ({
      listed: acc.listed + b.listed,
      copied: acc.copied + b.copied,
      unchanged: acc.unchanged + b.unchanged,
      wouldCopy: acc.wouldCopy + b.wouldCopy,
      vanished: acc.vanished + b.vanished,
      failed: acc.failed + b.failed,
      bytesCopied: acc.bytesCopied + b.bytesCopied,
    }),
    { listed: 0, copied: 0, unchanged: 0, wouldCopy: 0, vanished: 0, failed: 0, bytesCopied: 0 },
  );
  const failedBuckets = buckets.filter((b) => b.status === "failed").map((b) => b.bucket);
  const exitCode = failedBuckets.length > 0 || aborted ? 1 : 0;
  const result = {
    exitCode,
    aborted,
    failedBuckets,
    skippedBuckets: buckets.filter((b) => b.status === "skipped_missing").map((b) => b.bucket),
    totals,
    durationMs: now() - started,
    dryRun: config.dryRun,
  };
  ctx.logger[exitCode === 0 ? "info" : "error"]("run.finish", result);
  return { ...result, buckets };
}
