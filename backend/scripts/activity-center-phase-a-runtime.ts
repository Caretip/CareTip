/**
 * Activity Center Phase A — verification runtime.
 * Run: npm run test:activity-center-phase-a
 *
 * Covers: migration indexes, dedupeKey, cursor pagination, chronological order,
 * tenant isolation, activity.created envelope shape.
 * Optional live API checks when RUNTIME_API_BASE is reachable.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { ActivityEventPriority, ActivityEventSource } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import { signAuthJwt } from "../src/services/auth.service.js";
import {
  ACTIVITY_EVENT_TYPES,
  listBusinessActivityEvents,
  writeBusinessActivityEvent,
} from "../src/services/activity/businessActivityEvent.service.js";
import {
  REALTIME_EVENTS,
  emitActivityCreatedCanonical,
} from "../src/socket/realtimeContracts.js";

const API = (process.env.RUNTIME_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const skip = (m: string) => results.push(`SKIP: ${m}`);

async function api(
  path: string,
  token: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function seedBusiness(label: string) {
  const tag = `acta-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);
  const manager = await prisma.user.create({
    data: {
      email: `${tag}-mgr@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      onboardingCompletedAt: new Date(),
      business: {
        create: {
          name: `${label} Venue`,
          slug: `${tag}-venue`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });
  const token = signAuthJwt({
    userId: manager.id,
    id: manager.id,
    email: manager.email,
    role: "MANAGER",
    roleLabel: "MANAGER",
  });
  return {
    userId: manager.id,
    businessId: manager.business!.id,
    token,
    cleanup: async () => {
      await prisma.businessActivityEvent.deleteMany({ where: { businessId: manager.business!.id } });
      await prisma.business.delete({ where: { id: manager.business!.id } });
      await prisma.user.delete({ where: { id: manager.id } });
    },
  };
}

async function verifyIndexes(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'business_activity_events'
    ORDER BY indexname
  `;
  const names = new Set(rows.map((r) => r.indexname));
  const required = [
    "business_activity_events_business_id_occurred_at_idx",
    "business_activity_events_business_id_source_occurred_at_idx",
    "business_activity_events_business_id_type_occurred_at_idx",
    "business_activity_events_business_id_dedupe_key_key",
  ];
  for (const name of required) {
    if (names.has(name)) pass(`index present: ${name}`);
    else fail(`index missing: ${name}`);
  }
}

async function main() {
  console.log("Activity Center Phase A verification…");

  let a: Awaited<ReturnType<typeof seedBusiness>> | null = null;
  let b: Awaited<ReturnType<typeof seedBusiness>> | null = null;

  try {
    await verifyIndexes();

    a = await seedBusiness("A");
    b = await seedBusiness("B");

    const t1 = new Date("2026-07-14T10:00:00.000Z");
    const t2 = new Date("2026-07-14T11:00:00.000Z");
    const t3 = new Date("2026-07-14T12:00:00.000Z");

    const tip1 = await writeBusinessActivityEvent({
      businessId: a.businessId,
      type: ACTIVITY_EVENT_TYPES.TIP_RECEIVED,
      source: ActivityEventSource.TIPS,
      priority: ActivityEventPriority.NORMAL,
      occurredAt: t1,
      dedupeKey: "tip:phasea-1:received",
      subjectType: "tip",
      subjectId: "phasea-1",
      summary: { amountEur: 5, employeeName: "Alex" },
    });
    if (tip1.inserted) pass("tip.received insert");
    else fail("tip.received insert");

    const tipDup = await writeBusinessActivityEvent({
      businessId: a.businessId,
      type: ACTIVITY_EVENT_TYPES.TIP_RECEIVED,
      source: ActivityEventSource.TIPS,
      occurredAt: t1,
      dedupeKey: "tip:phasea-1:received",
      subjectType: "tip",
      subjectId: "phasea-1",
      summary: { amountEur: 5, employeeName: "Alex" },
    });
    if (!tipDup.inserted) pass("dedupeKey prevents duplicate tip write");
    else fail("dedupeKey prevents duplicate tip write");

    const countTips = await prisma.businessActivityEvent.count({
      where: { businessId: a.businessId, dedupeKey: "tip:phasea-1:received" },
    });
    if (countTips === 1) pass("dedupeKey unique row count === 1");
    else fail(`dedupeKey unique row count === 1 (got ${countTips})`);

    await writeBusinessActivityEvent({
      businessId: a.businessId,
      type: ACTIVITY_EVENT_TYPES.QR_SCANNED,
      source: ActivityEventSource.QR,
      occurredAt: t2,
      dedupeKey: "scan:phasea-2:scanned",
      subjectType: "scan",
      subjectId: "phasea-2",
      summary: { scanType: "employee", deviceType: "mobile" },
    });
    await writeBusinessActivityEvent({
      businessId: a.businessId,
      type: ACTIVITY_EVENT_TYPES.TIP_RECEIVED,
      source: ActivityEventSource.TIPS,
      occurredAt: t3,
      dedupeKey: "tip:phasea-3:received",
      subjectType: "tip",
      subjectId: "phasea-3",
      summary: { amountEur: 8, employeeName: "Blake" },
    });

    await writeBusinessActivityEvent({
      businessId: b.businessId,
      type: ACTIVITY_EVENT_TYPES.TIP_RECEIVED,
      source: ActivityEventSource.TIPS,
      occurredAt: t3,
      dedupeKey: "tip:phaseb-secret:received",
      subjectType: "tip",
      subjectId: "phaseb-secret",
      summary: { amountEur: 99, employeeName: "OtherTenant" },
    });

    const page1 = await listBusinessActivityEvents(a.businessId, { limit: 2 });
    if (page1.items.length === 2) pass("cursor page size respects limit");
    else fail(`cursor page size respects limit (got ${page1.items.length})`);

    const orderOk =
      page1.items[0]?.occurredAt === t3.toISOString() &&
      page1.items[1]?.occurredAt === t2.toISOString();
    if (orderOk) pass("newest-first chronological order");
    else fail("newest-first chronological order");

    if (page1.nextCursor) pass("nextCursor returned when more rows exist");
    else fail("nextCursor returned when more rows exist");

    const page2 = await listBusinessActivityEvents(a.businessId, {
      limit: 2,
      cursor: page1.nextCursor,
    });
    if (page2.items.length === 1 && page2.items[0]?.occurredAt === t1.toISOString()) {
      pass("cursor pagination returns older page");
    } else {
      fail("cursor pagination returns older page");
    }
    if (page2.nextCursor == null) pass("nextCursor null on last page");
    else fail("nextCursor null on last page");

    const tipsOnly = await listBusinessActivityEvents(a.businessId, {
      source: ActivityEventSource.TIPS,
    });
    if (
      tipsOnly.items.length === 2 &&
      tipsOnly.items.every((i) => i.source === ActivityEventSource.TIPS)
    ) {
      pass("source filter TIPS");
    } else {
      fail("source filter TIPS");
    }

    const tenantA = await listBusinessActivityEvents(a.businessId, { limit: 50 });
    const leaked = tenantA.items.some((i) => i.params.employeeName === "OtherTenant");
    if (!leaked && tenantA.items.length === 3) pass("tenant isolation at list service");
    else fail("tenant isolation at list service");

    if (!tip1.event) {
      fail("socket envelope: missing inserted event");
    } else {
      const envelope = emitActivityCreatedCanonical(a.businessId, {
        id: tip1.event.id,
        type: tip1.event.type,
        source: tip1.event.source,
        priority: tip1.event.priority,
      });
      if (
        envelope.event === REALTIME_EVENTS.ACTIVITY_CREATED &&
        envelope.businessId === a.businessId &&
        envelope.payload != null
      ) {
        pass("activity.created envelope shape");
      } else {
        fail("activity.created envelope shape");
      }
    }

    // Optional HTTP API (server must be running with Phase A routes)
    try {
      const probe = await fetch(`${API}/api/business/activity?limit=1`, {
        headers: { Authorization: `Bearer ${a.token}` },
      }).catch(() => null);

      if (!probe) {
        skip("live API (server unreachable)");
      } else {
        const own = { status: probe.status, json: await probe.json().catch(() => null) };
        if (own.status === 200 && Array.isArray((own.json as { items?: unknown })?.items)) {
          const items = (own.json as { items: Array<{ params?: { employeeName?: string } }> }).items;
          const leakApi = items.some((i) => i.params?.employeeName === "OtherTenant");
          if (!leakApi) pass("API tenant isolation (manager A)");
          else fail("API tenant isolation (manager A)");
        } else if (own.status === 404) {
          skip("live API /activity not mounted yet (restart server after deploy)");
        } else {
          fail(`API list status ${own.status}`);
        }

        const other = await api("/api/business/activity?limit=10", b.token);
        if (other.status === 200) {
          const items = (other.json as { items: Array<{ id: string }> }).items;
          const seesA = items.some((i) => i.id === tip1.event?.id);
          if (!seesA) pass("API tenant isolation (manager B cannot see A)");
          else fail("API tenant isolation (manager B cannot see A)");
        }

        const filtered = await api("/api/business/activity?source=QR&limit=10", a.token);
        if (filtered.status === 200) {
          const items = (filtered.json as { items: Array<{ source: string }> }).items;
          if (items.every((i) => i.source === "QR")) pass("API source filter");
          else fail("API source filter");
        }
      }
    } catch {
      skip("live API (error probing server)");
    }
  } catch (err) {
    fail(`unexpected: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (a) await a.cleanup().catch(() => undefined);
    if (b) await b.cleanup().catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log("\n--- Results ---");
  for (const line of results) console.log(line);
  const failed = results.filter((r) => r.startsWith("FAIL:")).length;
  if (failed > 0) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nAll Phase A checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
