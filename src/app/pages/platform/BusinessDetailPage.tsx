import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BadgeCheck,
  Building2,
  CreditCard,
  ExternalLink,
  FileText,
  Gavel,
  LayoutGrid,
  MapPin,
  Pencil,
  Shield,
  Users,
  Wallet,
} from "lucide-react";
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
import { PlatformSponsoredAccessSection } from "../../components/platform/PlatformSponsoredAccessSection";
import { PlatformLegalHoldPanel } from "../../components/platform/PlatformLegalHoldPanel";
import { PlatformBusinessPayoutSchedulePanel } from "../../components/platform/PlatformBusinessPayoutSchedulePanel";
import { BusinessWorkflowVerificationPanels } from "../../components/platform/BusinessWorkflowVerificationPanels";
import {
  ConsoleCard,
  ConsoleDl,
  ConsoleEmpty,
  ConsoleHeader,
  ConsoleKpi,
  ConsoleKpiGrid,
  ConsoleKv,
  ConsolePage,
  ConsoleStatus,
  ConsoleTabPanel,
  ConsoleTable,
  ConsoleTabs,
  type ConsoleTone,
} from "../../components/platform/console/AdminConsole";
import { formatCount, formatDateShort } from "../../components/platform/console/consoleFormat";
import { PLATFORM_BUSINESS_BASE } from "../../components/platform/platformAdminNav";

type DetailTab = "overview" | "verification" | "plan" | "payouts" | "compliance";

const ONBOARDING_TONE: Record<string, ConsoleTone> = {
  approved: "success",
  submitted: "attention",
  rejected: "failure",
  draft: "neutral",
};

const PAYOUT_TONE: Record<string, ConsoleTone> = {
  connected: "success",
  setup_required: "attention",
  action_required: "attention",
  restricted: "failure",
  not_connected: "neutral",
};

