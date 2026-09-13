import { Outlet } from "react-router";

/**
 * Dashboard child routes swap in place.
 * Never fade to opacity 0 — that blanked the workspace on every in-shell navigation.
 */
export function RouteOutletTransition() {
  return (
    <div className="caretip-route-outlet min-h-0 min-w-0">
      <Outlet />
    </div>
  );
}
