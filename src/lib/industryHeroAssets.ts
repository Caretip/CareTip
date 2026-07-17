/**
 * Industry page hero warming — prevents stale-image flash on SPA industry nav.
 * Prefetch on hover/idle so the new hero is already decoded when the route param changes.
 */

import { INDUSTRY_MEDIA } from "@/app/data/industryMedia";
import {
  ALL_INDUSTRY_PAGE_IDS,
  isIndustryPageId,
  type IndustryPageId,
} from "@/app/data/industryPages";

const PRELOAD_ATTR = "data-caretip-industry-hero-preload";

/** Keep decoded bitmaps reachable across industry navigations. */
const warmImageBySrc = new Map<string, HTMLImageElement>();
const inflightById = new Map<IndustryPageId, Promise<void>>();

function preferHeroHref(industryId: IndustryPageId): { href: string; type: string; fallback: string } {
  const hero = INDUSTRY_MEDIA[industryId].hero;
  return { href: hero.avif, type: "image/avif", fallback: hero.webp };
}

export function isIndustryHeroWarm(industryId: IndustryPageId): boolean {
  if (typeof window === "undefined") return false;
  const { href, fallback } = preferHeroHref(industryId);
  for (const src of [href, fallback]) {
    const warm = warmImageBySrc.get(src);
    if (warm?.complete && warm.naturalWidth > 0) return true;
  }
  return false;
}

/** Document preload for the active industry LCP hero (SPA navigations). */
export function ensureIndustryHeroPreloadLink(industryId: IndustryPageId): void {
  if (typeof document === "undefined") return;

  const { href, type } = preferHeroHref(industryId);
  let link = document.head.querySelector<HTMLLinkElement>(`link[${PRELOAD_ATTR}]`);

  if (!link) {
    link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.setAttribute(PRELOAD_ATTR, "1");
    document.head.appendChild(link);
  }

  const absolute = new URL(href, document.baseURI).href;
  if (link.href !== absolute) {
    link.href = href;
  }
  link.type = type;
  link.setAttribute("fetchpriority", "high");
}

function loadAndDecode(src: string, priority: "high" | "low"): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const existing = warmImageBySrc.get(src);
    if (existing?.complete && existing.naturalWidth > 0) {
      resolve(existing);
      return;
    }

    const img = new Image();
    img.setAttribute("fetchpriority", priority);
    img.decoding = "async";

    const finish = () => {
      warmImageBySrc.set(src, img);
      resolve(img);
    };

    img.onload = () => {
      if (typeof img.decode === "function") {
        void img.decode().then(finish, finish);
      } else {
        finish();
      }
    };
    img.onerror = () => reject(new Error(`Failed to warm ${src}`));
    img.src = src;
  });
}

/**
 * Fetch + decode an industry hero early. Safe to call repeatedly —
 * shares one in-flight promise per industry id.
 */
export function warmIndustryHero(
  industryId: IndustryPageId,
  options?: { priority?: "high" | "low" },
): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  const priority = options?.priority ?? "high";
  if (priority === "high") {
    ensureIndustryHeroPreloadLink(industryId);
  }

  if (isIndustryHeroWarm(industryId)) return Promise.resolve();

  const existing = inflightById.get(industryId);
  if (existing) return existing;

  const { href, fallback } = preferHeroHref(industryId);
  const promise = loadAndDecode(href, priority)
    .catch(() => loadAndDecode(fallback, priority))
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      inflightById.delete(industryId);
    });

  inflightById.set(industryId, promise);
  return promise;
}

/** Warm hero (+ route chunk caller) from an `/industries/:id` path. */
export function warmIndustryHeroFromPath(path: string): void {
  const normalized = path.split("#")[0].split("?")[0];
  const match = normalized.match(/^\/industries\/([^/]+)\/?$/);
  if (!match) return;
  const id = match[1];
  if (!isIndustryPageId(id)) return;
  void warmIndustryHero(id, { priority: "high" });
}

let idleWarmScheduled = false;

/** Idle-warm all industry heroes after the current page is interactive. */
export function warmAllIndustryHeroesIdle(_excludeId?: IndustryPageId): void {
  if (typeof window === "undefined" || idleWarmScheduled) return;
  idleWarmScheduled = true;

  const run = () => {
    for (const id of ALL_INDUSTRY_PAGE_IDS) {
      void warmIndustryHero(id, { priority: "low" });
    }
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => run(), { timeout: 2500 });
  } else {
    globalThis.setTimeout(run, 1200);
  }
}

export function markIndustryHeroSrcWarm(src: string, img: HTMLImageElement): void {
  if (img.complete && img.naturalWidth > 0) {
    warmImageBySrc.set(src, img);
  }
}
