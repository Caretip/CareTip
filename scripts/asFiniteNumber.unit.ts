import { asFiniteNumber } from "../mobile/types/employee.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(asFiniteNumber(12.5) === 12.5, "number");
assert(asFiniteNumber("12.50") === 12.5, "numeric string");
assert(asFiniteNumber(undefined) === undefined, "undefined");
assert(asFiniteNumber("nope") === undefined, "garbage");
assert(asFiniteNumber(NaN) === undefined, "nan");

console.log("asFiniteNumber.unit.ts: ok");
