/**
 * Supabase object-authorization unit tests (no live project required).
 * Run: npm run test:supabase-object-auth (backend)
 * Also invoked from test:supabase-security.
 */
import {
  assertDsarSignedUrlTarget,
  isAllowedDsarObjectPath,
  supabaseDsarStorageBucketName,
  supabaseKycStorageBucketName,
  supabaseStorageBucketName,
} from "../src/lib/supabaseStorageClient.js";
import {
  isAllowedKycObjectRef,
  parseKycStorageReference,
} from "../src/lib/kycStorageReference.js";

type CaseResult = { id: string; pass: boolean; detail: string };

const BIZ = "bizA-sb09-1111";
const USER = "userA-sb09-2222";
const KYC = () => supabaseKycStorageBucketName();
const DSAR = () => supabaseDsarStorageBucketName();

export function runSupabaseObjectAuthTests(): CaseResult[] {
  const results: CaseResult[] = [];
  const pass = (id: string, detail: string) => results.push({ id, pass: true, detail });
  const fail = (id: string, detail: string) => results.push({ id, pass: false, detail });

  const kycOk = `kyc-object:${KYC()}/verification/${BIZ}/file.pdf`;
  if (parseKycStorageReference(kycOk)?.kind === "kyc-object") {
    pass("parse-kyc-object-ok", "Valid KYC object ref parses");
  } else {
    fail("parse-kyc-object-ok", "Valid KYC object ref rejected");
  }

  if (parseKycStorageReference(`kyc-object:${DSAR()}/verification/${BIZ}/file.pdf`) == null) {
    pass("deny-dsar-bucket-as-kyc", "DSAR bucket cannot be used as KYC object ref");
  } else {
    fail("deny-dsar-bucket-as-kyc", "DSAR bucket accepted as KYC ref");
  }

  if (parseKycStorageReference(`kyc-object:${supabaseStorageBucketName()}/verification/${BIZ}/file.pdf`) == null) {
    pass("deny-public-bucket-as-kyc", "Public branding bucket cannot be used as KYC object ref");
  } else {
    fail("deny-public-bucket-as-kyc", "Public bucket accepted as KYC ref");
  }

  if (parseKycStorageReference(`kyc-object:${KYC()}/exports/${USER}/job.json`) == null) {
    pass("deny-dsar-path-in-kyc-bucket", "exports/ path rejected as KYC object");
  } else {
    fail("deny-dsar-path-in-kyc-bucket", "DSAR path accepted as KYC");
  }

  if (parseKycStorageReference(`kyc-object:${KYC()}/verification/${BIZ}/../file.pdf`) == null) {
    pass("deny-kyc-object-dotdot", "Object path .. rejected");
  } else {
    fail("deny-kyc-object-dotdot", ".. accepted in KYC object path");
  }

  if (parseKycStorageReference(`kyc-object:evil-bucket/verification/${BIZ}/file.pdf`) == null) {
    pass("deny-arbitrary-bucket", "Arbitrary bucket rejected");
  } else {
    fail("deny-arbitrary-bucket", "Arbitrary bucket accepted");
  }

  if (!isAllowedKycObjectRef(KYC(), `verification/${BIZ}/file.pdf`, BIZ)) {
    fail("allow-own-kyc-path", "Own verification path should be allowed");
  } else {
    pass("allow-own-kyc-path", "Own verification path allowed");
  }

  if (isAllowedKycObjectRef(KYC(), `verification/other-biz/file.pdf`, BIZ)) {
    fail("deny-cross-biz-kyc-path", "Cross-business object path allowed");
  } else {
    pass("deny-cross-biz-kyc-path", "Cross-business object path denied");
  }

  const dsarKey = `exports/${USER}/jobid123.json`;
  if (!isAllowedDsarObjectPath(dsarKey)) {
    fail("dsar-path-ok", "Valid DSAR key rejected");
  } else {
    pass("dsar-path-ok", "Valid DSAR key accepted");
  }

  try {
    assertDsarSignedUrlTarget(DSAR(), dsarKey, USER);
    pass("dsar-sign-assert-ok", "DSAR signed-url assert accepts owned export");
  } catch {
    fail("dsar-sign-assert-ok", "Owned DSAR path rejected");
  }

  const denyAssert = (id: string, fn: () => void) => {
    try {
      fn();
      fail(id, "Expected throw");
    } catch {
      pass(id, "Denied");
    }
  };

  denyAssert("dsar-sign-wrong-bucket", () =>
    assertDsarSignedUrlTarget(KYC(), dsarKey, USER),
  );
  denyAssert("dsar-sign-other-user", () =>
    assertDsarSignedUrlTarget(DSAR(), `exports/other-user/jobid123.json`, USER),
  );
  denyAssert("dsar-sign-kyc-path", () =>
    assertDsarSignedUrlTarget(DSAR(), `verification/${BIZ}/file.pdf`, USER),
  );

  return results;
}

function main() {
  console.log("=== CareTip Supabase object authorization ===\n");
  const results = runSupabaseObjectAuthTests();
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  const failures = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length} tests, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

if (process.argv[1]?.includes("supabase-object-auth")) {
  main();
}
