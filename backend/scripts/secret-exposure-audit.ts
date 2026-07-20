/**
 * Secret exposure audit — static patterns + frontend guard + build artifact scan.
 * Run: npm run test:secret-exposure (backend) or repo root via npm script alias.
 *
 * Scans: git tracked files, staged files, PR diff (SECRET_SCAN_BASE_REF), dist/ when present.
 * CI: set SECRET_SCAN_BASE_REF to base SHA for pull_request diffs (see .github/workflows/ci.yml).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Severity = "critical" | "high" | "medium";

type Finding = {
  file: string;
  line: number;
  type: string;
  severity: Severity;
  snippet: string;
  scanScope: string;
};

type SecretRule = {
  type: string;
  severity: Severity;
  testLine: (line: string) => boolean;
};

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

const SCAN_EXTENSIONS =
  /\.(tsx?|jsx?|mjs|cjs|json|ya?ml|toml|html|css|md|env\.example|example)$/i;

const SKIP_PATH_PARTS = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\\.git(\/|$)/,
  /(^|\/)dist\/workbox-/,
  /package-lock\.json$/i,
  /(^|\/)playwright-report(\/|$)/,
  /(^|\/)coverage(\/|$)/,
];

const APPROVED_PUBLIC_FIREBASE = new Set([
  "public/firebase-messaging-sw.js",
  "public/fcm-sw-handler.js",
  "dist/firebase-messaging-sw.js",
  "dist/fcm-sw-handler.js",
]);

const ALLOW_LINE_REGEXES: RegExp[] = [
  /^\s*#/,
  /^\s*\/\//,
  /^\s*\*/,
  /sk_test_\.\.\./i,
  /sk_live_\.\.\./i,
  /pk_test_\.\.\./i,
  /whsec_\.\.\./i,
  /eyJhbG\.\.\./i,
  /re_\.\.\./i,
  /sk-\.\.\./i,
  /sk_test_ci_placeholder/i,
  /whsec_ci_test_secret_placeholder/i,
  /ci-test-jwt-secret-min-32-chars-long/i,
  /long-random-secret/i,
  /replace-in-production/i,
  /YOUR_DEMO_PASSWORD/i,
  /YOUR_PROJECT/i,
  /PROJECT_REF:PASSWORD/i,
  /postgres\.PROJECT_REF:PASSWORD/i,
  /PASSWORD@aws-/i,
  /placeholder/i,
  /example\.com/i,
  /onboarding@resend\.dev/i,
  /password123/i,
  /Demo1234!/,
  /GOOGLE_CLIENT_SECRET is \*\*not\*\* used/i,
  /GOOGLE_CLIENT_SECRET is not read/i,
  /not used by this app/i,
  /never commit/i,
  /see backend\/\.env\.example/i,
  /Detection Targets/i,
  /Stripe Secret Key/i,
];

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/");
}

function gitLines(cmd: string): string[] {
  try {
    return execSync(cmd, { cwd: repoRoot, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function walkDir(dir: string, out: string[] = [], prefix = ""): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walkDir(full, out, rel);
    } else {
      out.push(normalizeRel(rel));
    }
  }
  return out;
}

function collectScanTargets(): Map<string, Set<string>> {
  const scopes = new Map<string, Set<string>>();

  function add(scope: string, paths: string[]) {
    if (!scopes.has(scope)) scopes.set(scope, new Set());
    for (const p of paths) {
      const rel = normalizeRel(p);
      if (!rel || SKIP_PATH_PARTS.some((re) => re.test(rel))) continue;
      if (!existsSync(join(repoRoot, rel))) continue;
      scopes.get(scope)!.add(rel);
    }
  }

  add("tracked", gitLines("git ls-files"));
  add("staged", gitLines("git diff --cached --name-only --diff-filter=ACM"));

  const baseRef =
    process.env.SECRET_SCAN_BASE_REF?.trim() ||
    process.env.GITHUB_BASE_REF?.trim() ||
    "";
  if (baseRef) {
    add("pull_request", gitLines(`git diff --name-only ${baseRef}...HEAD`));
  } else if (process.env.CI === "true") {
    const mergeBase =
      gitLines("git merge-base HEAD origin/main")[0] || gitLines("git merge-base HEAD origin/master")[0];
    if (mergeBase) {
      add("pull_request", gitLines(`git diff --name-only ${mergeBase}...HEAD`));
    }
  }

  for (const root of ["dist", "backend/dist"]) {
    const abs = join(repoRoot, root);
    if (existsSync(abs)) {
      add("build_artifact", walkDir(abs, [], root));
    }
  }

  return scopes;
}

function shouldScanFile(rel: string): boolean {
  if (rel.endsWith(".env") || rel === ".env" || rel.endsWith("/.env")) return false;
  if (/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp4|pdf|zip|dll|exe|map)$/i.test(rel)) {
    return false;
  }
  if (rel.includes("secret-exposure-audit.ts")) return false;
  if (/^dist\/assets\/vendor-/i.test(rel)) return false;
  return SCAN_EXTENSIONS.test(rel) || rel.includes(".env.example");
}

