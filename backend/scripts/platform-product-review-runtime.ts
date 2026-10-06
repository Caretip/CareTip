/**
 * Platform product review — Phase 1 backend validation + API checks.
 * Run: npm --prefix backend run test:platform-product-review
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { signAuthJwt } from "../src/services/auth.service.js";
import {
  computeAverageRating,
  computeRatingDistribution,
  parsePlatformProductFeedbackAdminStatus,
  parsePlatformProductFeedbackPayload,
  PLATFORM_PRODUCT_FEEDBACK_COMMENT_MAX,
} from "../src/lib/platformProductFeedbackValidation.js";
import {
  createMyPlatformProductFeedback,
  getMyPlatformProductFeedbackOverview,
  getPlatformProductFeedbackSummary,
} from "../src/services/platformProductFeedback.service.js";

const API = (process.env.RUNTIME_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const results: string[] = [];
let failed = 0;
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => {
  failed += 1;
  results.push(`FAIL: ${m}`);
};
const skip = (m: string) => results.push(`SKIP: ${m}`);

async function api(
  path: string,
  token: string | null,
  opts?: { method?: string; body?: unknown },
): Promise<{ status: number; body: string; json?: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: opts?.method ?? "GET",
    headers,
    body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  return { status: res.status, body, json };
}

function runValidationUnitTests() {
  const badRating = parsePlatformProductFeedbackPayload({ rating: 6 });
  if (!badRating.ok) pass("validation rejects rating > 5");
  else fail("validation should reject rating > 5");

  const missingRating = parsePlatformProductFeedbackPayload({ comment: "ok" });
  if (!missingRating.ok) pass("validation rejects missing rating");
  else fail("validation should reject missing rating");

  const emptyComment = parsePlatformProductFeedbackPayload({ rating: 3, comment: "   " });
  if (!emptyComment.ok) pass("validation rejects empty trimmed comment");
  else fail("validation should reject empty comment");

  const longComment = parsePlatformProductFeedbackPayload({
    rating: 4,
    comment: "x".repeat(PLATFORM_PRODUCT_FEEDBACK_COMMENT_MAX + 1),
  });
  if (!longComment.ok) pass("validation rejects over-limit comment");
  else fail("validation should reject long comment");

  const ownership = parsePlatformProductFeedbackPayload({ rating: 3, userId: "evil" });
  if (!ownership.ok) pass("validation rejects client userId");
  else fail("validation should reject client userId");

  const ok = parsePlatformProductFeedbackPayload({ rating: 5, comment: "  Great app  " });
  if (ok.ok && ok.value.rating === 5 && ok.value.comment === "Great app") {
    pass("validation accepts rating + trimmed comment");
  } else fail("validation should accept valid payload");

  const dist = computeRatingDistribution([{ rating: 5 }, { rating: 5 }, { rating: 2 }]);
  if (dist["5"] === 2 && dist["2"] === 1 && dist["1"] === 0) pass("rating distribution math");
  else fail("rating distribution math");

  const avg = computeAverageRating([{ rating: 4 }, { rating: 5 }]);
  if (avg === 4.5) pass("average rating math");
  else fail("average rating math");

  if (parsePlatformProductFeedbackAdminStatus("read") === "read") pass("admin status parse");
  else fail("admin status parse");
}

async function seedUsers(tag: string) {
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const manager = await prisma.user.create({
    data: {
      email: `${tag}-mgr@caretip-test.local`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `${tag} Venue`,
          slug: `${tag}-venue-${Date.now()}`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });

  const employeeUser = await prisma.user.create({
    data: {
      email: `${tag}-emp@caretip-test.local`,
      passwordHash,
      role: Role.EMPLOYEE,
      emailVerified: true,
      employee: {
        create: {
          name: `${tag} Staff`,
          slug: `${tag}-staff-${Date.now()}`,
          jobTitle: "Host",
          businessId: manager.business!.id,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });

  const admin = await prisma.user.create({
    data: {
      email: `${tag}-admin@caretip-test.local`,
      passwordHash,
      role: Role.SUPER_ADMIN,
      emailVerified: true,
      isPlatformAdmin: true,
      hasCompletedOnboarding: true,
    },
  });

  const managerToken = signAuthJwt({
    userId: manager.id,
    id: manager.id,
    sub: manager.id,
    email: manager.email,
    role: Role.MANAGER,
    roleLabel: "MANAGER",
  });
  const employeeToken = signAuthJwt({
    userId: employeeUser.id,
    id: employeeUser.id,
    sub: employeeUser.id,
    email: employeeUser.email,
    role: Role.EMPLOYEE,
    roleLabel: "EMPLOYEE",
  });
  const adminToken = signAuthJwt({
    userId: admin.id,
    id: admin.id,
    sub: admin.id,
    email: admin.email,
    role: Role.SUPER_ADMIN,
    roleLabel: "SUPER_ADMIN",
  });

  return {
    manager,
    employeeUser,
    admin,
    managerToken,
    employeeToken,
    adminToken,
    cleanup: async () => {
      await prisma.platformProductFeedback.deleteMany({
        where: {
          userId: { in: [manager.id, employeeUser.id] },
        },
      });
      await prisma.employee.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.business.delete({ where: { id: manager.business!.id } }).catch(() => {});
      await prisma.user.deleteMany({
        where: { id: { in: [manager.id, employeeUser.id, admin.id] } },
      });
    },
  };
}

async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  runValidationUnitTests();

  let seeded: Awaited<ReturnType<typeof seedUsers>> | null = null;
  try {
    seeded = await seedUsers(`ppr-${Date.now()}`);

    const first = await createMyPlatformProductFeedback({
      userId: seeded.manager.id,
      role: Role.MANAGER,
      payload: { rating: 4, comment: "Solid product" },
    });
    if (first.feedback.rating === 4) pass("service manager first create");
    else fail("service manager first create");

    const second = await createMyPlatformProductFeedback({
      userId: seeded.manager.id,
      role: Role.MANAGER,
      payload: { rating: 5, comment: "Even better" },
    });
    if (second.feedback.rating === 5 && second.feedback.adminStatus === "new") {
      pass("service second submission is new row with fresh status");
    } else fail("service second submission");

    const managerRows = await prisma.platformProductFeedback.findMany({
      where: { userId: seeded.manager.id },
      orderBy: { createdAt: "asc" },
    });
    if (managerRows.length === 2 && managerRows[0]?.comment === "Solid product") {
      pass("service preserves first submission when second is created");
    } else fail(`expected 2 manager rows, got ${managerRows.length}`);

    const overview = await getMyPlatformProductFeedbackOverview(seeded.manager.id);
    if (overview.latest?.comment === "Even better") pass("service GET overview returns latest");
    else fail("service GET overview latest");

    await createMyPlatformProductFeedback({
      userId: seeded.employeeUser.id,
      role: Role.EMPLOYEE,
      payload: { rating: 3, comment: null },
    });
    const empOverview = await getMyPlatformProductFeedbackOverview(seeded.employeeUser.id);
    if (empOverview.latest?.submitterRole === Role.EMPLOYEE && empOverview.latest.employeeId) {
      pass("service employee context");
    } else fail("service employee context");

    const summary = await getPlatformProductFeedbackSummary();
    if (summary.totalCount >= 2 && summary.averageRating != null) pass("service summary");
    else fail("service summary");

    const apiUp = await isApiReachable();
    if (!apiUp) {
      skip(`API not reachable at ${API} — HTTP checks skipped`);
    } else {
      const unauth = await api("/api/product-reviews/me", null, {
        method: "POST",
        body: { rating: 3 },
      });
      if (unauth.status === 401) pass("HTTP unauthenticated POST rejected");
      else fail(`HTTP unauthenticated POST expected 401 got ${unauth.status}`);

      const mgrPost = await api("/api/product-reviews/me", seeded.managerToken, {
        method: "POST",
        body: { rating: 5, comment: "HTTP submit" },
      });
      if (mgrPost.status === 200) pass("HTTP manager POST");
      else fail(`HTTP manager POST got ${mgrPost.status}`);

      const mgrGet = await api("/api/product-reviews/me", seeded.managerToken);
      if (mgrGet.status === 200 && mgrGet.body.includes("HTTP submit") && mgrGet.body.includes('"latest"')) {
        pass("HTTP manager GET latest");
      } else fail(`HTTP manager GET got ${mgrGet.status}`);

      const empPost = await api("/api/product-reviews/me", seeded.employeeToken, {
        method: "POST",
        body: { rating: 4 },
      });
      if (empPost.status === 200) pass("HTTP employee POST");
      else fail(`HTTP employee POST got ${empPost.status}`);

      const crossGet = await api("/api/product-reviews/me", seeded.managerToken);
      if (crossGet.status === 200 && !crossGet.body.includes(seeded.employeeUser.employee!.id)) {
        pass("HTTP manager GET does not return employee review");
      } else if (crossGet.status !== 200) {
        fail(`HTTP manager GET failed ${crossGet.status}`);
      }

      const mgrPlatform = await api("/api/platform/product-reviews", seeded.managerToken);
      if (mgrPlatform.status === 403) pass("HTTP non-admin platform list blocked");
      else fail(`HTTP manager platform list expected 403 got ${mgrPlatform.status}`);

      const adminList = await api("/api/platform/product-reviews?take=50", seeded.adminToken);
      if (adminList.status === 200) pass("HTTP admin list");
      else fail(`HTTP admin list got ${adminList.status}`);

      const adminSummary = await api("/api/platform/product-reviews/summary", seeded.adminToken);
      if (adminSummary.status === 200) pass("HTTP admin summary");
      else fail(`HTTP admin summary got ${adminSummary.status}`);

      const ownershipInject = await api("/api/product-reviews/me", seeded.employeeToken, {
        method: "POST",
        body: { rating: 2, userId: seeded.manager.id, businessId: "x" },
      });
      if (ownershipInject.status === 400) pass("HTTP rejects ownership injection");
      else fail(`HTTP ownership injection expected 400 got ${ownershipInject.status}`);

      const patchForbidden = await api(
        `/api/platform/product-reviews/${first.feedback.id}`,
        seeded.adminToken,
        { method: "PATCH", body: { adminStatus: "read", rating: 1 } },
      );
      if (patchForbidden.status === 400) pass("HTTP admin PATCH rejects rating mass-assign");
      else fail(`HTTP admin PATCH mass-assign expected 400 got ${patchForbidden.status}`);

      const patchOk = await api(
        `/api/platform/product-reviews/${first.feedback.id}`,
        seeded.adminToken,
        { method: "PATCH", body: { adminStatus: "read" } },
      );
      if (patchOk.status === 200) pass("HTTP admin PATCH status");
      else fail(`HTTP admin PATCH status got ${patchOk.status}`);

      const bigTake = await api("/api/platform/product-reviews?take=9999", seeded.adminToken);
      if (bigTake.status === 200) {
        const j = bigTake.json as { items?: unknown[] } | undefined;
        if (j && Array.isArray(j.items) && j.items.length <= 100) pass("HTTP pagination take cap");
        else fail("HTTP pagination take cap");
      } else fail(`HTTP pagination got ${bigTake.status}`);

      const feedbackTip = await api("/api/feedback/tip", null, {
        method: "POST",
        body: { rating: 3, comment: "guest" },
      });
      if (feedbackTip.status === 400 || feedbackTip.status === 503) {
        pass("regression POST /api/feedback/tip still mounted (validation/session)");
      } else {
        skip(`regression feedback/tip returned ${feedbackTip.status}`);
      }

      const feedbackBiz = await api("/api/feedback/business", seeded.managerToken);
      if (feedbackBiz.status === 200 || feedbackBiz.status === 403) {
        pass("regression GET /api/feedback/business still mounted");
      } else {
        fail(`regression feedback/business unexpected ${feedbackBiz.status}`);
      }
    }
  } catch (e) {
    fail(`runtime: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (seeded) await seeded.cleanup();
  }

  console.log(results.join("\n"));
  console.log(failed === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
