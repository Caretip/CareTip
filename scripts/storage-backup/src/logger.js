// @ts-check
import { createHash } from "node:crypto";

/**
 * @typedef {(event: string, fields?: Record<string, unknown>) => void} LogFn
 * @typedef {{ info: LogFn, warn: LogFn, error: LogFn }} Logger
 */

/**
 * One JSON object per line (Render log search friendly). Callers pass explicit fields only —
 * never config objects, credentials, request/response objects, or file contents.
 * @param {{ write?: (line: string) => void, now?: () => Date }} [opts]
 * @returns {Logger}
 */
export function createLogger(opts = {}) {
  const write = opts.write ?? ((line) => process.stdout.write(`${line}\n`));
  const now = opts.now ?? (() => new Date());
  /**
   * @param {string} level
   * @param {string} event
   * @param {Record<string, unknown>} [fields]
   */
  const emit = (level, event, fields = {}) => {
    write(JSON.stringify({ ts: now().toISOString(), level, service: "caretip-storage-backup", event, ...fields }));
  };
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

/**
 * Object keys in sensitive buckets (KYC, DSAR) embed tenant/user identifiers, so logs carry a
 * truncated hash instead. Other buckets log the key for operability.
 * @param {string} bucket
 * @param {string} key
 * @param {Set<string>} sensitiveBuckets
 */
export function keyRefFor(bucket, key, sensitiveBuckets) {
  if (!sensitiveBuckets.has(bucket)) return key;
  return `sha256:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}