function isAllowlistedLine(rel: string, line: string, ruleType: string): boolean {
  const norm = normalizeRel(rel);
  // Firebase "web API keys" (AIzaSy...) are intended to be public in client configs.
  // Treat matches as approved-public to avoid false positives in bundle scanning.
  if (ruleType === "Firebase Web API Key" && /AIzaSy[A-Za-z0-9_-]{20,}/.test(line)) {
    return true;
  }
  if (/\.env\.example$/i.test(norm) || norm.endsWith(".example.json")) {
    return true;
  }
  if (/github-cleanup-audit\.md$/i.test(norm)) {
    return true;
  }
  if (/\.github\/workflows\/ci\.yml$/i.test(norm)) {
    return true;
  }
  return ALLOW_LINE_REGEXES.some((re) => re.test(line));
}

function decodeJwtPayloadSegment(segment: string): string | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function isSupabaseServiceRoleJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const payload = decodeJwtPayloadSegment(parts[1]!);
  if (!payload) return false;
  return payload.includes('"role":"service_role"') || payload.includes('"role": "service_role"');
}

function extractSupabaseServiceRole(line: string): boolean {
  const jwtRe = /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  let m: RegExpExecArray | null;
  while ((m = jwtRe.exec(line)) !== null) {
    if (isSupabaseServiceRoleJwt(m[0])) return true;
  }
  return false;
}

