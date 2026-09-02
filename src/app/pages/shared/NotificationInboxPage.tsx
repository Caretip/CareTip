import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useRequireAuth } from "@/app/hooks/useRequireAuth";
import { NotificationInboxFeed } from "@/app/components/notifications/NotificationInboxFeed";

export function NotificationInboxPage() {
  const { t } = useTranslation();
  const { user, authStatus, authReady } = useRequireAuth();
  const isPlatformAdmin = user?.role === "platform_admin" || user?.role === "admin";
  const isEmployee = user?.role === "employee";
  const isBusiness = user?.role === "business";
  const flushSurface = isEmployee || isBusiness;
  const notificationsEnabled =
    authReady && authStatus === "authenticated" && Boolean(user);

  const pageTitle = isPlatformAdmin
    ? t("admin.sidebar.navNotifications")
    : t("notifications.inbox.title");

  const pageSubtitle = isPlatformAdmin
    ? t("notifications.inbox.subtitleAdmin")
    : t("notifications.inbox.subtitle");

  return (
    <div
      className={cn(
        "dashboard-inbox-page w-full min-w-0 px-4 py-5 sm:px-6 sm:py-6",
        flushSurface && "dashboard-inbox-page--flush",
      )}
    >
      <NotificationInboxFeed
        enabled={notificationsEnabled}
        isPlatformAdmin={isPlatformAdmin}
        navRole={user?.role}
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        flushSurface={flushSurface}
      />
    </div>
  );
}
