/**
 * Validates Content-Security-Policy configuration in repo (deployment sources).
 * Run: npm run test:csp (repo root)
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SPA_CONNECT_SRC,
  SPA_CONTENT_SECURITY_POLICY,
} from "./spa-csp-policy.mjs";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** @typedef {{ source: string, csp: string }} CspSource */

/** @returns {CspSource[]} */
function loadCspSources() {
  /** @type {CspSource[]} */
  const sources = [];

  const headersPath = join(REPO_ROOT, "public/_headers");
  if (existsSync(headersPath)) {
    const text = readFileSync(headersPath, "utf8");
    const match = text.match(/Content-Security-Policy:\s*(.+)/i);
    if (match?.[1]) {
      sources.push({ source: "public/_headers", csp: match[1].trim() });
    }
  }

  const vercelPath = join(REPO_ROOT, "vercel.json");
  if (existsSync(vercelPath)) {
    const json = JSON.parse(readFileSync(vercelPath, "utf8"));
    for (const block of json.headers ?? []) {
      for (const h of block.headers ?? []) {
        if (h.key === "Content-Security-Policy" && typeof h.value === "string") {
          sources.push({ source: "vercel.json", csp: h.value.trim() });
        }
      }
    }
  }

  const apiMiddleware = join(REPO_ROOT, "backend/src/middleware/securityHeaders.middleware.ts");
  if (existsSync(apiMiddleware)) {
    const text = readFileSync(apiMiddleware, "utf8");
    const multiMatch = text.match(
      /Content-Security-Policy",\s*\n\s*"([^"]+)"/,
    );
    if (multiMatch?.[1]) {
      sources.push({
        source: "backend/src/middleware/securityHeaders.middleware.ts",
        csp: multiMatch[1].trim(),
      });
    }
  }

  return sources;
}

/** @param {string} csp */
function parseDirectives(csp) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(" ");
    if (space === -1) {
      map.set(trimmed.toLowerCase(), "");
    } else {
      map.set(trimmed.slice(0, space).toLowerCase(), trimmed.slice(space + 1).trim());
    }
  }
  return map;
}

/**
 * @param {string} label
 * @param {CspSource} entry
 * @param {{ requireScriptSrc?: boolean, requireBaseUriSelf?: boolean }} opts
 * @returns {string[]}
 */
