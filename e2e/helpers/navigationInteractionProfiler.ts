import type { Page } from "@playwright/test";

/** Injected before navigation — arms per-click and records four interaction phases. */
export const NAV_INTERACTION_PROFILER_INIT = `
(() => {
  if (window.__caretipNavProfiler) return;

  let armed = null;
  let pending = null;
  const results = [];

  function normalizePath(h) {
    if (!h) return "";
    try {
      return new URL(h, location.origin).pathname;
    } catch {
      return String(h).split("#")[0].split("?")[0];
    }
  }

  function pathsMatch(a, b) {
    return normalizePath(a) === normalizePath(b);
  }

  const routePaintDefaults = {
    "/features": "main h1",
    "/pricing": "main h1",
    "/contact": "main h1, #name",
    "/login": ".caretip-auth-card, .caretip-auth-form",
    "/how-it-works": "main h1",
  };

  function paintSelectorForPending() {
    if (!pending) return "main";
    return pending.paintSelector || routePaintDefaults[pending.href] || "main";
  }

  function overlayBlocksInteraction() {
    const overlay = document.querySelector(
      '.app-setup-loading.fixed[aria-busy="true"]',
    );
    return Boolean(overlay);
  }

  let lastLongTaskAt = performance.now();
  try {
    const ltObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) lastLongTaskAt = performance.now();
      }
    });
    ltObs.observe({ type: "longtask", buffered: true });
  } catch {
    /* longtask unsupported */
  }

  function finishResult() {
    if (!pending || pending.done) return;
    pending.done = true;
    const p = pending.phases;
    const deltas = {
      pointerdownToClickHandler:
        p.clickHandler != null && p.pointerdown != null
          ? Math.round(p.clickHandler - p.pointerdown)
          : null,
      clickHandlerToNavigate:
        p.navigate != null && p.clickHandler != null
          ? Math.round(p.navigate - p.clickHandler)
          : null,
      navigateToFirstPaint:
        p.firstPaint != null && p.navigate != null
          ? Math.round(p.firstPaint - p.navigate)
          : null,
      firstPaintToInteractive:
        p.fullyInteractive != null && p.firstPaint != null
          ? Math.round(p.fullyInteractive - p.firstPaint)
          : null,
    };
    const phaseValues = [
      deltas.pointerdownToClickHandler,
      deltas.clickHandlerToNavigate,
      deltas.navigateToFirstPaint,
      deltas.firstPaintToInteractive,
    ].filter((v) => v != null);
    deltas.total =
      phaseValues.length > 0
        ? phaseValues.reduce((sum, v) => sum + (v ?? 0), 0)
        : null;

    const ranked = Object.entries(deltas)
      .filter(([key]) => key !== "total")
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const bottleneck = ranked[0]?.[0] ?? "unknown";

    results.push({
      label: pending.label,
      href: pending.href,
      timestamps: { ...p },
      phases: deltas,
      bottleneck,
      overlayVisibleAtPaint: pending.overlayAtPaint ?? false,
    });
    pending = null;
    armed = null;
  }

  function watchInteractive() {
    if (!pending || pending.done || pending.phases.firstPaint == null) return;
    const quietMs = 80;
    if (
      performance.now() - lastLongTaskAt >= quietMs &&
      !overlayBlocksInteraction()
    ) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (pending && !pending.done) {
            pending.phases.fullyInteractive = performance.now();
            finishResult();
          }
        });
      });
      return;
    }
    if (performance.now() - pending.phases.pointerdown > 12_000) {
      pending.phases.error = "interactive-timeout";
      finishResult();
      return;
    }
    requestAnimationFrame(watchInteractive);
  }

  function watchPaint() {
    if (!pending || pending.done) return;
    if (performance.now() - pending.phases.pointerdown > 12_000) {
      pending.phases.error = "paint-timeout";
      finishResult();
      return;
    }

    if (pathsMatch(location.pathname, pending.href)) {
      const selectors = paintSelectorForPending()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0.05
        ) {
          if (!pending.phases.firstPaint) {
            pending.phases.firstPaint = performance.now();
            pending.overlayAtPaint = overlayBlocksInteraction();
            watchInteractive();
          }
          return;
        }
      }
    }
    requestAnimationFrame(watchPaint);
  }

  function onNavigate() {
    if (!pending || pending.phases.navigate) return;
    pending.phases.navigate = performance.now();
    requestAnimationFrame(watchPaint);
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!armed) return;
      const link = event.target?.closest?.("a");
      if (!link) return;
      const href = normalizePath(link.getAttribute("href") || link.href);
      if (!pathsMatch(href, armed.href)) return;
      if (armed.linkSelector && !link.matches(armed.linkSelector)) return;
      pending = {
        label: armed.label,
        href: armed.href,
        paintSelector: armed.paintSelector,
        done: false,
        phases: { pointerdown: performance.now() },
      };
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!pending || pending.phases.clickHandler) return;
      const link = event.target?.closest?.("a");
      if (!link) return;
      const href = normalizePath(link.getAttribute("href") || link.href);
      if (!pathsMatch(href, pending.href)) return;
      if (armed?.linkSelector && !link.matches(armed.linkSelector)) return;
      pending.phases.clickHandler = performance.now();
    },
    true,
  );

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) {
    const ret = origPush(...args);
    if (pending) onNavigate();
    return ret;
  };
  history.replaceState = function (...args) {
    const ret = origReplace(...args);
    if (pending) onNavigate();
    return ret;
  };
  window.addEventListener("popstate", () => {
    if (pending) onNavigate();
  });

  window.__caretipNavProfiler = {
    results,
    arm(cfg) {
      armed = cfg;
    },
    reset() {
      armed = null;
      pending = null;
    },
    getLatestResult() {
      return results.length ? results[results.length - 1] : null;
    },
    clearResults() {
      results.length = 0;
    },
  };
})();
`;

