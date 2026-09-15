import { useNavigate, useParams, Link, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTipFlow } from "../../context/TipFlowContext";
import { getStaffByBusinessEmployeeSlug, recordGuestQrScanOnce, type StaffBySlugResponse } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { prefetchCustomerFlowRoutes } from "../../lib/prefetchCustomerRoutes";
import { CustomerFlowShell } from "./CustomerFlowShell";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { CustomerJourneyHeader } from "./CustomerJourneyHeader";
import { CustomerJourneyAttributionFooter } from "./CustomerJourneyCareTipAttribution";
import { headerLeaveTipFor } from "./customerJourneyHeaderCopy";
import { useCustomerVenueBrand, mergeCustomerVenueBrand } from "./customerJourneyBrand";
import { getRepeatTipDataForBusiness } from "../../lib/repeatTip";
import { markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { formatEur } from "../../lib/formatEur";
import { startGuestTipCheckout } from "../../lib/startGuestTipCheckout";
import { customerFlowUi as cf } from "./customerFlowUi";
import {
  type CustomerEntryPhase,
  isCustomerEntryPending,
  scheduleCustomerRouteRedirect,
  shouldShowCustomerEntryFailure,
} from "../../lib/customerRouteTransition";
import { navFlashLog } from "../../lib/navigationFlashAudit";
import { tippingVenueFromEmployeeAssignment, applyGuestTipVenueSearchParams } from "../../lib/guestEmployeeTippingVenue";
import { rememberGuestTipEmployee } from "../../lib/resolveCustomerEmployeeContext";
import { usePublicHtmlBootHandoff } from "../../lib/usePublicHtmlBootHandoff";

/**
 * `/{businessSlug}/{employeeSlug}` — canonical human-readable employee tip entry.
 */
export function StaffTipByPublicPathPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const previewProfile = searchParams.get("preview") === "1";
  const { businessSlug: bizParam, employeeSlug: empParam } = useParams<{
    businessSlug: string;
    employeeSlug: string;
  }>();
  const { setBusinessId, setEmployee, setStaffTipReturnPath, setAmount, setTippingVenue } = useTipFlow();
  const [phase, setPhase] = useState<CustomerEntryPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffBySlugResponse | null>(null);
  const [showRepeatPrompt, setShowRepeatPrompt] = useState(false);
  const [repeatAmount, setRepeatAmount] = useState<number | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  usePublicHtmlBootHandoff(phase === "ready" && Boolean(staff));

  useEffect(() => {
    const schedule = () => prefetchCustomerFlowRoutes();
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(schedule, { timeout: 2500 });
      return () => cancelIdleCallback(id);
    }
    const id = window.setTimeout(schedule, 400);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const b = bizParam?.trim().toLowerCase();
    const e = empParam?.trim().toLowerCase();
    if (!b || !e) {
      setError(t("tipFlow.errors.invalidLink"));
      setPhase("error");
      return;
    }
    let cancelled = false;
    navFlashLog("data_load_started", { path: `/${b}/${e}`, route: "StaffTipByPublicPathPage" });
    const run = async () => {
      setPhase("loading");
      setError(null);
      try {
        const data = await getStaffByBusinessEmployeeSlug(b, e);
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
          scanType: "employee",
          employeeId: data.id,
          entryPath: window.location.pathname,
        });
        setBusinessId(data.businessId);
        setEmployee(data.id, data.name, data.avatar ?? undefined);
        setTippingVenue(tippingVenueFromEmployeeAssignment(data.locationId, data.locationName));
        setStaffTipReturnPath(b, e);
        navFlashLog("data_load_settled", { path: `/${b}/${e}`, preview: previewProfile });
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
            returnBusinessSlug: b,
            returnEmployeeSlug: e,
            direct: "1",
          });
          applyGuestTipVenueSearchParams(qs, { locationId: data.locationId });
          setPhase("redirecting");
          scheduleCustomerRouteRedirect(`/tip-amount?${qs.toString()}`, navigate, {
            replace: true,
            from: `/${b}/${e}`,
          });
          return;
        }
        setStaff(data);
        setPhase("ready");
      } catch (err) {
        logClientError("StaffTipByPublicPathPage", err);
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
  }, [bizParam, empParam, previewProfile, navigate, setBusinessId, setEmployee, setStaffTipReturnPath, setTippingVenue]);

  const handleLeaveTip = () => {
    if (!staff || !bizParam?.trim() || !empParam?.trim()) return;
    const b = bizParam.trim().toLowerCase();
    const e = empParam.trim().toLowerCase();
    const qs = new URLSearchParams({
      employeeId: staff.id,
      returnBusinessSlug: b,
      returnEmployeeSlug: e,
      direct: "1",
    });
    applyGuestTipVenueSearchParams(qs, { locationId: staff.locationId });
    navigate(`/tip-amount?${qs.toString()}`);
  };

  const handleRepeatTip = async () => {
    if (!staff || repeatAmount == null || !bizParam?.trim() || !empParam?.trim()) return;
    if (checkingOut) return;
    setBusinessId(staff.businessId);
    setEmployee(staff.id, staff.name, staff.avatar ?? undefined);
    setStaffTipReturnPath(bizParam.trim().toLowerCase(), empParam.trim().toLowerCase());
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

  const profileHeaderFor = (name: string) => headerLeaveTipFor(t, name);
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
    : { name: fallbackVenue, logo: null };

  if (isCustomerEntryPending(phase)) {
    const pendingHeader = staff
      ? profileHeaderFor(staff.name)
      : profileHeaderFor(t("tipFlow.common.teamMember"));
    return (
      <CustomerFlowShell
        venue={venueBrand}
        stepTitle={pendingHeader.stepTitle}
        trustMessage={pendingHeader.trustMessage}
        loading
        loadingContext="tipPage"
        loadingRegistrationKey="staff-public-path-entry"
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
    const pendingHeader = profileHeaderFor(t("tipFlow.common.teamMember"));
    return (
      <CustomerFlowShell
        venue={{ name: fallbackVenue, logo: null }}
        stepTitle={pendingHeader.stepTitle}
        trustMessage={pendingHeader.trustMessage}
        loading
        loadingContext="tipPage"
        loadingRegistrationKey="staff-public-path-entry"
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
