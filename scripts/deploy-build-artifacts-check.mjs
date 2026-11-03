/**
 * Verifies deployment-update artifacts in an existing production build (`dist/`).
 * Run after `npm run build`: npm run test:deploy-build-artifacts [-- --expect-version=<id>]
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const expectArg = process.argv.find((arg) => arg.startsWith("--expect-version="));
const expectedVersion = expectArg ? expectArg.slice("--expect-version=".length) : null;
const read = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

assert.ok(existsSync(dist), "dist/ missing — run the production build first");

const versionPath = path.join(dist, "version.json");
assert.ok(existsSync(versionPath), "dist/version.json missing");
const info = JSON.parse(read(versionPath));
assert.deepEqual(Object.keys(info).sort(), ["buildTime", "version"], "version.json exposes only version + buildTime");
assert.match(info.version, /^[A-Za-z0-9._-]{1,120}$/);
assert.notEqual(info.version, "dev");
assert.ok(!Number.isNaN(Date.parse(info.buildTime)), "buildTime is ISO-8601");
if (expectedVersion) assert.equal(info.version, expectedVersion);

const assetsDir = path.join(dist, "assets");
const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
const embedded = jsFiles.filter((f) => read(path.join(assetsDir, f)).includes(JSON.stringify(info.version)));
assert.ok(embedded.length > 0, "running version is embedded in the bundle");

const shell = read(path.join(dist, "index.html"));
const stamped = shell.match(/<meta name="caretip-build-version" content="([^"]*)"/);
assert.ok(stamped, "index.html carries the build id meta (service-worker readiness check)");
assert.equal(stamped[1], info.version, "index.html build id matches version.json");

for (const file of ["_headers", "_redirects", "404.html"]) {
  assert.ok(existsSync(path.join(dist, file)), `dist/${file} missing`);
}
assert.equal(read(path.join(dist, "_headers")), read(path.join(root, "public/_headers")));
assert.equal(read(path.join(dist, "_redirects")), read(path.join(root, "public/_redirects")));

const sw = read(path.join(dist, "sw.js"));
assert.doesNotMatch(sw, /url:\s*"version\.json"/, "version.json must not be precached");
assert.doesNotMatch(sw, /url:\s*"404\.html"/, "404.html must not be precached");
assert.match(sw, /url:\s*"index\.html"/, "app shell still precached");
assert.match(sw, /skipWaiting\(\)/, "autoUpdate SW activates new releases");

console.log(
  `deploy-build-artifacts-check: ok (version ${info.version}, built ${info.buildTime}, embedded in ${embedded.length} chunk(s))`,
);
