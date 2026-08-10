import { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import {
  fetchPlatformBusiness,
  updatePlatformBusinessOnboardingStatus,
  updatePlatformBusinessKycStatus,
  updatePlatformBusinessSubscriptionTier,
  updatePlatformBusinessKyc,
  uploadPlatformBusinessLogo,
  uploadPlatformBusinessVerification,
  fetchAuthedObjectUrl,
  type PlatformBusinessRow,
  type PlatformOnboardingVerificationAction,
  type PlatformVerificationAction,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { EmployeeSettingsFormSkeleton } from "../../components/dashboard/DashboardSectionLoading";
import { formatEur } from "../../lib/formatEur";
import { BusinessLogoMark } from "../../components/business/BusinessLogoMark";
import { PlatformPage, PlatformPageHeader } from "../../components/platform/PlatformPageChrome";
import { PlatformSponsoredAccessSection } from "../../components/platform/PlatformSponsoredAccessSection";
import { PlatformLegalHoldPanel } from "../../components/platform/PlatformLegalHoldPanel";
import { BusinessWorkflowVerificationPanels } from "../../components/platform/BusinessWorkflowVerificationPanels";
import { platformUi } from "../../components/platform/platformDashboardUi";
import { cn } from "@/lib/utils";

export function BusinessDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<PlatformBusinessRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState<"basic" | "premium" | "enterprise">("premium");
  const [tierSaving, setTierSaving] = useState(false);
  const [form, setForm] = useState({
    legalContactName: "",
    contactEmail: "",
    contactPhone: "",
    website: "",
    registeredAddress: "",
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetchPlatformBusiness(id);
      setRow(res.business);
    } catch (e) {
      logClientError("BusinessDetailPage.load", e);
      toast.error(toUserFriendlyMessage(e));
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!row) return;
    setForm({
      legalContactName: row.legalContactName ?? "",
      contactEmail: row.contactEmail ?? "",
      contactPhone: row.contactPhone ?? "",
      website: row.website ?? "",
      registeredAddress: row.registeredAddress ?? "",
    });
    setSubscriptionTier(row.subscriptionTier ?? "premium");
  }, [row]);

  const handleOnboardingAction = async (action: PlatformOnboardingVerificationAction) => {
    if (!id) return;
    let reviewNote: string | undefined;
    if (action === "rejected") {
      reviewNote = window.prompt(t("admin.businessVerificationPage.rejectNotePrompt")) ?? undefined;
    }
    try {
      await updatePlatformBusinessOnboardingStatus(id, action, reviewNote);
      toast.success(
        action === "approved"
          ? t("admin.businessDetailPage.toastOnboardingApproved")
          : action === "rejected"
            ? t("admin.businessDetailPage.toastOnboardingRejected")
            : t("admin.businessVerificationPage.toastStatusUpdated"),
      );
      await load();
    } catch (e) {
      logClientError("BusinessDetailPage.handleOnboardingAction", e);
      toast.error(toUserFriendlyMessage(e));
    }
  };

  const handleKycAction = async (status: PlatformVerificationAction) => {
    if (!id) return;
    let reviewNote: string | undefined;
    if (status === "rejected") {
      reviewNote = window.prompt(t("admin.businessVerificationPage.rejectNotePrompt")) ?? undefined;
    }
    try {
      await updatePlatformBusinessKycStatus(id, status, reviewNote);
      if (status === "verified") {
        toast.success(t("admin.businessVerificationPage.toastApproved"));
      } else if (status === "rejected") {
        toast.success(t("admin.businessVerificationPage.toastRejected"));
      } else {
        toast.success(t("admin.businessVerificationPage.toastStatusUpdated"));
      }
      await load();
    } catch (e) {
      logClientError("BusinessDetailPage.handleKycAction", e);
      toast.error(toUserFriendlyMessage(e));
    }
  };

  const saveKyc = async () => {
    if (!row) return;
    try {
      const { business } = await updatePlatformBusinessKyc(row.id, {
        legalContactName: form.legalContactName || null,
        contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null,
        website: form.website || null,
        registeredAddress: form.registeredAddress || null,
      });
      setRow(business);
      toast.success(t("admin.businessVerificationPage.toastDetailsSaved"));
      setEditing(false);
    } catch (e) {
      logClientError("BusinessDetailPage.saveKyc", e);
      toast.error(toUserFriendlyMessage(e));
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !row) return;
    try {
      await uploadPlatformBusinessLogo(row.id, f);
      toast.success(t("admin.businessVerificationPage.toastLogoUploaded"));
      await load();
      e.target.value = "";
    } catch (err) {
      logClientError("BusinessDetailPage.handleLogoUpload", err);
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const handleVerificationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !row) return;
    try {
      await uploadPlatformBusinessVerification(row.id, f);
      toast.success(t("admin.businessVerificationPage.toastDocUploaded"));
      await load();
      e.target.value = "";
    } catch (err) {
      logClientError("BusinessDetailPage.handleVerificationUpload", err);
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const scrollToDocuments = () => {
    document.getElementById("kyc-documents")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const isInitialLoad = loading && !row;

  return (
    <PlatformPage>
      <Link to="/platform-admin/businesses/onboarding-verification" className={platformUi.backLink}>
        {t("admin.businessDetailPage.backLink")}
      </Link>

      <PlatformPageHeader
        icon={Shield}
        title={t("admin.businessDetailPage.title")}
        subtitle={t("admin.businessDetailPage.subtitle")}
      />

      {isInitialLoad ? (
        <EmployeeSettingsFormSkeleton className="max-w-2xl" />
      ) : !id || !row ? (
        <p className="text-muted-foreground">{t("admin.businessDetailPage.notFound")}</p>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(platformUi.contentCard, "dashboard-page-narrow w-full max-w-2xl space-y-6")}
        >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-3">
                <BusinessLogoMark logoPathOrUrl={row.logoPath ?? null} businessName={row.name} size="xl" />
                <div>
                  <h2 className="text-xl font-semibold text-foreground">{row.name}</h2>
                  <p className="text-sm text-muted-foreground font-mono">{row.slug}</p>
                  <p className="text-sm text-muted-foreground mt-1">{row.ownerEmail}</p>
                </div>
              </div>
            </div>

            <BusinessWorkflowVerificationPanels
              row={row}
              onOnboardingAction={(action) => void handleOnboardingAction(action)}
              onKycAction={(status) => void handleKycAction(status)}
              onReviewDocuments={scrollToDocuments}
            />

            <div className="rounded-lg border border-border/80 bg-muted/20 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">{t("admin.businessDetailPage.dtSubscriptionTier")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={subscriptionTier}
                  onChange={(e) =>
                    setSubscriptionTier(e.target.value as "basic" | "premium" | "enterprise")
                  }
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="basic">{t("admin.businessDetailPage.subscriptionTierBasic")}</option>
                  <option value="premium">{t("admin.businessDetailPage.subscriptionTierPremium")}</option>
                  <option value="enterprise">{t("admin.businessDetailPage.subscriptionTierEnterprise")}</option>
                </select>
                <button
                  type="button"
                  disabled={tierSaving || subscriptionTier === (row.subscriptionTier ?? "premium")}
                  onClick={() => {
                    if (!id) return;
                    setTierSaving(true);
                    void updatePlatformBusinessSubscriptionTier(id, subscriptionTier)
                      .then(() => {
                        toast.success(t("admin.businessDetailPage.toastSubscriptionTierSaved"));
                        return load();
                      })
                      .catch((e) => {
                        logClientError("BusinessDetailPage.subscriptionTier", e);
                        toast.error(toUserFriendlyMessage(e));
                      })
                      .finally(() => setTierSaving(false));
                  }}
                  className={cn(platformUi.btnPrimary, "px-4 py-2 text-sm disabled:opacity-50")}
                >
                  {t("admin.businessDetailPage.saveSubscriptionTier")}
                </button>
              </div>
            </div>

            <PlatformSponsoredAccessSection businessId={row.id} />

            <PlatformLegalHoldPanel
              subjectType="business"
              subjectId={row.id}
              subjectLabel={row.name}
            />
            {row.ownerUserId ? (
              <PlatformLegalHoldPanel
                subjectType="user"
                subjectId={row.ownerUserId}
                subjectLabel={row.ownerEmail}
              />
            ) : null}

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("admin.businessDetailPage.dtTotalTips")}</dt>
                <dd className="font-medium">
                  {formatEur(row.totalTipsEur ?? 0)}{" "}
                  <span className="text-muted-foreground font-normal">
                    {t("admin.businessDetailPage.totalTipsDetail", { count: row.successTipCount ?? 0 })}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("admin.businessDetailPage.dtLegalContact")}</dt>
                <dd className="font-medium">{row.legalContactName ?? t("format.notAvailable")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("admin.businessDetailPage.dtContactEmail")}</dt>
                <dd className="font-medium break-all">{row.contactEmail ?? t("format.notAvailable")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("admin.businessDetailPage.dtPhone")}</dt>
                <dd className="font-medium">{row.contactPhone ?? t("format.notAvailable")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("admin.businessDetailPage.dtWebsite")}</dt>
                <dd className="font-medium break-all">{row.website ?? t("format.notAvailable")}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t("admin.businessDetailPage.dtRegisteredAddress")}</dt>
                <dd className="font-medium whitespace-pre-wrap">{row.registeredAddress ?? t("format.notAvailable")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("admin.businessDetailPage.dtStaffLocations")}</dt>
                <dd className="font-medium">
                  {t("admin.businessDetailPage.staffLocationsLine", {
                    staff: row.staffCount ?? 0,
                    locations: row.locationCount ?? 0,
                  })}
                </dd>
              </div>
            </dl>

            <div id="kyc-documents" className="flex flex-wrap gap-2">
              {row.logoPath ? (
                <button
                  type="button"
                  onClick={async () => {
                    const path = row.logoPath;
                    if (!path) return;
                    try {
                      const objUrl = await fetchAuthedObjectUrl(path);
                      window.open(objUrl, "_blank", "noopener,noreferrer");
                    } catch (err) {
                      toast.error(toUserFriendlyMessage(err));
                    }
                  }}
                  className="text-sm text-accent hover:underline"
                >
                  {t("admin.businessDetailPage.openLogo")}
                </button>
              ) : null}
              {row.verificationDocumentPath ? (
                <button
                  type="button"
                  onClick={async () => {
                    const path = row.verificationDocumentPath;
                    if (!path) return;
                    try {
                      const objUrl = await fetchAuthedObjectUrl(path);
                      window.open(objUrl, "_blank", "noopener,noreferrer");
                    } catch (err) {
                      toast.error(toUserFriendlyMessage(err));
                    }
                  }}
                  className="text-sm text-accent hover:underline"
                >
                  {t("admin.businessDetailPage.openKycDocument")}
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted"
              >
                {t("admin.businessDetailPage.editDetails")}
              </button>
            </div>
          </motion.div>
        )}

      {editing && row ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-lg font-semibold mb-1">
              {t("admin.businessVerificationPage.modalTitle", { name: row.name })}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">{t("admin.businessVerificationPage.sectionContactInfo")}</p>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelLegalName")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.legalContactName}
                  onChange={(e) => setForm((f) => ({ ...f, legalContactName: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelContactEmail")}</span>
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.contactEmail}
                  onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelContactPhone")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.contactPhone}
                  onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessDetailPage.labelWebsite")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelRegisteredAddress")}</span>
                <textarea
                  className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                  value={form.registeredAddress}
                  onChange={(e) => setForm((f) => ({ ...f, registeredAddress: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 pt-4 border-t border-border space-y-3">
              <p className="text-sm font-medium text-foreground">{t("admin.businessVerificationPage.sectionUploads")}</p>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelLogoUpload")}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1 block w-full text-sm text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1"
                  onChange={(e) => void handleLogoUpload(e)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">{t("admin.businessVerificationPage.labelVerificationDoc")}</span>
                <input
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,application/pdf"
                  className="mt-1 block w-full text-sm text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1"
                  onChange={(e) => void handleVerificationUpload(e)}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm"
              >
                {t("admin.businessVerificationPage.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void saveKyc()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary-hover"
              >
                {t("admin.businessVerificationPage.save")}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </PlatformPage>
  );
}
