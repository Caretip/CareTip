/**
 * Employee invite cross-platform contract regression.
 *
 *   npm run test:employee-invite
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeInviteCode } from "../utils/normalizeInviteCode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

function run() {
  assert.equal(normalizeInviteCode("  ab-cd 12 "), "ABCD12");
  assert.equal(normalizeInviteCode("a3f9k2mx"), "A3F9K2MX");
  assert.equal(normalizeInviteCode("A3F9K2MX"), "A3F9K2MX");

  const join = read("features/auth/JoinScreen.tsx");
  assert.match(join, /validation\.ok/);
  assert.doesNotMatch(join, /validation\.valid/);
  assert.match(join, /normalizeInviteCode/);

  const types = read("types/auth.ts");
  assert.match(types, /ok:\s*boolean/);
  assert.doesNotMatch(types, /valid:\s*boolean/);

  const client = read("services/api/client.ts");
  assert.match(client, /\/api\/business\/invite\/validate/);

  const endpoints = read("constants/endpoints.ts");
  assert.match(endpoints, /generateInvite:\s*"\/api\/business\/generate-invite"/);
  assert.match(endpoints, /inviteValidate:\s*"\/api\/business\/invite\/validate"/);

  const businessService = read("services/api/businessService.ts");
  assert.match(businessService, /generateBusinessInviteCode/);
  assert.match(businessService, /API_ENDPOINTS\.business\.generateInvite/);

  const team = read("features/business/TeamManagementScreen.tsx");
  assert.match(team, /generateBusinessInviteCode/);
  assert.match(team, /shareInvite/);
  assert.match(team, /copyToClipboard/);
  assert.match(team, /team\.generateInvite/);

  const authService = read("services/auth/authService.ts");
  assert.match(authService, /normalizeInviteCode/);
  assert.match(authService, /params:\s*\{\s*code:\s*normalized/);

  // No parallel mobile-only invite generate endpoint invented.
  assert.doesNotMatch(endpoints, /mobile\/.*invite/);

  console.log("employee-invite-runtime: OK");
}

run();
