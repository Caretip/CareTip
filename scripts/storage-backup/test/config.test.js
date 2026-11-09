import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, loadConfig } from "../src/config.js";
import { FAKE_SECRETS, baseEnv } from "./helpers/fixtures.js";

test("defaults: caretip + caretip-official required, KYC/DSAR marked sensitive, SSE on", () => {
  const c = loadConfig(baseEnv());
  assert.deepEqual(c.requiredBuckets, ["caretip", "caretip-official"]);
  assert.deepEqual(c.optionalBuckets, []);
  assert.ok(c.sensitiveBuckets.has("caretip-kyc"));
  assert.ok(c.sensitiveBuckets.has("caretip-dsar"));
  assert.equal(c.serverSideEncryption, "AES256");
  assert.equal(c.destPrefix, "supabase-storage");
  assert.equal(c.dryRun, false);
  assert.equal(c.concurrency, 4);
});

test("missing variables are reported by name only, never by value", () => {
  const env = baseEnv();
  delete env.B2_SECRET_ACCESS_KEY;
  delete env.SUPABASE_S3_ENDPOINT;
  assert.throws(
    () => loadConfig(env),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.ok(err.problems.includes("B2_SECRET_ACCESS_KEY is required"));
      assert.ok(err.problems.includes("SUPABASE_S3_ENDPOINT is required"));
      for (const secret of Object.values(FAKE_SECRETS)) assert.ok(!err.message.includes(secret));
      return true;
    },
  );
});

test("rejects non-https endpoints and endpoints with embedded credentials", () => {
  assert.throws(() => loadConfig(baseEnv({ B2_S3_ENDPOINT: "http://s3.example.com" })), /B2_S3_ENDPOINT must use https/);
  assert.throws(
    () => loadConfig(baseEnv({ SUPABASE_S3_ENDPOINT: "https://user:pass@x.supabase.co/storage/v1/s3" })),
    (err) => err.problems.includes("SUPABASE_S3_ENDPOINT must not contain credentials") && !err.message.includes("pass@"),
  );
});

test("configurable bucket lists, optional buckets and dry-run flag", () => {
  const c = loadConfig(
    baseEnv({ BACKUP_BUCKETS: "caretip", BACKUP_OPTIONAL_BUCKETS: " caretip-kyc , caretip-dsar ", BACKUP_DRY_RUN: "1" }),
  );
  assert.deepEqual(c.requiredBuckets, ["caretip"]);
  assert.deepEqual(c.optionalBuckets, ["caretip-kyc", "caretip-dsar"]);
  assert.equal(c.dryRun, true);
  assert.equal(loadConfig(baseEnv(), { dryRunFlag: true }).dryRun, true);
});

test("rejects overlapping, invalid or empty bucket lists", () => {
  assert.throws(() => loadConfig(baseEnv({ BACKUP_OPTIONAL_BUCKETS: "caretip" })), /both required and optional/);
  assert.throws(() => loadConfig(baseEnv({ BACKUP_BUCKETS: "Bad Bucket" })), /not valid/);
  assert.throws(() => loadConfig(baseEnv({ BACKUP_BUCKETS: "" })), /at least one bucket/);
});

test("validates numeric ranges, prefix and SSE values", () => {
  assert.throws(() => loadConfig(baseEnv({ BACKUP_CONCURRENCY: "0" })), /BACKUP_CONCURRENCY/);
  assert.throws(() => loadConfig(baseEnv({ BACKUP_MAX_ATTEMPTS: "abc" })), /BACKUP_MAX_ATTEMPTS/);
  assert.throws(() => loadConfig(baseEnv({ B2_PREFIX: "a/../b" })), /B2_PREFIX/);
  assert.throws(() => loadConfig(baseEnv({ B2_SERVER_SIDE_ENCRYPTION: "aws:kms" })), /B2_SERVER_SIDE_ENCRYPTION/);
  assert.equal(loadConfig(baseEnv({ B2_SERVER_SIDE_ENCRYPTION: "none" })).serverSideEncryption, undefined);
  assert.equal(loadConfig(baseEnv({ B2_PREFIX: "/backups/storage/" })).destPrefix, "backups/storage");
  assert.equal(loadConfig(baseEnv({ B2_PREFIX: "" })).destPrefix, "");
});
