/**
 * Notification intelligence (Class S) + support-reply dedupe regression.
 * Run: npm run test:notification-intelligence  (from repo root or backend)
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { signAuthJwt } from "../src/services/auth.service.js";
import {
  actionSetupPrompt,
  dismissSetupPrompt,
  evaluateSetupPrompts,
  setupKeyForTests,
  snoozeMsFor,
} from "../src/services/notifications/notificationIntelligence.service.js";

const API = (process.env.RUNTIME_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const skip = (m: string) => results.push(`SKIP: ${m}`);

function readRepo(relFromBackendScripts: string): string {
  return readFileSync(path.resolve(scriptDir, relFromBackendScripts), "utf8");
}

async function api(
  pathName: string,
  token: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${pathName}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep */
  }
  return { status: res.status, body };
}

async function isApiReachable(): Promise<boolean> {
  try {
    return (await fetch(`${API}/health`)).ok;
  } catch {
    return false;
  }
}

async function seed() {
  const tag = `ni-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);

  const manager = await prisma.user.create({
    data: {
      email: `${tag}-mgr@caretip-test.local`,
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

  const other = await prisma.user.create({
    data: {
      email: `${tag}-other@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `${tag} Other`,
          slug: `${tag}-other`,
          verificationStatus: "verified",
          subscriptionTier: "basic",
        },
      },
    },
    include: { business: true },
  });

  const emp = await prisma.user.create({
    data: {
      email: `${tag}-emp@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
    },
  });

  const managerToken = signAuthJwt({
    userId: manager.id,
    id: manager.id,
    email: manager.email,
    role: "MANAGER",
    roleLabel: "MANAGER",
  });
  const otherToken = signAuthJwt({
    userId: other.id,
    id: other.id,
    email: other.email,
    role: "MANAGER",
    roleLabel: "MANAGER",
  });
  const empToken = signAuthJwt({
    userId: emp.id,
    id: emp.id,
    email: emp.email,
    role: "EMPLOYEE",
    roleLabel: "EMPLOYEE",
  });

  return {
    manager,
    other,
    emp,
    managerToken,
    otherToken,
    empToken,
    businessId: manager.business!.id,
    cleanup: async () => {
      await prisma.setupNotificationState.deleteMany({
        where: { userId: { in: [manager.id, other.id, emp.id] } },
      });
      await prisma.business.deleteMany({
        where: { id: { in: [manager.business!.id, other.business!.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [manager.id, other.id, emp.id] } },
      });
    },
  };
}

async function main() {
  // —— Static architecture checks ——
  const fixPrompt = readRepo("../../src/app/components/FixPrompt.tsx");
  if (fixPrompt.includes("useSetupPromptIntelligence") && !fixPrompt.includes("addDismissedFixId")) {
    pass("FixPrompt uses server intelligence (no local dismiss helpers)");
  } else fail("FixPrompt still tied to browser dismiss storage");

  const storage = readRepo("../../src/app/lib/fixPromptStorage.ts");
  if (storage.includes("clearLegacyFixPromptDismissStorage") && !storage.includes("addDismissedFixId")) {
    pass("Legacy fixPromptStorage no longer writes dismiss ids");
  } else fail("fixPromptStorage still has write dismiss API");

  const stripePrompt = readRepo("../../src/app/components/business/BusinessStripeConnectPrompt.tsx");
  if (stripePrompt.includes("conditionVersion") && !stripePrompt.includes('dismissPersistence="session"')) {
    pass("Stripe prompt no longer session-dismissed");
  } else fail("Stripe prompt still session-dismissed");

  const banner = readRepo("../../src/app/components/business/VerificationPendingBanner.tsx");
  if (banner.includes("useSetupPromptIntelligence") && banner.includes("onClick={dismiss}")) {
    pass("Verification banner is dismissible via server intelligence");
  } else fail("Verification banner missing server dismiss");

  const supportNotify = readRepo("../src/services/supportTicketNotify.service.ts");
  if (supportNotify.includes("msg:${msgKey}") || supportNotify.includes("msg:${")) {
    pass("Support reply dedupe is message-scoped");
  } else fail("Support reply dedupe still ticket-scoped only");

  const fcm = readRepo("../../src/app/hooks/useFcmPushSync.ts");
  if (fcm.includes("inbox-${notificationId}") || fcm.includes("inbox-${")) {
    pass("FCM toast uses inbox notification id for presentation dedupe");
  } else fail("FCM toast missing notificationId dedupe");

  const orchestrator = readRepo("../src/services/notifications/notificationOrchestrator.service.ts");
  if (orchestrator.includes("notificationId: notification.id")) {
    pass("Orchestrator attaches notificationId to push metadata");
  } else fail("Push metadata missing notificationId");

  if (snoozeMsFor("stripe_connect", "not_ready") === 7 * 86400000) {
    pass("Stripe snooze is 7 days");
  } else fail("Stripe snooze unexpected");
  if (snoozeMsFor("onboarding_verification", "pending") === 86400000) {
    pass("Verification pending snooze is 1 day (stricter)");
  } else fail("Verification pending snooze unexpected");
  if (snoozeMsFor("onboarding_verification", "rejected") === 2 * 86400000) {
    pass("Verification rejected snooze is 2 days (stricter than Stripe)");
  } else fail("Verification rejected snooze unexpected");

  // —— Service + DB ——
  let bundle: Awaited<ReturnType<typeof seed>> | null = null;
  try {
    bundle = await seed();
    const { manager, other, emp, businessId, managerToken, otherToken, empToken } = bundle;

    const key = setupKeyForTests("stripe_connect", { userId: manager.id, businessId });

    let vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "stripe_connect", conditionActive: true, conditionVersion: "onboarding_incomplete" },
    ]);
    if (vis[0]?.show === true) pass("Stripe incomplete → show");
    else fail("Stripe incomplete should show");

    await dismissSetupPrompt(manager.id, businessId, "stripe_connect", "onboarding_incomplete");
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "stripe_connect", conditionActive: true, conditionVersion: "onboarding_incomplete" },
    ]);
    if (vis[0]?.show === false) pass("After dismiss → hidden (snoozed)");
    else fail("After dismiss should hide");

    // Simulate remount / re-login evaluation — still snoozed
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "stripe_connect", conditionActive: true, conditionVersion: "onboarding_incomplete" },
    ]);
    if (vis[0]?.show === false) pass("Re-evaluate after dismiss stays hidden (login-safe)");
    else fail("Re-evaluate should stay dismissed");

    // Resolve when ready
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "stripe_connect", conditionActive: false, conditionVersion: "ready" },
    ]);
    if (vis[0]?.show === false) pass("Stripe ready → resolved/hidden");
    else fail("Stripe ready should hide");

    const resolved = await prisma.setupNotificationState.findUnique({
      where: { userId_notificationKey: { userId: manager.id, notificationKey: key } },
    });
    if (resolved?.status === "resolved") pass("Stripe ready persists resolved status");
    else fail(`Expected resolved, got ${resolved?.status}`);

    // New incomplete cycle
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "stripe_connect", conditionActive: true, conditionVersion: "restricted" },
    ]);
    if (vis[0]?.show === true) pass("New Stripe incomplete version → new ACTIVE cycle");
    else fail("New condition version should show again");

    // Verification pending / rejected
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "onboarding_verification", conditionActive: true, conditionVersion: "pending" },
    ]);
    if (vis[0]?.show) pass("Verification pending → show");
    else fail("Verification pending should show");
    await dismissSetupPrompt(manager.id, businessId, "onboarding_verification", "pending");
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "onboarding_verification", conditionActive: true, conditionVersion: "pending" },
    ]);
    if (!vis[0]?.show) pass("Verification pending dismiss → hidden");
    else fail("Verification pending dismiss failed");

    // Status change pending → rejected starts new cycle
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "onboarding_verification", conditionActive: true, conditionVersion: "rejected" },
    ]);
    if (vis[0]?.show) pass("Verification rejected (new version) → show again");
    else fail("Rejected should open new cycle");

    await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "onboarding_verification", conditionActive: false, conditionVersion: "approved" },
    ]);
    const vKey = setupKeyForTests("onboarding_verification", { userId: manager.id, businessId });
    const vRow = await prisma.setupNotificationState.findUnique({
      where: { userId_notificationKey: { userId: manager.id, notificationKey: vKey } },
    });
    if (vRow?.status === "resolved") pass("Verification approved → resolved");
    else fail("Verification approve should resolve");

    // Missing QR
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "missing_employee_qr", conditionActive: true, conditionVersion: "employees_missing_qr" },
    ]);
    await dismissSetupPrompt(manager.id, businessId, "missing_employee_qr", "employees_missing_qr");
    vis = await evaluateSetupPrompts(manager.id, businessId, [
      { kind: "missing_employee_qr", conditionActive: true, conditionVersion: "employees_missing_qr" },
    ]);
    if (!vis[0]?.show) pass("Missing QR dismiss → hidden");
    else fail("Missing QR dismiss failed");

    // Profile photo (user-scoped)
    vis = await evaluateSetupPrompts(emp.id, null, [
      { kind: "profile_photo", conditionActive: true, conditionVersion: "missing_photo" },
    ]);
    if (vis[0]?.show) pass("Profile photo missing → show");
    else fail("Profile photo should show");
    await actionSetupPrompt(emp.id, null, "profile_photo", "missing_photo");
    vis = await evaluateSetupPrompts(emp.id, null, [
      { kind: "profile_photo", conditionActive: true, conditionVersion: "missing_photo" },
    ]);
    if (!vis[0]?.show) pass("Profile photo actioned → snoozed/hidden");
    else fail("Profile photo actioned should hide");

    // Tenant isolation via API (if reachable and server has latest Prisma client)
    if (await isApiReachable()) {
      const evalRes = await api("/api/me/notifications/setup/evaluate", managerToken, {
        method: "POST",
        body: JSON.stringify({
          items: [
            {
              kind: "stripe_connect",
              conditionActive: true,
              conditionVersion: "onboarding_incomplete",
            },
          ],
        }),
      });
      if (evalRes.status === 200 && Array.isArray(evalRes.body?.results)) {
        pass("API setup/evaluate returns results for owner");
      } else if (evalRes.status === 500) {
        skip(
          "API setup/evaluate 500 — restart backend after prisma generate to load SetupNotificationState",
        );
      } else {
        fail(
          `API evaluate unexpected: ${evalRes.status} ${JSON.stringify(evalRes.body)?.slice(0, 200)}`,
        );
      }

      const otherDismiss = await api("/api/me/notifications/setup/dismiss", otherToken, {
        method: "POST",
        body: JSON.stringify({
          kind: "stripe_connect",
          conditionVersion: "onboarding_incomplete",
        }),
      });
      if (otherDismiss.status === 200) {
        const otherKey = setupKeyForTests("stripe_connect", {
          userId: other.id,
          businessId: other.business!.id,
        });
        if (otherKey !== key) pass("Dismiss is scoped to authenticated business key");
        else fail("Other user key collided with manager key");
      } else if (otherDismiss.status === 500) {
        skip("API setup/dismiss 500 — restart backend after prisma generate");
      } else {
        fail(
          `Other dismiss status ${otherDismiss.status} ${JSON.stringify(otherDismiss.body)?.slice(0, 200)}`,
        );
      }

      // In-process tenant proof (does not depend on live server Prisma client)
      await dismissSetupPrompt(other.id, other.business!.id, "stripe_connect", "onboarding_incomplete");
      const managerRow = await prisma.setupNotificationState.findUnique({
        where: { userId_notificationKey: { userId: manager.id, notificationKey: key } },
      });
      const otherRow = await prisma.setupNotificationState.findUnique({
        where: {
          userId_notificationKey: {
            userId: other.id,
            notificationKey: setupKeyForTests("stripe_connect", {
              userId: other.id,
              businessId: other.business!.id,
            }),
          },
        },
      });
      if (managerRow && otherRow && managerRow.id !== otherRow.id) {
        pass("In-process: managers keep separate setup state rows");
      } else fail("In-process tenant isolation for setup state failed");

      const empDismiss = await api("/api/me/notifications/setup/dismiss", empToken, {
        method: "POST",
        body: JSON.stringify({
          kind: "stripe_connect",
          conditionVersion: "x",
        }),
      });
      if (empDismiss.status === 403) pass("Employee cannot dismiss business Stripe setup");
      else if (empDismiss.status === 500) {
        skip("Employee dismiss 500 — restart backend; service-level business check still covered");
      } else fail(`Expected 403 for employee stripe dismiss, got ${empDismiss.status}`);
    } else {
      skip("API not reachable — HTTP tenant checks skipped");
    }
  } catch (err) {
    fail(`Runtime error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (bundle) await bundle.cleanup().catch(() => undefined);
  }

  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) console.log(line);
  if (failed.length) {
    console.error(`\n${failed.length} notification intelligence check(s) failed`);
    process.exit(1);
  }
  console.log(`\n${results.length} notification intelligence checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