function verifySpaCsp(label, entry, opts = {}) {
  const failures = [];
  const { csp, source } = entry;
  if (!csp) {
    failures.push(`${label} (${source}): missing Content-Security-Policy`);
    return failures;
  }

  if (csp !== SPA_CONTENT_SECURITY_POLICY) {
    failures.push(
      `${label} (${source}): CSP does not match scripts/spa-csp-policy.mjs — re-sync _headers and vercel.json`,
    );
  }

  const d = parseDirectives(csp);
  const scriptSrc = d.get("script-src") ?? "";
  if (opts.requireScriptSrc !== false) {
    if (!d.has("script-src")) {
      failures.push(`${label} (${source}): script-src directive missing`);
    } else if (/\bunsafe-inline\b/i.test(scriptSrc)) {
      failures.push(`${label} (${source}): script-src must not contain 'unsafe-inline'`);
    }
  }

  const connectSrc = d.get("connect-src") ?? "";
  if (/\bhttps:\s*(;|$)/i.test(connectSrc) || /\bwss:\s*(;|$)/i.test(connectSrc)) {
    failures.push(
      `${label} (${source}): connect-src must not use scheme-only https: or wss: wildcards`,
    );
  }
  // SEC-10: wildcard subdomains of shared hosting platforms let any tenant of that platform receive
  // requests from the SPA. Only exact origins are allowed for them, in every directive.
  for (const [directive, value] of d) {
    const shared = value.match(
      /\S*\*\.(onrender\.com|netlify\.app|vercel\.app|herokuapp\.com|fly\.dev|supabase\.co|pages\.dev|github\.io)\b/gi,
    );
    if (shared) {
      failures.push(`${label} (${source}): ${directive} must not use shared-hosting wildcards: ${shared.join(", ")}`);
    }
    if (/'unsafe-eval'|'wasm-unsafe-eval'/i.test(value)) {
      failures.push(`${label} (${source}): ${directive} must not contain 'unsafe-eval'`);
    }
    if (directive !== "style-src" && /'unsafe-inline'/i.test(value)) {
      failures.push(`${label} (${source}): ${directive} must not contain 'unsafe-inline' (style-src is the documented exception)`);
    }
    if (/(^|\s)\*(\s|$)/.test(value)) {
      failures.push(`${label} (${source}): ${directive} must not contain a bare * source`);
    }
  }
  for (const origin of ["https://caretip.onrender.com", "wss://caretip.onrender.com"]) {
    if (!connectSrc.split(/\s+/).includes(origin)) {
      failures.push(`${label} (${source}): connect-src must allow the exact API origin ${origin}`);
    }
  }
  for (const host of SPA_CONNECT_SRC) {
    if (!connectSrc.includes(host)) {
      failures.push(`${label} (${source}): connect-src missing required host ${host}`);
    }
  }

  const objectSrc = d.get("object-src") ?? "";
  if (!/\bnone\b/i.test(objectSrc)) {
    failures.push(`${label} (${source}): object-src must include 'none'`);
  }

  const frameAncestors = d.get("frame-ancestors") ?? "";
  if (!/\bnone\b/i.test(frameAncestors)) {
    failures.push(`${label} (${source}): frame-ancestors must be 'none'`);
  }

  const baseUri = d.get("base-uri") ?? "";
  if (opts.requireBaseUriSelf !== false) {
    if (!/\bself\b/i.test(baseUri) && !/\bnone\b/i.test(baseUri)) {
      failures.push(`${label} (${source}): base-uri must be 'self' (SPA) or 'none' (API)`);
    }
  }

  return failures;
}

function main() {
  const sources = loadCspSources();
  /** @type {string[]} */
  const failures = [];

  console.log("=== CSP deployment verification ===\n");
  console.log("Canonical SPA policy: scripts/spa-csp-policy.mjs\n");

  if (sources.length === 0) {
    failures.push("No CSP sources found in public/_headers, vercel.json, or API middleware");
  }

  const spaSources = sources.filter((s) => s.source !== "backend/src/middleware/securityHeaders.middleware.ts");
  const apiSource = sources.find((s) => s.source === "backend/src/middleware/securityHeaders.middleware.ts");

  if (spaSources.length === 0) {
    failures.push("SPA CSP missing from public/_headers and/or vercel.json");
  }

  for (const entry of spaSources) {
    console.log(`Checking SPA CSP: ${entry.source}`);
    failures.push(...verifySpaCsp("SPA", entry, { requireBaseUriSelf: true }));
  }

  if (apiSource) {
    console.log(`Checking API CSP: ${apiSource.source}`);
    const d = parseDirectives(apiSource.csp);
    if (!d.has("default-src") || !/\bnone\b/i.test(d.get("default-src") ?? "")) {
      failures.push(`API (${apiSource.source}): default-src must be 'none'`);
    }
    const frameAncestors = d.get("frame-ancestors") ?? "";
    if (!/\bnone\b/i.test(frameAncestors)) {
      failures.push(`API (${apiSource.source}): frame-ancestors must be 'none'`);
    }
    const baseUri = d.get("base-uri") ?? "";
    if (!/\bnone\b/i.test(baseUri)) {
      failures.push(`API (${apiSource.source}): base-uri must be 'none'`);
    }
  } else {
    failures.push("API CSP missing from securityHeaders.middleware.ts");
  }

  if (failures.length === 0) {
    console.log("\nPASS: Required CSP directives present.");
    for (const s of sources) {
      console.log(`  ✓ ${s.source}`);
    }
    console.log("\nOVERALL: PASS");
    process.exit(0);
  }

  console.log(`\nFAIL: ${failures.length} issue(s):\n`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log("\nOVERALL: FAIL");
  process.exit(1);
}

main();
