import { loadConfig } from "../../src/config.js";
import { createLogger } from "../../src/logger.js";

export const FAKE_SECRETS = {
  SUPABASE_S3_ACCESS_KEY_ID: "test-src-access-key-id-AAAA",
  SUPABASE_S3_SECRET_ACCESS_KEY: "test-src-secret-BBBBBBBBBBBB",
  B2_ACCESS_KEY_ID: "test-dst-access-key-id-CCCC",
  B2_SECRET_ACCESS_KEY: "test-dst-secret-DDDDDDDDDDDD",
};

export function baseEnv(overrides = {}) {
  return {
    SUPABASE_S3_ENDPOINT: "https://example-project.storage.supabase.co/storage/v1/s3",
    SUPABASE_S3_REGION: "eu-central-1",
    B2_S3_ENDPOINT: "https://s3.eu-central-003.backblazeb2.com",
    B2_S3_REGION: "eu-central-003",
    B2_BUCKET: "caretip-backup-test",
    ...FAKE_SECRETS,
    ...overrides,
  };
}

export function testConfig(overrides = {}) {
  return loadConfig(baseEnv(overrides));
}

export function captureLogger() {
  const lines = [];
  const logger = createLogger({ write: (line) => lines.push(line), now: () => new Date("2026-11-09T12:00:00.000Z") });
  return {
    logger,
    lines,
    events: () => lines.map((l) => JSON.parse(l)),
    text: () => lines.join("\n"),
  };
}

export const noSleep = async () => {};
