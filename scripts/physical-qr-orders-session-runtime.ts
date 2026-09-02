/**
 * My Orders session cache: business-scoped list/detail, logout wipe.
 * Run: npm run test:physical-qr-orders-session
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PhysicalQrCustomerOrder } from "../src/app/lib/api";
import {
  clearPhysicalQrOrdersSessionCache,
  physicalQrOrderDetailCacheKey,
  physicalQrOrdersCacheKey,
  readPhysicalQrOrderSnapshot,
  readPhysicalQrOrdersSnapshot,
  upsertPhysicalQrOrderInListSnapshot,
  writePhysicalQrOrderSnapshot,
  writePhysicalQrOrdersSnapshot,
} from "../src/app/lib/physicalQrOrdersSessionCache";
import { resetAllClientSessionCaches } from "../src/app/lib/resetAllClientSessionCaches";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function sampleOrder(businessId: string, orderId: string, name: string): PhysicalQrCustomerOrder {
  return {
    id: orderId,
    productId: "prod",
    productName: name,
    templateId: "caretip-a5",
    supportsAddress: true,
    qrContextType: "storefront",
    qrSubjectId: null,
    quantity: 1,
    itemCount: 1,
    items: [],
    currency: "EUR",
    unitPrice: 0,
    totalAmount: 0,
    placedAt: "2026-09-02T00:00:00.000Z",
    processingClass: "standard",
    processingDeadlineAt: "2026-09-03T00:00:00.000Z",
    processingCopySnapshot: null,
    addressSnapshot: null,
    businessNameSnapshot: businessId,
    paymentStatus: "PAID",
    fulfillmentStatus: "RECEIVED",
    canPay: false,
  } as PhysicalQrCustomerOrder;
}

clearPhysicalQrOrdersSessionCache();

if (physicalQrOrdersCacheKey("biz-a") === "physical-qr-orders:biz-a") {
  pass("Orders list cache key is business-scoped");
} else {
  fail("physicalQrOrdersCacheKey drifted");
}

if (physicalQrOrderDetailCacheKey("biz-a", "ord-1") === "physical-qr-order:biz-a:ord-1") {
  pass("Order detail cache key includes business and order id");
} else {
  fail("physicalQrOrderDetailCacheKey drifted");
}

writePhysicalQrOrdersSnapshot("biz-a", [sampleOrder("biz-a", "ord-1", "Alpha")]);
writePhysicalQrOrdersSnapshot("biz-b", [sampleOrder("biz-b", "ord-9", "Beta")]);

const listA = readPhysicalQrOrdersSnapshot("biz-a");
const listB = readPhysicalQrOrdersSnapshot("biz-b");

if (listA?.orders[0]?.productName === "Alpha" && listB?.orders[0]?.productName === "Beta") {
  pass("Business A and B order lists are isolated");
} else {
  fail("Cross-business order list isolation failed");
}

if (readPhysicalQrOrderSnapshot("biz-a", "ord-1")?.productName === "Alpha") {
  pass("Order detail can be read from the list snapshot");
} else {
  fail("List snapshot did not hydrate order detail");
}

if (readPhysicalQrOrderSnapshot("biz-a", "ord-9") == null) {
  pass("Business A cannot read Business B's order id from the list");
} else {
  fail("Cross-business order id leaked through list snapshot");
}

writePhysicalQrOrderSnapshot("biz-a", sampleOrder("biz-a", "ord-2", "Alpha-2"));
if (
  readPhysicalQrOrderSnapshot("biz-a", "ord-2")?.productName === "Alpha-2" &&
  readPhysicalQrOrdersSnapshot("biz-a")?.orders.some((row) => row.id === "ord-1")
) {
  pass("Writing a detail snapshot does not drop the rest of the cached list");
} else {
  fail("Detail write corrupted the orders list snapshot");
}

upsertPhysicalQrOrderInListSnapshot("biz-c", sampleOrder("biz-c", "ord-new", "New"));
if (readPhysicalQrOrdersSnapshot("biz-c")?.orders[0]?.id === "ord-new") {
  pass("New order is primed into an empty list snapshot");
} else {
  fail("upsertPhysicalQrOrderInListSnapshot did not seed the list");
}

resetAllClientSessionCaches();
if (
  readPhysicalQrOrdersSnapshot("biz-a") == null &&
  readPhysicalQrOrderSnapshot("biz-a", "ord-1") == null
) {
  pass("Logout/session reset clears My Orders snapshots");
} else {
  fail("Session reset left My Orders cache in place");
}

const ordersPage = read("src/app/pages/business/qr-studio/QrStudioOrdersPage.tsx");
if (
  ordersPage.includes("readPhysicalQrOrdersSnapshot") &&
  ordersPage.includes("useState(() => !initial)") &&
  ordersPage.includes("fetchPhysicalQrOrders({ revalidate: true })") &&
  ordersPage.includes("writePhysicalQrOrdersSnapshot")
) {
  pass("My Orders list hydrates from session snapshot then quietly revalidates");
} else {
  fail("QrStudioOrdersPage missing cache-first boot");
}

if (ordersPage.includes("readPhysicalQrOrdersSnapshot(businessId)") && ordersPage.includes("setError")) {
  pass("My Orders keeps cached list when a quiet reload fails");
} else {
  fail("My Orders error handling may wipe cached orders");
}

const detailPage = read("src/app/pages/business/qr-studio/PhysicalQrOrderDetailPage.tsx");
if (
  detailPage.includes("readPhysicalQrOrderSnapshot") &&
  detailPage.includes("fetchPhysicalQrOrder(orderId, { revalidate: true })") &&
  detailPage.includes("writePhysicalQrOrderSnapshot")
) {
  pass("Order detail hydrates from cache and revalidates status");
} else {
  fail("PhysicalQrOrderDetailPage missing cache-first load");
}

if (detailPage.includes('checkoutFlag !== "success"') && detailPage.includes("{ revalidate: true }")) {
  pass("Checkout confirmation polling still revalidates the order from the server");
} else {
  fail("Checkout polling must not reuse a stale unpaid cache indefinitely");
}

const overview = read("src/app/pages/business/qr-studio/QrStudioOverviewPage.tsx");
if (
  overview.includes("readPhysicalQrOrdersSnapshot") &&
  overview.includes("fetchPhysicalQrOrders({ revalidate: true })")
) {
  pass("QR Studio overview My Orders teaser reuses the same session snapshot");
} else {
  fail("Overview still always waits on a cold orders GET");
}

const printStudio = read("src/app/components/business/physical-branding/PrintQrStudio.tsx");
if (
  printStudio.includes("primePhysicalQrOrderClientCache") &&
  printStudio.includes("upsertPhysicalQrOrderInListSnapshot")
) {
  pass("Placing an order primes My Orders so the new order can appear immediately");
} else {
  fail("Print checkout does not seed the orders cache");
}

const reset = read("src/app/lib/resetAllClientSessionCaches.ts");
if (reset.includes("clearPhysicalQrOrdersSessionCache")) {
  pass("resetAllClientSessionCaches wipes My Orders snapshots");
} else {
  fail("Logout missing My Orders cache clear");
}

const cacheMod = read("src/app/lib/physicalQrOrdersSessionCache.ts");
if (!cacheMod.includes("localStorage.setItem") && !cacheMod.includes("window.localStorage")) {
  pass("My Orders session cache does not use localStorage");
} else {
  fail("My Orders cache wrote localStorage");
}

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} physical-qr-orders-session check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} physical-qr-orders-session checks passed`);
