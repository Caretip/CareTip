/**
 * Runtime dashboard performance profiler (evidence only — no product optimizations).
 *
 * Enable: ?dashProfile=1 | localStorage.caretip_dash_profile=1 | __DASHBOARD_PROFILE_FORCE__
 * Export: window.__DASHBOARD_PROFILE__.download() / exportJson() / exportMarkdown()
 */

export type DashProfileEvent = {
  event: string;
  t: number;
  elapsedMs: number;
  detail?: Record<string, unknown>;
};

export type DashApiSpan = {
  id: string;
  url: string;
  method: string;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
  ttfbMs: number | null;
  jsonParseMs: number | null;
  responseBytes: number | null;
  status: number | string | null;
  cacheSource: "network" | "browser_cache" | "memory_hint" | "unknown";
};

export type DashRenderStats = {
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
};

export type DashLongTask = {
  startMs: number;
  durationMs: number;
  elapsedMs: number;
  attribution: string[];
};

export type DashSocketStats = {
  messageCount: number;
  byEvent: Record<string, number>;
  messagesPerMinute: number;
};

export type DashProfileSnapshot = {
  surface: string | null;
  scenario: string | null;
  originMs: number | null;
  navigationStartMs: number | null;
  events: DashProfileEvent[];
  apis: DashApiSpan[];
  renderCounts: Record<string, number>;
  renderStats: Record<string, DashRenderStats>;
  longTasks: DashLongTask[];
  paintMetrics: { fcpMs: number | null; lcpMs: number | null };
  mainThread: {
    longTaskCount: number;
    longTaskTotalMs: number;
    scriptingEntries: number;
  };
  contextUpdates: Array<{ context: string; elapsedMs: number; detail?: Record<string, unknown> }>;
  socket: DashSocketStats;
  milestones: Record<string, number | null>;
  generatedAt: string;
};

type ProfilerApi = {
  enabled: boolean;
  snapshot: () => DashProfileSnapshot;
  exportJson: () => string;
  exportMarkdown: () => string;
  download: (basename?: string) => void;
  reset: (surface?: string, scenario?: string) => void;
};

declare global {
  interface Window {
    __DASHBOARD_PROFILE_FORCE__?: boolean;
    __DASHBOARD_PROFILE__?: ProfilerApi;
  }
}

const MILESTONE_KEYS = [
  "navigation_start",
  "layout_mounted",
  "sidebar_rendered",
  "header_rendered",
  "first_kpi_rendered",
  "chart_mounted",
  "notifications_fetch_done",
  "profile_fetch_done",
  "first_usable",
  "fully_loaded",
] as const;

type MilestoneKey = (typeof MILESTONE_KEYS)[number];

let enabledCache: boolean | null = null;
let originMs: number | null = null;
let surface: string | null = null;
let scenario: string | null = null;
let navigationStartMs: number | null = null;
const events: DashProfileEvent[] = [];
const apis: DashApiSpan[] = [];
const renderCounts: Record<string, number> = {};
const renderAccum: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
const longTasks: DashLongTask[] = [];
const contextUpdates: Array<{ context: string; elapsedMs: number; detail?: Record<string, unknown> }> = [];
const socketByEvent: Record<string, number> = {};
let socketMessageCount = 0;
let socketSessionStartMs: number | null = null;
const milestones: Record<string, number | null> = Object.fromEntries(
  MILESTONE_KEYS.map((k) => [k, null]),
);
let fetchPatched = false;
let observersInstalled = false;
let apiSeq = 0;
const pendingApis = new Map<string, DashApiSpan>();
const memoryUrlHits = new Set<string>();

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__DASHBOARD_PROFILE_FORCE__ === true) return true;
  try {
    if (new URLSearchParams(window.location.search).get("dashProfile") === "1") return true;
    if (window.localStorage.getItem("caretip_dash_profile") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function isDashboardProfilerEnabled(): boolean {
  enabledCache = readEnabled();
  return enabledCache;
}

export function refreshDashboardProfilerEnabled(): boolean {
  enabledCache = readEnabled();
  return enabledCache;
}

function ensureWindowApi(): void {
  if (typeof window === "undefined") return;
  window.__DASHBOARD_PROFILE__ = {
    get enabled() {
      return isDashboardProfilerEnabled();
    },
    snapshot: getDashboardProfileSnapshot,
    exportJson: () => JSON.stringify(getDashboardProfileSnapshot(), null, 2),
    exportMarkdown: formatDashboardProfileMarkdown,
    download: downloadDashboardProfile,
    reset: beginDashboardProfile,
  };
}

function pushEvent(event: string, detail?: Record<string, unknown>): void {
  if (!isDashboardProfilerEnabled()) return;
  const now = performance.now();
  if (originMs == null) originMs = now;
  const entry: DashProfileEvent = {
    event,
    t: now,
    elapsedMs: Math.round(now - originMs),
    detail,
  };
  events.push(entry);
  if (import.meta.env.DEV) {
    console.info(`[DashProfile] ${event} +${entry.elapsedMs}ms`, detail ?? {});
  }
  ensureWindowApi();
}

function setMilestone(key: MilestoneKey, at = performance.now()): void {
  if (!isDashboardProfilerEnabled()) return;
  if (milestones[key] != null) return;
  if (originMs == null) originMs = at;
  milestones[key] = Math.round(at - originMs);
  pushEvent(`milestone:${key}`, { atMs: milestones[key] });
}

function installPerformanceObservers(): void {
  if (typeof window === "undefined" || observersInstalled || !isDashboardProfilerEnabled()) return;
  observersInstalled = true;

  try {
    const longTaskObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const start = entry.startTime;
        const duration = entry.duration;
        if (duration < 50) continue;
        const attribution: string[] = [];
        const anyEntry = entry as PerformanceEntry & {
          attribution?: Array<{ name?: string; containerType?: string }>;
        };
        for (const a of anyEntry.attribution ?? []) {
          attribution.push([a.containerType, a.name].filter(Boolean).join(":"));
        }
        const row: DashLongTask = {
          startMs: start,
          durationMs: Math.round(duration),
          elapsedMs: originMs != null ? Math.round(start - originMs) : Math.round(start),
          attribution,
        };
        longTasks.push(row);
        pushEvent("long_task", {
          durationMs: row.durationMs,
          attribution,
        });
      }
    });
    longTaskObs.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
  } catch {
    /* Long Tasks API unavailable */
  }
}

