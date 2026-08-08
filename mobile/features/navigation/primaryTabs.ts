/**
 * Primary bottom-tab route names per role.
 * Remaining destinations stay in the More menu (including Settings / Log out).
 */

export const EMPLOYEE_PRIMARY_TAB_ROUTES = [
  "index",
  "tips",
  "qr",
  "notifications",
  "menu",
] as const;

export const BUSINESS_PRIMARY_TAB_ROUTES = [
  "index",
  "activity",
  "tips",
  "notifications",
  "menu",
] as const;

export type EmployeePrimaryTabRoute = (typeof EMPLOYEE_PRIMARY_TAB_ROUTES)[number];
export type BusinessPrimaryTabRoute = (typeof BUSINESS_PRIMARY_TAB_ROUTES)[number];

/** Menu rows already exposed as primary tabs — keep More focused on secondary destinations. */
export const EMPLOYEE_MENU_PRIMARY_IDS = new Set(["tips", "qr", "inbox"]);
export const BUSINESS_MENU_PRIMARY_IDS = new Set(["activity", "tips", "inbox"]);
