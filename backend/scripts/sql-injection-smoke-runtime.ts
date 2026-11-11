/**
 * SQL injection payload smoke tests — service layer + optional HTTP against RUNTIME_API_BASE.
 * Run: npm run test:sql-injection-smoke (from backend/)
 *
 * Unit tests (likeSearch) always run. DB/HTTP payloads run only when DATABASE_URL is set
 * and the database is reachable (CI uses the job Postgres service).
 */
import "dotenv/config";
import "../src/loadEnv.js";
import {
  escapeLikeContainsPattern,
  sanitizeLikeContainsSearch,
} from "../src/utils/likeSearch.js";

const API = (process.env.RUNTIME_API_BASE ?? (process.env.CI ? "http://localhost:3001" : "http://127.0.0.1:9")).replace(/\/$/, "");

export const SQLI_PAYLOADS = [
  "' OR 1=1--",
  '" OR 1=1--',
  "admin'--",
  "' UNION SELECT NULL--",
  "') OR ('1'='1",
] as const;

const DB_LEAK_RE =
  /syntax error at or near|invalid input syntax|SQLSTATE|P20\d{2}|prisma.*query|postgresql.*error|unterminated quoted string/i;

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const skip = (m: string) => results.push(`SKIP: ${m}`);

type DatabaseDeps = {
  prisma: {
    $queryRaw: (query: TemplateStringsArray) => Promise<unknown>;
    user: {
      create: (args: unknown) => Promise<{
        id: string;
        email: string;
        business?: { id: string } | null;
      }>;
      delete: (args: unknown) => Promise<unknown>;
    };
    business: { delete: (args: unknown) => Promise<unknown> };
  };
  bcrypt: typeof import("bcrypt");
  authService: typeof import("../src/services/auth.service.js");
  signAuthJwt: typeof import("../src/services/auth.service.js").signAuthJwt;
  listGlobalTransactions: typeof import("../src/services/platform.service.js").listGlobalTransactions;
  listPlatformSupportTickets: typeof import("../src/services/supportTicket.service.js").listPlatformSupportTickets;
  listBusinessSupportTickets: typeof import("../src/services/supportTicket.service.js").listBusinessSupportTickets;
  listUserNotifications: typeof import("../src/services/notifications/notificationInbox.service.js").listUserNotifications;
  validateInviteCode: typeof import("../src/services/business.service.js").validateInviteCode;
};

async function loadDatabaseDeps(): Promise<DatabaseDeps> {
  const bcrypt = (await import("bcrypt")).default;
  const { prisma } = await import("../src/prisma.js");
  const authService = await import("../src/services/auth.service.js");
  const { listGlobalTransactions } = await import("../src/services/platform.service.js");
  const {
    listBusinessSupportTickets,
    listPlatformSupportTickets,
  } = await import("../src/services/supportTicket.service.js");
  const { listUserNotifications } = await import(
    "../src/services/notifications/notificationInbox.service.js"
  );
  const { validateInviteCode } = await import("../src/services/business.service.js");

  return {
    prisma: prisma as DatabaseDeps["prisma"],
    bcrypt,
    authService,
    signAuthJwt: authService.signAuthJwt,
    listGlobalTransactions,
    listPlatformSupportTickets,
    listBusinessSupportTickets,
    listUserNotifications,
    validateInviteCode,
  };
}

function assertNoDbLeak(context: string, err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (DB_LEAK_RE.test(msg)) {
    fail(`${context}: database error leaked — ${msg.slice(0, 120)}`);
    return false;
  }
  return true;
}

function assertResponseSafe(context: string, status: number, body: string): boolean {
  if (status >= 500) {
    fail(`${context}: unexpected ${status}`);
    return false;
  }
  if (DB_LEAK_RE.test(body)) {
    fail(`${context}: response body leaks DB/SQL details`);
    return false;
  }
  return true;
}

