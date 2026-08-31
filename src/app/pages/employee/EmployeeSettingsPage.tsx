import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Settings, Upload, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import {
  getEmployeeProfile,
  patchEmployeeProfile,
  uploadEmployeeAvatar,
  changePasswordAPI,
  downloadMyDataExport,
  deleteMyEmployeeAccount,
} from "../../lib/api";
import { validateImageFileForUpload } from "../../lib/imageClientUpload";
import {
  getPasswordChecklist,
  isPasswordStrong,
  getPasswordStrength,
} from "../../lib/passwordValidation";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { registerFcmDeviceToken, unregisterFcmDeviceToken } from "../../lib/fcmPush";
import { ThemeAppearanceControl } from "@/app/components/theme/ThemeAppearanceControl";
import { LinkedOAuthAccountsSection } from "@/app/components/business/settings/LinkedOAuthAccountsSection";
import { changeAppLanguage, type AppLanguage } from "@/i18n/i18n";
import { EmployeeSettingsFormSkeleton } from "../../components/dashboard/DashboardSectionLoading";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Switch } from "../../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { EmployeePageHeader } from "../../components/employee/EmployeePageHeader";
import { employeeUi } from "../../components/employee/employeeDashboardUi";
import { cn } from "@/lib/utils";
import {
  getPageSessionCache,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
} from "../../lib/pageSessionCache";

type EmployeeSettingsCache = {
  name: string;
  bio: string;
  businessName: string;
  monthlyGoal: string;
  emailNotif: boolean;
  pushNotif: boolean;
};

const TEAL = "#e9781c";

