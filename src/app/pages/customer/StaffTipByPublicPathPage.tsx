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
import { venueBrandFromResolved } from "./customerJourneyBrand";
import { getRepeatTipDataForBusiness } from "../../lib/repeatTip";
import { markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { formatEur } from "../../lib/formatEur";
import { customerFlowUi as cf } from "./customerFlowUi";
import {
  type CustomerEntryPhase,
  isCustomerEntryPending,
  scheduleCustomerRouteRedirect,
  shouldShowCustomerEntryFailure,
} from "../../lib/customerRouteTransition";
import { navFlashLog } from "../../lib/navigationFlashAudit";

const BRAND_ORANGE = "#e9781c";

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
  const { setBusinessId, setEmployee, setStaffTipReturnPath, setAmount } = useTipFlow();
  const [phase, setPhase] = useState<CustomerEntryPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffBySlugResponse | null>(null);
  const [showRepeatPrompt, setShowRepeatPrompt] = useState(false);
  const [repeatAmount, setRepeatAmount] = useState<number | null>(null);

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
        recordGuestQrScanOnce({
          businessId: data.businessId,
          scanType: "employee",
          employeeId: data.id,
          entryPath: window.location.pathname,
        });
        setBusinessId(data.businessId);
        setEmployee(data.id, data.name, data.avatar ?? undefined);
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
  }, [bizParam, empParam, previewProfile, navigate, setBusinessId, setEmployee, setStaffTipReturnPath, t]);

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
    navigate(`/tip-amount?${qs.toString()}`);
  };

  const handleRepeatTip = () => {
    if (!staff || repeatAmount == null || !bizParam?.trim() || !empParam?.trim()) return;
    setBusinessId(staff.businessId);
    setEmployee(staff.id, staff.name, staff.avatar ?? undefined);
    setStaffTipReturnPath(bizParam.trim().toLowerCase(), empParam.trim().toLowerCase());
    setAmount(repeatAmount);
    markCustomerFlowEntered();
    navigate("/payment");
  };

  const profileHeaderFor = (name: string) => headerLeaveTipFor(t, name);

  if (isCustomerEntryPending(phase)) {
    const pendingHeader = staff
      ? profileHeaderFor(staff.name)
      : profileHeaderFor(t("tipFlow.common.teamMember"));
    return (
      <CustomerFlowShell
        venue={
          staff
            ? venueBrandFromResolved({
                businessName: staff.businessName,
                businessLogo: staff.businessLogo ?? null,
                branding: staff.branding ?? null,
              })
            : { name: t("tipFlow.common.venue"), logo: null }
        }
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
        venue={{ name: t("tipFlow.common.venue"), logo: null }}
        stepTitle={pendingHeader.stepTitle}
        trustMessage={pendingHeader.trustMessage}
        loading
        loadingContext="tipPage"
        loadingRegistrationKey="staff-public-path-entry"
      />
    );
  }

  const profileHeader = profileHeaderFor(staff.name);

  return (
    <div className={cf.page}>
      <CustomerJourneyHeader
        venue={venueBrandFromResolved({
          businessName: staff.businessName,
          businessLogo: staff.businessLogo ?? null,
          branding: staff.branding ?? null,
        })}
        stepTitle={profileHeader.stepTitle}
        trustMessage={profileHeader.trustMessage}
      />

      <div className={`${cf.main} max-w-xl pb-8 sm:pb-10`}>
        <div className={`${cf.card} px-6 py-8 text-center sm:px-8 sm:py-9`}>
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
              <button type="button" onClick={handleRepeatTip} className={`${cf.btnPrimaryLg} py-4 text-[0.9375rem]`}>
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
  );
}
