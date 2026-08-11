/**
 * Slice E storage isolation without DB — CI has no Supabase config.
 * Run: npx tsx scripts/lifecycle-slice-e-storage-guard-runtime.ts
 */
import assert from "node:assert/strict";
import {
  removeDsarStorageObject,
  supabaseDsarStorageBucketName,
  supabaseKycStorageBucketName,
} from "../src/lib/supabaseStorageClient.js";

async function expectThrow(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    throw new Error(`${label}: expected throw`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith(`${label}:`)) throw e;
  }
}

async function main(): Promise<void> {
  await expectThrow("kyc bucket", () =>
    removeDsarStorageObject(supabaseKycStorageBucketName(), "biz/doc.pdf"),
  );
  await expectThrow("wrong bucket", () =>
    removeDsarStorageObject("some-other-bucket", "exports/u/j.json"),
  );
  await expectThrow("bad path", () =>
    removeDsarStorageObject(supabaseDsarStorageBucketName(), "verification/abc.pdf"),
  );

  const saved = {
    url: process.env.SUPABASE_URL,
    pub: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    role: process.env.SUPABASE_SERVICE_ROLE,
  };
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE;
  try {
    await removeDsarStorageObject(supabaseDsarStorageBucketName(), "exports/user1/job1.json");
  } finally {
    if (saved.url) process.env.SUPABASE_URL = saved.url;
    if (saved.pub) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.pub;
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
    if (saved.role) process.env.SUPABASE_SERVICE_ROLE = saved.role;
  }

  assert.ok(true);
  console.log("lifecycle-slice-e-storage-guard-runtime: OK");
}

void main();
