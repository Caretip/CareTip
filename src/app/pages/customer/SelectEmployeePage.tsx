import { useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Star, Award } from "lucide-react";
import { useTipFlow } from "../../context/TipFlowContext";
import { getEmployees } from "../../lib/api";
import type { EmployeeItem } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { CareTipPageLoader } from "../../components/CareTipPageLoader";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../../lib/devCustomerBypass";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerFlowShell } from "./CustomerFlowShell";
import { CustomerJourneyBackButton } from "./CustomerJourneyHeader";
import { useCustomerVenueBrand } from "./customerJourneyBrand";
import { headerSelectTeamMember } from "./customerJourneyHeaderCopy";

export function SelectEmployeePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { businessId, setEmployee, setBusinessId, setTippingVenue } = useTipFlow();
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const venueBrand = useCustomerVenueBrand(businessId, t("tipFlow.common.venue"));
  const teamHeader = headerSelectTeamMember(t);

  // DEV-only: allow opening /select-employee without QR context.
  useEffect(() => {
    if (!DEV_BYPASS_ENABLED) return;
    if (businessId) return;
    setBusinessId(DEV_MOCK.businessId);
    setTippingVenue(DEV_MOCK.venue);
  }, [businessId, setBusinessId, setTippingVenue]);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    const fetchEmployees = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getEmployees(businessId);
        setEmployees(data ?? []);
      } catch (err) {
        logClientError("SelectEmployeePage", err);
        setError(toUserFriendlyMessage(err));
        setEmployees([]);
      } finally {
        setLoading(false);
      }
    };
    fetchEmployees();
  }, [businessId]);

  const displayEmployees = employees.map((e) => ({
    id: e.id,
    name: e.name,
    role: e.role,
    avatar: e.avatar,
    rating: e.rating,
    tips: e.tips,
    topRated: e.topRated,
  }));

  const handleBack = () => {
    navigate(businessId ? `/qr-landing/${businessId}` : "/");
  };

  const handleContinue = () => {
    if (selectedEmployee) {
      const emp = displayEmployees.find((e) => e.id === selectedEmployee);
      if (emp) {
        setEmployee(String(emp.id), emp.name, emp.avatar ?? undefined);
        navigate(`/tip-amount?employeeId=${emp.id}`);
      }
    }
  };

  if (!businessId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <h1 className="text-xl font-semibold text-foreground">{t("tipFlow.selectEmployee.noBusinessContextTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("tipFlow.selectEmployee.noBusinessContextDesc")}
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white shadow-lg transition-opacity hover:bg-accent/90"
          >
            {t("tipFlow.selectEmployee.noBusinessContextCta")}
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <CareTipPageLoader
        variant="wait"
        context="tipPage"
        registrationKey="select-employee"
      />
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <p className="mb-2 text-sm font-medium text-destructive">{error}</p>
          <button type="button" onClick={() => window.location.reload()} className="text-sm text-primary hover:underline">
            {t("dashboard.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <CustomerFlowShell
      withBottomCta={Boolean(selectedEmployee)}
      headerLeading={
        <CustomerJourneyBackButton label={t("tipFlow.common.back")} onClick={handleBack} />
      }
      venue={venueBrand}
      stepTitle={teamHeader.stepTitle}
      trustMessage={teamHeader.trustMessage}
      bottomBar={
        selectedEmployee ? (
          <div className={cf.fixedBottomBar}>
            <div className={cf.fixedBottomInner}>
              <div className={cf.journeyCtaStack}>
                <button type="button" onClick={handleContinue} className={cf.btnPrimaryLg}>
                  {t("tipFlow.tipAmount.continuePayment")}
                </button>
              </div>
            </div>
          </div>
        ) : undefined
      }
    >
        <div className="grid grid-cols-2 gap-4 sm:gap-5">
          {displayEmployees.length === 0 ? (
            <p className="col-span-2 py-12 text-center text-muted-foreground">{t("tipFlow.selectEmployee.emptyTeam")}</p>
          ) : (
            displayEmployees.map((employee) => (
              <button
                key={employee.id}
                type="button"
                onClick={() => setSelectedEmployee(String(employee.id))}
                className={`${cf.employeeCard} relative overflow-hidden text-left ${
                  selectedEmployee === String(employee.id) ? cf.employeeCardSelected : ""
                }`}
              >
                {employee.topRated ? (
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-xs text-white">
                    <Award className="h-3 w-3" />
                    <span>{t("tipFlow.selectEmployee.topRatedBadge")}</span>
                  </div>
                ) : null}

                <div className="relative aspect-square bg-gradient-to-br from-primary/10 to-accent/10">
                  <ProfileAvatar
                    src={employee.avatar}
                    displayName={employee.name}
                    variant="square"
                    className="absolute inset-0 h-full w-full min-h-0"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>

                <div className="space-y-2 p-3">
                  <div>
                    <h3 className="text-left text-sm font-semibold text-foreground">{employee.name}</h3>
                    <p className="text-left text-xs text-muted-foreground">{employee.role}</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {employee.rating != null ? (
                        <>
                          <Star className="h-3 w-3 fill-accent text-accent" />
                          <span className="text-xs font-medium text-foreground">{employee.rating}</span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("tipFlow.selectEmployee.newMember")}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{t("tipFlow.selectEmployee.tipsCount", { count: employee.tips })}</span>
                  </div>
                </div>

                {selectedEmployee === String(employee.id) ? (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary">
                      <svg className="size-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                ) : null}
              </button>
            ))
          )}
        </div>
    </CustomerFlowShell>
  );
}
