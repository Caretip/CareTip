/**
 * Documentation secret sanitizer — replaces known credentials/staging values
 * with professional placeholders. Does not modify application runtime source
 * under src/, backend/src/, or mobile app code (except docs/.env.example style files).
 *
 * Usage: node scripts/sanitize-docs-secrets.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const replacements = [
  ["Pentest2026!CareTip", "<PASSWORD>"],
  ["caretip@2026!", "<PASSWORD>"],
  ["Demo1234!", "<PASSWORD>"],
  ["password123", "<PASSWORD>"],
  ["pentest.manager.b@caretip.staging", "<MANAGER_B_EMAIL>"],
  ["pentest.manager@caretip.staging", "<MANAGER_EMAIL>"],
  ["pentest.employee@caretip.staging", "<EMPLOYEE_EMAIL>"],
  ["pentest.admin@caretip.staging", "<ADMIN_EMAIL>"],
  ["albertina@caretip.de", "<TEAM_ADMIN_A_EMAIL>"],
  ["fanny@caretip.de", "<TEAM_ADMIN_B_EMAIL>"],
  ["demo@caretip.de", "<MANAGER_EMAIL>"],
  ["employee@caretip.de", "<EMPLOYEE_EMAIL>"],
  ["admin@caretip.de", "<ADMIN_EMAIL>"],
  ["https://staging-api.caretip.de", "<STAGING_API_URL>"],
  ["https://staging.caretip.de", "<STAGING_WEB_URL>"],
  ["https://caretip.onrender.com", "<API_BASE_URL>"],
  ["*.staff.demo@caretip.de", "<STAFF_DEMO_EMAIL>"],
  ["fquuoahpnonexjsswpto", "<SUPABASE_PROJECT_REF>"],
  ["rumfwfhjrzefysmxebnd", "<LEGACY_SUPABASE_PROJECT_REF>"],
];

const includeDirs = [
  "security",
  "docs",
  "backend/docs",
  "mobile/docs",
  "migrations",
];

const includeFiles = [
  "README.md",
  "backend/README.md",
  "mobile/README.md",
  "mobile/.env.example",
  "backend/.env.example",
  ".env.example",
  "caretip-postman-environment.example.json",
  "scripts/generate-caretip-postman.mjs",
];

const includeExt = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".mjs",
  ".example",
]);

const skipParts = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}_apk_check${path.sep}`,
  "newman-results.json",
  `${path.sep}.env`,
];

function shouldSkip(filePath) {
  const norm = filePath.toLowerCase();
  if (norm.endsWith(`${path.sep}.env`) || norm.endsWith("/.env")) return true;
  return skipParts.some((p) => filePath.includes(p));
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (shouldSkip(full)) continue;
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (includeExt.has(ext) || entry.name.endsWith(".env.example")) {
      out.push(full);
    }
  }
}

const collected = [];
for (const rel of includeFiles) {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) collected.push(full);
}
for (const rel of includeDirs) {
  walk(path.join(root, rel), collected);
}
// Root-level markdown reports
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (entry.name.toLowerCase().endsWith(".md") || entry.name.toLowerCase().endsWith(".txt")) {
    collected.push(path.join(root, entry.name));
  }
}
const files = new Set(collected);

const changed = [];
for (const file of [...files].sort()) {
  if (shouldSkip(file)) continue;
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  let next = raw;
  for (const [from, to] of replacements) {
    if (next.includes(from)) next = next.split(from).join(to);
  }
  if (next !== raw) {
    fs.writeFileSync(file, next, "utf8");
    changed.push(path.relative(root, file));
  }
}

console.log(`sanitize-docs-secrets: updated ${changed.length} file(s)`);
for (const f of changed) console.log(` - ${f}`);
