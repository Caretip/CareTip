/**
 * Regression: screen-scoped payout/notification queries must not trip global offline banner.
 *
 *   npm run test:payout-global-error
 */
import assert from "node:assert/strict";
import { withSuppressGlobalApiError } from "../utils/apiClientConfig";

assert.equal(withSuppressGlobalApiError().__caretipSuppressGlobalError, true);
assert.equal(
  withSuppressGlobalApiError({ params: { take: 50 } }).__caretipSuppressGlobalError,
  true,
);
assert.equal(withSuppressGlobalApiError({ params: { take: 50 } }).params?.take, 50);

console.log("payout-global-error-runtime: OK");
