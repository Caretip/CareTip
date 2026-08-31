import { QR_STUDIO_BASE } from "@/app/components/business/businessDashboardNav";

/** QR categories shown in QR Studio navigation. */
export type QrStudioCategory = "business" | "employees" | "tables" | "locations";

/** Print marketplace focus — maps to physical QR context types. */
export type QrStudioPrintFocus = "storefront" | "employee" | "table" | "location";

const VIEW_PATH: Record<QrStudioCategory, string> = {
  business: `${QR_STUDIO_BASE}/business`,
  employees: `${QR_STUDIO_BASE}/employees`,
  tables: `${QR_STUDIO_BASE}/tables`,
  locations: `${QR_STUDIO_BASE}/locations`,
};

const PRINT_FOCUS: Record<QrStudioCategory, QrStudioPrintFocus> = {
  business: "storefront",
  employees: "employee",
  tables: "table",
  locations: "location",
};

const FOCUS_ALIASES: Record<string, QrStudioPrintFocus> = {
  storefront: "storefront",
  business: "storefront",
  employee: "employee",
  employees: "employee",
  table: "table",
  tables: "table",
  location: "location",
  locations: "location",
};

export function qrStudioViewPath(category: QrStudioCategory): string {
  return VIEW_PATH[category];
}

export function qrStudioPrintPath(category: QrStudioCategory): string {
  return `${QR_STUDIO_BASE}/print?focus=${PRINT_FOCUS[category]}`;
}

export function parseQrStudioPrintFocus(raw: string | null | undefined): QrStudioPrintFocus | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return FOCUS_ALIASES[key] ?? null;
}

export function printFocusSectionId(focus: QrStudioPrintFocus): string {
  return `print-focus-${focus}`;
}

export function qrStudioCategoryFromViewMode(
  viewMode: "gallery" | "employees" | "locations" | "business",
): QrStudioCategory | null {
  if (viewMode === "gallery") return null;
  if (viewMode === "business") return "business";
  if (viewMode === "employees") return "employees";
  return "locations";
}

const FOCUS_TO_CATEGORY: Record<QrStudioPrintFocus, QrStudioCategory> = {
  storefront: "business",
  employee: "employees",
  table: "tables",
  location: "locations",
};

export function qrStudioCategoryFromPrintFocus(focus: QrStudioPrintFocus): QrStudioCategory {
  return FOCUS_TO_CATEGORY[focus];
}

export function printFocusForGroup(
  qrContextType: "storefront" | "employee" | "table" | "location",
): QrStudioPrintFocus {
  return qrContextType;
}
