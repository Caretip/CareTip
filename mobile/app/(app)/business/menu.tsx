import { useRouter } from "expo-router";
import { useMemo } from "react";
import { AppMenuScreen } from "@/features/navigation/AppMenuScreen";
import { buildBusinessAppMenu } from "@/features/navigation/appMenuConfig";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";

export default function BusinessMenuRoute() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { data: unreadCount } = useUnreadNotificationCount(isAuthenticated);
  const items = useMemo(
    () => buildBusinessAppMenu(router, unreadCount && unreadCount > 0 ? unreadCount : undefined),
    [router, unreadCount],
  );

  return <AppMenuScreen role="business" items={items} />;
}
