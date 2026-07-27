export type QrItemType = "business" | "employee" | "location" | "table";

export type QrCodeItem = {
  id: string;
  type: QrItemType;
  title: string;
  subtitle?: string | null;
  url: string;
  slug?: string | null;
};

export type BusinessQrAnalyticsTimeframe = "week" | "month" | "year";

export type QrRecentScan = {
  scannedAt: string;
  scanType: string;
  label: string;
};

export type BusinessQrAnalytics = {
  timeframe: BusinessQrAnalyticsTimeframe;
  totalScans: number;
  uniqueScans: number;
  repeatScans: number;
  recentScans: QrRecentScan[];
};

export type LocationItem = {
  id: string;
  name: string;
  [key: string]: unknown;
};

export type TableItem = {
  id: string;
  name: string;
  qrSlug?: string | null;
  locationId?: string | null;
  location?: { id: string; name: string } | null;
  [key: string]: unknown;
};

export type EmployeeQrItem = {
  id: string;
  name: string;
  slug?: string | null;
  jobTitle?: string | null;
  avatar?: string | null;
};
