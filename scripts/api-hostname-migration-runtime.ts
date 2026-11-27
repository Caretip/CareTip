/**
 * API hostname migration guard: `https://api.caretip.de` is the canonical API host everywhere a
 * deployed client or job is configured; `caretip.onrender.com` is being retired
 * (docs/ops/api-hostname-migration.md) and is no longer allowed by the web CSP.
 * Static checks plus the backend production-config warning. No network, database or secrets.
 * Run: npm run test:api-hostname-migration
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const CANONICAL = "https://api.caretip.de";
const LEGACY_HOST = "caretip.onrender.com";

let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks++;
  console.log(`ok - ${name}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|json)$/.test(name)) out.push(p);
  }
  return out;
}

check("mobile: production fallback API URL is the canonical host", () => {
  const src = read("mobile/constants/config.ts");
  const m = /export const PRODUCTION_API_URL = "([^"]+)"/.exec(src);
  assert.equal(m?.[1], CANONICAL);
});

check("mobile: preview and production EAS profiles use the canonical host; LAN profile unchanged", () => {
  const eas = JSON.parse(read("mobile/eas.json")) as { build: Record<string, { env?: Record<string, string> }> };
  assert.equal(eas.build.production?.env?.EXPO_PUBLIC_API_URL, CANONICAL);
  assert.equal(eas.build.preview?.env?.EXPO_PUBLIC_API_URL, CANONICAL);
  assert.equal(eas.build.production?.env?.EXPO_PUBLIC_APP_ENV, "production");
  assert.match(eas.build["preview-lan"]?.env?.EXPO_PUBLIC_API_URL ?? "", /^http:\/\/192\.168\./, "LAN dev profile keeps its LAN API");
  for (const [name, profile] of Object.entries(eas.build)) {
    assert.ok(!JSON.stringify(profile).includes(LEGACY_HOST), `eas profile ${name} references ${LEGACY_HOST}`);
  }
});

check("mobile: no runtime source references the legacy Render host", () => {
  const dirs = ["app", "components", "constants", "features", "hooks", "services", "utils", "lib", "contexts", "providers"]
    .map((d) => path.join(root, "mobile", d))
    .filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
  const offenders = dirs.flatMap((d) => walk(d)).filter((f) => readFileSync(f, "utf8").includes(LEGACY_HOST));
  assert.deepEqual(offenders.map((f) => path.relative(root, f)), []);
});

check("cron: every render.yaml job calls the canonical host", () => {
  const yaml = read("render.yaml");
  const origins = [...yaml.matchAll(/key: CARE_TIP_API_ORIGIN\s+value: (\S+)/g)].map((m) => m[1]);
  assert.ok(origins.length > 0, "render.yaml defines CARE_TIP_API_ORIGIN");
  assert.deepEqual([...new Set(origins)], [CANONICAL]);
});

check("cron: the job runner's fallback origin is the canonical host", () => {
  assert.ok(read("backend/scripts/render-category-retention-http.mjs").includes(`|| "${CANONICAL}"`));
  assert.ok(read("backend/scripts/render-category-retention-http.sh").includes(`:-${CANONICAL}}`));
  assert.ok(!read("backend/scripts/render-category-retention-http.mjs").includes(LEGACY_HOST));
});

check("web CSP: canonical API host allowed; retired Render host not allowed at all", () => {
  for (const rel of ["scripts/spa-csp-policy.mjs", "public/_headers", "vercel.json"]) {
    const s = read(rel);
    assert.ok(s.includes("https://*.caretip.de") || s.includes(CANONICAL), `${rel}: https API origin`);
    assert.ok(s.includes("wss://*.caretip.de") || s.includes("wss://api.caretip.de"), `${rel}: wss API origin`);
    // An actual origin (scheme + wildcard), not prose that explains why the wildcard is forbidden.
    assert.ok(!/(https|wss):\/\/\*\.onrender\.com/.test(s), `${rel}: no wildcard Render origin`);
    assert.ok(!/(https|wss):\/\/caretip\.onrender\.com/.test(s), `${rel}: retired Render API origin removed`);
  }
});

check("web: Netlify proxies /api/* to the canonical host", () => {
  assert.match(read("public/_redirects"), /^\/api\/\*\s+https:\/\/api\.caretip\.de\/api\/:splat\s+200/m);
});

const { reviewProductionConfig } = await import("../backend/src/config/productionConfig.ts");
const baseProd = {
  RENDER: "true",
  NODE_ENV: "production",
  JWT_SECRET: "k".repeat(24) + "Q7v!" + "z".repeat(24),
  MFA_SECRET_ENCRYPTION_KEY: "m".repeat(40),
};

check("backend: production warns when API-built URLs would use the Render hostname", () => {
  const w = reviewProductionConfig({ ...baseProd, RENDER_EXTERNAL_URL: `https://${LEGACY_HOST}` }).warnings.join("|");
  assert.match(w, /PUBLIC_API_BASE_URL is not set: API-built URLs use the Render hostname caretip\.onrender\.com/);
});

check("backend: no hostname warning once PUBLIC_API_BASE_URL is the canonical host", () => {
  const w = reviewProductionConfig({ ...baseProd, RENDER_EXTERNAL_URL: `https://${LEGACY_HOST}`, PUBLIC_API_BASE_URL: CANONICAL }).warnings.join("|");
  assert.ok(!w.includes("PUBLIC_API_BASE_URL is not set"), w);
});

console.log(`api-hostname-migration: ok (${checks} checks)`);
