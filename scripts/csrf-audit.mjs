/**
 * CSRF regression static audit — cookie-authenticated auth routes.
 * Run: npm run test:csrf-audit (repo root)
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY_PATH = join(REPO_ROOT, "scripts/csrf-audit.inventory.json");
const AUTH_ROUTES_PATH = join(REPO_ROOT, "backend/src/routes/auth.routes.ts");
const AUTH_CONTROLLER_PATH = join(REPO_ROOT, "backend/src/controllers/auth.controller.ts");
const FRONTEND_API_PATH = join(REPO_ROOT, "src/app/lib/api.ts");

/** @typedef {{ routeFile: string, middleware: { origin: string, clientHeader: string }, protectedRoutes: Array<{ method: string, path: string, requiresTrustedOrigin: boolean, requiresClientHeader: boolean }>, cookieMutationHandlers: Array<{ handler: string, note?: string }> }} CsrfInventory */

/** @type {CsrfInventory} */
const INVENTORY = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));

/** @type {Array<{ route: string, file: string, protectionMissing: string }>} */
const violations = [];

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

/**
 * @param {string} content
 * @param {string} method
 * @param {string} pathLiteral e.g. "/refresh"
 */
function extractRouteBlock(content, method, pathLiteral) {
  const escapedPath = pathLiteral.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `router\\.${method.toLowerCase()}\\(\\s*"${escapedPath}"[\\s\\S]*?\\);`,
  );
  const match = content.match(regex);
  return match ? match[0] : null;
}

/**
 * @param {string} block
 * @param {string} middlewareName
 */
function blockUsesMiddleware(block, middlewareName) {
  return new RegExp(`\\b${middlewareName}\\b`).test(block);
}

function auditProtectedRoutes() {
  if (!existsSync(AUTH_ROUTES_PATH)) {
    violations.push({
      route: "(auth routes file missing)",
      file: normalizePath(AUTH_ROUTES_PATH),
      protectionMissing: "backend/src/routes/auth.routes.ts not found",
    });
    return;
  }

  const routesContent = readFileSync(AUTH_ROUTES_PATH, "utf8");
  const originMw = INVENTORY.middleware.origin;
  const clientMw = INVENTORY.middleware.clientHeader;

  if (!routesContent.includes(originMw)) {
    violations.push({
      route: "(imports)",
      file: "backend/src/routes/auth.routes.ts",
      protectionMissing: `${originMw} middleware not imported or used`,
    });
  }

  for (const route of INVENTORY.protectedRoutes) {
    const block = extractRouteBlock(routesContent, route.method, route.path);
    const routeLabel = `${route.method} /api/auth${route.path}`;

    if (!block) {
      violations.push({
        route: routeLabel,
        file: "backend/src/routes/auth.routes.ts",
        protectionMissing: "route definition not found",
      });
      continue;
    }

    if (route.requiresTrustedOrigin && !blockUsesMiddleware(block, originMw)) {
      violations.push({
        route: routeLabel,
        file: "backend/src/routes/auth.routes.ts",
        protectionMissing: originMw,
      });
    }

    if (route.requiresClientHeader && !blockUsesMiddleware(block, clientMw)) {
      violations.push({
        route: routeLabel,
        file: "backend/src/routes/auth.routes.ts",
        protectionMissing: clientMw,
      });
    }
  }
}

function auditCookieMutationHandlers() {
  if (!existsSync(AUTH_CONTROLLER_PATH)) {
    violations.push({
      route: "(auth controller missing)",
      file: normalizePath(AUTH_CONTROLLER_PATH),
      protectionMissing: "auth.controller.ts not found",
    });
    return;
  }

  const content = readFileSync(AUTH_CONTROLLER_PATH, "utf8");
  const knownHandlers = new Set(INVENTORY.cookieMutationHandlers.map((h) => h.handler));
  const exportRegex = /export\s+async\s+function\s+(\w+)\s*\(/g;

  /** @type {string[]} */
  const exportedHandlers = [];
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exportedHandlers.push(match[1]);
  }

  for (const handler of exportedHandlers) {
    const fnStart = content.indexOf(`export async function ${handler}`);
    if (fnStart < 0) continue;

    const nextExport = content.indexOf("export async function", fnStart + 1);
    const fnBody = nextExport >= 0 ? content.slice(fnStart, nextExport) : content.slice(fnStart);

    if (!fnBody.includes("setRefreshCookie(")) continue;

    if (!knownHandlers.has(handler)) {
      violations.push({
        route: `(handler ${handler})`,
        file: "backend/src/controllers/auth.controller.ts",
        protectionMissing:
          "new setRefreshCookie handler — add to scripts/csrf-audit.inventory.json and backend/docs/CSRF_SECURITY.md",
      });
    }
  }
}

function auditFrontendClientHeader() {
  if (!existsSync(FRONTEND_API_PATH)) return;

  const content = readFileSync(FRONTEND_API_PATH, "utf8");
  const clientHeaderPattern = /X-CareTip-Client["']\s*:\s*["']1["']/;

  function hasClientHeaderNear(anchor, radius = 500) {
    const idx = content.indexOf(anchor);
    if (idx < 0) return false;
    const slice = content.slice(Math.max(0, idx - radius), idx + radius);
    return clientHeaderPattern.test(slice);
  }

  const checks = [
    {
      label: "POST /api/auth/refresh",
      ok:
        hasClientHeaderNear("resolveBrowserAuthRefreshUrl(resolveApiBaseUrl())") ||
        hasClientHeaderNear("apiPath(AUTH_REFRESH_PATHNAME)"),
    },
    { label: "POST /api/auth/logout", ok: hasClientHeaderNear('apiPath("/api/auth/logout")') },
  ];

  for (const check of checks) {
    if (!check.ok) {
      violations.push({
        route: check.label,
        file: "src/app/lib/api.ts",
        protectionMissing: "X-CareTip-Client: 1 header",
      });
    }
  }
}

auditProtectedRoutes();
auditCookieMutationHandlers();
auditFrontendClientHeader();

if (violations.length === 0) {
  console.log("CSRF audit passed.");
  console.log(`Protected routes checked: ${INVENTORY.protectedRoutes.length}`);
  console.log(`Cookie mutation handlers inventoried: ${INVENTORY.cookieMutationHandlers.length}`);
  process.exit(0);
}

console.error("CSRF audit failed.\n");
for (const v of violations) {
  console.error(`  route: ${v.route}`);
  console.error(`  file: ${v.file}`);
  console.error(`  protection missing: ${v.protectionMissing}\n`);
}
process.exit(1);
