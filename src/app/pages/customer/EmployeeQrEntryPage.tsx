import { useNavigate, useParams, Link } from "react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTipFlow } from "../../context/TipFlowContext";
import { getEmployeeById, recordGuestQrScanOnce } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { CareTipPageLoader } from "../../components/CareTipPageLoader";
import { getRepeatTipDataForBusiness } from "../../lib/repeatTip";
import { markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { formatEur } from "../../lib/formatEur";
import { startGuestTipCheckout } from "../../lib/startGuestTipCheckout";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerRepeatTipPrompt } from "./CustomerRepeatTipPrompt";
import {
  type CustomerEntryPhase,
  scheduleCustomerRouteRedirect,
} from "../../lib/customerRouteTransition";
import { tippingVenueFromEmployeeAssignment, applyGuestTipVenueSearchParams } from "../../lib/guestEmployeeTippingVenue";
import { rememberGuestTipEmployee } from "../../lib/resolveCustomerEmployeeContext";
import { navFlashLog } from "../../lib/navigationFlashAudit";
import { usePublicHtmlBootHandoff } from "../../lib/usePublicHtmlBootHandoff";

/**
 * /qr/employee/:employeeId — Deep link by employee id (parallel to `/staff/:slug`).
 * Resolves the staff member and continues to the tip amount step.
 */
export function EmployeeQrEntryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { employeeId } = useParams<{ employeeId: string }>();
  const { setBusinessId, setEmployee, setStaffProfileSlug, setAmount, setTippingVenue } = useTipFlow();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CustomerEntryPhase>("loading");
  const [emp, setEmp] = useState<{
    id: string;
    name: string;
    avatar?: string | null;
    businessId: string;
    locationId?: string | null;
    locationName?: string | null;
  } | null>(null);
  const [repeatAmount, setRepeatAmount] = useState<number | null>(null);
  const [repeatDismissed, setRepeatDismissed] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  usePublicHtmlBootHandoff(phase === "ready" && Boolean(emp));

  useEffect(() => {
    const raw = employeeId?.trim();
    if (!raw) {
      setError(t("tipFlow.errors.invalidLink"));
      setPhase("error");
      return;
    }
    let cancelled = false;
    navFlashLog("data_load_started", { path: `/qr/employee/${raw}`, route: "EmployeeQrEntryPage" });
    (async () => {
      setPhase("loading");
      setError(null);
      try {
        const emp = await getEmployeeById(raw);
        if (cancelled) return;
        rememberGuestTipEmployee({
          businessId: emp.businessId,
          employeeId: emp.id,
          employeeName: emp.name,
          employeeAvatar: emp.avatar ?? undefined,
          businessName: emp.businessName ?? "",
          businessLogo: emp.businessLogo ?? null,
          branding: emp.branding ?? null,
          locationId: emp.locationId ?? null,
          locationName: emp.locationName ?? null,
        });
        recordGuestQrScanOnce({
          businessId: emp.businessId,
          scanType: "employee_legacy_id",
          employeeId: emp.id,
          entryPath: window.location.pathname,
        });
        setEmp(emp);
        setBusinessId(emp.businessId);
        setEmployee(emp.id, emp.name, emp.avatar ?? undefined);
        setTippingVenue(tippingVenueFromEmployeeAssignment(emp.locationId, emp.locationName));
        setStaffProfileSlug(null);
        navFlashLog("data_load_settled", { path: `/qr/employee/${raw}` });
        const d = getRepeatTipDataForBusiness(emp.businessId);
        if (d && d.employeeId === emp.id && !repeatDismissed) {
          setRepeatAmount(d.lastAmount);
          setPhase("ready");
          return;
        }
        const qs = new URLSearchParams({ employeeId: emp.id });
        qs.set("direct", "1");
        applyGuestTipVenueSearchParams(qs, { locationId: emp.locationId });
        setPhase("redirecting");
        scheduleCustomerRouteRedirect(`/tip-amount?${qs.toString()}`, navigate, {
          replace: true,
          from: `/qr/employee/${raw}`,
        });
      } catch (e) {
        logClientError("EmployeeQrEntryPage", e);
        if (!cancelled) {
          setError(toUserFriendlyMessage(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    }, [employeeId, navigate, repeatDismissed, setBusinessId, setEmployee, setStaffProfileSlug, setTippingVenue]);

  if (error) {
    return (
      <div className={cf.stateCenter}>
        <p className={cf.stateError}>{error}</p>
        <Link to="/" className="mt-4 text-sm font-semibold text-primary underline-offset-2 hover:underline">
          {t("tipFlow.common.goHomeLink")}
        </Link>
      </div>
    );
  }

  if (phase === "loading" || phase === "redirecting" || !emp) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="tipPage"
        registrationKey="employee-qr-entry"
      />
    );
  }

  if (!emp || repeatAmount == null) {
    return null;
  }

  return (
    <div className={cf.page} data-caretip-route-ready="">
      <div className={cf.frame}>
      <div className={`${cf.main} pb-16 sm:pb-20`}>
        <CustomerRepeatTipPrompt
          employeeName={emp.name ?? t("tipFlow.common.teamMember")}
          employeeAvatar={emp.avatar}
          body={t("tipFlow.qrLanding.repeatBody", {
            name: emp.name ?? t("tipFlow.common.teamMember"),
          })}
          lastTipLabel={t("tipFlow.qrLanding.repeatLastTip", { amount: formatEur(repeatAmount) })}
          primaryLabel={t("tipFlow.qrLanding.tipAgain")}
          secondaryLabel={t("tipFlow.staffLanding.chooseDifferentAmount")}
          primaryDisabled={checkingOut}
          onPrimary={() => {
            void (async () => {
              if (checkingOut) return;
              setBusinessId(emp.businessId);
              setEmployee(emp.id, emp.name, emp.avatar ?? undefined);
              setStaffProfileSlug(null);
              setAmount(repeatAmount);
              markCustomerFlowEntered();
              setCheckingOut(true);
              const result = await startGuestTipCheckout(
                {
                  amount: repeatAmount,
                  employeeId: emp.id,
                  businessId: emp.businessId,
                  employeeName: emp.name,
                  locationId: emp.locationId,
                  tableId: null,
                },
                t("tipFlow.payment.checkoutStartError"),
              );
              if (result === "failed") setCheckingOut(false);
            })();
          }}
          onSecondary={() => {
            setRepeatDismissed(true);
            const qs = new URLSearchParams({ employeeId: emp.id });
            qs.set("direct", "1");
            applyGuestTipVenueSearchParams(qs, { locationId: emp.locationId });
            navigate(`/tip-amount?${qs.toString()}`, { replace: true });
          }}
        />
      </div>
      </div>
    </div>
  );
}
