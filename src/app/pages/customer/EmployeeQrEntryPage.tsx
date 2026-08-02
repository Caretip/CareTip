import { useNavigate, useParams, Link } from "react-router";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useTipFlow } from "../../context/TipFlowContext";
import { getEmployeeById, recordGuestQrScanOnce } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { CareTipPageLoader } from "../../components/CareTipPageLoader";
import { Card, CardContent } from "@/components/ui/card";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { getRepeatTipDataForBusiness } from "../../lib/repeatTip";
import { markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { formatEur } from "../../lib/formatEur";
import { customerFlowUi as cf } from "./customerFlowUi";
import {
  type CustomerEntryPhase,
  scheduleCustomerRouteRedirect,
} from "../../lib/customerRouteTransition";
import { navFlashLog } from "../../lib/navigationFlashAudit";

/**
 * /qr/employee/:employeeId — Deep link by employee id (parallel to `/staff/:slug`).
 * Resolves the staff member and continues to the tip amount step.
 */
export function EmployeeQrEntryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { employeeId } = useParams<{ employeeId: string }>();
  const { setBusinessId, setEmployee, setStaffProfileSlug, setAmount } = useTipFlow();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CustomerEntryPhase>("loading");
  const [emp, setEmp] = useState<{ id: string; name: string; avatar?: string | null; businessId: string } | null>(
    null
  );
  const [repeatAmount, setRepeatAmount] = useState<number | null>(null);
  const [repeatDismissed, setRepeatDismissed] = useState(false);

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
        recordGuestQrScanOnce({
          businessId: emp.businessId,
          scanType: "employee_legacy_id",
          employeeId: emp.id,
          entryPath: window.location.pathname,
        });
        setEmp(emp);
        setBusinessId(emp.businessId);
        setEmployee(emp.id, emp.name, emp.avatar ?? undefined);
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
  }, [employeeId, navigate, repeatDismissed, setBusinessId, setEmployee, setStaffProfileSlug]);

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
    <div className={cf.page}>
      <div className={`${cf.main} pb-16 sm:pb-20`}>
        <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <Card className={cf.cardShadcn}>
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{t("tipFlow.qrLanding.repeatWelcome")}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t("tipFlow.qrLanding.repeatBody", {
                      name: emp.name ?? t("tipFlow.common.teamMember"),
                    })}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-primary">
                    {t("tipFlow.qrLanding.repeatLastTip", { amount: formatEur(repeatAmount) })}
                  </p>
                </div>
                <ProfileAvatar
                  src={emp.avatar ?? undefined}
                  displayName={emp.name ?? t("tipFlow.common.teamMember")}
                  className="size-14 shrink-0 ring-2 ring-primary/22"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setBusinessId(emp.businessId);
                    setEmployee(emp.id, emp.name, emp.avatar ?? undefined);
                    setStaffProfileSlug(null);
                    setAmount(repeatAmount);
                    markCustomerFlowEntered();
                    navigate("/payment");
                  }}
                  className={`${cf.btnPrimaryLg} py-3.5 text-sm sm:flex-1`}
                >
                  {t("tipFlow.qrLanding.tipAgain")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRepeatDismissed(true);
                    const qs = new URLSearchParams({ employeeId: emp.id });
                    qs.set("direct", "1");
                    navigate(`/tip-amount?${qs.toString()}`, { replace: true });
                  }}
                  className={`${cf.btnSecondaryLg} py-3.5 text-sm sm:flex-1`}
                >
                  {t("tipFlow.staffLanding.chooseDifferentAmount")}
                </button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