export function beginDashboardProfile(nextSurface = "unknown", nextScenario = "default"): void {
  if (!refreshDashboardProfilerEnabled()) return;
  originMs = performance.now();
  surface = nextSurface;
  scenario = nextScenario;
  navigationStartMs = 0;
  events.length = 0;
  apis.length = 0;
  pendingApis.clear();
  longTasks.length = 0;
  contextUpdates.length = 0;
  socketMessageCount = 0;
  socketSessionStartMs = originMs;
  for (const k of Object.keys(socketByEvent)) delete socketByEvent[k];
  for (const k of Object.keys(renderCounts)) delete renderCounts[k];
  for (const k of Object.keys(renderAccum)) delete renderAccum[k];
  for (const k of MILESTONE_KEYS) milestones[k] = null;
  installDashboardFetchProbe();
  installPerformanceObservers();
  setMilestone("navigation_start", originMs);
  pushEvent("profile_session_start", {
    surface: nextSurface,
    scenario: nextScenario,
    path: window.location.pathname,
  });
  ensureWindowApi();
}

export function markDashboardNavigationStart(nextSurface: string): void {
  if (!isDashboardProfilerEnabled() && !refreshDashboardProfilerEnabled()) return;
  if (originMs == null || surface !== nextSurface) {
    beginDashboardProfile(nextSurface);
    return;
  }
  pushEvent("navigation_start", { surface: nextSurface });
  if (milestones.navigation_start == null) setMilestone("navigation_start");
}

export function markDashboardLayoutMounted(detail?: Record<string, unknown>): void {
  pushEvent("layout_mounted", detail);
  setMilestone("layout_mounted");
}

export function markDashboardSidebarRendered(detail?: Record<string, unknown>): void {
  pushEvent("sidebar_rendered", detail);
  setMilestone("sidebar_rendered");
}

export function markDashboardHeaderRendered(detail?: Record<string, unknown>): void {
  pushEvent("header_rendered", detail);
  setMilestone("header_rendered");
}

export function markDashboardFirstKpiRendered(detail?: Record<string, unknown>): void {
  if (milestones.first_kpi_rendered != null) return;
  pushEvent("first_kpi_rendered", detail);
  setMilestone("first_kpi_rendered");
  maybeMarkUsable();
}

export function markDashboardChartMounted(detail?: Record<string, unknown>): void {
  if (milestones.chart_mounted != null) return;
  pushEvent("chart_mounted", detail);
  setMilestone("chart_mounted");
  maybeMarkFullyLoaded();
}

export function markDashboardNotificationsFetchDone(detail?: Record<string, unknown>): void {
  pushEvent("notifications_fetch_done", detail);
  setMilestone("notifications_fetch_done");
  maybeMarkFullyLoaded();
}

