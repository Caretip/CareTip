/**
 * Runtime lock: mobile money/count/percent display matches web German/EUR convention.
 * Run: npx tsx scripts/number-format-runtime.ts
 */
import assert from "node:assert/strict";
import {
  formatCount,
  formatEur,
  formatEurCompact,
  formatGrowthPercent,
  formatPercent,
} from "../utils/format";

const cases: Array<[number, string]> = [
  [0, "€0,00"],
  [5, "€5,00"],
  [115, "€115,00"],
  [115.5, "€115,50"],
  [999.99, "€999,99"],
  [1000, "€1.000,00"],
  [1250.5, "€1.250,50"],
  [10000, "€10.000,00"],
  [1_000_000, "€1.000.000,00"],
  [-115, "€-115,00"],
  [-1250.5, "€-1.250,50"],
];

for (const [amount, expected] of cases) {
  assert.equal(formatEur(amount), expected, `formatEur(${amount})`);
}

assert.equal(formatEur(null), "€0,00");
assert.equal(formatEur(undefined), "€0,00");
assert.equal(formatEur(Number.NaN), "€0,00");

assert.equal(formatEurCompact(1240), "€1.240");
assert.equal(formatEurCompact(1240.5), "€1.240,50");

assert.equal(formatCount(7), "7");
assert.equal(formatCount(1240), "1.240");
assert.equal(formatCount(1_000_000), "1.000.000");

assert.equal(formatPercent(84), "84,0%");
assert.equal(formatPercent(-84), "-84,0%");
assert.equal(formatGrowthPercent(12.5), "+12,5%");
assert.equal(formatGrowthPercent(-84), "-84,0%");
assert.equal(formatGrowthPercent(0), "0,0%");

// Cents → euros is call-site conversion only; formatter receives major units.
assert.equal(formatEur(11500 / 100), "€115,00");

console.log("number-format-runtime: ok");
