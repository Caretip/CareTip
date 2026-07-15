import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { patchMyAccountSettings } from "../../../lib/api";
import { logClientError } from "../../../lib/clientLog";
import { registerFcmDeviceToken, unregisterFcmDeviceToken } from "../../../lib/fcmPush";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import { BusinessSettingsPanelShell } from "./BusinessSettingsPanelShell";
import type { useBusinessSettingsData } from "./useBusinessSettingsData";

type Props = Pick<
  ReturnType<typeof useBusinessSettingsData>,
  | "loading"
  | "tipReceivedNotifications"
  | "setTipReceivedNotifications"
  | "summaryEmails"
  | "setSummaryEmails"
  | "systemAlerts"
  | "setSystemAlerts"
  | "notifyNewLogin"
  | "setNotifyNewLogin"
>;

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onToggle,
  ariaLabel,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-4 last:border-0 last:pb-0">
      <div className="flex gap-3">
        <div className="rounded-lg bg-accent/10 p-2">
          <Mail className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-border"
        } ${disabled ? "opacity-60" : ""}`}
        aria-label={ariaLabel}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export function BusinessSettingsNotificationsPanel({
  loading,
  tipReceivedNotifications,
  setTipReceivedNotifications,
  summaryEmails,
  setSummaryEmails,
  systemAlerts,
  setSystemAlerts,
  notifyNewLogin,
  setNotifyNewLogin,
}: Props) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  const savePrefs = async (patch: Parameters<typeof patchMyAccountSettings>[0]) => {
    setSaving(true);
    try {
      const updated = await patchMyAccountSettings(patch);
      setTipReceivedNotifications(updated.tipReceivedNotifications);
      setSummaryEmails(updated.summaryEmails);
      setSystemAlerts(updated.systemAlerts);
      setNotifyNewLogin(updated.notifyNewLogin);
      const wantsPush =
        updated.tipReceivedNotifications ||
        updated.systemAlerts ||
        updated.notifyNewLogin;
      if (wantsPush) {
        await registerFcmDeviceToken({ requestPermission: true, dedupe: false });
      } else {
        await unregisterFcmDeviceToken();
      }
    } catch (e) {
      logClientError("BusinessSettingsNotificationsPanel.save", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BusinessSettingsPanelShell embedded>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("business.settings.loading")}</p>
      ) : (
        <div>
          <ToggleRow
            title={t("business.accountSettings.tipNotifTitle")}
            description={t("business.accountSettings.tipNotifDesc")}
            checked={tipReceivedNotifications}
            disabled={saving}
            ariaLabel={t("business.accountSettings.ariaTipNotif")}
            onToggle={() => {
              const next = !tipReceivedNotifications;
              setTipReceivedNotifications(next);
              void savePrefs({ tipReceivedNotifications: next });
            }}
          />
          <ToggleRow
            title={t("business.accountSettings.summaryTitle")}
            description={t("business.accountSettings.summaryDesc")}
            checked={summaryEmails}
            disabled={saving}
            ariaLabel={t("business.accountSettings.ariaSummary")}
            onToggle={() => {
              const next = !summaryEmails;
              setSummaryEmails(next);
              void savePrefs({ summaryEmails: next });
            }}
          />
          <ToggleRow
            title={t("business.accountSettings.systemTitle")}
            description={t("business.accountSettings.systemDesc")}
            checked={systemAlerts}
            disabled={saving}
            ariaLabel={t("business.accountSettings.ariaSystem")}
            onToggle={() => {
              const next = !systemAlerts;
              setSystemAlerts(next);
              void savePrefs({ systemAlerts: next });
            }}
          />
          <ToggleRow
            title={t("business.accountSettings.loginTitle")}
            description={t("business.accountSettings.loginDesc")}
            checked={notifyNewLogin}
            disabled={saving}
            ariaLabel={t("business.accountSettings.ariaLogin")}
            onToggle={() => {
              const next = !notifyNewLogin;
              setNotifyNewLogin(next);
              void savePrefs({ notifyNewLogin: next });
            }}
          />
        </div>
      )}
    </BusinessSettingsPanelShell>
  );
}