export function markDashboardProfileFetchDone(detail?: Record<string, unknown>): void {
  pushEvent("profile_fetch_done", detail);
  setMilestone("profile_fetch_done");
  maybeMarkFullyLoaded();
}

function maybeMarkUsable(): void {
  if (milestones.layout_mounted == null) return;
  if (milestones.first_kpi_rendered == null) return;
  setMilestone("first_usable");
}

function maybeMarkFullyLoaded(): void {
  if (milestones.first_usable == null) return;
  if (milestones.chart_mounted != null) {
    setMilestone("fully_loaded");
  }
}

export function markDashboardFullyLoaded(detail?: Record<string, unknown>): void {
  pushEvent("fully_loaded_forced", detail);
  setMilestone("fully_loaded");
}

export function markDashboardContextUpdate(context: string, detail?: Record<string, unknown>): void {
  if (!isDashboardProfilerEnabled()) return;
  const elapsedMs = originMs != null ? Math.round(performance.now() - originMs) : 0;
  contextUpdates.push({ context, elapsedMs, detail });
  pushEvent("context_update", { context, ...detail });
}

export function markDashboardSocketMessage(eventName: string, detail?: Record<string, unknown>): void {
  if (!isDashboardProfilerEnabled()) return;
  socketMessageCount += 1;
  socketByEvent[eventName] = (socketByEvent[eventName] ?? 0) + 1;
  if (socketSessionStartMs == null) socketSessionStartMs = performance.now();
  pushEvent("socket_message", { event: eventName, count: socketMessageCount, ...detail });
}

export function recordDashboardReactProfile(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
): void {
  if (!isDashboardProfilerEnabled()) return;
  const prev = renderAccum[id] ?? { count: 0, totalMs: 0, maxMs: 0 };
  prev.count += 1;
  prev.totalMs += actualDuration;
  prev.maxMs = Math.max(prev.maxMs, actualDuration);
  renderAccum[id] = prev;
  renderCounts[id] = prev.count;
  if (prev.count === 1 || prev.count % 10 === 0 || actualDuration > 16) {
    pushEvent("react_profile", {
      id,
      phase,
      actualDurationMs: Math.round(actualDuration * 100) / 100,
      count: prev.count,
    });
  }
}

/** Count + approximate commit duration via layout effect. */
export function useDashboardRenderProbe(componentName: string): void {
  if (!isDashboardProfilerEnabled()) return;
  const t0 = performance.now();
  const next = (renderCounts[componentName] ?? 0) + 1;
  renderCounts[componentName] = next;

  // Schedule measurement after commit (sync layout path approximated on next microtask).
  queueMicrotask(() => {
    const dur = performance.now() - t0;
    const prev = renderAccum[componentName] ?? { count: 0, totalMs: 0, maxMs: 0 };
    // Keep count aligned with renderCounts; accumulate duration for this commit window.
    prev.count = next;
    prev.totalMs += dur;
    prev.maxMs = Math.max(prev.maxMs, dur);
    renderAccum[componentName] = prev;
  });

  if (next === 1 || next % 10 === 0) {
    pushEvent("render", { component: componentName, count: next });
  }
  ensureWindowApi();
}

function classifyUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function isInterestingApi(url: string): boolean {
  const path = classifyUrl(url);
  return (
    path.includes("/api/business/") ||
    path.includes("/api/employees/") ||
    path.includes("/api/tips/") ||
    path.includes("/api/me/notifications") ||
    path.includes("/api/platform/") ||
    path.includes("/api/auth/me")
  );
}

function inferCacheSource(res: Response, url: string, transferSize: number | null): DashApiSpan["cacheSource"] {
  if (memoryUrlHits.has(url) && transferSize === 0) return "memory_hint";
  if (transferSize === 0 && res.ok) return "browser_cache";
  const xCache = res.headers.get("x-cache") || res.headers.get("cf-cache-status");
  if (xCache && /hit/i.test(xCache)) return "browser_cache";
  return "network";
}

