import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ALLOWED_COMMANDS, META_SHA256, META_SOURCE_ETAG, runBackup, backupBucket } from "../src/backup.js";
import { MockS3, s3Error } from "./helpers/mockS3.js";
import { FAKE_SECRETS, captureLogger, noSleep, testConfig } from "./helpers/fixtures.js";

const DEST = "caretip-backup-test";
const PREFIX = "supabase-storage";

function setup({ configOverrides = {}, sourceOpts, destOpts } = {}) {
  const source = new MockS3("source", sourceOpts);
  const destination = new MockS3("destination", destOpts).createBucket(DEST);
  const config = testConfig(configOverrides);
  const log = captureLogger();
  const ctx = { source, destination, config, logger: log.logger, sleep: noSleep };
  return { source, destination, config, log, ctx };
}

function assertOnlyAllowedCommands(source, destination) {
  for (const name of source.callNames()) {
    assert.ok(ALLOWED_COMMANDS.source.includes(name), `unexpected source command ${name}`);
  }
  for (const name of destination.callNames()) {
    assert.ok(ALLOWED_COMMANDS.destination.includes(name), `unexpected destination command ${name}`);
  }
}

test("copies new objects to {prefix}/{bucket}/{key}, preserving paths and metadata", async () => {
  const { source, destination, ctx } = setup();
  source
    .putRaw("caretip", "avatars/a.jpg", "jpeg-bytes", { contentType: "image/jpeg", cacheControl: "3600" })
    .putRaw("caretip", "business-logos/nested/dir/b.png", "png-bytes", { contentType: "image/png" })
    .putRaw("caretip-official", "logo.webp", "webp-bytes", { contentType: "image/webp" });

  const result = await runBackup(ctx);

  assert.equal(result.exitCode, 0);
  assert.equal(result.totals.copied, 3);
  const copied = destination.get(DEST, `${PREFIX}/caretip/business-logos/nested/dir/b.png`);
  assert.ok(copied, "nested path preserved");
  assert.equal(copied.body.toString(), "png-bytes");
  assert.equal(copied.contentType, "image/png");
  assert.equal(copied.serverSideEncryption, "AES256");
  assert.equal(copied.metadata[META_SOURCE_ETAG], createHash("md5").update("png-bytes").digest("hex"));
  assert.equal(copied.metadata[META_SHA256], createHash("sha256").update("png-bytes").digest("hex"));
  assert.equal(destination.get(DEST, `${PREFIX}/caretip/avatars/a.jpg`).cacheControl, "3600");
  assert.ok(destination.get(DEST, `${PREFIX}/caretip-official/logo.webp`));

  const put = destination.calls.find((c) => c.name === "PutObjectCommand");
  assert.ok(put.input.ContentMD5, "buffered uploads carry Content-MD5 for server-side integrity checks");
  assertOnlyAllowedCommands(source, destination);
});

test("second run skips unchanged objects and writes nothing", async () => {
  const { source, destination, ctx } = setup();
  source.putRaw("caretip", "a.txt", "one").putRaw("caretip", "b.txt", "two").createBucket("caretip-official");

  await runBackup(ctx);
  const putsAfterFirst = destination.calls.filter((c) => c.name === "PutObjectCommand").length;
  const second = await runBackup(ctx);

  assert.equal(second.exitCode, 0);
  assert.equal(second.totals.copied, 0);
  assert.equal(second.totals.unchanged, 2);
  assert.equal(destination.calls.filter((c) => c.name === "PutObjectCommand").length, putsAfterFirst);
});

test("recopies changed objects (same size, different content) and size changes", async () => {
  const { source, destination, ctx } = setup();
  source.putRaw("caretip", "same-size.txt", "aaaa").putRaw("caretip", "grows.txt", "x").createBucket("caretip-official");
  await runBackup(ctx);

  source.putRaw("caretip", "same-size.txt", "bbbb").putRaw("caretip", "grows.txt", "xyz");
  const result = await runBackup(ctx);

  assert.equal(result.totals.copied, 2);
  assert.equal(destination.get(DEST, `${PREFIX}/caretip/same-size.txt`).body.toString(), "bbbb");
  assert.equal(destination.get(DEST, `${PREFIX}/caretip/grows.txt`).body.toString(), "xyz");
});

