import { useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate, type LinkProps } from "react-router";
import { prefetchAuthenticatedRoute } from "../lib/prefetchAuthenticatedRoutes";
import { prefetchCustomerFlowRoute } from "../lib/prefetchCustomerRoutes";
import { prefetchPublicRoute } from "../lib/prefetchPublicRoutes";
import { ensureAuthEntryRouteCode } from "../routing/routeLazy";

type PrefetchLinkProps = LinkProps;

function routePathFromTo(to: LinkProps["to"]): string {
  if (typeof to === "string") return to.split("#")[0].split("?")[0];
  if (to && typeof to === "object" && "pathname" in to && to.pathname) {
    return String(to.pathname);
  }
  return "";
}

function warmRoute(path: string): void {
  if (!path.startsWith("/")) return;
  prefetchPublicRoute(path);
  prefetchAuthenticatedRoute(path);
  prefetchCustomerFlowRoute(path);
}

/** React Router's per-entry history key — changes when any navigation happens. */
function currentHistoryKey(): unknown {
  try {
    return (window.history.state as { key?: unknown } | null)?.key ?? null;
  } catch {
    return null;
  }
}

function isPlainLeftClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  return e.button === 0 && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey;
}

export function PrefetchLink({
  to,
  onMouseEnter,
  onFocus,
  onTouchStart,
  onClick,
  replace,
  state,
  preventScrollReset,
  relative,
  viewTransition,
  ...rest
}: PrefetchLinkProps) {
  const navigate = useNavigate();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const path = routePathFromTo(to);

  const warm = () => {
    warmRoute(path);
  };

  /**
   * Signed-out entry pages (login / sign-up) are code-split behind a full-screen Suspense fallback.
   * Navigating before their code has arrived committed the route and showed that fallback over a
   * page that was already on screen — the Login-button loader flash. Wait for the code instead and
   * navigate when it is there, as React Router does for `lazy` routes; nothing else is delayed.
   */
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (pendingRef.current) {
      e.preventDefault();
      return;
    }
    if (!isPlainLeftClick(e) || rest.reloadDocument || (rest.target && rest.target !== "_self")) return;
    const codeReady = ensureAuthEntryRouteCode(path);
    if (!codeReady) return;
    e.preventDefault();
    pendingRef.current = true;
    setPending(true);
    const keyAtClick = currentHistoryKey();
    void codeReady.then(() => {
      pendingRef.current = false;
      setPending(false);
      // The user went somewhere else meanwhile: do not pull them back.
      if (currentHistoryKey() !== keyAtClick) return;
      // Navigate even if this link unmounted meanwhile (the mobile drawer closes on tap).
      navigate(to, { replace, state, preventScrollReset, relative, viewTransition });
    });
  };

  return (
    <Link
      to={to}
      replace={replace}
      state={state}
      preventScrollReset={preventScrollReset}
      relative={relative}
      viewTransition={viewTransition}
      aria-busy={pending || undefined}
      data-route-pending={pending ? "" : undefined}
      onClick={handleClick}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      {...rest}
    />
  );
}
