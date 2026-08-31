/**
 * N+1 query regression — structural checks on remediated function bodies.
 * Run: npm run test:n1-query (from backend/)
 *
 * Checks target anti-patterns inside named functions (whitespace-normalized),
 * not fragile exact source strings beyond API identifiers.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function src(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/** Collapse whitespace so formatting refactors do not break checks. */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract a top-level async/function body by name until the next export
 * at column 0, or EOF. Good enough for CareTip service modules.
 */
function extractFn(file: string, fnName: string): string {
  const re = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\(`,
  );
  const m = re.exec(file);
  if (!m || m.index == null) return "";
  const from = m.index;
  const rest = file.slice(from);
  const nextExport = rest.search(/\nexport\s+(?:async\s+)?(?:function|type|const|class|\{)/);
  return nextExport > 0 ? rest.slice(0, nextExport) : rest;
}

function hasBatchIn(hayNorm: string, fieldHint: string): boolean {
  // e.g. stripeBalanceTransactionId: { in: ... } or id: { in: ... }
  return new RegExp(`${fieldHint}\\s*:\\s*\\{\\s*in\\s*:`).test(hayNorm) ||
    hayNorm.includes(`${fieldHint}: { in:`) ||
    hayNorm.includes(`{ in:`);
}

function prismaCallInForLoop(hay: string, call: string): boolean {
  // for (...) { ... prisma.<model>.call  OR await prisma...call inside loop body
  const n = norm(hay);
  const forIdx = n.search(/\bfor\s*\(/);
  if (forIdx < 0) return false;
  const afterFor = n.slice(forIdx);
  return afterFor.includes(call);
}

function main() {
  // --- F-01 persistBalanceLines ---
  {
    const file = src("src/services/stripeConnectPayoutReconciliation.service.ts");
    const body = extractFn(file, "persistBalanceLines");
    const n = norm(body);
    if (!body) fail("F-01: persistBalanceLines not found");
    else {
      if (n.includes("createMany") && hasBatchIn(n, "stripeBalanceTransactionId")) {
        pass("F-01: prefetch IN + createMany present");
      } else {
        fail("F-01: missing IN prefetch or createMany");
      }
      // Anti-pattern: findUnique inside a for-over-lines path
      if (/for\s*\(\s*const\s+bt\s+of\s+lines[\s\S]*?findUnique/.test(body)) {
        fail("F-01: findUnique still inside for (const bt of lines)");
      } else if (n.includes("findUnique") && prismaCallInForLoop(body, "findUnique")) {
        // findUnique only acceptable outside the lines loop; reject if after any for(
        fail("F-01: findUnique appears after a for-loop (likely per-row)");
      } else {
        pass("F-01: no per-line findUnique on lines[]");
      }
      if (/\.upsert\s*\(/.test(body) && /for\s*\([\s\S]*?\.upsert\s*\(/.test(body)) {
        fail("F-01: per-row upsert loop reintroduced");
      } else {
        pass("F-01: no per-row upsert loop");
      }
    }
  }

  // --- F-02 runNotifyCleanup ---
  {
    const file = src("src/services/categoryRetention.runners.ts");
    const body = extractFn(file, "runNotifyCleanup");
    const n = norm(body);
    if (!body) fail("F-02: runNotifyCleanup not found");
    else {
      if (n.includes("deleteMany") && n.includes("user.findMany") && hasBatchIn(n, "id")) {
        pass("F-02: batch user load + deleteMany");
      } else {
        fail("F-02: missing user.findMany IN and/or deleteMany");
      }
      if (/for\s*\(\s*const\s+n\s+of\s+candidates[\s\S]*?user\.findUnique/.test(body)) {
        fail("F-02: per-candidate user.findUnique reintroduced");
      } else {
        pass("F-02: no per-candidate user.findUnique");
      }
      if (/for\s*\(\s*const\s+n\s+of\s+candidates[\s\S]*?notification\.delete\s*\(/.test(body)) {
        fail("F-02: per-candidate notification.delete reintroduced");
      } else {
        pass("F-02: no per-candidate notification.delete");
      }
    }
  }

  // --- F-03 runGuestScrub ---
  {
    const file = src("src/services/categoryRetention.runners.ts");
    const body = extractFn(file, "runGuestScrub");
    const n = norm(body);
    if (!body) fail("F-03: runGuestScrub not found");
    else {
      if (n.includes("businessHoldDecisionsBatch") && n.includes("tipFeedback.updateMany")) {
        pass("F-03: hold batch + tipFeedback.updateMany");
      } else {
        fail("F-03: missing hold batch or updateMany");
      }
      if (/for\s*\([\s\S]*?businessHoldDecision\s*\(/.test(body) && !n.includes("businessHoldDecisionsBatch")) {
        fail("F-03: per-row businessHoldDecision without batch helper");
      } else if (/for\s*\([\s\S]*?await\s+prisma\.tipFeedback\.update\s*\(/.test(body)) {
        fail("F-03: per-row tipFeedback.update reintroduced");
      } else {
        pass("F-03: no per-row hold/update Prisma in loop");
      }
    }
  }

  // --- F-04 runAnalyticsTtl ---
  {
    const file = src("src/services/categoryRetention.runners.ts");
    const body = extractFn(file, "runAnalyticsTtl");
    const n = norm(body);
    if (!body) fail("F-04: runAnalyticsTtl not found");
    else {
      const hasBatches =
        n.includes("businessHoldDecisionsBatch") &&
        n.includes("qrScanEvent.updateMany") &&
        n.includes("qrGuestVisit.updateMany") &&
        n.includes("qrFunnelEvent.updateMany");
      if (hasBatches) pass("F-04: hold batch + three updateMany paths");
      else fail("F-04: missing hold batch or updateMany for scans/visits/funnels");
      if (/for\s*\([\s\S]*?await\s+prisma\.qrScanEvent\.update\s*\(/.test(body)) {
        fail("F-04: per-row qrScanEvent.update reintroduced");
      } else {
        pass("F-04: no per-row qrScanEvent.update");
      }
    }
  }

  // --- F-05 evaluateSetupPrompts ---
  {
    const file = src("src/services/notifications/notificationIntelligence.service.ts");
    const body = extractFn(file, "evaluateSetupPrompts");
    const n = norm(body);
    if (!body) fail("F-05: evaluateSetupPrompts not found");
    else {
      if (n.includes("setupNotificationState.findMany") && hasBatchIn(n, "notificationKey")) {
        pass("F-05: findMany by notificationKey IN");
      } else {
        fail("F-05: missing findMany with notificationKey IN");
      }
      if (n.includes("setupNotificationState.findUnique")) {
        fail("F-05: findUnique still inside evaluateSetupPrompts");
      } else {
        pass("F-05: no findUnique in evaluateSetupPrompts");
      }
    }
  }

  // --- F-06 evaluateAndProjectGoalAchievements ---
  {
    const file = src("src/services/activity/goalActivity.projection.ts");
    const body = extractFn(file, "evaluateAndProjectGoalAchievements");
    const n = norm(body);
    if (!body) fail("F-06: evaluateAndProjectGoalAchievements not found");
    else {
      if (n.includes("transaction.findMany") && n.includes("businessId")) {
        pass("F-06: single tip findMany with businessId tenant filter");
      } else {
        fail("F-06: missing batched tip findMany and/or businessId filter");
      }
      if (n.includes("transaction.aggregate") || n.includes(".aggregate({")) {
        fail("F-06: aggregate still present (per-goal risk)");
      } else {
        pass("F-06: no transaction.aggregate");
      }
    }
  }

  // --- F-07 recordFeatureUtilizationBatch ---
  {
    const file = src("src/services/commercial/businessFeatureUtilization.service.ts");
    const body = extractFn(file, "recordFeatureUtilizationBatch");
    const n = norm(body);
    if (!body) fail("F-07: recordFeatureUtilizationBatch not found");
    else {
      if (n.includes("createMany") && n.includes("findMany") && hasBatchIn(n, "featureKey")) {
        pass("F-07: prefetch + createMany batch path");
      } else {
        fail("F-07: missing prefetch/createMany pattern");
      }
      if (/Promise\.all\s*\(\s*\w+\.map\s*\(\s*\(?\w+\)?\s*=>\s*recordFeatureUtilization/.test(body)) {
        fail("F-07: Promise.all(recordFeatureUtilization) fan-out reintroduced");
      } else {
        pass("F-07: no Promise.all upsert fan-out");
      }
    }
  }

  // --- F-08 hard-delete staff ---
  {
    const file = src("src/services/business.service.ts");
    const marker = "staffUserIds";
    const delIdx = file.search(/user\.deleteMany\s*\(\s*\{\s*where\s*:\s*\{\s*id\s*:\s*\{\s*in\s*:\s*staffUserIds/);
    const loopIdx = file.search(/for\s*\(\s*const\s+uid\s+of\s+staffUserIds/);
    const guardWindow = (() => {
      const idx = file.indexOf(marker);
      return idx >= 0 ? file.slice(Math.max(0, idx - 400), idx + 1200) : "";
    })();
    const n = norm(guardWindow);
    if (delIdx >= 0) {
      pass("F-08: user.deleteMany with id IN staffUserIds");
    } else {
      fail("F-08: missing user.deleteMany({ id: { in: staffUserIds }})");
    }
    if (loopIdx >= 0 && /user\.delete\s*\(/.test(file.slice(loopIdx, loopIdx + 200))) {
      fail("F-08: per-uid user.delete loop reintroduced");
    } else {
      pass("F-08: no per-uid user.delete loop");
    }
    if (n.includes("isPlatformAdmin") && n.includes("EMPLOYEE")) {
      pass("F-08: platform-admin / EMPLOYEE role guards still present");
    } else {
      fail("F-08: authz guards missing near staff delete");
    }
  }

  // Guard: goal.service batch helper still exists (already optimized path)
  {
    const goalSvc = src("src/services/goal.service.ts");
    if (norm(goalSvc).includes("batchTipTotalsForGoalRows")) {
      pass("S-03: batchTipTotalsForGoalRows still present");
    } else {
      fail("S-03: batchTipTotalsForGoalRows missing");
    }
  }

  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(failed.length === 0 ? "OVERALL: PASS" : "OVERALL: FAIL");
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
