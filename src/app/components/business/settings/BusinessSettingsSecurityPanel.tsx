import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Edit2, Eye, EyeOff, Lock, Save, Shield, X } from "lucide-react";
import { toast } from "sonner";
import {
  changePasswordAPI,
  disableTwoFactor,
  enableTwoFactor,
  setupTwoFactor,
} from "../../../lib/api";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";
import { BusinessSettingsPanelShell } from "./BusinessSettingsPanelShell";
import { LinkedOAuthAccountsSection } from "./LinkedOAuthAccountsSection";
import type { useBusinessSettingsData } from "./useBusinessSettingsData";

const TEAL = "#e9781c";

type Props = Pick<
  ReturnType<typeof useBusinessSettingsData>,
  "loading" | "twoFactorEnabled" | "setTwoFactorEnabled"
>;

export function BusinessSettingsSecurityPanel({ loading, twoFactorEnabled, setTwoFactorEnabled }: Props) {
  const { t } = useTranslation();
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [twoFactorQr, setTwoFactorQr] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const handleSavePassword = async () => {
    setSavingPassword(true);
    try {
      if (newPassword !== confirmPassword) {
        toast.error(t("business.accountSettings.toastPasswordMismatch"));
        return;
      }
      await changePasswordAPI(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setIsEditingPassword(false);
      toast.success(t("business.accountSettings.toastPasswordUpdated"), {
        style: { background: TEAL, color: "#fff" },
      });
    } catch (e) {
      logClientError("BusinessSettingsSecurityPanel.password", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <BusinessSettingsPanelShell grouped
        title={t("business.accountSettings.passwordTitle")}
        description={t("business.accountSettings.passwordDesc")}
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("business.settings.loading")}</p>
        ) : isEditingPassword ? (
          <div className="space-y-4">
            {[
              {
                label: t("business.accountSettings.labelCurrentPw"),
                value: currentPassword,
                set: setCurrentPassword,
                show: showCurrentPassword,
                toggle: () => setShowCurrentPassword((v) => !v),
              },
              {
                label: t("business.accountSettings.labelNewPw"),
                value: newPassword,
                set: setNewPassword,
                show: showNewPassword,
                toggle: () => setShowNewPassword((v) => !v),
              },
              {
                label: t("business.accountSettings.labelConfirmPw"),
                value: confirmPassword,
                set: setConfirmPassword,
                show: showConfirmPassword,
                toggle: () => setShowConfirmPassword((v) => !v),
              },
            ].map((field) => (
              <div key={field.label}>
                <label className="mb-2 block text-sm font-medium">{field.label}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={field.show ? "text" : "password"}
                    value={field.value}
                    onChange={(e) => field.set(e.target.value)}
                    className="w-full rounded-lg border border-border bg-input-background py-3 pl-11 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="button"
                    onClick={field.toggle}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={t("business.accountSettings.togglePwVisibility")}
                  >
                    {field.show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={savingPassword}
                onClick={() => void handleSavePassword()}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white"
              >
                <Save className="h-4 w-4" />
                {t("business.accountSettings.updatePassword")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setIsEditingPassword(false);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm"
              >
                <X className="h-4 w-4" />
                {t("business.accountSettings.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t("business.accountSettings.passwordHint")}</p>
            <button
              type="button"
              onClick={() => setIsEditingPassword(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              <Edit2 className="h-4 w-4" />
              {t("business.accountSettings.changeShort")}
            </button>
          </div>
        )}
      </BusinessSettingsPanelShell>

      <BusinessSettingsPanelShell grouped
        title={t("business.accountSettings.linkedAccountsTitle")}
        description={t("business.accountSettings.linkedAccountsDesc")}
      >
        <LinkedOAuthAccountsSection loading={loading} />
      </BusinessSettingsPanelShell>

      <BusinessSettingsPanelShell grouped
        title={t("business.accountSettings.twoFactorTitle")}
        description={t("business.accountSettings.twoFactorDesc")}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {twoFactorEnabled
              ? t("business.settings.panels.twoFactorOn")
              : t("business.settings.panels.twoFactorOff")}
          </p>
          {!twoFactorEnabled ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                void setupTwoFactor()
                  .then((r) => {
                    setTwoFactorQr(r.qrDataUrl || "");
                    toast.success(t("business.accountSettings.toast2faScan"), {
                      style: { background: TEAL, color: "#fff" },
                    });
                  })
                  .catch((e) => {
                    logClientError("BusinessSettingsSecurityPanel.2fa.setup", e);
                    toast.error(toUserFriendlyMessage(e));
                  });
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              {t("business.accountSettings.setup2fa")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setTwoFactorQr("disable")}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              {t("business.accountSettings.disable2fa")}
            </button>
          )}
        </div>
        {!twoFactorEnabled && twoFactorQr && twoFactorQr !== "disable" ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <img
              src={twoFactorQr}
              alt={t("business.accountSettings.twoFactorQrAlt")}
              className="max-w-[220px] rounded-md bg-white p-2"
            />
            <div className="space-y-3">
              <input
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("business.accountSettings.phCode")}
                inputMode="numeric"
                maxLength={6}
                className="w-full rounded-lg border border-border px-4 py-3 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  void enableTwoFactor(twoFactorCode)
                    .then((r) => {
                      setTwoFactorEnabled(r.enabled);
                      setTwoFactorQr("");
                      setTwoFactorCode("");
                      toast.success(t("business.accountSettings.toast2faEnabled"), {
                        style: { background: TEAL, color: "#fff" },
                      });
                    })
                    .catch((e) => {
                      logClientError("BusinessSettingsSecurityPanel.2fa.enable", e);
                      toast.error(toUserFriendlyMessage(e));
                    });
                }}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white"
              >
                {t("business.accountSettings.enable2fa")}
              </button>
            </div>
          </div>
        ) : null}
        {twoFactorEnabled && twoFactorQr === "disable" ? (
          <div className="mt-6 space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <input
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t("business.accountSettings.phCode")}
              inputMode="numeric"
              maxLength={6}
              className="w-full rounded-lg border border-border px-4 py-3 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void disableTwoFactor(twoFactorCode)
                    .then((r) => {
                      setTwoFactorEnabled(r.enabled);
                      setTwoFactorQr("");
                      setTwoFactorCode("");
                      toast.success(t("business.accountSettings.toast2faDisabled"), {
                        style: { background: TEAL, color: "#fff" },
                      });
                    })
                    .catch((e) => {
                      logClientError("BusinessSettingsSecurityPanel.2fa.disable", e);
                      toast.error(toUserFriendlyMessage(e));
                    });
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                {t("business.accountSettings.disable")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTwoFactorQr("");
                  setTwoFactorCode("");
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                {t("business.accountSettings.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </BusinessSettingsPanelShell>
    </div>
  );
}
