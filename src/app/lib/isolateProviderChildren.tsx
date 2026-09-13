import { memo, type ReactNode } from "react";

/**
 * Keeps routed UI from re-rendering when an ancestor provider’s own state
 * changes. Only works when `children` is a stable element from a parent that
 * did not re-render (typical for app-root providers wrapping RouterProvider).
 */
export const IsolateProviderChildren = memo(function IsolateProviderChildren({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
});
