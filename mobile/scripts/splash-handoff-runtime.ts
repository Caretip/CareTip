/**
 * Splash handoff regression — blocked boot sources, reveal rules, watchdog force.
 *
 *   npm run test:splash
 *   npx tsx scripts/splash-handoff-runtime.ts
 */
import assert from "node:assert/strict";
import {
  canMarkFirstScreenReady,
  shouldForceRevealOnWatchdog,
  shouldRevealAfterDestination,
  shouldRevealAfterFallback,
} from "../utils/splashHandoffPolicy";

function run() {
  // Index / boot stubs must never unlock the splash.
  assert.equal(canMarkFirstScreenReady("index"), false);
  assert.equal(canMarkFirstScreenReady("boot"), false);
  assert.equal(canMarkFirstScreenReady("index-boot"), false);
  assert.equal(canMarkFirstScreenReady("Index"), false);

  // Real destinations may unlock.
  assert.equal(canMarkFirstScreenReady("auth"), true);
  assert.equal(canMarkFirstScreenReady("LayeredScreen"), true);
  assert.equal(canMarkFirstScreenReady("Screen"), true);

  // No premature reveal before bootstrap / destination.
  assert.equal(
    shouldRevealAfterDestination({
      bootstrapReady: false,
      navigationReady: true,
      firstScreenReady: true,
    }),
    false,
  );
  assert.equal(
    shouldRevealAfterDestination({
      bootstrapReady: true,
      navigationReady: true,
      firstScreenReady: false,
    }),
    false,
  );
  assert.equal(
    shouldRevealAfterDestination({
      bootstrapReady: true,
      navigationReady: true,
      firstScreenReady: true,
    }),
    true,
  );

  // Fallback still requires bootstrap + nav (no dashboard before session settle).
  assert.equal(
    shouldRevealAfterFallback({ bootstrapReady: false, navigationReady: true }),
    false,
  );
  assert.equal(
    shouldRevealAfterFallback({ bootstrapReady: true, navigationReady: true }),
    true,
  );

  // Watchdog must force React overlay release.
  assert.equal(shouldForceRevealOnWatchdog(false), false);
  assert.equal(shouldForceRevealOnWatchdog(true), true);

  console.log("splash-handoff-runtime: OK");
}

run();
