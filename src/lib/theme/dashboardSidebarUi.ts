/**
 * Shared semantic tokens for authenticated dashboard sidebars (business, employee, platform admin).
 */

export const DASHBOARD_SIDEBAR_SHELL_CLASS =
  "hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-sidebar-border lg:bg-sidebar lg:text-sidebar-foreground";

/** Mobile drawer panel — solid surface (no glass / transparency; matches desktop sidebar). */
export const DASHBOARD_MOBILE_DRAWER_PANEL_CLASS =
  "border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl";

export const dashboardSidebarNavLinkBase =
  "flex items-center gap-3 px-3 py-2.5 text-sm font-medium";

export const dashboardSidebarNavLinkIdle =
  "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground";

export const dashboardSidebarNavLinkActive =
  "font-semibold text-foreground shadow-[0_1px_2px_rgb(15_23_42/0.04)]";

export const dashboardSidebarIconButtonIdle =
  "transition-colors hover:bg-sidebar-accent";

export const dashboardSidebarSignOutButton =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sidebar-foreground/90 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground";

/** Sidebar billing entry — nav rhythm with primary accent. */
export const dashboardSidebarUpgradeLink =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-sidebar-accent hover:text-primary";
