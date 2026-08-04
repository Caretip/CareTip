/**
 * Regression: mobile QR tenant isolation (offline cache / display resolution).
 *
 * Run from repo root:
 *   npx tsx mobile/scripts/offline-qr-tenant-isolation-regression.ts
 */
import assert from "node:assert/strict";
import {
  buildOfflineQrEnvelope,
  employeeQrStorageKey,
  isOfflineQrWriteAllowed,
  offlineQrStorageKey,
  parseEmployeeQrEnvelope,
  parseOfflineQrEnvelope,
  resolveQrStudioDisplayItems,
} from "../utils/offlineQrTenantIsolation";

/** Mirrors brandedQrImageCache.brandedQrStorageKey employee-mode contract (no AsyncStorage). */
function brandedQrEmployeeKey(userId: string): string {
  return `caretip_branded_qr_png_v2:${userId}:employee:employee-me`;
}

function run() {
  const userA = "user-pentest-a";
  const userB = "user-new-manager-b";
  const pentestItems = [
    {
      id: "business-1",
      type: "business" as const,
      title: "Pentest Venue GmbH",
      url: "https://caretip.app/b/pentest-venue",
      slug: "pentest-venue",
    },
  ];
  const newBizItems = [
    {
      id: "business-2",
      type: "business" as const,
      title: "New Hospitality Co",
      url: "https://caretip.app/b/new-hospitality",
      slug: "new-hospitality",
    },
  ];

  // 1) Storage keys are user-scoped and distinct
  assert.notEqual(offlineQrStorageKey(userA), offlineQrStorageKey(userB));
  assert.notEqual(employeeQrStorageKey(userA), employeeQrStorageKey(userB));
  assert.ok(offlineQrStorageKey(userA).includes(userA));
  assert.ok(employeeQrStorageKey(userB).includes(userB));

  // 2) Envelope belonging to A must not hydrate for B
  const envelopeA = JSON.stringify(
    buildOfflineQrEnvelope({ userId: userA, businessId: "biz-a", items: pentestItems }),
  );
  assert.deepEqual(parseOfflineQrEnvelope(envelopeA, userB), []);
  assert.deepEqual(parseOfflineQrEnvelope(envelopeA, userA), pentestItems);

  // 3) Legacy bare array must never hydrate (old unscoped shape)
  assert.deepEqual(parseOfflineQrEnvelope(JSON.stringify(pentestItems), userA), []);

  // 4) Late write after account switch is rejected
  assert.equal(isOfflineQrWriteAllowed(userA, userB), false);
  assert.equal(isOfflineQrWriteAllowed(userA, userA), true);
  assert.equal(isOfflineQrWriteAllowed(userA, null), false);
  assert.equal(isOfflineQrWriteAllowed(null, userA), false);

  // 5) While loading, offline inventory must not paint (the flash bug)
  assert.deepEqual(
    resolveQrStudioDisplayItems({
      liveItems: [],
      offlineItems: pentestItems,
      isLoading: true,
    }),
    [],
  );

  // 6) After load settles with empty live, same-user offline OK
  assert.deepEqual(
    resolveQrStudioDisplayItems({
      liveItems: [],
      offlineItems: newBizItems,
      isLoading: false,
    }),
    newBizItems,
  );

  // 7) Live always wins over offline
  assert.deepEqual(
    resolveQrStudioDisplayItems({
      liveItems: newBizItems,
      offlineItems: pentestItems,
      isLoading: false,
    }),
    newBizItems,
  );

  // 8) Employee envelope cross-user reject
  const empRaw = JSON.stringify({
    userId: userA,
    url: "https://caretip.app/e/pentest",
    name: "Alice",
    businessName: "Pentest Venue GmbH",
    cachedAt: new Date().toISOString(),
  });
  assert.equal(parseEmployeeQrEnvelope(empRaw, userB), null);
  assert.equal(parseEmployeeQrEnvelope(empRaw, userA)?.businessName, "Pentest Venue GmbH");

  // 9) Branded PNG keys include userId (employee-me was previously global)
  assert.notEqual(brandedQrEmployeeKey(userA), brandedQrEmployeeKey(userB));
  assert.ok(brandedQrEmployeeKey(userA).includes(userA));

  console.log("offline-qr-tenant-isolation-regression: PASS");
}

run();