const SECRET_RULES: SecretRule[] = [
  {
    type: "Stripe Secret Key",
    severity: "critical",
    testLine: (line) => /sk_(live|test)_[a-zA-Z0-9]{10,}/.test(line),
  },
  {
    type: "Stripe Webhook Secret",
    severity: "critical",
    testLine: (line) => /whsec_[a-zA-Z0-9]{8,}/.test(line),
  },
  {
    type: "Supabase Service Role Key",
    severity: "critical",
    testLine: (line) =>
      /SUPABASE_SERVICE_ROLE(_KEY)?\s*=\s*["']?eyJ/.test(line) || extractSupabaseServiceRole(line),
  },
  {
    type: "JWT_SECRET value",
    severity: "critical",
    testLine: (line) =>
      /JWT_SECRET\s*=\s*["']?([^"'\s#]{12,})/.test(line) &&
      !/long-random-secret|ci-test-jwt-secret|your_super_secret/i.test(line),
  },
  {
    type: "DATABASE_URL / PostgreSQL connection string",
    severity: "critical",
    testLine: (line) =>
      /postgresql:\/\/[^\s"'#]+:[^\s"'#]+@/i.test(line) &&
      !/PROJECT_REF:PASSWORD|postgres:PASSWORD@|caretip:caretip@localhost/i.test(line),
  },
  {
    type: "OpenAI API Key",
    severity: "critical",
    testLine: (line) => /sk-proj-[A-Za-z0-9_-]{20,}/.test(line) || /OPENAI_API_KEY\s*=\s*["']?sk-/.test(line),
  },
  {
    type: "Resend API Key",
    severity: "high",
    testLine: (line) =>
      /RESEND_API_KEY\s*=\s*["']?re_[A-Za-z0-9]{10,}/.test(line) ||
      /\bre_[A-Za-z0-9]{32,}\b/.test(line),
  },
  {
    type: "Cloudinary Secret",
    severity: "high",
    testLine: (line) => /CLOUDINARY_API_SECRET\s*=\s*["']?[a-zA-Z0-9]{8,}/.test(line),
  },
  {
    type: "Firebase Admin Credentials",
    severity: "critical",
    testLine: (line) =>
      /"type"\s*:\s*"service_account"/.test(line) ||
      /FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*\{/.test(line) ||
      (/private_key_id/.test(line) && /client_email/.test(line)),
  },
  {
    type: "Private Key / PEM block",
    severity: "critical",
    testLine: (line) => /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/.test(line),
  },
  {
    type: "OAuth Client Secret",
    severity: "high",
    testLine: (line) =>
      /GOOGLE_CLIENT_SECRET\s*=\s*["']?[a-zA-Z0-9_\-]{10,}/.test(line) &&
      !/not used|not read|\*\*not\*\*/i.test(line),
  },
  {
    type: "Password reset URL with token",
    severity: "high",
    testLine: (line) => /reset-password\/[A-Za-z0-9_-]{20,}/.test(line),
  },
  {
    type: "Firebase Web API Key",
    severity: "medium",
    testLine: (line) => /AIzaSy[A-Za-z0-9_-]{20,}/.test(line),
  },
];

const FRONTEND_FORBIDDEN: { type: string; severity: Severity; pattern: RegExp }[] = [
  { type: "SUPABASE_SERVICE_ROLE_KEY in frontend", severity: "critical", pattern: /SUPABASE_SERVICE_ROLE(_KEY)?/ },
  { type: "DATABASE_URL in frontend", severity: "critical", pattern: /DATABASE_URL\s*=\s*["']?postgresql:\/\// },
  { type: "JWT_SECRET in frontend", severity: "critical", pattern: /JWT_SECRET\s*=\s*["'][^"']{8,}/ },
  { type: "STRIPE_SECRET_KEY in frontend", severity: "critical", pattern: /STRIPE_SECRET_KEY\s*=\s*["']?sk_/ },
  { type: "OPENAI_API_KEY in frontend", severity: "critical", pattern: /OPENAI_API_KEY\s*=\s*["']?sk-/ },
  { type: "Server OpenAI in VITE_*", severity: "critical", pattern: /VITE_[A-Z_]*OPENAI[A-Z_]*\s*=\s*["']?sk-/ },
  { type: "Server Stripe secret in VITE_*", severity: "critical", pattern: /VITE_[A-Z_]*STRIPE[A-Z_]*SECRET/i },
  { type: "Resend key in frontend", severity: "high", pattern: /RESEND_API_KEY\s*=\s*["']?re_/ },
];

const APPROVED_VITE_PREFIXES = [
  "VITE_API_URL",
  "VITE_APP_URL",
  "VITE_BASE_URL",
  "VITE_CARETIP_APP_ORIGIN",
  "VITE_ENABLE_AI_ASSISTANT",
  "VITE_FIREBASE_",
  "VITE_GOOGLE_CLIENT_ID",
  "VITE_SENTRY_",
  "VITE_STRIPE_PUBLISHABLE_KEY",
  "VITE_APP_VERSION",
  "VITE_LIVE_IN_MINUTES_DEMO_VIDEO",
  "NEXT_PUBLIC_",
];

const findings: Finding[] = [];

function redactSnippet(line: string, max = 80): string {
  return line.trim().slice(0, max).replace(/sk_[a-z]+_[a-zA-Z0-9]+/gi, "sk_[REDACTED]");
}

function scanFile(rel: string, scope: string): void {
  if (!shouldScanFile(rel)) return;
  const abs = join(repoRoot, rel);
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const rule of SECRET_RULES) {
      if (!rule.testLine(line)) continue;
      if (isAllowlistedLine(rel, line, rule.type)) continue;
      findings.push({
        file: rel,
        line: i + 1,
        type: rule.type,
        severity: rule.severity,
        snippet: redactSnippet(line),
        scanScope: scope,
      });
    }
  }
}

function runFrontendGuard(): void {
  const files: string[] = [];
  for (const root of ["src", "public"]) {
    const abs = join(repoRoot, root);
    if (existsSync(abs)) walkDir(abs, files, root);
  }
  const distDir = join(repoRoot, "dist");
  if (existsSync(distDir)) walkDir(distDir, files, "dist");

  for (const rel of files) {
    if (!shouldScanFile(rel)) continue;
    const content = readFileSync(join(repoRoot, rel), "utf8");
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const rule of FRONTEND_FORBIDDEN) {
        if (!rule.pattern.test(line)) continue;
        if (isAllowlistedLine(rel, line, rule.type)) continue;
        findings.push({
          file: rel,
          line: i + 1,
          type: rule.type,
          severity: rule.severity,
          snippet: redactSnippet(line),
          scanScope: "frontend_guard",
        });
      }
      const viteAssign = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=/);
      if (viteAssign) {
        const key = viteAssign[1]!;
        const approved = APPROVED_VITE_PREFIXES.some((p) =>
          p.endsWith("_") ? key.startsWith(p) : key === p || key.startsWith(p),
        );
        if (!approved && /=\s*["']?[a-zA-Z0-9_\-]{8,}/.test(line)) {
          if (!isAllowlistedLine(rel, line, "VITE")) {
            findings.push({
              file: rel,
              line: i + 1,
              type: `Unapproved VITE_* variable (${key})`,
              severity: "medium",
              snippet: redactSnippet(line),
              scanScope: "frontend_guard",
            });
          }
        }
      }
    }
  }
}

function runPasswordResetLogGuard(): void {
  const rel = "backend/src/services/passwordReset.service.ts";
  const content = readFileSync(join(repoRoot, rel), "utf8");
  if (!content.includes("PASSWORD_RESET_LOG_DEV_LINK")) {
    findings.push({
      file: rel,
      line: 1,
      type: "Password reset logging guard missing",
      severity: "high",
      snippet: "Expected PASSWORD_RESET_LOG_DEV_LINK gate before logging reset URLs",
      scanScope: "static_guard",
    });
    return;
  }
  const withoutGate = content.replace(
    /if\s*\(\s*process\.env\.PASSWORD_RESET_LOG_DEV_LINK\s*===\s*["']true["']\s*\)\s*\{[\s\S]*?\}/g,
    "",
  );
  if (/console\.(info|log|debug)\([^)]*resetUrl/.test(withoutGate)) {
    findings.push({
      file: rel,
      line: 0,
      type: "Password reset URL may log without dev gate",
      severity: "high",
      snippet: "resetUrl logged outside PASSWORD_RESET_LOG_DEV_LINK block",
      scanScope: "static_guard",
    });
  }
}

function printFindings(): void {
  if (findings.length === 0) {
    console.log("\n✅ No secret exposure detected.\n");
    return;
  }
  console.log("\n❌ Secret Exposure Detected\n");
  const sorted = [...findings].sort((a, b) => {
    const sev = { critical: 0, high: 1, medium: 2 };
    return sev[a.severity] - sev[b.severity] || a.file.localeCompare(b.file);
  });
  for (const f of sorted) {
    console.log(`File:\n${f.file}\n`);
    console.log(`Line:\n${f.line || "—"}\n`);
    console.log(`Type:\n${f.type}\n`);
    console.log(`Severity:\n${f.severity}\n`);
    console.log(`Scope:\n${f.scanScope}\n`);
    if (f.snippet) console.log(`Snippet:\n${f.snippet}\n`);
    console.log("Action:\nRemove immediately and rotate credentials.\n");
    console.log("---\n");
  }
}

function main(): void {
  console.log("=== CareTip Secret Exposure Audit ===\n");

  const scopes = collectScanTargets();
  const allFiles = new Set<string>();
  for (const [scope, paths] of scopes) {
    console.log(`Scan scope "${scope}": ${paths.size} file(s)`);
    for (const p of paths) allFiles.add(p);
  }

  for (const rel of allFiles) {
    let scope = "tracked";
    for (const [name, set] of scopes) {
      if (set.has(rel)) {
        scope = name;
        break;
      }
    }
    scanFile(rel, scope);
  }

  runFrontendGuard();
  runPasswordResetLogGuard();

  printFindings();
  console.log(
    `Summary: ${findings.length} finding(s) — critical: ${findings.filter((f) => f.severity === "critical").length}, high: ${findings.filter((f) => f.severity === "high").length}, medium: ${findings.filter((f) => f.severity === "medium").length}`,
  );

  if (findings.length > 0) process.exit(1);
}

main();
