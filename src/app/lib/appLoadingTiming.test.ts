import { describe, expect, it } from "vitest";
import { shouldBypassOverlayShowThreshold } from "./appLoadingTiming";

describe("shouldBypassOverlayShowThreshold", () => {
  it("bypasses for cold app-boot handoff", () => {
    expect(shouldBypassOverlayShowThreshold("app-boot", true)).toBe(true);
  });

  it("does not bypass routine keys during cold boot", () => {
    expect(shouldBypassOverlayShowThreshold("some-page-loader", true)).toBe(false);
  });

  it("bypasses immediately for post-login transition", () => {
    expect(shouldBypassOverlayShowThreshold("auth-post-login-transition", false)).toBe(true);
  });

  it("bypasses immediately for logout transition", () => {
    expect(shouldBypassOverlayShowThreshold("auth-logout-transition", false)).toBe(true);
  });
});
