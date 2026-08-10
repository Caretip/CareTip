/**
 * Platform Legal Hold UI + API contract tests (Slice G UI refinement).
 * Run: npm run test:lifecycle-platform-legal-hold-ui (from backend/)
 *
 * Covers: subject search/selection, no-hold / active-hold UI, required reason/categories,
 * place/clear confirmations, unauthorized denial. Does not invent T_* or enable destruction.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  LegalHoldError,
  clearBusinessLegalHold,
  clearUserLegalHold,
  searchLegalHoldSubjects,
  setBusinessLegalHold,
  setUserLegalHold,
} from "../src/services/legalHold.service.js";
import { LEGAL_HOLD_API_CATEGORIES } from "../src/services/retentionPolicy.helpers.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

async function main() {
  // --- UI contract (static) ---
  const routes = read("src/app/routes.tsx");
  if (routes.includes("system/legal-hold") && routes.includes("PlatformLegalHoldPage")) {
    pass("route system/legal-hold registered");
  } else fail("route system/legal-hold missing");

  const nav = read("src/app/components/platform/platformAdminNav.ts");
  if (nav.includes("legal-hold") && nav.includes("admin.sidebar.system.legalHold")) {
    pass("sidebar nav entry for legal hold");
  } else fail("sidebar nav missing legal hold");

  const api = read("src/app/lib/api.ts");
  for (const fn of [
    "fetchPlatformUserLegalHold",
    "setPlatformUserLegalHold",
    "clearPlatformUserLegalHold",
    "fetchPlatformBusinessLegalHold",
    "setPlatformBusinessLegalHold",
    "clearPlatformBusinessLegalHold",
    "searchPlatformLegalHoldSubjects",
    "PLATFORM_LEGAL_HOLD_CATEGORIES",
  ]) {
    if (api.includes(fn)) pass(`api client exports ${fn}`);
    else fail(`api client missing ${fn}`);
  }

  const page = read("src/app/pages/platform/PlatformLegalHoldPage.tsx");
  if (
    page.includes("searchPlatformLegalHoldSubjects") &&
    page.includes("legal-hold-search-input") &&
    page.includes("legal-hold-selected-subject") &&
    page.includes("legal-hold-id-fallback")
  ) {
    pass("page supports search/select + ID fallback");
  } else fail("page missing search/select UX");

  const panel = read("src/app/components/platform/PlatformLegalHoldPanel.tsx");
  if (panel.includes("window.confirm") && panel.includes("confirmSet") && panel.includes("confirmClear")) {
    pass("UI requires confirmation before place/clear");
  } else fail("UI confirmation missing for place/clear");

  if (
    panel.includes("legalHoldReason") &&
    panel.includes("legalHoldCategories") &&
    panel.includes("legalHoldSetAt") &&
    panel.includes("legalHoldSetByUserId") &&
    panel.includes("legal-hold-status") &&
    panel.includes("statusActive") &&
    panel.includes("statusInactive")
  ) {
    pass("UI surfaces status, reason, categories, set-by, set-at");
  } else fail("UI missing hold status fields");

  if (
    panel.includes("setHold") &&
    panel.includes("clearHold") &&
    panel.includes("!isActive") &&
    panel.includes("isActive")
  ) {
    pass("UI separates no-hold place form vs active clear action");
  } else fail("UI place/clear mode separation missing");

  const en = JSON.parse(read("src/i18n/locales/en.json")) as {
    admin: { legalHoldPage?: Record<string, unknown>; sidebar: { system: Record<string, string> } };
  };
  const de = JSON.parse(read("src/i18n/locales/de.json")) as {
    admin: { legalHoldPage?: Record<string, unknown>; sidebar: { system: Record<string, string> } };
  };
  const enLh = en.admin.legalHoldPage ?? {};
  const deLh = de.admin.legalHoldPage ?? {};

  if (
    String(enLh.subtitle).includes("legal or compliance") &&
    String(enLh.lookupHint).includes("Select a user or business") &&
    String(enLh.setHold) === "Place Legal Hold" &&
    String(enLh.clearHold) === "Clear Legal Hold" &&
    String(enLh.statusActive) === "Legal Hold Active" &&
    String(enLh.statusInactive) === "No active legal hold"
  ) {
    pass("EN copy matches UX refinement wording");
  } else fail("EN legalHoldPage copy incomplete");

  if (
    String(enLh.confirmSet).includes("protected from applicable lifecycle") &&
    String(enLh.confirmClear) ===
      "Are you sure you want to clear this legal hold? Applicable lifecycle processing may resume after the hold is cleared."
  ) {
    pass("EN place/clear confirmation copy correct");
  } else fail("EN confirmation copy incorrect");

  if (deLh.confirmSet && deLh.confirmClear && deLh.searchUser && deLh.searchBusiness) {
    pass("DE legalHoldPage search + confirmation copy present");
  } else fail("DE legalHoldPage i18n incomplete");

  if (en.admin.sidebar.system.legalHold && de.admin.sidebar.system.legalHold) {
    pass("EN/DE sidebar legalHold labels present");
  } else fail("sidebar legalHold i18n missing");

  const catMatch = api.match(
    /PLATFORM_LEGAL_HOLD_CATEGORIES\s*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  if (catMatch) {
    const listed = [...catMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const backend = [...LEGAL_HOLD_API_CATEGORIES];
    const same =
      listed.length === backend.length && listed.every((c, i) => c === backend[i]);
    if (same) pass("frontend categories match backend LEGAL_HOLD_API_CATEGORIES");
    else fail(`category mismatch fe=${listed.join(",")} be=${backend.join(",")}`);
  } else fail("could not parse PLATFORM_LEGAL_HOLD_CATEGORIES");

  const bizDetail = read("src/app/pages/platform/BusinessDetailPage.tsx");
  if (
    bizDetail.includes("PlatformLegalHoldPanel") &&
    bizDetail.includes('subjectType="business"') &&
    bizDetail.includes('subjectType="user"')
  ) {
    pass("BusinessDetailPage embeds business + owner legal hold panels");
  } else fail("BusinessDetailPage legal hold panels missing");

  const platformRoutes = read("backend/src/routes/platform.routes.ts");
  if (platformRoutes.includes("/legal-hold/subjects") && platformRoutes.includes("searchPlatformLegalHoldSubjects")) {
    pass("platform route registers legal-hold subjects search");
  } else fail("platform subjects search route missing");

  // --- Authorized / unauthorized API behavior (fixtures) ---
  const tag = Date.now();
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const admin = await prisma.user.create({
    data: {
      email: `ui-lh-admin-${tag}@caretip-test.local`,
      passwordHash,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      emailVerified: true,
      accountStatus: "active",
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: `ui-lh-mgr-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      accountStatus: "active",
      business: {
        create: {
          name: `UI LH Biz ${tag}`,
          slug: `ui-lh-${tag}`,
          verificationStatus: "verified",
        },
      },
    },
    include: { business: true },
  });
  const businessId = manager.business!.id;
  await prisma.employee.create({
    data: {
      name: `UI LH Manager ${tag}`,
      jobTitle: "Manager",
      businessId,
      userId: manager.id,
      isActive: true,
    },
  });

  try {
    try {
      await setUserLegalHold({
        userId: manager.id,
        actorUserId: manager.id,
        reason: "unauthorized",
        categories: ["audit"],
      });
      fail("unauthorized manager must not set user hold");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "FORBIDDEN") {
        pass("unauthorized user cannot set legal hold");
      } else fail(`unexpected unauthorized error: ${e}`);
    }

    try {
      await searchLegalHoldSubjects({
        actorUserId: manager.id,
        subjectType: "business",
        q: "UI LH",
      });
      fail("unauthorized manager must not search subjects");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "FORBIDDEN") {
        pass("unauthorized user cannot search legal-hold subjects");
      } else fail(`unexpected search unauthorized error: ${e}`);
    }

    try {
      await setUserLegalHold({
        userId: manager.id,
        actorUserId: admin.id,
        reason: "  ",
        categories: ["audit"],
      });
      fail("empty reason must be rejected");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "VALIDATION") {
        pass("required reason enforced");
      } else fail(`reason validation unexpected: ${e}`);
    }

    try {
      await setBusinessLegalHold({
        businessId,
        actorUserId: admin.id,
        reason: "missing cats",
        categories: [],
      });
      fail("empty categories must be rejected");
    } catch (e) {
      if (e instanceof LegalHoldError && e.code === "VALIDATION") {
        pass("required categories enforced");
      } else fail(`categories validation unexpected: ${e}`);
    }

    const bizHits = await searchLegalHoldSubjects({
      actorUserId: admin.id,
      subjectType: "business",
      q: `UI LH Biz ${tag}`,
    });
    if (bizHits.some((h) => h.id === businessId && h.label.includes("UI LH Biz"))) {
      pass("platform admin can search business by name");
    } else fail(`business search missed subject: ${JSON.stringify(bizHits)}`);

    const userHits = await searchLegalHoldSubjects({
      actorUserId: admin.id,
      subjectType: "user",
      q: manager.email,
    });
    if (userHits.some((h) => h.id === manager.id)) {
      pass("platform admin can search user by email");
    } else fail(`user email search missed subject: ${JSON.stringify(userHits)}`);

    const nameHits = await searchLegalHoldSubjects({
      actorUserId: admin.id,
      subjectType: "user",
      q: `UI LH Manager ${tag}`,
    });
    if (nameHits.some((h) => h.id === manager.id)) {
      pass("platform admin can search user by name");
    } else fail(`user name search missed subject: ${JSON.stringify(nameHits)}`);

    const setBiz = await setBusinessLegalHold({
      businessId,
      actorUserId: admin.id,
      reason: "UI contract hold",
      categories: ["kyc", "financial"],
    });
    if (
      setBiz.legalHold &&
      setBiz.legalHoldReason === "UI contract hold" &&
      setBiz.legalHoldCategories.includes("kyc") &&
      setBiz.legalHoldSetByUserId === admin.id &&
      setBiz.legalHoldSetAt
    ) {
      pass("authorized admin can place business hold with reason/categories/setBy/setAt");
    } else fail(`set business hold unexpected: ${JSON.stringify(setBiz)}`);

    const cleared = await clearBusinessLegalHold({
      businessId,
      actorUserId: admin.id,
    });
    if (!cleared.legalHold && cleared.legalHoldCategories.length === 0) {
      pass("authorized admin can clear business hold");
    } else fail("clear business hold failed");

    const setUser = await setUserLegalHold({
      userId: manager.id,
      actorUserId: admin.id,
      reason: "user hold",
      categories: ["profile"],
    });
    if (setUser.legalHold && setUser.legalHoldSetByUserId === admin.id) {
      pass("authorized admin can place user hold");
    } else fail("set user hold failed");
    await clearUserLegalHold({ userId: manager.id, actorUserId: admin.id });
    pass("authorized admin can clear user hold");
  } finally {
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [admin.id, manager.id] } },
    });
    await prisma.employee.deleteMany({ where: { userId: manager.id } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, manager.id] } } });
  }

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  if (failed.length) {
    console.error(`\n${failed.length} failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} platform legal-hold UI checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
