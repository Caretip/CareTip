import { useNavigate, useParams, Link, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import { useTipFlow } from "../../context/TipFlowContext";
import { getStaffBySlug, recordGuestQrScanOnce, type StaffBySlugResponse } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { CareTipPageLoader } from "../../components/CareTipPageLoader";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { getRepeatTipDataForBusiness } from "../../lib/repeatTip";
import { markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { formatEur } from "../../lib/formatEur";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerJourneyHeader } from "./CustomerJourneyHeader";
import { CustomerJourneyAttributionFooter } from "./CustomerJourneyCareTipAttribution";
import { headerLeaveTipFor } from "./customerJourneyHeaderCopy";
import { venueBrandFromResolved, useCustomerVenueBrand, mergeCustomerVenueBrand } from "./customerJourneyBrand";
import {
  type CustomerEntryPhase,
  isCustomerEntryPending,
  scheduleCustomerRouteRedirect,
  shouldShowCustomerEntryFailure,
} from "../../lib/customerRouteTransition";
import { navFlashLog } from "../../lib/navigationFlashAudit";

const BRAND_ORANGE = "#e9781c";

/**
 * /staff/:slug — Individual QR (Path A).
 * Default: skip the profile step and open tip amount with employee context (verify on that screen).
 * ?preview=1 — full profile + "Leave a tip" (e.g. back navigation from tip flow).
 */
export function StaffLandingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const previewProfile = searchParams.get("preview") === "1";
  const { slug: slugParam } = useParams<{ slug: string }>();
  const { setBusinessId, setEmployee, setStaffProfileSlug, setAmount } = useTipFlow();
  const [phase, setPhase] = useState<CustomerEntryPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffBySlugResponse | null>(null);
  const [showRepeatPrompt, setShowRepeatPrompt] = useState(false);
  const [repeatAmount, setRepeatAmount] = useState<number | null>(null);

  useEffect(() => {
    if (!slugParam?.trim()) {
      setError(t("tipFlow.errors.invalidLink"));
      setPhase("error");
      return;
    }
    const slug = slugParam.trim();
    let cancelled = false;
    navFlashLog("data_load_started", { path: `/staff/${slug}`, route: "StaffLandingPage" });
    const run = async () => {
      setPhase("loading");
      setError(null);
      try {
        const data = await getStaffBySlug(slug);
        if (cancelled) return;
        recordGuestQrScanOnce({
          businessId: data.businessId,
          scanType: "employee_legacy_slug",
          employeeId: data.id,
          entryPath: window.location.pathname,
        });
        setBusinessId(data.businessId);
        setEmployee(data.id, data.name, data.avatar ?? undefined);
        setStaffProfileSlug(slug);
        navFlashLog("data_load_settled", { path: `/staff/${slug}`, preview: previewProfile });
        if (!previewProfile) {
          const d = getRepeatTipDataForBusiness(data.businessId);
          if (d && d.employeeId === data.id) {
            setRepeatAmount(d.lastAmount);
            setShowRepeatPrompt(true);
            setStaff(data);
            setPhase("ready");
            return;
          }
          setPhase("redirecting");
          scheduleCustomerRouteRedirect(
            `/tip-amount?employeeId=${encodeURIComponent(data.id)}&returnSlug=${encodeURIComponent(slug)}&direct=1`,
            navigate,
            { replace: true, from: `/staff/${slug}` },
          );
          return;
        }
        setStaff(data);
        setPhase("ready");
      } catch (err) {
        logClientError("StaffLandingPage", err);
        if (!cancelled) {
          setError(toUserFriendlyMessage(err));
          setPhase("error");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    slugParam,
    previewProfile,
    navigate,
    setBusinessId,
    setEmployee,
    setStaffProfileSlug,
  ]);

  const handleLeaveTip = () => {
    if (!staff || !slugParam?.trim()) return;
    navigate(
      `/tip-amount?employeeId=${encodeURIComponent(staff.id)}&returnSlug=${encodeURIComponent(slugParam.trim())}&direct=1`
    );
  };

  const handleRepeatTip = () => {
    if (!staff || repeatAmount == null || !slugParam?.trim()) return;
    setBusinessId(staff.businessId);
    setEmployee(staff.id, staff.name, staff.avatar ?? undefined);
    setStaffProfileSlug(slugParam.trim());
    setAmount(repeatAmount);
    markCustomerFlowEntered();
    navigate("/payment");
  };

  const fallbackVenue = t("tipFlow.common.venue");
  const fetchedVenue = useCustomerVenueBrand(staff?.businessId, fallbackVenue);
  const venueBrand = staff
    ? mergeCustomerVenueBrand(
        {
          ...fetchedVenue,
          branding: fetchedVenue.branding ?? staff.branding ?? null,
          tagline:
            fetchedVenue.tagline ??
            (staff.branding?.premium && staff.branding.brandTagline?.trim()
              ? staff.branding.brandTagline.trim()
              : undefined),
        },
        {
          snapshot: { name: staff.businessName, logo: staff.businessLogo ?? null },
          fallbackName: fallbackVenue,
        },
      )
    : venueBrandFromResolved({
        businessName: fallbackVenue,
        businessLogo: null,
        branding: null,
      });

  if (isCustomerEntryPending(phase)) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="tipPage"
        registrationKey="staff-landing"
      />
    );
  }

  if (shouldShowCustomerEntryFailure(phase, { error, hasContent: Boolean(staff) })) {
    return (
      <div className={cf.stateCenter}>
        <p className={cf.stateError}>{error ?? t("tipFlow.common.notFound")}</p>
        <Link to="/" className="mt-4 text-sm font-semibold text-primary underline-offset-2 hover:underline">
          {t("tipFlow.staffLanding.goHome")}
        </Link>
      </div>
    );
  }

  if (!staff) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="tipPage"
        registrationKey="staff-landing"
      />
    );
  }

  const profileHeader = staff ? headerLeaveTipFor(t, staff.name) : headerLeaveTipFor(t, t("tipFlow.common.teamMember"));

  return (
    <div className={cf.page}>
      <CustomerJourneyHeader
        venue={venueBrand}
        stepTitle={profileHeader.stepTitle}
        trustMessage={profileHeader.trustMessage}
      />

      <div className={`${cf.main} max-w-xl pb-8 sm:pb-10`}>
        <motion.div
          initial={{ y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`${cf.cardShadcn} border border-border/60 bg-card px-6 py-8 text-center shadow-[0_14px_42px_-22px_rgba(15,23,42,0.2)]`}
        >
          <div
            className="mx-auto mb-5 inline-flex rounded-full"
            style={{ boxShadow: `0 0 0 3px ${BRAND_ORANGE}33` }}
          >
            <ProfileAvatar
              src={staff.avatar}
              displayName={staff.name}
              className="mx-auto size-[7.25rem] ring-[6px] ring-background"
            />
          </div>
          <h2 className="text-balance text-2xl font-bold tracking-tight text-foreground">{staff.name}</h2>
          <p className="mt-1.5 text-sm font-semibold" style={{ color: BRAND_ORANGE }}>
            {staff.jobTitle}
          </p>

          {staff.bio ? <p className="mt-5 text-left text-sm leading-relaxed text-muted-foreground">{staff.bio}</p> : null}

          {showRepeatPrompt && repeatAmount ? (
            <div className="mt-7 space-y-3">
              <button
                type="button"
                onClick={handleRepeatTip}
                className={`${cf.btnPrimaryLg} py-4 text-[0.9375rem]`}
              >
                <Heart className="size-5 shrink-0" aria-hidden />
                {t("tipFlow.staffLanding.tipAgainWithAmount", { amount: formatEur(repeatAmount) })}
              </button>
              <button type="button" onClick={handleLeaveTip} className={`${cf.btnSecondaryLg} py-3.5 text-sm`}>
                {t("tipFlow.staffLanding.chooseDifferentAmount")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={handleLeaveTip} className={`${cf.btnPrimaryLg} mt-7 py-4 text-[0.9375rem]`}>
              <Heart className="size-5 shrink-0" aria-hidden />
              {t("tipFlow.staffLanding.leaveTipButton")}
            </button>
          )}
        </motion.div>

        <CustomerJourneyAttributionFooter label={t("tipFlow.common.poweredByCareTip")} />
      </div>
    </div>
  );
}
