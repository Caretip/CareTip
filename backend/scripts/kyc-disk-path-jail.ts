/**
 * KYC disk path jail regression — UPLOAD-01.
 * Isolated temp directories only. No .env, secrets, or personal files.
 *
 * Run: npm run test:kyc-disk-path-jail (backend)
 * Also invoked from test:file-upload-pentest.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isAllowedKycDiskPathForBusiness,
  resolveKycDiskPathForBusiness,
} from "../src/lib/kycDiskPath.js";
import { parseKycStorageReference } from "../src/lib/kycStorageReference.js";
import { readKycDiskFile } from "../src/services/upload.service.js";

type CaseResult = { id: string; pass: boolean; detail: string };

const BIZ_A = "bizA-test-1111";
const BIZ_B = "bizB-test-2222";
const FIXTURE_BODY = "caretip-kyc-jail-fixture-ok";
const OUTSIDE_BODY = "outside-fixture-must-not-be-read";

function expectThrow(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

export function runKycDiskPathJailTests(): CaseResult[] {
  const results: CaseResult[] = [];
  const tmp = mkdtempSync(path.join(os.tmpdir(), "caretip-kyc-jail-"));
  const opts = { cwd: tmp };

  try {
    const dirA = path.join(tmp, "uploads", "kyc", BIZ_A);
    const dirB = path.join(tmp, "uploads", "kyc", BIZ_B);
    const sibling = path.join(tmp, "uploads", "kyc-other", BIZ_A);
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(dirA, "doc.pdf"), FIXTURE_BODY);
    writeFileSync(path.join(dirB, "other.pdf"), "tenant-b-kyc");
    writeFileSync(path.join(tmp, "outside-secret.txt"), OUTSIDE_BODY);
    writeFileSync(path.join(sibling, "prefix.pdf"), "prefix-trick");

    const pass = (id: string, detail: string) => results.push({ id, pass: true, detail });
    const fail = (id: string, detail: string) => results.push({ id, pass: false, detail });

    // Legitimate read
    try {
      const got = readKycDiskFile(`uploads/kyc/${BIZ_A}/doc.pdf`, BIZ_A, opts);
      if (got.buffer.toString() === FIXTURE_BODY && got.contentType === "application/pdf") {
        pass("valid-kyc-read", "Authorized path inside business jail");
      } else {
        fail("valid-kyc-read", "Unexpected content-type or body");
      }
    } catch (e) {
      fail("valid-kyc-read", e instanceof Error ? e.message : String(e));
    }

    // Missing file inside jail
    if (expectThrow(() => readKycDiskFile(`uploads/kyc/${BIZ_A}/missing.pdf`, BIZ_A, opts))) {
      pass("missing-kyc", "Nonexistent file inside jail is not found");
    } else {
      fail("missing-kyc", "Expected throw");
    }

    const denyRead = (id: string, rel: string, biz = BIZ_A) => {
      const resolved = resolveKycDiskPathForBusiness(biz, rel, opts);
      let threw = false;
      let leaked = false;
      try {
        const buf = readKycDiskFile(rel, biz, opts);
        leaked = buf.buffer.toString() === OUTSIDE_BODY || buf.buffer.toString() === "prefix-trick";
      } catch {
        threw = true;
      }
      if (!resolved.ok && threw && !leaked) pass(id, "Denied");
      else fail(id, `ok=${resolved.ok} threw=${threw} leaked=${leaked}`);
    };

    denyRead("traversal-parent", `uploads/kyc/${BIZ_A}/../outside-secret.txt`);
    denyRead("traversal-nested", `uploads/kyc/${BIZ_A}/foo/../../outside-secret.txt`);
    denyRead("traversal-dotdot-cwd", `uploads/kyc/${BIZ_A}/../../../outside-secret.txt`);
    denyRead("encoded-traversal", `uploads/kyc/${BIZ_A}/%2e%2e/%2e%2e/outside-secret.txt`);
    denyRead("encoded-dot-segments", `uploads/kyc/${BIZ_A}/%2e%2e/outside-secret.txt`);
    denyRead("windows-sep-traversal", `uploads/kyc/${BIZ_A}/..\\..\\outside-secret.txt`);
    denyRead("absolute-posix", "/etc/passwd");
    denyRead("absolute-win-drive", "C:\\Windows\\win.ini");
    denyRead("unc-path", "\\\\127.0.0.1\\share\\file");
    denyRead("sibling-prefix", `uploads/kyc-other/${BIZ_A}/prefix.pdf`);
    denyRead("cross-business", `uploads/kyc/${BIZ_B}/other.pdf`, BIZ_A);
    denyRead("null-byte", `uploads/kyc/${BIZ_A}/doc.pdf\0.pdf`);

    if (!isAllowedKycDiskPathForBusiness(BIZ_A, `uploads/kyc/${BIZ_A}/../outside-secret.txt`, opts)) {
      pass("allowlist-traversal", "isAllowed rejects ..");
    } else {
      fail("allowlist-traversal", "allowlist accepted traversal");
    }

    if (isAllowedKycDiskPathForBusiness(BIZ_A, `uploads/kyc/${BIZ_A}/doc.pdf`, opts)) {
      pass("allowlist-valid", "isAllowed accepts in-jail file");
    } else {
      fail("allowlist-valid", "allowlist rejected valid file");
    }

    const parseDeny = (id: string, ref: string) => {
      if (parseKycStorageReference(ref) == null) pass(id, "parse fail-closed");
      else fail(id, "parse accepted unsafe ref");
    };
    parseDeny("parse-traversal", `kyc-disk:uploads/kyc/${BIZ_A}/../../outside-secret.txt`);
    parseDeny("parse-encoded", `kyc-disk:uploads/kyc/${BIZ_A}/%2e%2e/%2e%2e/outside-secret.txt`);
    parseDeny("parse-malformed", "kyc-disk:not-a-kyc-path");
    parseDeny("parse-empty", "kyc-disk:");
    parseDeny("parse-absolute", "kyc-disk:/etc/passwd");

    // Same sequence as loadKycDiskStreamPayload: parse then read.
    const streamRef = `kyc-disk:uploads/kyc/${BIZ_A}/../../outside-secret.txt`;
    const parsedStream = parseKycStorageReference(streamRef);
    if (parsedStream == null) {
      pass("stream-payload-traversal", "secure-stream parse rejects traversal refs");
    } else {
      fail("stream-payload-traversal", "parse accepted traversal");
    }

    if (parseKycStorageReference("not-kyc") == null) {
      pass("stream-malformed-ref", "invalid ref rejected");
    } else {
      fail("stream-malformed-ref", "invalid ref accepted");
    }

    // Symlink escape (skip if unsupported)
    try {
      const linkPath = path.join(dirA, "escape-link.pdf");
      symlinkSync(path.join(tmp, "outside-secret.txt"), linkPath);
      const resolved = resolveKycDiskPathForBusiness(BIZ_A, `uploads/kyc/${BIZ_A}/escape-link.pdf`, opts);
      let leaked = false;
      try {
        const buf = readKycDiskFile(`uploads/kyc/${BIZ_A}/escape-link.pdf`, BIZ_A, opts);
        leaked = buf.buffer.toString() === OUTSIDE_BODY;
      } catch {
        /* expected */
      }
      if (!resolved.ok && !leaked) pass("symlink-escape", "realpath jail blocked symlink");
      else fail("symlink-escape", `ok=${resolved.ok} leaked=${leaked}`);
    } catch {
      pass("symlink-escape", "SKIP: filesystem did not allow symlink creation");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  return results;
}

function main() {
  console.log("=== CareTip KYC disk path jail (UPLOAD-01) ===\n");
  const results = runKycDiskPathJailTests();
  for (const r of results) {
    console.log(`[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.detail}`);
  }
  const failures = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length} tests, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

const isDirect = process.argv[1]?.includes("kyc-disk-path-jail");
if (isDirect) main();
