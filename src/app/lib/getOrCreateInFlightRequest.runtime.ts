/**
 * Request coalescing utility — behavioral regression tests.
 * Run: npm run test:request-coalescing-cache-lock
 */
import assert from "node:assert/strict";
import {
  clearInFlightRequest,
  getOrCreateInFlightRequest,
} from "./getOrCreateInFlightRequest";

let ok = true;
const pass = (msg: string) => console.log(`PASS: ${msg}`);
const fail = (msg: string) => {
  console.error(`FAIL: ${msg}`);
  ok = false;
};

clearInFlightRequest();

let runs = 0;
const shared = getOrCreateInFlightRequest("a", async () => {
  runs += 1;
  await new Promise((r) => setTimeout(r, 5));
  return "ok";
});
const shared2 = getOrCreateInFlightRequest("a", async () => {
  runs += 1;
  return "dup";
});
const [r1, r2] = await Promise.all([shared, shared2]);
if (runs === 1 && r1 === "ok" && r2 === "ok") {
  pass("identical concurrent keys share one factory execution");
} else {
  fail(`expected one run, got runs=${runs} r1=${r1} r2=${r2}`);
}

let runsB = 0;
await getOrCreateInFlightRequest("b", async () => {
  runsB += 1;
  throw new Error("nope");
}).catch(() => undefined);
await getOrCreateInFlightRequest("b", async () => {
  runsB += 1;
  return 1;
});
if (runsB === 2) {
  pass("rejection clears in-flight entry so the next call retries");
} else {
  fail(`expected retry after rejection, runsB=${runsB}`);
}

let runsTenant = 0;
await Promise.all([
  getOrCreateInFlightRequest("tenant:A", async () => {
    runsTenant += 1;
    return "A";
  }),
  getOrCreateInFlightRequest("tenant:B", async () => {
    runsTenant += 1;
    return "B";
  }),
]);
if (runsTenant === 2) {
  pass("different keys never share work");
} else {
  fail(`tenant keys must be independent, runsTenant=${runsTenant}`);
}

clearInFlightRequest();
assert.equal(ok, true);
console.log("\ngetOrCreateInFlightRequest behavioral checks passed.");
