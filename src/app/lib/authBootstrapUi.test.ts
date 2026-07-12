import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { shouldShowAuthBootstrapShell } from "./authBootstrapUi";

vi.mock("./authTransitionIntent", () => ({
  isIntentionalUserLogout: vi.fn(() => false),
}));

vi.mock("./authSessionHint", () => ({
  hasClientSessionHint: vi.fn(() => false),
}));

vi.mock("./authUserStore", () => ({
  hasClientStoredSession: vi.fn(() => false),
}));

import { isIntentionalUserLogout } from "./authTransitionIntent";

describe("shouldShowAuthBootstrapShell", () => {
  beforeEach(() => {
    vi.mocked(isIntentionalUserLogout).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows shell while post-login / continue transition is pending", () => {
    expect(
      shouldShowAuthBootstrapShell({
        authStatus: "authenticated",
        authTransitionPending: true,
      }),
    ).toBe(true);
  });

  it("does not hide shell for post-login when logout is not intentional", () => {
    vi.mocked(isIntentionalUserLogout).mockReturnValue(false);
    expect(
      shouldShowAuthBootstrapShell({
        authStatus: "authenticated",
        authTransitionPending: true,
      }),
    ).toBe(true);
  });

  it("hides shell during intentional logout so Sign In can appear", () => {
    vi.mocked(isIntentionalUserLogout).mockReturnValue(true);
    expect(
      shouldShowAuthBootstrapShell({
        authStatus: "unauthenticated",
        authTransitionPending: false,
      }),
    ).toBe(false);
  });

  it("shows shell while auth is initializing with a stored session path", () => {
    expect(
      shouldShowAuthBootstrapShell({
        authStatus: "initializing",
        authTransitionPending: false,
      }),
    ).toBe(true);
  });

  it("prioritizes transition pending over intentional logout", () => {
    // Continue was clicked; never flash login chrome even if logout flags race.
    vi.mocked(isIntentionalUserLogout).mockReturnValue(true);
    expect(
      shouldShowAuthBootstrapShell({
        authStatus: "authenticated",
        authTransitionPending: true,
      }),
    ).toBe(true);
  });
});
