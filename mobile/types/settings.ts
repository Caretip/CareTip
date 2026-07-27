export type MyAccountSettings = {
  tipReceivedNotifications: boolean;
  summaryEmails: boolean;
  systemAlerts: boolean;
  notifyNewLogin: boolean;
  preferredLocale?: string | null;
};

export type TwoFactorStatus = {
  enabled: boolean;
};

export type TwoFactorSetup = {
  otpauthUrl: string;
  qrDataUrl: string;
};
