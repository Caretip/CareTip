/**
 * Product feedback modal — composer must never preload historical GET /me data.
 * Run: npm run test:product-feedback-composer
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  emptyProductFeedbackComposerState,
  resetProductFeedbackComposerState,
} from "../src/app/components/product-feedback/productFeedbackComposerState.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modalSrc = readFileSync(
  join(root, "src/app/components/product-feedback/ProductFeedbackModalContent.tsx"),
  "utf8",
);

assert.equal(emptyProductFeedbackComposerState().rating, 0);
assert.equal(emptyProductFeedbackComposerState().comment, "");
assert.equal(emptyProductFeedbackComposerState().submitting, false);
assert.equal(emptyProductFeedbackComposerState().showSuccess, false);

const dirty = {
  rating: 4,
  comment: "old",
  submitting: true,
  showSuccess: true,
};
const reset = resetProductFeedbackComposerState(dirty);
assert.deepEqual(reset, emptyProductFeedbackComposerState());

assert.ok(!modalSrc.includes("fetchMyProductReview"), "modal must not fetch GET /me");
assert.ok(!modalSrc.includes("productReview.latest"), "modal must not show latest-feedback UI");
assert.ok(!modalSrc.includes("Update feedback"), "modal must not offer update copy");

assert.ok(modalSrc.includes("emptyProductFeedbackComposerState"), "modal uses composer-only state");

console.log("product-feedback-composer: OK");
