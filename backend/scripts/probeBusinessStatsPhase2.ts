/**
 * Cold/warm probe for GET business week summary after Phase 2 SQL changes.
 * Usage: npx dotenv -e ../.env -e .env -- npx tsx scripts/probeBusinessStatsPhase2.ts [businessId]
 */
import "../src/loadEnv.js";
import { getBusinessStats, invalidateBusinessStatsCache } from "../src/services/business.service.js";
import { prisma } from "../src/prisma.js";
import { invalidateCacheKeyPrefix } from "../src/utils/shortLivedCache.js";

async function main() {
  let businessId = process.argv[2] || process.env.PROBE_BUSINESS_ID || "";
  if (!businessId) {
    const demo = await prisma.user.findUnique({
      where: { email: "demo@caretip.de" },
      select: { business: { select: { id: true } } },
    });
    businessId = demo?.business?.id || "cmpy3xoc90003u7o0eqdf55c6";
  }

  const runs: Array<{ label: string; ms: number; totalTips: number; tipCount: number }> = [];

  async function run(label: string) {
    const t0 = performance.now();
    const stats = await getBusinessStats(businessId, "week", "summary");
    const ms = Math.round(performance.now() - t0);
    runs.push({
      label,
      ms,
      totalTips: Number((stats as { totalTips?: number }).totalTips ?? 0),
      tipCount: Number((stats as { tipCount?: number }).tipCount ?? 0),
    });
    console.log(`[probe] ${label} week summary ${ms}ms`, {
      totalTips: runs[runs.length - 1].totalTips,
      tipCount: runs[runs.length - 1].tipCount,
    });
  }

  invalidateBusinessStatsCache(businessId);
  await run("cold_combined");

  await run("response_cache_hit");

  invalidateCacheKeyPrefix(`biz-dash-summary:${businessId}:`);
  invalidateCacheKeyPrefix(`business-stats-summary:${businessId}:`);
  await run("context_warm_summary_cold");

  console.log(JSON.stringify({ businessId, runs }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