async function isDbReachable(deps: DatabaseDeps): Promise<boolean> {
  try {
    await deps.prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function seedManager(deps: DatabaseDeps) {
  const { prisma, bcrypt, signAuthJwt } = deps;
  const tag = `sqli-mgr-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `${tag} Venue`,
          slug: `${tag}-venue`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });
  return {
    userId: user.id,
    businessId: user.business!.id,
    token: signAuthJwt({
      userId: user.id,
      id: user.id,
      email: user.email,
      role: "MANAGER",
      roleLabel: "MANAGER",
    }),
    cleanup: async () => {
      await prisma.business.delete({ where: { id: user.business!.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    },
  };
}

async function seedPlatformAdmin(deps: DatabaseDeps) {
  const { prisma, bcrypt, signAuthJwt } = deps;
  const tag = `sqli-admin-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const user = await prisma.user.create({
    data: {
      email: `${tag}@caretip-test.local`,
      passwordHash,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      emailVerified: true,
    },
  });
  return {
    userId: user.id,
    token: signAuthJwt({
      userId: user.id,
      id: user.id,
      email: user.email,
      role: "SUPER_ADMIN",
      roleLabel: "SUPER_ADMIN",
    }),
    cleanup: async () => {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    },
  };
}

async function testLikeSearchHardening(): Promise<void> {
  if (escapeLikeContainsPattern("50% off") === "50\\% off") {
    pass("likeSearch: escapes %");
  } else {
    fail("likeSearch: % escape");
  }
  if (escapeLikeContainsPattern("a_b") === "a\\_b") {
    pass("likeSearch: escapes _");
  } else {
    fail("likeSearch: _ escape");
  }
  if (sanitizeLikeContainsSearch("  x  ") === "x") {
    pass("likeSearch: trims search");
  } else {
    fail("likeSearch: trim");
  }
  if (sanitizeLikeContainsSearch("") === undefined) {
    pass("likeSearch: empty → undefined");
  } else {
    fail("likeSearch: empty");
  }
}

async function testLoginPayloads(deps: DatabaseDeps): Promise<void> {
  for (const payload of SQLI_PAYLOADS) {
    try {
      await deps.authService.login({ email: payload, password: payload });
      fail(`login payload did not reject: ${payload.slice(0, 20)}`);
    } catch (err) {
      if (!assertNoDbLeak(`login(${payload.slice(0, 12)}...)`, err)) continue;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Invalid email or password") || msg.includes("EmailNotVerified")) {
        pass(`login rejects payload (${payload.slice(0, 14)}…)`);
      } else {
        pass(`login throws safe error for payload (${payload.slice(0, 14)}…)`);
      }
    }
  }
}

async function testSearchPayloads(
  deps: DatabaseDeps,
  adminUserId: string,
  managerUserId: string,
): Promise<void> {
  for (const payload of SQLI_PAYLOADS) {
    try {
      const tx = await deps.listGlobalTransactions({ q: payload, take: 10, skip: 0 });
      if (!Array.isArray(tx.items)) {
        fail(`platform search invalid shape for payload`);
      } else if (tx.items.length > 100) {
        fail(`platform search suspicious expansion (${tx.items.length} rows)`);
      } else {
        pass(`platform search safe (${payload.slice(0, 12)}…)`);
      }
    } catch (err) {
      if (assertNoDbLeak("platform search", err)) {
        fail(`platform search threw: ${err instanceof Error ? err.message : err}`);
      }
    }

    try {
      const tickets = await deps.listPlatformSupportTickets({ search: payload });
      if (!Array.isArray(tickets) || tickets.length > 200) {
        fail(`platform tickets search suspicious result`);
      } else {
        pass(`platform tickets search safe (${payload.slice(0, 12)}…)`);
      }
    } catch (err) {
      if (assertNoDbLeak("platform tickets search", err)) {
        fail(`platform tickets search threw`);
      }
    }

    try {
      const tickets = await deps.listBusinessSupportTickets(managerUserId, { search: payload });
      if (!Array.isArray(tickets) || tickets.length > 200) {
        fail(`business tickets search suspicious result`);
      } else {
        pass(`business tickets search safe (${payload.slice(0, 12)}…)`);
      }
    } catch (err) {
      if (assertNoDbLeak("business tickets search", err)) {
        fail(`business tickets search threw`);
      }
    }

    try {
      const inbox = await deps.listUserNotifications(adminUserId, { search: payload, limit: 20 });
      if (!Array.isArray(inbox.items) || inbox.items.length > 100) {
        fail(`notifications search suspicious result`);
      } else {
        pass(`notifications search safe (${payload.slice(0, 12)}…)`);
      }
    } catch (err) {
      if (assertNoDbLeak("notifications search", err)) {
        fail(`notifications search threw`);
      }
    }
  }
}

async function testPublicEndpoints(deps: DatabaseDeps): Promise<void> {
  for (const payload of SQLI_PAYLOADS) {
    try {
      const r = await deps.validateInviteCode(payload);
      if (r.ok) {
        fail(`invite validate must not succeed on SQLi payload`);
      } else {
        pass(`invite validate rejects payload (${payload.slice(0, 12)}…)`);
      }
    } catch (err) {
      if (assertNoDbLeak("invite validate", err)) {
        fail(`invite validate threw unexpectedly`);
      }
    }
  }
}

async function testHttpPayloads(managerToken: string, adminToken: string): Promise<void> {
  if (!(await isApiReachable())) {
    skip("HTTP smoke — API not reachable");
    return;
  }

  for (const payload of SQLI_PAYLOADS) {
    const loginRes = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: payload, password: "wrong" }),
    }).catch(() => null);
    if (!loginRes) {
      skip("HTTP login — fetch failed");
      break;
    }
    const loginBody = await loginRes.text();
    if (!assertResponseSafe("HTTP login", loginRes.status, loginBody)) continue;
    if (loginRes.status === 200 && loginBody.includes('"token"')) {
      fail("HTTP login returned token on SQLi payload");
    } else {
      pass(`HTTP login safe (${payload.slice(0, 12)}…)`);
    }

    const searchRes = await fetch(
      `${API}/api/platform/transactions?q=${encodeURIComponent(payload)}&take=10`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const searchBody = await searchRes.text();
    if (assertResponseSafe("HTTP platform search", searchRes.status, searchBody)) {
      pass(`HTTP platform search safe (${payload.slice(0, 12)}…)`);
    }

    const tipsRes = await fetch(
      `${API}/api/tips/business?employeeId=${encodeURIComponent(payload)}&take=10`,
      { headers: { Authorization: `Bearer ${managerToken}` } },
    );
    const tipsBody = await tipsRes.text();
    if (assertResponseSafe("HTTP tips employeeId filter", tipsRes.status, tipsBody)) {
      pass(`HTTP tips filter safe (${payload.slice(0, 12)}…)`);
    }

    const ticketRes = await fetch(
      `${API}/api/business/support/tickets?search=${encodeURIComponent(payload)}`,
      { headers: { Authorization: `Bearer ${managerToken}` } },
    );
    const ticketBody = await ticketRes.text();
    if (assertResponseSafe("HTTP support tickets search", ticketRes.status, ticketBody)) {
      pass(`HTTP support search safe (${payload.slice(0, 12)}…)`);
    }

    const notifRes = await fetch(
      `${API}/api/me/notifications?q=${encodeURIComponent(payload)}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const notifBody = await notifRes.text();
    if (assertResponseSafe("HTTP notifications search", notifRes.status, notifBody)) {
      pass(`HTTP notifications search safe (${payload.slice(0, 12)}…)`);
    }

    const inviteRes = await fetch(
      `${API}/api/business/invite/validate?code=${encodeURIComponent(payload)}`,
    );
    const inviteBody = await inviteRes.text();
    if (assertResponseSafe("HTTP invite validate", inviteRes.status, inviteBody)) {
      pass(`HTTP invite validate safe (${payload.slice(0, 12)}…)`);
    }

    const ctxRes = await fetch(
      `${API}/api/tipping-context/${encodeURIComponent(payload)}`,
    );
    const ctxBody = await ctxRes.text();
    if (assertResponseSafe("HTTP tipping-context slug", ctxRes.status, ctxBody)) {
      pass(`HTTP public tipping-context safe (${payload.slice(0, 12)}…)`);
    }

    const goalsRes = await fetch(`${API}/api/goals/${encodeURIComponent(payload)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const goalsBody = await goalsRes.text();
    if (assertResponseSafe("HTTP goals id param", goalsRes.status, goalsBody)) {
      pass(`HTTP goals param safe (${payload.slice(0, 12)}…)`);
    }
  }
}

async function main(): Promise<void> {
  await testLikeSearchHardening();

  if (!process.env.DATABASE_URL?.trim()) {
    skip("Service-layer SQLi payloads — DATABASE_URL not set");
    skip("HTTP SQLi payloads — requires DATABASE_URL for tokens");
    printSummary();
    return;
  }

  const deps = await loadDatabaseDeps();

  if (!(await isDbReachable(deps))) {
    skip("Service-layer SQLi payloads — database not reachable");
    skip("HTTP SQLi payloads — requires database for tokens");
    printSummary();
    return;
  }

  let manager: Awaited<ReturnType<typeof seedManager>> | null = null;
  let admin: Awaited<ReturnType<typeof seedPlatformAdmin>> | null = null;

  try {
    await testLoginPayloads(deps);
    await testPublicEndpoints(deps);

    manager = await seedManager(deps);
    admin = await seedPlatformAdmin(deps);
    await testSearchPayloads(deps, admin.userId, manager.userId);
    await testHttpPayloads(manager.token, admin.token);
  } finally {
    await manager?.cleanup();
    await admin?.cleanup();
    const { prisma } = await import("../src/prisma.js");
    await prisma.$disconnect().catch(() => undefined);
  }

  printSummary();
}

function printSummary(): void {
  console.log("\n=== SQL injection payload smoke tests ===\n");
  for (const line of results) console.log(line);
  const failed = results.filter((r) => r.startsWith("FAIL:"));
  const passed = results.filter((r) => r.startsWith("PASS:"));
  const skipped = results.filter((r) => r.startsWith("SKIP:"));
  console.log(`\nSummary: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
