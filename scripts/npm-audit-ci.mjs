/**
 * CI dependency audit gate.
 * Fails on high/critical findings except explicitly allowlisted advisories
 * that do not apply to CareTip's usage (see comments below).
 */
import { execFileSync } from "node:child_process";

/** Advisories accepted with documented product rationale. */
const ALLOWLIST = new Map([
  [
    "ghsa-qwww-vcr4-c8h2",
    "React Router RSC CSRF path — CareTip web is a Vite SPA (createBrowserRouter) and does not enable unstable RSC APIs. Fixed upstream only in react-router >=8.3.0 which requires React >=19.2.7.",
  ],
]);

function runAuditJson() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    const out = execFileSync(npmCmd, ["audit", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
      shell: process.platform === "win32",
    });
    return JSON.parse(out);
  } catch (err) {
    const stdout = err && typeof err === "object" && "stdout" in err ? String(err.stdout ?? "") : "";
    if (stdout.trim()) {
      try {
        return JSON.parse(stdout);
      } catch {
        /* fall through */
      }
    }
    throw err;
  }
}

const report = runAuditJson();
const vulns = report.vulnerabilities ?? {};
const blockers = [];

for (const [name, entry] of Object.entries(vulns)) {
  const severity = String(entry.severity ?? "").toLowerCase();
  if (severity !== "high" && severity !== "critical") continue;

  const via = Array.isArray(entry.via) ? entry.via : [];
  const ghsaIds = via
    .map((item) => (item && typeof item === "object" ? item.url : null))
    .filter(Boolean)
    .map((url) => {
      const m = String(url).match(/GHSA-[a-z0-9-]+/i);
      return m ? m[0].toLowerCase() : null;
    })
    .filter(Boolean);

  const titles = via
    .map((item) => (item && typeof item === "object" ? item.title : null))
    .filter(Boolean);

  const allowlisted = ghsaIds.length > 0 && ghsaIds.every((id) => ALLOWLIST.has(id));
  if (allowlisted) {
    for (const id of ghsaIds) {
      console.log(`[audit-ci] allowlisted ${id} (${name}): ${ALLOWLIST.get(id)}`);
    }
    continue;
  }

  blockers.push({ name, severity, ghsaIds, titles, range: entry.range });
}

if (blockers.length > 0) {
  console.error("=== Frontend npm audit (fail on high/critical) ===");
  for (const b of blockers) {
    console.error(`- ${b.name} [${b.severity}] range=${b.range ?? "?"}`);
    for (const t of b.titles) console.error(`  ${t}`);
    for (const id of b.ghsaIds) console.error(`  ${id}`);
  }
  process.exit(1);
}

console.log("Frontend npm audit: no blocking high/critical vulnerabilities.");
