/**
 * Admin file links: credentials only ever go to CareTip's own API; public storage opens directly.
 * Run: npm run test:authed-file-url
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyFileUrl, type FileUrlOrigins } from "../src/app/lib/authedFileUrl";

const prod: FileUrlOrigins = {
  pageOrigin: "https://caretip.de",
  apiBase: "https://api.caretip.de",
  legacyApiBase: "https://caretip.onrender.com",
};
const dev: FileUrlOrigins = { pageOrigin: "http://localhost:5173", apiBase: "" };

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};
const kind = (url: string, o: FileUrlOrigins = prod) => classifyFileUrl(url, o).kind;

console.log("authedFileUrl.runtime");

check("CareTip API files get credentials (API base, legacy base, page origin, relative)", () => {
  assert.equal(kind("https://api.caretip.de/api/media/kyc/abc"), "authed");
  assert.equal(kind("https://api.caretip.de/uploads/business-logos/a.png"), "authed");
  assert.equal(kind("https://caretip.onrender.com/uploads/a.png"), "authed");
  assert.equal(kind("https://caretip.de/api/files/x"), "authed");
  assert.equal(kind("/api/media/kyc/abc", dev), "authed");
  assert.equal(kind("http://localhost:5173/uploads/a.png", dev), "authed");
});

check("the reported logo URL (public Supabase object) opens directly, never with credentials", () => {
  const logo =
    "https://fquuoahpnonexjsswpto.supabase.co/storage/v1/object/public/caretip/business-logos/1794998599597-6111197c.png";
  const d = classifyFileUrl(logo, prod);
  assert.equal(d.kind, "public");
  assert.equal(d.kind === "public" && d.url, logo);
});

check("a CareTip-looking path on a foreign host never gets credentials (the old path-only gap)", () => {
  assert.equal(kind("https://evil.example/api/media/kyc/abc"), "refused");
  assert.equal(kind("https://evil.example/uploads/a.png"), "refused");
  assert.equal(kind("https://api.caretip.de.evil.example/api/x"), "refused");
  assert.equal(kind("https://caretip.de@evil.example/api/x"), "refused");
});

check("non-public or look-alike storage URLs are refused", () => {
  assert.equal(kind("https://abc.supabase.co/storage/v1/object/sign/caretip/kyc/doc.pdf"), "refused");
  assert.equal(kind("https://abc.supabase.co/storage/v1/object/authenticated/caretip/x.pdf"), "refused");
  assert.equal(kind("https://abc.supabase.co.evil.example/storage/v1/object/public/x.png"), "refused");
  assert.equal(kind("http://abc.supabase.co/storage/v1/object/public/x.png"), "refused");
  assert.equal(kind("https://abc.supabase.co/rest/v1/users"), "refused");
});

check("path tricks, embedded credentials and non-web protocols are refused", () => {
  assert.equal(kind("https://api.caretip.de/api/../admin"), "refused");
  assert.equal(kind("https://user:pw@api.caretip.de/api/x"), "refused");
  assert.equal(kind("javascript:alert(1)"), "refused");
  assert.equal(kind("data:text/html,hi"), "refused");
  assert.equal(kind("http://api.caretip.de/api/x"), "refused");
  assert.equal(kind(""), "refused");
});

check("CareTip origins are only those passed in (no API base: same-origin only)", () => {
  assert.equal(kind("https://api.caretip.de/api/x", { pageOrigin: "https://caretip.de", apiBase: "" }), "refused");
});

check("fetchAuthedObjectUrl classifies before any bearer is attached", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "../src/app/lib/api.ts"), "utf8");
  const start = src.indexOf("export async function fetchAuthedObjectUrl");
  assert.ok(start >= 0);
  const body = src.slice(start, start + 2500);
  const classifyAt = body.indexOf("classifyFileUrl(");
  const bearerAt = body.indexOf("attachLatestBearer(");
  assert.ok(classifyAt > 0 && bearerAt > classifyAt, "classification precedes the authenticated fetch");
  assert.match(body, /decision\.kind === "public"\) return decision\.url/);
  assert.match(body, /decision\.kind === "refused"\) throw/);
});

console.log(`authedFileUrl.runtime: OK (${passed} checks)`);
