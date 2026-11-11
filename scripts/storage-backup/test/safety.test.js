import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { destinationKey, isRetryable, withRetry } from "../src/backup.js";
import { keyRefFor } from "../src/logger.js";
import { s3Error } from "./helpers/mockS3.js";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const sources = readdirSync(srcDir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => ({ file: f, text: readFileSync(path.join(srcDir, f), "utf8") }));

test("worker source contains no destructive S3 operations", () => {
  const forbidden = /\b(DeleteObjectCommand|DeleteObjectsCommand|DeleteBucketCommand|CopyObjectCommand|PutBucket\w*Command|DeleteBucket\w*Command)\b/;
  for (const { file, text } of sources) {
    assert.ok(!forbidden.test(text), `${file} must not use destructive or bucket-mutating commands`);
  }
});

test("worker source never logs process.env or credentials", () => {
  for (const { file, text } of sources) {
    assert.ok(!/log\w*\.\w+\([^)]*process\.env/.test(text), `${file} must not log process.env`);
    assert.ok(!/console\.(log|info|warn|error)/.test(text), `${file} must log via the structured logger`);
  }
});

test("destination keys preserve the source path verbatim", () => {
  assert.equal(destinationKey("supabase-storage", "caretip", "a/b/c.png"), "supabase-storage/caretip/a/b/c.png");
  assert.equal(destinationKey("", "caretip", "x.png"), "caretip/x.png");
  assert.equal(destinationKey("p", "caretip", "dir with space/ü.png"), "p/caretip/dir with space/ü.png");
});

test("key references: hashed for sensitive buckets, raw otherwise", () => {
  const sensitive = new Set(["caretip-kyc"]);
  assert.equal(keyRefFor("caretip", "avatars/a.jpg", sensitive), "avatars/a.jpg");
  const ref = keyRefFor("caretip-kyc", "verification/biz/doc.pdf", sensitive);
  assert.match(ref, /^sha256:[0-9a-f]{16}$/);
  assert.ok(!ref.includes("biz"));
});

test("retry classification", () => {
  assert.equal(isRetryable(s3Error("InternalError", 500)), true);
  assert.equal(isRetryable(s3Error("SlowDown", 503)), true);
  assert.equal(isRetryable(s3Error("TooManyRequests", 429)), true);
  assert.equal(isRetryable(Object.assign(new Error("reset"), { code: "ECONNRESET" })), true);
  assert.equal(isRetryable(s3Error("AccessDenied", 403)), false);
  assert.equal(isRetryable(s3Error("NoSuchKey", 404)), false);
  assert.equal(isRetryable(Object.assign(new Error("aborted"), { name: "AbortError" })), false);
});

test("withRetry backs off and gives up after the configured attempts", async () => {
  const delays = [];
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw s3Error("InternalError", 500);
      },
      { attempts: 3, sleep: async (ms) => delays.push(ms), baseDelayMs: 100 },
    ),
  );
  assert.equal(calls, 3);
  assert.equal(delays.length, 2);
  assert.ok(delays[1] >= delays[0] / 2);
});