export function installDashboardFetchProbe(): void {
  if (typeof window === "undefined" || fetchPatched) return;
  if (!isDashboardProfilerEnabled()) return;
  fetchPatched = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (!isInterestingApi(rawUrl)) {
      return original(input, init);
    }

    const id = `api_${++apiSeq}`;
    const startMs = performance.now();
    const url = classifyUrl(rawUrl);
    const span: DashApiSpan = {
      id,
      url,
      method,
      startMs,
      endMs: null,
      durationMs: null,
      ttfbMs: null,
      jsonParseMs: null,
      responseBytes: null,
      status: null,
      cacheSource: "unknown",
    };
    pendingApis.set(id, span);
    apis.push(span);
    pushEvent("api_start", { id, url: span.url, method });

    try {
      const res = await original(input, init);
      const ttfbMs = Math.round(performance.now() - startMs);
      span.ttfbMs = ttfbMs;

      const clone = res.clone();
      let responseBytes: number | null = null;
      let jsonParseMs: number | null = null;
      try {
        const buf = await clone.arrayBuffer();
        responseBytes = buf.byteLength;
        const text = new TextDecoder().decode(buf);
        const p0 = performance.now();
        try {
          JSON.parse(text);
        } catch {
          /* non-JSON */
        }
        jsonParseMs = Math.round((performance.now() - p0) * 100) / 100;
      } catch {
        const len = res.headers.get("content-length");
        responseBytes = len ? Number(len) : null;
      }

      let transferSize: number | null = null;
      try {
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const match = [...resources].reverse().find((r) => r.name.includes(url.split("?")[0] ?? url));
        if (match) transferSize = match.transferSize;
      } catch {
        /* ignore */
      }

      const endMs = performance.now();
      span.endMs = endMs;
      span.durationMs = Math.round(endMs - startMs);
      span.status = res.status;
      span.responseBytes = responseBytes;
      span.jsonParseMs = jsonParseMs;
      span.cacheSource = inferCacheSource(res, url, transferSize);
      if (span.cacheSource === "network") memoryUrlHits.add(url);
      pendingApis.delete(id);

      pushEvent("api_end", {
        id,
        url: span.url,
        method,
        status: res.status,
        durationMs: span.durationMs,
        ttfbMs: span.ttfbMs,
        jsonParseMs: span.jsonParseMs,
        responseBytes: span.responseBytes,
        cacheSource: span.cacheSource,
      });

      if (span.url.includes("/notifications")) {
        markDashboardNotificationsFetchDone({ url: span.url, durationMs: span.durationMs });
      }
      if (span.url.includes("/business/profile") || span.url.includes("/employees/me")) {
        markDashboardProfileFetchDone({ url: span.url, durationMs: span.durationMs });
      }

      return res;
    } catch (err) {
      const endMs = performance.now();
      span.endMs = endMs;
      span.durationMs = Math.round(endMs - startMs);
      span.ttfbMs = span.durationMs;
      span.status = "error";
      pendingApis.delete(id);
      pushEvent("api_error", { id, url: span.url, durationMs: span.durationMs });
      throw err;
    }
  };
}

function buildRenderStats(): Record<string, DashRenderStats> {
  const out: Record<string, DashRenderStats> = {};
  const names = new Set([...Object.keys(renderCounts), ...Object.keys(renderAccum)]);
  for (const name of names) {
    const acc = renderAccum[name];
    const count = renderCounts[name] ?? acc?.count ?? 0;
    const totalMs = acc?.totalMs ?? 0;
    out[name] = {
      count,
      totalMs: Math.round(totalMs * 100) / 100,
      avgMs: count > 0 ? Math.round((totalMs / count) * 100) / 100 : 0,
      maxMs: Math.round((acc?.maxMs ?? 0) * 100) / 100,
    };
  }
  return out;
}

function paintMetrics(): { fcpMs: number | null; lcpMs: number | null } {
  let fcpMs: number | null = null;
  let lcpMs: number | null = null;
  try {
    for (const e of performance.getEntriesByType("paint")) {
      if (e.name === "first-contentful-paint") fcpMs = Math.round(e.startTime);
    }
  } catch {
    /* ignore */
  }
  return { fcpMs, lcpMs };
}

export function getDashboardProfileSnapshot(): DashProfileSnapshot {
  const elapsedMin =
    socketSessionStartMs != null ? Math.max((performance.now() - socketSessionStartMs) / 60000, 1 / 60) : 1 / 60;
  return {
    surface,
    scenario,
    originMs,
    navigationStartMs,
    events: [...events],
    apis: apis.map((a) => ({ ...a })),
    renderCounts: { ...renderCounts },
    renderStats: buildRenderStats(),
    longTasks: [...longTasks],
    paintMetrics: paintMetrics(),
    mainThread: {
      longTaskCount: longTasks.length,
      longTaskTotalMs: longTasks.reduce((s, t) => s + t.durationMs, 0),
      scriptingEntries: events.filter((e) => e.event === "react_profile" || e.event === "long_task").length,
    },
    contextUpdates: [...contextUpdates],
    socket: {
      messageCount: socketMessageCount,
      byEvent: { ...socketByEvent },
      messagesPerMinute: Math.round((socketMessageCount / elapsedMin) * 10) / 10,
    },
    milestones: { ...milestones },
    generatedAt: new Date().toISOString(),
  };
}

