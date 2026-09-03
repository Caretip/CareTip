import { motion } from 'motion/react';
import { memo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { CareIcon } from '@/components/icons';
import { useAuth } from '../hooks/useAuth';
import {
  isAuthLogoutTransitionActive,
  subscribeAuthLogoutTransition,
} from '../lib/authLogoutTransition';
import { cn } from '@/lib/utils';
import {
  DASHBOARD_SIDEBAR_SHELL_CLASS,
  dashboardSidebarSignOutButton,
} from "@/lib/theme/dashboardSidebarUi";
import { CareTipLogo, DASHBOARD_SIDEBAR_BRAND_CLASS, DASHBOARD_SIDEBAR_NAV_CLASS } from './CareTipLogo';
import { PlatformSidebarNavShell } from './platform/PlatformSidebarNavShell';
import { useDashboardRenderProbe } from '../hooks/useDashboardRuntimeProfile';

export const AdminSidebar = memo(function AdminSidebar() {
  useDashboardRenderProbe('platform_admin:AdminSidebar');
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const signingOut = useSyncExternalStore(
    subscribeAuthLogoutTransition,
    isAuthLogoutTransitionActive,
    () => false,
  );
  const displayName = user?.name || t("admin.fallbackAdminName");

  return (
    <motion.aside
      initial={false}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={cn("admin-sidebar", DASHBOARD_SIDEBAR_SHELL_CLASS)}
    >
      <div className={DASHBOARD_SIDEBAR_BRAND_CLASS}>
        <CareTipLogo size="sidebar" />
      </div>

      <nav className={cn(DASHBOARD_SIDEBAR_NAV_CLASS, "min-h-0 flex-1 overflow-y-auto overscroll-contain px-0")}>
        <PlatformSidebarNavShell />
      </nav>

      <div className="px-4 pb-4">
        <button
          type="button"
          disabled={signingOut}
          aria-busy={signingOut}
          onClick={() => {
            if (signingOut) return;
            logout();
          }}
          className={dashboardSidebarSignOutButton}
        >
          <CareIcon name="signOut" size="md" />
          {signingOut ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          ) : null}
          <span className="text-sm font-medium">{t('admin.sidebar.signOut')}</span>
        </button>
      </div>

      <div className="border-t border-sidebar-border p-3 sm:p-4">
        <div className="admin-identity flex items-center gap-3 px-1 py-2">
          <div className="admin-identity__avatar flex h-9 w-9 items-center justify-center rounded-full font-medium">
            {displayName.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email ?? ""}</p>
          </div>
        </div>
      </div>
    </motion.aside>
  );
});