test("never deletes destination objects that no longer exist in the source", async () => {
  const { source, destination, ctx } = setup();
  source.putRaw("caretip", "keep.txt", "k").putRaw("caretip", "removed-later.txt", "r").createBucket("caretip-official");
  await runBackup(ctx);

  source.buckets.get("caretip").delete("removed-later.txt");
  destination.putRaw(DEST, "unrelated/manual-file.txt", "manual");
  const result = await runBackup(ctx);

  assert.equal(result.exitCode, 0);
  assert.ok(destination.get(DEST, `${PREFIX}/caretip/removed-later.txt`), "destination copy retained");
  assert.ok(destination.get(DEST, "unrelated/manual-file.txt"), "unrelated objects untouched");
  assertOnlyAllowedCommands(source, destination);
});

test("handles pagination on both source and destination listings", async () => {
  const { source, destination, ctx } = setup({ configOverrides: { BACKUP_LIST_PAGE_SIZE: "7", BACKUP_BUCKETS: "caretip" } });
  for (let i = 0; i < 25; i++) source.putRaw("caretip", `p/${String(i).padStart(3, "0")}.bin`, `v${i}`);

  const first = await runBackup(ctx);
  assert.equal(first.totals.listed, 25);
  assert.equal(first.totals.copied, 25);
  assert.ok(source.calls.filter((c) => c.name === "ListObjectsV2Command").length >= 4);

  const second = await runBackup(ctx);
  assert.equal(second.totals.unchanged, 25);
  assert.equal(second.totals.copied, 0);
  const destLists = destination.calls.filter((c) => c.name === "ListObjectsV2Command" && c.input.ContinuationToken);
  assert.ok(destLists.length >= 3, "destination index paginates");
});

test("retries transient failures (5xx, network) and succeeds", async () => {
  let putFailures = 0;
  let listFailures = 0;
  const { source, destination, ctx, log } = setup({
    configOverrides: { BACKUP_BUCKETS: "caretip" },
    destOpts: {
      fault: (name) => {
        if (name === "PutObjectCommand" && putFailures < 2) {
          putFailures++;
          return s3Error("ServiceUnavailable", 503);
        }
        return undefined;
      },
    },
    sourceOpts: {
      fault: (name) => {
        if (name === "ListObjectsV2Command" && listFailures < 1) {
          listFailures++;
          const err = new Error("socket hang up");
          err.code = "ECONNRESET";
          return err;
        }
        return undefined;
      },
    },
  });
  source.putRaw("caretip", "flaky.txt", "data");

  const result = await runBackup(ctx);

  assert.equal(result.exitCode, 0);
  assert.equal(result.totals.copied, 1);
  assert.equal(destination.get(DEST, `${PREFIX}/caretip/flaky.txt`).body.toString(), "data");
  assert.equal(log.events().filter((e) => e.event === "object.retry").length, 2);
});

test("partial failure: other objects still copy, bucket fails, exit code is non-zero", async () => {
  const { source, destination, ctx, log } = setup({
    configOverrides: { BACKUP_MAX_ATTEMPTS: "3" },
    destOpts: {
      fault: (name, input) =>
        name === "PutObjectCommand" && input.Key.endsWith("broken.txt") ? s3Error("InternalError", 500) : undefined,
    },
  });
  source.putRaw("caretip", "ok-1.txt", "1").putRaw("caretip", "broken.txt", "b").putRaw("caretip", "ok-2.txt", "2");
  source.putRaw("caretip-official", "fine.txt", "f");

  const result = await runBackup(ctx);

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.failedBuckets, ["caretip"]);
  const caretip = result.buckets.find((b) => b.bucket === "caretip");
  assert.equal(caretip.copied, 2);
  assert.equal(caretip.failed, 1);
  assert.equal(result.buckets.find((b) => b.bucket === "caretip-official").status, "ok");
  assert.ok(destination.get(DEST, `${PREFIX}/caretip-official/fine.txt`), "later buckets still run");
  const failure = log.events().find((e) => e.event === "object.failed");
  assert.equal(failure.attempts, 3);
  assert.equal(failure.httpStatus, 500);
});

