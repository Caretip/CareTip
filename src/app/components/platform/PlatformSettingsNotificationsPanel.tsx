import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getMyAccountSettings, patchMyAccountSettings } from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import { registerFcmDeviceToken, unregisterFcmDeviceToken } from "../../lib/fcmPush";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { platformUi } from "./platformDashboardUi";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
} from "../../lib/pageSessionCache";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

export function PlatformSettingsNotificationsPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [systemAlerts, setSystemAlerts] = useState(true);
  const [notifyNewLogin, setNotifyNewLogin] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = "platform:admin-settings-prefs";
    const cached = getPageSessionCache<{ systemAlerts: boolean; notifyNewLogin: boolean }>(
      cacheKey,
      PAGE_CACHE_TTL_LOW_MS,
    );
    if (cached) {
      setSystemAlerts(cached.systemAlerts);
      setNotifyNewLogin(cached.notifyNewLogin);
      setLoading(false);
    }
    void (async () => {
      try {
        const prefs = await getMyAccountSettings();
        if (cancelled) return;
        setSystemAlerts(prefs.systemAlerts);
        setNotifyNewLogin(prefs.notifyNewLogin);
        setPageSessionCache(cacheKey, {
          systemAlerts: prefs.systemAlerts,
          notifyNewLogin: prefs.notifyNewLogin,
        });
      } catch (e) {
        logClientError("PlatformSettingsNotificationsPanel.load", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const savePrefs = async (patch: {
    systemAlerts?: boolean;
    notifyNewLogin?: boolean;
  }) => {
    setSaving(true);
    try {
      const updated = await patchMyAccountSettings(patch);
      setSystemAlerts(updated.systemAlerts);
      setNotifyNewLogin(updated.notifyNewLogin);
      const wantsPush = updated.systemAlerts || updated.notifyNewLogin;
      if (wantsPush) {
        await registerFcmDeviceToken({ requestPermission: true, dedupe: false });
      } else {
        await unregisterFcmDeviceToken();
      }
    } catch (e) {
      logClientError("PlatformSettingsNotificationsPanel.save", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={platformUi.contentCard}>
      <header className="mb-5 border-b border-border/60 pb-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("admin.platformSettings.notifications.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("admin.platformSettings.notifications.desc")}
        </p>
      </header>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("business.settings.loading")}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="platform-system-alerts">
                {t("admin.platformSettings.notifications.systemTitle")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("admin.platformSettings.notifications.systemDesc")}
              </p>
            </div>
            <Switch
              id="platform-system-alerts"
              checked={systemAlerts}
              disabled={saving}
              onCheckedChange={(next) => {
                setSystemAlerts(next);
                void savePrefs({ systemAlerts: next });
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="platform-login-alerts">
                {t("admin.platformSettings.notifications.loginTitle")}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("admin.platformSettings.notifications.loginDesc")}
              </p>
            </div>
            <Switch
              id="platform-login-alerts"
              checked={notifyNewLogin}
              disabled={saving}
              onCheckedChange={(next) => {
                setNotifyNewLogin(next);
                void savePrefs({ notifyNewLogin: next });
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("admin.platformSettings.notifications.hint")}
          </p>
        </div>
      )}
    </section>
  );
}
