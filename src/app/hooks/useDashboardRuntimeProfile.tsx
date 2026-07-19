import { Profiler, useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";
import {
  beginDashboardProfile,
  bootDashboardProfilerConsole,
  isDashboardProfilerEnabled,
  markDashboardChartMounted,
  markDashboardContextUpdate,
  markDashboardFirstKpiRendered,
  markDashboardFullyLoaded,
  markDashboardHeaderRendered,
  markDashboardLayoutMounted,
  markDashboardSidebarRendered,
  recordDashboardReactProfile,
  refreshDashboardProfilerEnabled,
  useDashboardRenderProbe,
} from "../lib/dashboardRuntimeProfiler";

function surfaceFromPath(pathname: string): string | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path === "/dashboard" || path === "/dashboard/") return "business-overview";
  if (path.startsWith("/employee/dashboard")) return "employee-overview";
  if (path.startsWith("/platform-admin/dashboard")) return "platform-admin-overview";
  return null;
}

function scenarioFromSearch(search: string): string {
  try {
    return new URLSearchParams(search).get("dashScenario") || "default";
  } catch {
    return "default";
  }
}

/** Mount once under root — enables console API + starts a session on overview routes. */
export function DashboardProfilerRoot(): null {
  const { pathname, search } = useLocation();

  useEffect(() => {
    bootDashboardProfilerConsole();
  }, []);

  useEffect(() => {
    refreshDashboardProfilerEnabled();
    const surface = surfaceFromPath(pathname);
    if (!surface || !isDashboardProfilerEnabled()) return;
    beginDashboardProfile(surface, scenarioFromSearch(search));
  }, [pathname, search]);

  return null;
}

/** React Profiler bridge — evidence only. */
export function DashboardReactProfiler({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}): ReactNode {
  if (!isDashboardProfilerEnabled()) return children;
  return (
    <Profiler
      id={id}
      onRender={(_id, phase, actualDuration) => {
        recordDashboardReactProfile(
          id,
          phase === "mount" ? "mount" : "update",
          actualDuration,
        );
      }}
    >
      {children}
    </Profiler>
  );
}

/**
 * Watches common dashboard contexts and logs updates when profiler is enabled.
 * Must be rendered under the same providers as the dashboard shell.
 */
export function DashboardContextUpdateWatchers(): null {
  // Lazy import hooks inside effects/components that exist in tree — see dedicated watchers below.
  return null;
}

export function useDashboardLayoutProfile(role: "business" | "employee" | "platform_admin"): void {
  useDashboardRenderProbe(`${role}:Layout`);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    markDashboardLayoutMounted({ role });
  }, [role]);
}

export function useDashboardSidebarProfile(role: string, rendered: boolean): void {
  useDashboardRenderProbe(`${role}:Sidebar`);
  const once = useRef(false);
  useEffect(() => {
    if (!rendered || once.current) return;
    once.current = true;
    markDashboardSidebarRendered({ role });
  }, [rendered, role]);
}

export function useDashboardHeaderProfile(role: string): void {
  useDashboardRenderProbe(`${role}:Header`);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    markDashboardHeaderRendered({ role });
  }, [role]);
}

export function useDashboardKpiProfile(role: string, ready: boolean, detail?: Record<string, unknown>): void {
  useDashboardRenderProbe(`${role}:KpiSurface`);
  const once = useRef(false);
  useEffect(() => {
    if (!ready || once.current) return;
    once.current = true;
    markDashboardFirstKpiRendered({ role, ...(detail ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- milestone once
  }, [ready, role]);
}

export function useDashboardChartProfile(role: string, mounted: boolean): void {
  useDashboardRenderProbe(`${role}:Charts`);
  const once = useRef(false);
  useEffect(() => {
    if (!mounted || once.current) return;
    once.current = true;
    markDashboardChartMounted({ role });
  }, [mounted, role]);
}

export function useDashboardPageFullyLoaded(role: string, ready: boolean): void {
  const once = useRef(false);
  useEffect(() => {
    if (!ready || once.current) return;
    once.current = true;
    markDashboardFullyLoaded({ role });
  }, [ready, role]);
}

/** Log auth identity changes when profiling. */
export function useDashProfileAuthWatch(userId: string | null | undefined, authStatus: string): void {
  const prev = useRef<{ userId?: string | null; authStatus?: string }>({});
  useEffect(() => {
    if (!isDashboardProfilerEnabled()) return;
    if (prev.current.userId === userId && prev.current.authStatus === authStatus) return;
    prev.current = { userId, authStatus };
    markDashboardContextUpdate("AuthContext", { userId: userId ?? null, authStatus });
  }, [userId, authStatus]);
}

export function useDashProfileSocketWatch(connected: boolean, status: string): void {
  const prev = useRef<{ connected?: boolean; status?: string }>({});
  useEffect(() => {
    if (!isDashboardProfilerEnabled()) return;
    if (prev.current.connected === connected && prev.current.status === status) return;
    prev.current = { connected, status };
    markDashboardContextUpdate("SocketContext", { connected, status });
  }, [connected, status]);
}

export function useDashProfileEntitlementsWatch(ready: boolean, planKey?: string | null): void {
  const prev = useRef<{ ready?: boolean; planKey?: string | null }>({});
  useEffect(() => {
    if (!isDashboardProfilerEnabled()) return;
    if (prev.current.ready === ready && prev.current.planKey === planKey) return;
    prev.current = { ready, planKey };
    markDashboardContextUpdate("EntitlementsContext", { ready, planKey: planKey ?? null });
  }, [ready, planKey]);
}

export { useDashboardRenderProbe, markDashboardContextUpdate };
