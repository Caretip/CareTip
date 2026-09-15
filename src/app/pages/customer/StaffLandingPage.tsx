import { useNavigate, useParams, Link, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
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
import { startGuestTipCheckout } from "../../lib/startGuestTipCheckout";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerJourneyHeader } from "./CustomerJourneyHeader";
import { CustomerJourneyAttributionFooter } from "./CustomerJourneyCareTipAttribution";
import { venueBrandFromResolved, useCustomerVenueBrand, mergeCustomerVenueBrand } from "./customerJourneyBrand";
import {
  type CustomerEntryPhase,
  isCustomerEntryPending,
  scheduleCustomerRouteRedirect,
  shouldShowCustomerEntryFailure,
} from "../../lib/customerRouteTransition";
import { tippingVenueFromEmployeeAssignment, applyGuestTipVenueSearchParams } from "../../lib/guestEmployeeTippingVenue";
import { rememberGuestTipEmployee } from "../../lib/resolveCustomerEmployeeContext";
import { navFlashLog } from "../../lib/navigationFlashAudit";
import { usePublicHtmlBootHandoff } from "../../lib/usePublicHtmlBootHandoff";

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
  const { setBusinessId, setEmployee, setStaffProfileSlug, setAmount, setTippingVenue } = useTipFlow();
  const [phase, setPhase] = useState<CustomerEntryPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffBySlugResponse | null>(null);
  const [showRepeatPrompt, setShowRepeatPrompt] = useState(false);
  const [repeatAmount, setRepeatAmount] = useState<number | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  usePublicHtmlBootHandoff(phase === "ready" && Boolean(staff));

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
        rememberGuestTipEmployee({
          businessId: data.businessId,
          employeeId: data.id,
          employeeName: data.name,
          employeeAvatar: data.avatar ?? undefined,
          businessName: data.businessName,
          businessLogo: data.businessLogo ?? null,
          branding: data.branding ?? null,
          locationId: data.locationId ?? null,
          locationName: data.locationName ?? null,
        });
        recordGuestQrScanOnce({
          businessId: data.businessId,
          scanType: "employee_legacy_slug",
          employeeId: data.id,
          entryPath: window.location.pathname,
        });
        setBusinessId(data.businessId);
        setEmployee(data.id, data.name, data.avatar ?? undefined);
        setTippingVenue(tippingVenueFromEmployeeAssignment(data.locationId, data.locationName));
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
          const qs = new URLSearchParams({
            employeeId: data.id,
            returnSlug: slug,
            direct: "1",
          });
          applyGuestTipVenueSearchParams(qs, { locationId: data.locationId });
          setPhase("redirecting");
          scheduleCustomerRouteRedirect(
            `/tip-amount?${qs.toString()}`,
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
    setTippingVenue,
  ]);

  const handleLeaveTip = () => {
    if (!staff || !slugParam?.trim()) return;
    const qs = new URLSearchParams({
      employeeId: staff.id,
      returnSlug: slugParam.trim(),
      direct: "1",
    });
    applyGuestTipVenueSearchParams(qs, { locationId: staff.locationId });
    navigate(`/tip-amount?${qs.toString()}`);
  };

  const handleRepeatTip = async () => {
    if (!staff || repeatAmount == null || !slugParam?.trim()) return;
    if (checkingOut) return;
    setBusinessId(staff.businessId);
    setEmployee(staff.id, staff.name, staff.avatar ?? undefined);
    setStaffProfileSlug(slugParam.trim());
    setAmount(repeatAmount);
    markCustomerFlowEntered();
    setCheckingOut(true);
    const result = await startGuestTipCheckout(
      {
        amount: repeatAmount,
        employeeId: staff.id,
        businessId: staff.businessId,
        employeeName: staff.name,
        locationId: staff.locationId,
      },
      t("tipFlow.payment.checkoutStartError"),
    );
    if (result === "failed") setCheckingOut(false);
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

  return (
    <div className={cf.page} data-caretip-route-ready="">
      <div className={cf.frame}>
      <CustomerJourneyHeader venue={venueBrand} />

      <div className={`${cf.main} max-w-xl pb-8 sm:pb-10`}>
        <div className="px-1 py-6 text-center sm:py-8">
          <div className="mx-auto mb-5 inline-flex">
            <ProfileAvatar
              src={staff.avatar}
              displayName={staff.name}
              variant="square"
              className={`mx-auto size-[6.5rem] ${cf.employeePhotoSquare}`}
            />
          </div>
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground">{staff.name}</h2>
          {staff.jobTitle ? (
            <p className="mt-1.5 text-sm font-medium text-muted-foreground">{staff.jobTitle}</p>
          ) : null}

          {staff.bio ? <p className="mt-5 text-left text-sm leading-relaxed text-muted-foreground">{staff.bio}</p> : null}

          {showRepeatPrompt && repeatAmount ? (
            <div className="mt-7 space-y-3">
              <button
                type="button"
                onClick={() => void handleRepeatTip()}
                disabled={checkingOut}
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
        </div>

        <CustomerJourneyAttributionFooter label={t("tipFlow.common.poweredByCareTip")} />
      </div>
      </div>
    </div>
  );
}
