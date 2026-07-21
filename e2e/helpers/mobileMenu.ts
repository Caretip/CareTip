import { expect, type Page } from "@playwright/test";

export const MOBILE_MENU_GUARD_MS = 400;
export const MOBILE_MENU_TOGGLE_DEBOUNCE_MS = 250;

/** Header hamburger — only click when the drawer is closed. */
export function menuButton(page: Page) {
  return page.locator('button[aria-controls="mobile-main-nav"]').first();
}

export function mobileNavPanel(page: Page) {
  return page.locator("#mobile-main-nav");
}

export function mobileNavBackdrop(page: Page) {
  return page.locator(".caretip-mobile-drawer-backdrop--open");
}

/** In-drawer close control (full-screen drawer covers the header hamburger). */
export function drawerCloseButton(page: Page) {
  return mobileNavPanel(page).getByRole("button", {
    name: /close menu|menü schließen|schließen/i,
  });
}

export function firstMobileNavLink(page: Page) {
  return mobileNavPanel(page).locator("a.caretip-public-mobile-nav-drawer__nav-link").first();
}

export function mobileNavLink(page: Page, href: string) {
  return mobileNavPanel(page).locator(
    `a.caretip-public-mobile-nav-drawer__nav-link[href="${href}"]`,
  );
}

export function mobileAccountLink(page: Page, href: string) {
  return mobileNavPanel(page).locator(
    `a.caretip-public-mobile-nav-drawer__account-link[href="${href}"]`,
  );
}

export function mobileDrawerCta(page: Page, href: string) {
  return mobileNavPanel(page).locator(
    `a.caretip-public-mobile-nav-drawer__cta-primary[href="${href}"], a.caretip-public-mobile-nav-drawer__cta-secondary[href="${href}"]`,
  );
}

export async function openMobileMenu(page: Page) {
  const btn = menuButton(page);
  await expect(btn).toBeVisible();
  if ((await btn.getAttribute("aria-expanded")) === "true") {
    await expect(mobileNavPanel(page)).toBeVisible({ timeout: 10_000 });
    return;
  }
  await btn.click({ force: true });
  const opened = await mobileNavPanel(page)
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    await btn.evaluate((el: HTMLElement) => el.click());
    await expect(mobileNavPanel(page)).toBeVisible({ timeout: 20_000 });
  }
  await expect(btn).toHaveAttribute("aria-expanded", "true");
}

export async function closeMobileMenuViaDrawer(page: Page) {
  await expect(mobileNavPanel(page)).toBeVisible({ timeout: 20_000 });
  const close = drawerCloseButton(page);
  await expect(close).toBeVisible({ timeout: 10_000 });
  // WebKit sometimes needs a second click after the guard window.
  await close.click({ force: true });
  const closed = await mobileNavPanel(page)
    .waitFor({ state: "hidden", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) {
    await close.click({ force: true });
    await expect(mobileNavPanel(page)).toBeHidden({ timeout: 15_000 });
  }
  const btn = menuButton(page);
  if ((await btn.count()) > 0) {
    await expect(btn).toHaveAttribute("aria-expanded", "false", { timeout: 5_000 });
  }
}

export async function expectMenuClosed(page: Page) {
  await expect(mobileNavPanel(page)).toBeHidden({ timeout: 20_000 });
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
}

export async function expectMenuOpen(page: Page) {
  await expect(mobileNavPanel(page)).toBeVisible({ timeout: 20_000 });
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
}

/**
 * Full-screen drawer covers the backdrop. Guard tests may click the backdrop
 * via DOM evaluate; user-facing close uses the in-drawer close button.
 */
export async function tapBackdropViaDom(page: Page) {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".caretip-mobile-drawer-backdrop--open")?.click();
  });
}