export function BusinessDetailPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<PlatformBusinessRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<DetailTab>("overview");
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

  const openAuthed = async (path: string | null | undefined) => {
    if (!path) return;
    try {
      const objUrl = await fetchAuthedObjectUrl(path);
      window.open(objUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(toUserFriendlyMessage(err));
    }
  };

  const scrollToDocuments = () => {
    setTab("overview");
    window.setTimeout(() => {
      document.getElementById("kyc-documents")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const isInitialLoad = loading && !row;
  const back = { href: `${PLATFORM_BUSINESS_BASE}/onboarding-verification`, label: t("admin.businessDetailPage.backLink") };
  const crumbs = [
    { label: t("admin.sidebar.groups.businessManagement"), href: `${PLATFORM_BUSINESS_BASE}/all` },
    { label: t("admin.businessDetailPage.title") },
  ];

  if (isInitialLoad) {
    return (
      <ConsolePage>
        <ConsoleHeader back={back} crumbs={crumbs} icon={Shield} title={t("admin.businessDetailPage.title")} />
        <EmployeeSettingsFormSkeleton className="max-w-2xl" />
      </ConsolePage>
    );
  }

  if (!id || !row) {
    return (
      <ConsolePage>
        <ConsoleHeader back={back} crumbs={crumbs} icon={Shield} title={t("admin.businessDetailPage.title")} />
        <ConsoleCard>
          <ConsoleEmpty icon={Building2} title={t("admin.businessDetailPage.notFound")} />
        </ConsoleCard>
      </ConsolePage>
    );
  }

  const onboarding = row.onboardingVerificationStatus ?? "draft";
  const operational = row.operationalStatus ?? "active";
  const tierLabel = t(
    `admin.businessDetailPage.subscriptionTier${(row.subscriptionTier ?? "premium").replace(/^./, (c) => c.toUpperCase())}`,
  );
  const na = t("format.notAvailable");
  const payoutAccounts = row.employeePayoutAccounts ?? [];
  const payoutAttention = payoutAccounts.filter((a) => a.connectionState !== "connected").length;

  const tabs: Array<{ value: DetailTab; label: string; icon: typeof LayoutGrid; count?: number }> = [
    { value: "overview", label: t("admin.console.business.tabOverview"), icon: LayoutGrid },
    { value: "verification", label: t("admin.console.business.tabVerification"), icon: BadgeCheck },
    { value: "plan", label: t("admin.console.business.tabPlan"), icon: CreditCard },
    { value: "payouts", label: t("admin.console.business.tabPayouts"), icon: Wallet, count: payoutAttention || undefined },
    { value: "compliance", label: t("admin.console.business.tabCompliance"), icon: Gavel },
  ];

  return (
    <ConsolePage>
      <div className="flex flex-col gap-4">
        <ConsoleHeader
          back={back}
          crumbs={crumbs}
          title={
            <span className="inline-flex items-center gap-3">
              <BusinessLogoMark logoPathOrUrl={row.logoPath ?? null} businessName={row.name} size="lg" />
              <span className="min-w-0">{row.name}</span>
            </span>
          }
          status={
            <span className="inline-flex flex-wrap gap-1.5">
              <ConsoleStatus tone={ONBOARDING_TONE[onboarding] ?? "neutral"} title={t("admin.businessDetailPage.sectionOnboarding")}>
                {t(`admin.businessDetailPage.onboardingStatus.${onboarding}`)}
              </ConsoleStatus>
              <ConsoleStatus tone={operational === "active" ? "success" : operational === "suspended" ? "failure" : "neutral"}>
                {t(`admin.allBusinessesPage.operationalStatus.${operational}`)}
              </ConsoleStatus>
              <ConsoleStatus tone="info">{tierLabel}</ConsoleStatus>
            </span>
          }
          description={
            <>
              <span className="ac-mono">{row.slug}</span> · {row.ownerEmail}
            </>
          }
          meta={row.registeredAt ? <span>{t("admin.console.business.registered")}: {formatDateShort(row.registeredAt, lang)}</span> : null}
          actions={
            <button type="button" className="ac-btn ac-btn--secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              {t("admin.businessDetailPage.editDetails")}
            </button>
          }
        />
        <p className="ac-small ac-muted" style={{ marginTop: "-0.25rem" }}>
          {t("admin.businessDetailPage.subtitle")}
        </p>
      </div>

      <ConsoleKpiGrid columns={4} label={t("admin.businessDetailPage.sectionIdentity")}>
        <ConsoleKpi
          icon={Wallet}
          tone="attention"
          label={t("admin.businessDetailPage.dtTotalTips")}
          value={formatEur(row.totalTipsEur ?? 0)}
          hint={t("admin.businessDetailPage.totalTipsDetail", { count: row.successTipCount ?? 0 })}
        />
        <ConsoleKpi icon={Users} label={t("admin.overview.kpi.staff")} value={formatCount(row.staffCount, lang)} />
        <ConsoleKpi icon={MapPin} label={t("admin.console.overview.locations")} value={formatCount(row.locationCount, lang)} />
        <ConsoleKpi
          icon={CreditCard}
          label={t("admin.businessDetailPage.dtSubscriptionTier")}
          value={tierLabel}
          hint={row.subscriptionStatus ?? undefined}
        />
      </ConsoleKpiGrid>

      <ConsoleTabs idBase="biz" tabs={tabs} value={tab} onChange={setTab} label={t("admin.businessDetailPage.title")} />

      {tab === "overview" ? (
        <ConsoleTabPanel idBase="biz" value="overview">
          <div className="ac-grid ac-grid--wide-narrow">
            <ConsoleCard
              icon={Building2}
              title={t("admin.businessVerificationPage.sectionContactInfo")}
              actions={
                <button type="button" className="ac-btn ac-btn--ghost ac-btn--sm" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  {t("admin.businessDetailPage.editDetails")}
                </button>
              }
            >
              <ConsoleDl
                items={[
                  { label: t("admin.businessDetailPage.dtLegalContact"), value: row.legalContactName ?? na },
                  { label: t("admin.businessDetailPage.dtContactEmail"), value: <span className="break-all">{row.contactEmail ?? na}</span> },
                  { label: t("admin.businessDetailPage.dtPhone"), value: row.contactPhone ?? na },
                  { label: t("admin.businessDetailPage.dtWebsite"), value: <span className="break-all">{row.website ?? na}</span> },
                  {
                    label: t("admin.businessDetailPage.dtRegisteredAddress"),
                    value: <span className="whitespace-pre-wrap">{row.registeredAddress ?? na}</span>,
                    full: true,
                  },
                  {
                    label: t("admin.businessDetailPage.dtStaffLocations"),
                    value: t("admin.businessDetailPage.staffLocationsLine", {
                      staff: row.staffCount ?? 0,
                      locations: row.locationCount ?? 0,
                    }),
                  },
                ]}
              />
            </ConsoleCard>

            <div className="ac-stack">
            <ConsoleCard
              icon={BadgeCheck}
              title={t("admin.businessDetailPage.sectionOnboarding")}
              actions={
                <button type="button" className="ac-btn ac-btn--ghost ac-btn--sm" onClick={() => setTab("verification")}>
                  {t("admin.overview.alerts.review")}
                </button>
              }
            >
              <ConsoleKv
                items={[
                  {
                    label: t("admin.onboardingVerificationPage.kpi.submitted"),
                    value: row.onboardingSubmittedAt ? formatDateShort(row.onboardingSubmittedAt, lang) : "—",
                  },
                  {
                    label: t("admin.allBusinessesPage.colOnboardingVerification"),
                    value: (
                      <ConsoleStatus tone={ONBOARDING_TONE[onboarding] ?? "neutral"}>
                        {t(`admin.businessDetailPage.onboardingStatus.${onboarding}`)}
                      </ConsoleStatus>
                    ),
                  },
                  {
                    label: t("admin.allBusinessesPage.colOperationalStatus"),
                    value: t(`admin.allBusinessesPage.operationalStatus.${operational}`),
                  },
                ]}
              />
              {row.onboardingReviewNotes ? (
                <p className="ac-small ac-muted mt-3 whitespace-pre-wrap break-words">{row.onboardingReviewNotes}</p>
              ) : null}
            </ConsoleCard>
            <ConsoleCard id="kyc-documents" icon={FileText} title={t("admin.businessVerificationPage.sectionUploads")}>
              <div className="flex flex-col gap-2">
                {row.logoPath ? (
                  <button type="button" className="ac-btn ac-btn--secondary ac-btn--block justify-between" onClick={() => void openAuthed(row.logoPath)}>
                    {t("admin.businessDetailPage.openLogo")}
                    <ExternalLink aria-hidden />
                  </button>
                ) : null}
                {row.verificationDocumentPath ? (
                  <button
                    type="button"
                    className="ac-btn ac-btn--secondary ac-btn--block justify-between"
                    onClick={() => void openAuthed(row.verificationDocumentPath)}
                  >
                    {t("admin.businessDetailPage.openKycDocument")}
                    <ExternalLink aria-hidden />
                  </button>
                ) : null}
                {!row.logoPath && !row.verificationDocumentPath ? (
                  <ConsoleEmpty compact icon={FileText} title={na} />
                ) : null}
              </div>
            </ConsoleCard>
            </div>
          </div>
        </ConsoleTabPanel>
      ) : null}

      {tab === "verification" ? (
        <ConsoleTabPanel idBase="biz" value="verification">
          <ConsoleCard icon={BadgeCheck} title={t("admin.businessDetailPage.sectionOnboarding")} description={t("admin.businessDetailPage.sectionOnboardingDesc")}>
            <BusinessWorkflowVerificationPanels
              row={row}
              onOnboardingAction={(action) => void handleOnboardingAction(action)}
              onKycAction={(status) => void handleKycAction(status)}
              onReviewDocuments={scrollToDocuments}
            />
          </ConsoleCard>
        </ConsoleTabPanel>
      ) : null}

      {tab === "plan" ? (
        <ConsoleTabPanel idBase="biz" value="plan">
          <ConsoleCard icon={CreditCard} title={t("admin.businessDetailPage.dtSubscriptionTier")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="ac-field sm:w-64">
                <span className="ac-field__label">{t("admin.businessDetailPage.dtSubscriptionTier")}</span>
                <select
                  className="ac-select"
                  value={subscriptionTier}
                  onChange={(e) => setSubscriptionTier(e.target.value as "basic" | "premium" | "enterprise")}
                >
                  <option value="basic">{t("admin.businessDetailPage.subscriptionTierBasic")}</option>
                  <option value="premium">{t("admin.businessDetailPage.subscriptionTierPremium")}</option>
                  <option value="enterprise">{t("admin.businessDetailPage.subscriptionTierEnterprise")}</option>
                </select>
              </label>
              <button
                type="button"
                className="ac-btn ac-btn--primary"
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
              >
                {t("admin.businessDetailPage.saveSubscriptionTier")}
              </button>
            </div>
          </ConsoleCard>
          <ConsoleCard>
            <PlatformSponsoredAccessSection businessId={row.id} />
          </ConsoleCard>
        </ConsoleTabPanel>
      ) : null}

      {tab === "payouts" ? (
        <ConsoleTabPanel idBase="biz" value="payouts">
          <ConsoleCard>
            <PlatformBusinessPayoutSchedulePanel businessId={id} />
          </ConsoleCard>
          <ConsoleCard
            icon={Wallet}
            title={t("admin.businessDetailPage.employeePayoutSection")}
            description={t("admin.businessDetailPage.employeePayoutSectionHint")}
            flush
          >
            {payoutAccounts.length > 0 ? (
              <ConsoleTable label={t("admin.businessDetailPage.employeePayoutSection")}>
                <thead>
                  <tr>
                    <th>{t("admin.businessDetailPage.employeePayoutColName")}</th>
                    <th>{t("admin.businessDetailPage.employeePayoutColStatus")}</th>
                    <th>{t("admin.businessDetailPage.employeePayoutColSuffix")}</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutAccounts.map((emp) => (
                    <tr key={emp.employeeId}>
                      <td data-primary className="ac-cell-primary">
                        {emp.name}
                      </td>
                      <td data-label={t("admin.businessDetailPage.employeePayoutColStatus")}>
                        <ConsoleStatus tone={PAYOUT_TONE[emp.connectionState] ?? "neutral"}>
                          {t(`admin.businessDetailPage.payoutState.${emp.connectionState}`)}
                        </ConsoleStatus>
                      </td>
                      <td data-label={t("admin.businessDetailPage.employeePayoutColSuffix")} className="ac-mono">
                        {emp.accountSuffix ? `••••${emp.accountSuffix}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ConsoleTable>
            ) : (
              <ConsoleEmpty compact icon={Users} title={t("admin.businessDetailPage.employeePayoutEmpty")} />
            )}
          </ConsoleCard>
        </ConsoleTabPanel>
      ) : null}

      {tab === "compliance" ? (
        <ConsoleTabPanel idBase="biz" value="compliance">
          <ConsoleCard>
            <PlatformLegalHoldPanel subjectType="business" subjectId={row.id} subjectLabel={row.name} />
          </ConsoleCard>
          {row.ownerUserId ? (
            <ConsoleCard>
              <PlatformLegalHoldPanel subjectType="user" subjectId={row.ownerUserId} subjectLabel={row.ownerEmail} />
            </ConsoleCard>
          ) : null}
        </ConsoleTabPanel>
      ) : null}

      {editing ? (
        <div className="ac-modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && setEditing(false)}>
          <div className="ac-modal" role="dialog" aria-modal="true" aria-labelledby="biz-edit-title">
            <div className="ac-card__head">
              <div>
                <h2 id="biz-edit-title" className="ac-card__title">
                  {t("admin.businessVerificationPage.modalTitle", { name: row.name })}
                </h2>
                <p className="ac-card__desc">{t("admin.businessVerificationPage.sectionContactInfo")}</p>
              </div>
            </div>
            <div className="ac flex flex-col gap-3 p-5">
              {(
                [
                  ["legalContactName", t("admin.businessVerificationPage.labelLegalName"), "text"],
                  ["contactEmail", t("admin.businessVerificationPage.labelContactEmail"), "email"],
                  ["contactPhone", t("admin.businessVerificationPage.labelContactPhone"), "tel"],
                  ["website", t("admin.businessDetailPage.labelWebsite"), "url"],
                ] as const
              ).map(([key, label, type]) => (
                <label key={key} className="ac-field">
                  <span className="ac-field__label">{label}</span>
                  <input
                    type={type}
                    className="ac-input"
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </label>
              ))}
              <label className="ac-field">
                <span className="ac-field__label">{t("admin.businessVerificationPage.labelRegisteredAddress")}</span>
                <textarea
                  className="ac-textarea"
                  value={form.registeredAddress}
                  onChange={(e) => setForm((f) => ({ ...f, registeredAddress: e.target.value }))}
                />
              </label>
              <hr className="ac-divider my-2" />
              <p className="ac-field__label">{t("admin.businessVerificationPage.sectionUploads")}</p>
              <label className="ac-field">
                <span className="ac-field__hint">{t("admin.businessVerificationPage.labelLogoUpload")}</span>
                <input type="file" accept="image/*" className="text-sm" onChange={(e) => void handleLogoUpload(e)} />
              </label>
              <label className="ac-field">
                <span className="ac-field__hint">{t("admin.businessVerificationPage.labelVerificationDoc")}</span>
                <input
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,application/pdf"
                  className="text-sm"
                  onChange={(e) => void handleVerificationUpload(e)}
                />
              </label>
            </div>
            <div className="ac flex justify-end gap-2 border-t border-border/60 px-5 py-4">
              <button type="button" className="ac-btn ac-btn--secondary" onClick={() => setEditing(false)}>
                {t("admin.businessVerificationPage.cancel")}
              </button>
              <button type="button" className="ac-btn ac-btn--primary" onClick={() => void saveKyc()}>
                {t("admin.businessVerificationPage.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConsolePage>
  );
}
