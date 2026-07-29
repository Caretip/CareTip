import { useRouter } from "expo-router";
import { useMemo } from "react";
import { AppMenuScreen } from "@/features/navigation/AppMenuScreen";
import { buildEmployeeAppMenu } from "@/features/navigation/appMenuConfig";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";

export default function EmployeeMenuRoute() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { data: unreadCount } = useUnreadNotificationCount(isAuthenticated);
  const items = useMemo(
    () => buildEmployeeAppMenu(router, unreadCount && unreadCount > 0 ? unreadCount : undefined),
    [router, unreadCount],
  );

  return <AppMenuScreen role="employee" items={items} />;
}