test("non-retryable errors (403) fail fast without retries", async () => {
  const { source, ctx } = setup({
    configOverrides: { BACKUP_BUCKETS: "caretip" },
    destOpts: { fault: (name) => (name === "PutObjectCommand" ? s3Error("AccessDenied", 403) : undefined) },
  });
  source.putRaw("caretip", "x.txt", "x");
  const result = await runBackup(ctx);
  assert.equal(result.exitCode, 1);
  assert.equal(ctx.destination.calls.filter((c) => c.name === "PutObjectCommand").length, 1);
});

test("verification mismatch is retried and then reported as a failure", async () => {
  const { source, ctx, log } = setup({
    configOverrides: { BACKUP_BUCKETS: "caretip", BACKUP_MAX_ATTEMPTS: "2" },
    destOpts: { headOverride: (_input, head) => ({ ...head, ContentLength: head.ContentLength + 1 }) },
  });
  source.putRaw("caretip", "v.txt", "verify-me");
  const result = await runBackup(ctx);
  assert.equal(result.exitCode, 1);
  const failure = log.events().find((e) => e.event === "object.failed");
  assert.equal(failure.name, "VerificationError");
  assert.equal(failure.reason, "size_mismatch");
  assert.equal(failure.attempts, 2);
});

test("optional bucket that does not exist is skipped; run still succeeds", async () => {
  const { source, ctx, log } = setup({ configOverrides: { BACKUP_OPTIONAL_BUCKETS: "caretip-kyc,caretip-dsar" } });
  source.putRaw("caretip", "a.txt", "a").createBucket("caretip-official").createBucket("caretip-kyc");

  const result = await runBackup(ctx);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.skippedBuckets, ["caretip-dsar"]);
  assert.equal(result.buckets.find((b) => b.bucket === "caretip-kyc").status, "ok", "empty bucket is fine");
  assert.ok(log.events().some((e) => e.event === "bucket.finish" && e.status === "skipped_missing"));
});

test("required bucket that does not exist fails the run", async () => {
  const { source, ctx } = setup();
  source.putRaw("caretip", "a.txt", "a");
  const result = await runBackup(ctx);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.failedBuckets, ["caretip-official"]);
});

test("missing destination bucket fails every bucket without touching the source", async () => {
  const { source, ctx } = setup({ configOverrides: { B2_BUCKET: "does-not-exist" } });
  source.putRaw("caretip", "a.txt", "a").createBucket("caretip-official");
  const result = await runBackup(ctx);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failedBuckets.length, 2);
  assert.equal(source.calls.length, 0);
});

test("dry run lists and compares but never reads object bodies or writes", async () => {
  const { source, destination, ctx } = setup({ configOverrides: { BACKUP_DRY_RUN: "true" } });
  source.putRaw("caretip", "a.txt", "a").putRaw("caretip-official", "b.txt", "b");
  const result = await runBackup(ctx);
  assert.equal(result.exitCode, 0);
  assert.equal(result.totals.wouldCopy, 2);
  assert.equal(result.totals.copied, 0);
  assert.ok(!source.callNames().includes("GetObjectCommand"));
  assert.ok(!destination.callNames().includes("PutObjectCommand"));
});