function topRenders(stats: Record<string, DashRenderStats>, n = 20) {
  return Object.entries(stats)
    .map(([component, s]) => ({ component, ...s }))
    .sort((a, b) => b.count - a.count || b.totalMs - a.totalMs)
    .slice(0, n);
}

export function formatDashboardProfileMarkdown(
  snap: DashProfileSnapshot = getDashboardProfileSnapshot(),
): string {
  const ms = snap.milestones;
  const lines: string[] = [
    `# Dashboard Runtime Profile`,
    ``,
    `**Surface:** ${snap.surface ?? "—"}`,
    `**Scenario:** ${snap.scenario ?? "—"}`,
    `**Generated:** ${snap.generatedAt}`,
    ``,
    `## Milestones (ms from session start)`,
    ``,
    `| Milestone | ms |`,
    `|---|---:|`,
  ];
  for (const key of MILESTONE_KEYS) {
    lines.push(`| ${key} | ${ms[key] ?? "—"} |`);
  }

  lines.push(
    ``,
    `## API spans`,
    ``,
    `| Method | URL | Duration | TTFB | Parse | Bytes | Cache | Status |`,
    `|---|---|---:|---:|---:|---:|---|---|`,
  );
  for (const a of snap.apis) {
    lines.push(
      `| ${a.method} | \`${a.url}\` | ${a.durationMs ?? "—"} | ${a.ttfbMs ?? "—"} | ${a.jsonParseMs ?? "—"} | ${a.responseBytes ?? "—"} | ${a.cacheSource} | ${a.status ?? "—"} |`,
    );
  }

  lines.push(
    ``,
    `## React render stats`,
    ``,
    `| Component | Count | Total ms | Avg ms | Max ms |`,
    `|---|---:|---:|---:|---:|`,
  );
  for (const row of topRenders(snap.renderStats)) {
    lines.push(`| ${row.component} | ${row.count} | ${row.totalMs} | ${row.avgMs} | ${row.maxMs} |`);
  }

  lines.push(
    ``,
    `## Main thread`,
    ``,
    `- Long tasks (>50ms): **${snap.mainThread.longTaskCount}** (total **${snap.mainThread.longTaskTotalMs}ms**)`,
    `- FCP: ${snap.paintMetrics.fcpMs ?? "—"}ms`,
    ``,
  );
  if (snap.longTasks.length) {
    lines.push(`| +ms | Duration | Attribution |`, `|---:|---:|---|`);
    for (const t of snap.longTasks.slice(0, 30)) {
      lines.push(`| ${t.elapsedMs} | ${t.durationMs} | ${t.attribution.join(", ") || "—"} |`);
    }
    lines.push(``);
  }

  lines.push(
    ``,
    `## Context updates`,
    ``,
    `| +ms | Context | Detail |`,
    `|---:|---|---|`,
  );
  for (const c of snap.contextUpdates.slice(0, 50)) {
    lines.push(`| ${c.elapsedMs} | ${c.context} | ${c.detail ? JSON.stringify(c.detail) : ""} |`);
  }

  lines.push(
    ``,
    `## WebSocket`,
    ``,
    `- Messages: **${snap.socket.messageCount}**`,
    `- Messages/min: **${snap.socket.messagesPerMinute}**`,
    `- By event: ${JSON.stringify(snap.socket.byEvent)}`,
    ``,
    `## Event timeline (truncated)`,
    ``,
    `| +ms | Event | Detail |`,
    `|---:|---|---|`,
  );
  for (const e of snap.events.slice(0, 120)) {
    lines.push(`| ${e.elapsedMs} | ${e.event} | ${e.detail ? JSON.stringify(e.detail) : ""} |`);
  }

  return lines.join("\n");
}

export function downloadDashboardProfile(basename = "DASHBOARD_RUNTIME_PROFILE"): void {
  if (typeof document === "undefined") return;
  const snap = getDashboardProfileSnapshot();
  const json = JSON.stringify(snap, null, 2);
  const md = formatDashboardProfileMarkdown(snap);
  for (const [name, body, type] of [
    [`${basename}.json`, json, "application/json"],
    [`${basename}.md`, md, "text/markdown"],
  ] as const) {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export function bootDashboardProfilerConsole(): void {
  ensureWindowApi();
  if (isDashboardProfilerEnabled()) {
    installDashboardFetchProbe();
    installPerformanceObservers();
    console.info(
      "[DashProfile] enabled — use window.__DASHBOARD_PROFILE__.download('BUSINESS_DASHBOARD_PROFILE') after settle",
    );
  }
}
