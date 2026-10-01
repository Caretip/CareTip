import { useLocation, useNavigation } from "react-router";

/**
 * Pathname used for sidebar active / pending styles.
 * While React Router is loading a lazy route, `useLocation()` can lag;
 * `navigation.location` reflects the destination immediately after click.
 */
export function useBusinessSidebarNavigationPath(): { pathname: string; search: string; pending: boolean } {
  const location = useLocation();
  const navigation = useNavigation();
  const pending = navigation.state === "loading" && navigation.location != null;
  const activeLocation = pending && navigation.location ? navigation.location : location;

  return {
    pathname: activeLocation.pathname,
    search: activeLocation.search,
    pending,
  };
}