test("objects deleted from the source mid-run are counted as vanished, not failures", async () => {
  const { source, ctx } = setup({
    configOverrides: { BACKUP_BUCKETS: "caretip" },
    sourceOpts: { fault: (name, input) => (name === "GetObjectCommand" && input.Key === "gone.txt" ? s3Error("NoSuchKey", 404) : undefined) },
  });
  source.putRaw("caretip", "gone.txt", "g").putRaw("caretip", "here.txt", "h");
  const result = await runBackup(ctx);
  assert.equal(result.exitCode, 0);
  assert.equal(result.totals.vanished, 1);
  assert.equal(result.totals.copied, 1);
});

test("large objects stream without buffering and keep their length", async () => {
  const { source, destination, ctx } = setup({
    configOverrides: { BACKUP_BUCKETS: "caretip", BACKUP_BUFFER_LIMIT_BYTES: String(1024 * 1024) },
  });
  const big = Buffer.alloc(1024 * 1024 + 10, 7);
  source.putRaw("caretip", "big.bin", big);
  const result = await runBackup(ctx);
  assert.equal(result.exitCode, 0);
  const put = destination.calls.find((c) => c.name === "PutObjectCommand");
  assert.equal(put.input.ContentLength, big.length);
  assert.equal(put.input.ContentMD5, undefined);
  assert.equal(destination.get(DEST, `${PREFIX}/caretip/big.bin`).body.length, big.length);
});

test("sensitive buckets log hashed keys; logs never contain secrets or object contents", async () => {
  const { source, ctx, log } = setup({
    configOverrides: { BACKUP_BUCKETS: "caretip", BACKUP_OPTIONAL_BUCKETS: "caretip-kyc", BACKUP_MAX_ATTEMPTS: "1" },
    destOpts: {
      fault: (name, input) =>
        name === "PutObjectCommand" && input.Key.includes("caretip-kyc/") ? s3Error("InternalError", 500) : undefined,
    },
  });
  const kycKey = "verification/biz_123/1762000000000-abcd1234.pdf";
  source.putRaw("caretip", "avatars/public.jpg", "PUBLIC-CONTENT-MARKER");
  source.putRaw("caretip-kyc", kycKey, "SECRET-PASSPORT-CONTENT");

  const result = await runBackup(ctx);
  const text = log.text();

  assert.equal(result.exitCode, 1);
  assert.ok(!text.includes("biz_123"), "KYC key must not appear in logs");
  assert.ok(!text.includes(kycKey));
  assert.ok(text.includes('"keyRef":"sha256:'), "KYC failures reference a hash");
  assert.ok(!text.includes("SECRET-PASSPORT-CONTENT"));
  assert.ok(!text.includes("PUBLIC-CONTENT-MARKER"));
  for (const secret of Object.values(FAKE_SECRETS)) {
    assert.ok(!text.includes(secret), "credentials must never be logged");
  }
  for (const e of log.events()) assert.equal(typeof e.event, "string");
});

test("bucket summaries report counts, bytes and duration", async () => {
  const { source, ctx, log } = setup({ configOverrides: { BACKUP_BUCKETS: "caretip" } });
  source.putRaw("caretip", "a.txt", "12345").putRaw("caretip", "b.txt", "678");
  let t = 1000;
  const result = await backupBucket({ ...ctx, now: () => (t += 50) }, "caretip", { optional: false });
  assert.equal(result.bytesCopied, 8);
  assert.equal(result.copied, 2);
  assert.ok(result.durationMs > 0);
  const finish = log.events().find((e) => e.event === "bucket.finish");
  assert.equal(finish.bytesCopied, 8);
  assert.equal(finish.status, "ok");
});

test("abort signal stops the run and reports failure", async () => {
  const { source, ctx } = setup();
  source.putRaw("caretip", "a.txt", "a").createBucket("caretip-official");
  const controller = new AbortController();
  controller.abort();
  const result = await runBackup({ ...ctx, signal: controller.signal });
  assert.equal(result.exitCode, 1);
  assert.equal(result.aborted, true);
});
