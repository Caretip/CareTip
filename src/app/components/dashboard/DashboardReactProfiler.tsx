import { Profiler, type ReactNode } from "react";
import {
  isDashboardProfilerEnabled,
  recordDashboardReactProfile,
} from "../../lib/dashboardRuntimeProfiler";

/** React Profiler bridge — evidence only (no behavior change when profiler off). */
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
