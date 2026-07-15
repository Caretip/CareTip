import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail, Phone, Save, User, X } from "lucide-react";
import { toast } from "sonner";
import { patchBusinessProfile } from "../../../lib/api";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import { BusinessSettingsPanelShell } from "./BusinessSettingsPanelShell";
import type { useBusinessSettingsData } from "./useBusinessSettingsData";

type Props = Pick<
  ReturnType<typeof useBusinessSettingsData>,
  "user" | "loading" | "contactPhone" | "setContactPhone" | "initialPhone" | "setInitialPhone"
>;

export function BusinessSettingsGeneralPanel({
  user,
  loading,
  contactPhone,
  setContactPhone,
  initialPhone,
  setInitialPhone,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const managerName = user?.name?.trim() || "";
  const email = user?.email?.trim() || "";

  const handleSave = async () => {
    if (!user || user.role !== "business") return;
    setSaving(true);
    try {
      await patchBusinessProfile({
        contactPhone: contactPhone.trim() || null,
      });
      setInitialPhone(contactPhone);
      setEditing(false);
    } catch (e) {
      logClientError("BusinessSettingsGeneralPanel.save", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setContactPhone(initialPhone);
    setEditing(false);
  };

  return (
    <BusinessSettingsPanelShell embedded>
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("business.settings.loading")}</p>
      ) : (
        <div className="space-y-5">
          <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {t("business.settings.panels.generalHint")}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              {t("business.settings.panels.managerName")}
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={managerName}
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-border bg-input-background py-3 pl-11 pr-4 text-sm opacity-70"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              {t("business.accountSettings.labelEmailReadonly")}
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="email"
                value={email}
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-border bg-input-background py-3 pl-11 pr-4 text-sm opacity-70"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              {t("business.accountSettings.labelContactPhone")}
            </label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                disabled={!editing}
                placeholder={t("business.accountSettings.phPhone")}
                className={`w-full rounded-lg border border-border bg-input-background py-3 pl-11 pr-4 text-sm transition-all ${
                  editing
                    ? "text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent"
                    : "cursor-not-allowed opacity-70"
                }`}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row">
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex min-h-[44px] touch-manipulation items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                {t("business.accountSettings.editShort")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="inline-flex min-h-[44px] touch-manipulation items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? t("common.savingChanges") : t("business.accountSettings.saveProfile")}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleCancel}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                  {t("business.accountSettings.cancel")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </BusinessSettingsPanelShell>
  );
}