export function EmployeeSettingsPage() {
  const { t, i18n } = useTranslation();
  const { user, logout, updateUser } = useRequireAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [businessName, setBusinessName] = useState<string>("");
  const [monthlyGoal, setMonthlyGoal] = useState("");
  const [emailNotif, setEmailNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(true);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!user || user.role !== "employee") return;
    let cancelled = false;
    const cacheKey = `employee:settings:${user.id}`;
    const cached = getPageSessionCache<EmployeeSettingsCache>(cacheKey, PAGE_CACHE_TTL_LOW_MS);
    if (cached) {
      setName(cached.name);
      setBio(cached.bio);
      setBusinessName(cached.businessName);
      setMonthlyGoal(cached.monthlyGoal);
      setEmailNotif(cached.emailNotif);
      setPushNotif(cached.pushNotif);
      setLoading(false);
    } else {
      setLoading(true);
    }
    (async () => {
      try {
        const p = await getEmployeeProfile();
        if (cancelled) return;
        const snapshot: EmployeeSettingsCache = {
          name: p.name,
          bio: p.bio ?? "",
          businessName: p.businessName ?? "",
          monthlyGoal: p.monthlyGoal != null ? String(p.monthlyGoal) : "",
          emailNotif: p.emailNotifications,
          pushNotif: p.pushNotifications,
        };
        setName(snapshot.name);
        setBio(snapshot.bio);
        setBusinessName(snapshot.businessName);
        setMonthlyGoal(snapshot.monthlyGoal);
        setEmailNotif(snapshot.emailNotif);
        setPushNotif(snapshot.pushNotif);
        setPageSessionCache(cacheKey, snapshot);
        updateUser({ avatar: p.avatar ?? undefined, name: p.name });
      } catch (err) {
        logClientError("EmployeeSettingsPage", err);
        if (!cached) toast.error(t("employee.settings.toastLoadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- full `user` would loop after updateUser
  }, [user?.role, user?.id, updateUser, t]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const mg = monthlyGoal.trim() === "" ? null : Number(monthlyGoal);
      if (monthlyGoal.trim() !== "" && (Number.isNaN(mg) || mg! < 0)) {
        toast.error(t("employee.settings.toastMonthlyGoalInvalid"));
        setSaving(false);
        return;
      }
      const updated = await patchEmployeeProfile({
        name: name.trim(),
        bio: bio.trim() || null,
        monthlyGoal: mg,
        emailNotifications: emailNotif,
        pushNotifications: pushNotif,
      });
      if (pushNotif) {
        await registerFcmDeviceToken({ requestPermission: true, dedupe: false });
      } else {
        await unregisterFcmDeviceToken();
      }
      updateUser({ name: updated.name, avatar: updated.avatar ?? undefined });
    } catch (e) {
      logClientError("EmployeeSettingsPage", e);
      toast.error(toUserFriendlyMessage(e, { audience: "employee" }));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const check = validateImageFileForUpload(file);
    if (!check.ok) {
      toast.error(toUserFriendlyMessage(new Error(check.message), { audience: "employee" }));
      return;
    }
    setUploading(true);
    try {
      const { avatar } = await uploadEmployeeAvatar(file);
      const base = avatar.split("?")[0];
      updateUser({ avatar: `${base}?v=${Date.now()}` });
    } catch (err) {
      logClientError("EmployeeSettingsPage", err);
      toast.error(toUserFriendlyMessage(err, { audience: "employee" }));
    } finally {
      setUploading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!isPasswordStrong(newPw)) {
      toast.error(t("employee.settings.toastPasswordWeak"));
      return;
    }
    try {
      await changePasswordAPI(currentPw, newPw);
      setCurrentPw("");
      setNewPw("");
      toast.success(t("employee.settings.toastPasswordUpdated"), { style: { background: TEAL, color: "#fff" } });
    } catch (err) {
      logClientError("EmployeeSettingsPage", err);
      toast.error(toUserFriendlyMessage(err, { audience: "employee" }));
    }
  };

  const handleDownload = async () => {
    try {
      await downloadMyDataExport();
      toast.success(t("employee.settings.toastDownloadStarted"));
    } catch (err) {
      logClientError("EmployeeSettingsPage", err);
      toast.error(t("employee.settings.toastDownloadFailed"));
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteMyEmployeeAccount();
      logout();
      navigate("/", { replace: true });
      toast.success(t("employee.settings.toastAccountDeleted"));
    } catch (err) {
      logClientError("EmployeeSettingsPage", err);
      toast.error(t("employee.settings.toastDeleteFailed"));
    }
  };

  const checklist = getPasswordChecklist(newPw);
  const strength = getPasswordStrength(newPw);

  const isInitialSettingsLoad = loading && !name && !businessName;

  if (!user || user.role !== "employee") {
    return null;
  }

  return (
    <div className={employeeUi.page}>
      <div className={cn(employeeUi.pageInner, "dashboard-page-narrow mx-auto max-w-2xl space-y-6 max-lg:space-y-5")}>
        <EmployeePageHeader
          title={t("employee.settings.title")}
          description={businessName || t("dashboard.venueDashboardFallback")}
          backAriaLabel={t("employee.notifications.backAria")}
          leading={
            <div className={employeeUi.iconTileMuted}>
              <Settings className="h-5 w-5" aria-hidden />
            </div>
          }
        />

        {isInitialSettingsLoad ? (
          <EmployeeSettingsFormSkeleton />
        ) : (
          <>
        <section className={employeeUi.settingsSection}>
          <h3 className={employeeUi.settingsHeading}>
            {t("employee.settings.photoSection")}
          </h3>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <ProfileAvatar
              key={user.avatar ?? "none"}
              src={user.avatar}
              displayName={user.name ?? "You"}
              className="h-24 w-24 border-2 border-border shadow-md sm:h-28 sm:w-28"
            />
          </div>
          <label className={cn(employeeUi.btnPrimary, "inline-flex cursor-pointer items-center gap-2 text-sm font-medium disabled:opacity-50")}>
            <Upload className="w-4 h-4" />
            {uploading ? t("employee.settings.uploading") : t("employee.settings.uploadImage")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,image/avif,.heic,.heif"
              className="hidden"
              onChange={handleAvatar}
              disabled={uploading}
            />
          </label>
          <p className="text-xs text-muted-foreground">{t("employee.settings.photoHint")}</p>
        </section>

        <section className={employeeUi.settingsSection}>
          <h3 className={employeeUi.settingsHeading}>
            {t("employee.settings.profileSection")}
          </h3>
          <div>
            <Label htmlFor="emp-name">{t("employee.settings.labelName")}</Label>
            <Input id="emp-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="emp-bio">{t("employee.settings.labelBio")}</Label>
            <textarea
              id="emp-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="emp-goal">{t("employee.settings.labelMonthlyGoal")}</Label>
            <Input
              id="emp-goal"
              type="number"
              min={0}
              step="0.01"
              value={monthlyGoal}
              onChange={(e) => setMonthlyGoal(e.target.value)}
              className="mt-1"
              placeholder={t("employee.settings.placeholderGoal")}
            />
          </div>
          <Button type="button" onClick={handleSaveProfile} disabled={saving} className={employeeUi.btnPrimary}>
            {saving ? t("employee.settings.saving") : t("employee.settings.saveProfile")}
          </Button>
        </section>

        <section className={employeeUi.settingsSection}>
          <h3 className={employeeUi.settingsHeading}>
            {t("employee.settings.securitySection")}
          </h3>
          <LinkedOAuthAccountsSection />
          <div>
            <Label htmlFor="cur-pw">{t("employee.settings.currentPassword")}</Label>
            <div className="relative mt-1">
              <Input
                id="cur-pw"
                type={showCur ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                onClick={() => setShowCur(!showCur)}
                aria-label={t("employee.settings.toggleVisibility")}
              >
                {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="new-pw">{t("employee.settings.newPassword")}</Label>
            <div className="relative mt-1">
              <Input
                id="new-pw"
                type={showNew ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                onClick={() => setShowNew(!showNew)}
                aria-label={t("employee.settings.toggleVisibility")}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${strength.score}%`,
                  backgroundColor: strength.strength === "strong" ? TEAL : strength.strength === "fair" ? "#fb923c" : "#ef4444",
                }}
              />
            </div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {[
                { key: "minLength", label: t("employee.settings.pwMinLength"), met: checklist.minLength },
                { key: "upper", label: t("employee.settings.pwUpper"), met: checklist.hasUppercase },
                { key: "lower", label: t("employee.settings.pwLower"), met: checklist.hasLowercase },
                { key: "num", label: t("employee.settings.pwNumber"), met: checklist.hasNumber },
                { key: "spec", label: t("employee.settings.pwSpecial"), met: checklist.hasSpecial },
              ].map(({ key, label, met }) => (
                <li key={key} className={`flex items-center gap-2 ${met ? "text-primary" : ""}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${met ? "bg-primary text-white" : "bg-muted"}`}>
                    {met ? <Check className="w-2.5 h-2.5" /> : null}
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
          <Button
            type="button"
            onClick={handleChangePassword}
            disabled={!currentPw || !newPw}
            variant="outline"
            className={employeeUi.btnSecondary}
          >
            {t("employee.settings.changePassword")}
          </Button>
        </section>

        <section className={employeeUi.settingsSection}>
          <h3 className={employeeUi.settingsHeading}>
            {t("employee.settings.displayPrefsSection")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("employee.settings.displayPrefsHint")}</p>
          <ThemeAppearanceControl variant="inline" />
          <div className="max-w-sm space-y-2 pt-2">
            <Label htmlFor="employee-settings-language">{t("employee.settings.languageLabel")}</Label>
            <Select
              value={i18n.language?.startsWith("de") ? "de" : "en"}
              onValueChange={(lng) => {
                void changeAppLanguage(lng as AppLanguage);
              }}
            >
              <SelectTrigger id="employee-settings-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("business.settings.language.en")}</SelectItem>
                <SelectItem value="de">{t("business.settings.language.de")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className={employeeUi.settingsSection}>
          <h3 className={employeeUi.settingsHeading}>
            {t("employee.settings.prefsSection")}
          </h3>
          <div className="flex items-center justify-between">
            <Label htmlFor="email-n">{t("employee.settings.emailNotif")}</Label>
            <Switch id="email-n" checked={emailNotif} onCheckedChange={setEmailNotif} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="push-n">{t("employee.settings.pushNotif")}</Label>
            <Switch id="push-n" checked={pushNotif} onCheckedChange={setPushNotif} />
          </div>
          <p className="text-xs text-muted-foreground">{t("employee.settings.prefsHint")}</p>
        </section>

        <section className={employeeUi.settingsSection}>
          <h3 className={employeeUi.settingsHeading}>
            {t("employee.settings.dataSection")}
          </h3>
          <Button type="button" variant="outline" onClick={handleDownload} className={cn(employeeUi.btnSecondary, "w-full sm:w-auto")}>
            {t("employee.settings.downloadMyData")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" className="w-full sm:w-auto">
                {t("employee.settings.deleteAccount")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("employee.settings.deleteConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("employee.settings.deleteConfirmDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("employee.settings.dialogCancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAccount} className="bg-destructive text-destructive-foreground">
                  {t("employee.settings.deletePermanently")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
          </>
        )}
      </div>
    </div>
  );
}