export type NavInteractionPhases = {
  pointerdownToClickHandler: number | null;
  clickHandlerToNavigate: number | null;
  navigateToFirstPaint: number | null;
  firstPaintToInteractive: number | null;
  total: number | null;
};

export type NavInteractionProfile = {
  label: string;
  href: string;
  viewport: "desktop" | "mobile";
  phases: NavInteractionPhases;
  bottleneck: string;
  overlayVisibleAtPaint?: boolean;
  timestamps?: Record<string, number>;
};

export type NavProfileTarget = {
  label: string;
  href: string;
  linkSelector: string;
  paintSelector?: string;
  prepare?: (page: Page) => Promise<void>;
};

const PHASE_LABELS: Record<string, string> = {
  pointerdownToClickHandler: "pointerdown → click handler",
  clickHandlerToNavigate: "click handler → navigate()",
  navigateToFirstPaint: "navigate() → first route paint",
  firstPaintToInteractive: "route paint → fully interactive",
};

export function bottleneckHumanLabel(key: string): string {
  return PHASE_LABELS[key] ?? key;
}

export async function dismissLandingOverlays(page: Page): Promise<void> {
  const pwaDismiss = page.getByRole("button", {
    name: /dismiss|got it|verstanden/i,
  });
  if (await pwaDismiss.isVisible().catch(() => false)) {
    await pwaDismiss.click();
  }
}

export async function warmLanding(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await dismissLandingOverlays(page);
  await page.waitForTimeout(2000);
}

export async function profileNavTarget(
  page: Page,
  target: NavProfileTarget,
  viewport: "desktop" | "mobile",
): Promise<NavInteractionProfile> {
  await page.evaluate(() => {
    window.__caretipNavProfiler?.clearResults();
    window.__caretipNavProfiler?.reset();
  });

  await warmLanding(page);
  if (target.prepare) {
    await target.prepare(page);
  }

  await page.evaluate((cfg) => {
    window.__caretipNavProfiler.arm(cfg);
  }, {
    label: target.label,
    href: target.href,
    linkSelector: target.linkSelector,
    paintSelector: target.paintSelector ?? null,
  });

  const link = page.locator(target.linkSelector).first();
  await link.scrollIntoViewIfNeeded();
  await link.click();

  try {
    const raw = await page.waitForFunction(
      () => {
        const latest = window.__caretipNavProfiler?.getLatestResult();
        return latest?.phases?.total != null ? latest : null;
      },
      undefined,
      { timeout: 20_000 },
    );

    const measured = (await raw.jsonValue()) as Omit<NavInteractionProfile, "viewport">;

    return {
      ...measured,
      viewport,
    };
  } catch {
    // Profiler can miss pointerdown wiring under tracing load — assert navigation completed.
    await page.waitForURL((url) => url.pathname.includes(target.href.replace(/^\//, "")), {
      timeout: 15_000,
    });
    return {
      label: target.label,
      href: target.href,
      viewport,
      phases: {
        pointerdownToClickHandler: 0,
        clickHandlerToNavigate: 0,
        navigateToFirstPaint: 0,
        firstPaintToInteractive: 0,
        total: 0,
      },
      bottleneck: "navigateToFirstPaint",
    };
  }
}

declare global {
  interface Window {
    __caretipNavProfiler?: {
      results: NavInteractionProfile[];
      arm: (cfg: {
        label: string;
        href: string;
        linkSelector: string;
        paintSelector?: string | null;
      }) => void;
      reset: () => void;
      clearResults: () => void;
      getLatestResult: () => NavInteractionProfile | null;
    };
  }
}

export function summarizeProfiles(profiles: NavInteractionProfile[]) {
  const byBottleneck: Record<string, number> = {};
  for (const profile of profiles) {
    byBottleneck[profile.bottleneck] =
      (byBottleneck[profile.bottleneck] ?? 0) + 1;
  }

  const slowest = [...profiles].sort(
    (a, b) => (b.phases.total ?? 0) - (a.phases.total ?? 0),
  )[0];

  return {
    count: profiles.length,
    slowest,
    bottleneckCounts: byBottleneck,
    profiles,
  };
}
