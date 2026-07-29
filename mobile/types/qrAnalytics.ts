/** QR analytics DTO — mirrors web `BusinessQrAnalytics`. */

export type BusinessQrAnalytics = {
  timeframe?: string;
  totalScans?: number;
  uniqueScans?: number;
  tipsFromScans?: number;
  conversionRate?: number;
  topSources?: Array<{
    label: string;
    scans: number;
    tipsEur?: number;
  }>;
};
