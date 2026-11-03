import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { notifyDeployUpdateRouteChange } from "../lib/deployUpdate/runtime";

/** Reports committed in-app navigations — the safest moment to apply a pending deployment. */
export function DeployUpdateRouteObserver(): null {
  const location = useLocation();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const key = `${location.pathname}${location.search}`;
    if (previous.current === null) {
      previous.current = key;
      return;
    }
    if (previous.current === key) return;
    previous.current = key;
    notifyDeployUpdateRouteChange();
  }, [location.pathname, location.search]);

  return null;
}
