import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Static audit of Stripe payout mutations in backend/src.
 *
 * `payouts.create` is allowed only in these files, and each call must be scoped to the
 * connected account (`stripeAccount`) and carry an `idempotencyKey`. Instant creates must
 * use `method: "instant"`; scheduled bank payouts must not. `payouts.cancel` and external
 * account mutations are forbidden everywhere.
 */
export const PAYOUT_CREATE_ALLOWLIST: Record<string, "instant" | "scheduled"> = {
  "services/stripeConnectInstantPayout.service.ts": "instant",
  "services/businessScheduledBankPayout.service.ts": "scheduled",
  "services/employeeScheduledBankPayout.service.ts": "scheduled",
};

const FORBIDDEN_EVERYWHERE = [
  /\.payouts\.cancel\s*\(/,
  /\.externalAccounts\.create\s*\(/,
  /\.externalAccounts\.update\s*\(/,
  /\.externalAccounts\.del\s*\(/,
];

const CREATE_RE = /\.payouts\.create\s*\(/g;

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Returns the source of the `payouts.create(...)` call starting at `start` (balanced parens). */
function extractCall(src: string, start: number): string {
  const open = src.indexOf("(", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

export type PayoutCreateAuditResult = {
  ok: boolean;
  problems: string[];
  createSites: { file: string; kind: "instant" | "scheduled" }[];
  forbiddenHits: string[];
};

export function auditPayoutCreateCallSites(srcRoot: string): PayoutCreateAuditResult {
  const problems: string[] = [];
  const createSites: PayoutCreateAuditResult["createSites"] = [];
  const forbiddenHits: string[] = [];

  for (const abs of walkTs(srcRoot)) {
    const rel = relative(srcRoot, abs).replace(/\\/g, "/");
    const src = readFileSync(abs, "utf8");

    for (const re of FORBIDDEN_EVERYWHERE) {
      if (re.test(src)) forbiddenHits.push(`${rel}: ${re.source}`);
    }

    for (const m of src.matchAll(CREATE_RE)) {
      const kind = PAYOUT_CREATE_ALLOWLIST[rel];
      if (!kind) {
        problems.push(`payouts.create outside allowlist: ${rel}`);
        continue;
      }
      const call = extractCall(src, m.index ?? 0);
      if (!/\bstripeAccount\s*:/.test(call)) problems.push(`${rel}: payouts.create without stripeAccount`);
      if (!/\bidempotencyKey\s*:/.test(call)) problems.push(`${rel}: payouts.create without idempotencyKey`);
      const isInstant = /method\s*:\s*["']instant["']/.test(call);
      if (kind === "instant" && !isInstant) problems.push(`${rel}: instant create missing method "instant"`);
      if (kind === "scheduled" && isInstant) problems.push(`${rel}: scheduled create uses method "instant"`);
      createSites.push({ file: rel, kind });
    }
  }

  for (const [file, kind] of Object.entries(PAYOUT_CREATE_ALLOWLIST)) {
    if (!createSites.some((s) => s.file === file)) {
      problems.push(`expected ${kind} payouts.create in ${file} not found`);
    }
  }
  if (forbiddenHits.length) problems.push(...forbiddenHits.map((h) => `forbidden: ${h}`));

  return { ok: problems.length === 0, problems, createSites, forbiddenHits };
}
