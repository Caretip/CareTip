import type { Page } from "@playwright/test";

/** Minimal shape accepted by `persistAuthResponse` / `parseUser` (matches `AuthResponse`). */
export type MockAuthRefreshBody = {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    name: string;
    emailVerified?: boolean;
    hasCompletedOnboarding?: boolean;
    businessId?: string;
    employeeId?: string;
    businessVerificationStatus?: "pending" | "verified" | "rejected";
  };
};

function mapMockApiRole(apiRole: string): string {
  switch (apiRole) {
    case "MANAGER":
      return "business";
    case "EMPLOYEE":
      return "employee";
    case "SUPER_ADMIN":
      return "platform_admin";
    default:
      return apiRole;
  }
}

/** Persisted UI user shape — matches `normalizeStoredUser` / bootstrap cache. */
function toStoredSessionUser(user: MockAuthRefreshBody["user"]) {
  const role = mapMockApiRole(user.role);
  const emailVerified =
    typeof user.emailVerified === "boolean"
      ? user.emailVerified
      : role === "platform_admin" || role === "admin";
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    emailVerified,
    isVerified: emailVerified,
    hasCompletedOnboarding: role === "business" ? (user.hasCompletedOnboarding ?? false) : true,
    isPlatformAdmin: role === "platform_admin",
    businessId: user.businessId,
    employeeId: user.employeeId,
  };
}

async function primeE2EStorage(page: Page, body: MockAuthRefreshBody): Promise<void> {
  const storedUser = toStoredSessionUser(body.user);
  await page.addInitScript((payload) => {
    // Legacy key primed for migrateLegacyAccessTokenFromStorage → in-memory store (not persisted after bootstrap).
    localStorage.setItem("caretip_token", payload.token);
    localStorage.setItem("caretip_user", JSON.stringify(payload.storedUser));
    try {
      sessionStorage.setItem("caretip_session_hint", "1");
    } catch {
      /* ignore */
    }
  }, { token: body.token, storedUser });
}

export async function installMockAuthRefresh(page: Page, body: MockAuthRefreshBody): Promise<void> {
  await primeE2EStorage(page, body);
  await page.route("**/api/auth/refresh", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const role = mapMockApiRole(body.user.role);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // The real API sends this flag for platform admins, and the route guard requires it.
      body: JSON.stringify({ ...body, user: { ...body.user, isPlatformAdmin: role === "platform_admin" } }),
    });
  });
}

/** @deprecated Prefer `installMockAuthRefresh` which also primes storage. */
export async function primeE2ESessionToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("caretip_token", "e2e-test-token");
    try {
      sessionStorage.setItem("caretip_session_hint", "1");
    } catch {
      /* ignore */
    }
  });
}
