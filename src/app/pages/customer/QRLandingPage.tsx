import { useNavigate, useParams, useSearchParams, Navigate } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Home } from "lucide-react";
import { useTipFlow } from "../../context/TipFlowContext";
import {
  getBusinessById,
  getEmployeeById,
  getBusinessStaffDirectory,
  getTippingContextByQrSlug,
  recordGuestQrScanOnce,
  type BusinessDirectoryEmployee,
  type BusinessInfo,
  type EmployeeDetail,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { prefetchCustomerFlowRoutes } from "../../lib/prefetchCustomerRoutes";
import { CustomerFlowShell } from "./CustomerFlowShell";
import { CustomerJourneyHeader } from "./CustomerJourneyHeader";
import { CustomerJourneyAttributionFooter } from "./CustomerJourneyCareTipAttribution";
import { venueBrandFromBusiness } from "./customerJourneyBrand";
import { headerSelectTeamMember } from "./customerJourneyHeaderCopy";
import { startGuestTipCheckout } from "../../lib/startGuestTipCheckout";
import { CustomerTeamPicker } from "./CustomerTeamPicker";
import { CustomerRepeatTipPrompt } from "./CustomerRepeatTipPrompt";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../../lib/devCustomerBypass";
import { markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { getRepeatTipDataForBusiness } from "../../lib/repeatTip";
import { formatEur } from "../../lib/formatEur";
import { customerFlowUi as cf } from "./customerFlowUi";

export function QRLandingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { businessId, qrSlug } = useParams<{ businessId?: string; qrSlug?: string }>();
  const [searchParams] = useSearchParams();
  const employeeIdParam = searchParams.get("employeeId");
  const teamSectionRef = useRef<HTMLDivElement>(null);

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
    if (searchParams.get("tipComplete") !== "1") return;
    const sessionId = searchParams.get("session_id")?.trim();
    if (!sessionId) {
      navigate("/", { replace: true });
      return;
    }
    const params = new URLSearchParams({ session_id: sessionId });
    if (searchParams.get("feedbackSubmitted") === "1") params.set("feedbackSubmitted", "1");
    navigate(`/tip-complete?${params.toString()}`, { replace: true });
  }, [navigate, searchParams]);

  const {
    setBusinessId,
    setEmployee,
    setAmount,
    setTippingVenue,
    setStaffProfileSlug,
    setStaffTipReturnPath,
    tippingLocationName,
    tippingTableName,
  } = useTipFlow();

  const [businessData, setBusinessData] = useState<BusinessInfo | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Public staff list when business has a directory slug (general business QR). */
  const [poolEmployees, setPoolEmployees] = useState<BusinessDirectoryEmployee[] | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolQuery, setPoolQuery] = useState("");

  const [repeatCard, setRepeatCard] = useState<{
    employee: EmployeeDetail;
    amount: number;
    timestamp: number;
  } | null>(null);
  const [repeatDismissed, setRepeatDismissed] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  useEffect(() => {
    if (!businessId && !employeeIdParam && !qrSlug) {
      setBusinessId(null);
      setTippingVenue(null);
      setLoading(false);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);
      setSelectedEmployee(null);
      setBusinessData(null);
      try {
        let targetBusinessId: string | null = businessId ?? null;

        if (qrSlug) {
          const ctx = await getTippingContextByQrSlug(qrSlug);
          targetBusinessId = ctx.businessId;
          recordGuestQrScanOnce({
            businessId: ctx.businessId,
            scanType: "table_slug",
            locationId: ctx.locationId,
            tableId: ctx.tableId,
            qrSlug,
            entryPath: window.location.pathname,
            notify: { locationName: ctx.locationName, tableName: ctx.tableName },
          });
          setBusinessId(ctx.businessId);
          setTippingVenue({
            locationId: ctx.locationId,
            tableId: ctx.tableId,
            locationName: ctx.locationName,
            tableName: ctx.tableName,
            qrSlug,
          });
          markCustomerFlowEntered();
        } else {
          setTippingVenue(null);
        }

        if (employeeIdParam) {
          const emp = await getEmployeeById(employeeIdParam);
          if (!qrSlug) {
            recordGuestQrScanOnce({
              businessId: emp.businessId,
              scanType: "employee_legacy_id",
              employeeId: emp.id,
              entryPath: window.location.pathname,
            });
          }
          if (qrSlug && emp.businessId !== targetBusinessId) {
            setError(t("tipFlow.errors.employeeWrongVenue"));
            return;
          }
          setBusinessId(emp.businessId);
          setSelectedEmployee(emp);
          setEmployee(emp.id, emp.name ?? t("tipFlow.common.valuedTeamMember"), emp.avatar ?? undefined);
          markCustomerFlowEntered();
          if (!targetBusinessId) {
            targetBusinessId = emp.businessId;
          }
        } else if (targetBusinessId) {
          if (!qrSlug && !employeeIdParam) {
            recordGuestQrScanOnce({
              businessId: targetBusinessId,
              scanType: "business_id",
              entryPath: window.location.pathname,
            });
          }
          const business = await getBusinessById(targetBusinessId);
          if (!business) {
            setError(t("tipFlow.errors.businessNotFound"));
            return;
          }
          setBusinessId(targetBusinessId);
          setBusinessData({
            ...business,
            slug: business.slug ?? null,
          });
          markCustomerFlowEntered();

          const slug = business.slug?.trim().toLowerCase();
          if (slug && !employeeIdParam) {
            setPoolLoading(true);
            try {
              const res = await getBusinessStaffDirectory(slug);
              setPoolEmployees(res.employees ?? []);
            } catch (e) {
              logClientError("QRLandingPage.directory", e);
              setPoolEmployees([]);
            } finally {
              setPoolLoading(false);
            }
          }
        }
      } catch (err) {
        logClientError("QRLandingPage", err);
        setError(toUserFriendlyMessage(err));
        setBusinessData(null);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [
    businessId,
    employeeIdParam,
    qrSlug,
    setBusinessId,
    setEmployee,
    setTippingVenue,
    t,
  ]);

  // Repeat tip: check local last-tip data for this business and validate employee still exists.
  useEffect(() => {
    if (!businessData?.id || selectedEmployee || employeeIdParam) {
      setRepeatCard(null);
      return;
    }
    if (repeatDismissed) return;
    const d = getRepeatTipDataForBusiness(businessData.id);
    if (!d) {
      setRepeatCard(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const emp = await getEmployeeById(d.employeeId);
        if (cancelled) return;
        if (!emp || emp.businessId !== businessData.id) {
          setRepeatCard(null);
          return;
        }
        setRepeatCard({ employee: emp, amount: d.lastAmount, timestamp: d.timestamp });
      } catch {
        if (!cancelled) setRepeatCard(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessData?.id, selectedEmployee, employeeIdParam, repeatDismissed]);

  const filteredPool = useMemo(() => {
    const list = poolEmployees ?? [];
    const q = poolQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) => e.name.toLowerCase().includes(q) || e.jobTitle.toLowerCase().includes(q)
    );
  }, [poolEmployees, poolQuery]);

  useEffect(() => {
    if (employeeIdParam && selectedEmployee) {
      document.title = t("tipFlow.docTitle.tip", {
        name: selectedEmployee.name || t("tipFlow.common.valuedTeamMember"),
      });
    } else if (businessData) {
      document.title = t("tipFlow.docTitle.business", { name: businessData.name });
    }
    return () => {
      document.title = t("tipFlow.docTitle.default");
    };
  }, [selectedEmployee, businessData, employeeIdParam, t]);

  const goToSelectEmployee = () => {
    const slug = businessData?.slug?.trim();
    if (slug) {
      navigate(`/${encodeURIComponent(slug)}`);
      return;
    }
    navigate("/");
  };

  const pickEmployeeFromPool = (emp: BusinessDirectoryEmployee) => {
    if (!businessData) return;
    setBusinessId(businessData.id);
    setEmployee(emp.id, emp.name, emp.avatar ?? undefined);
    const qs = new URLSearchParams({ employeeId: emp.id });
    const bizSlug = businessData.slug?.trim();
    const empSlug = emp.slug?.trim();
    if (bizSlug && empSlug) {
      setStaffTipReturnPath(bizSlug, empSlug);
      qs.set("returnBusinessSlug", bizSlug);
      qs.set("returnEmployeeSlug", empSlug);
      qs.set("direct", "1");
    } else {
      setStaffProfileSlug(emp.slug ?? null);
      if (emp.slug) {
        qs.set("returnSlug", emp.slug);
        qs.set("direct", "1");
      }
    }
    navigate(`/tip-amount?${qs.toString()}`);
  };

  const showInlinePool =
    Boolean(businessData?.slug?.trim()) && !poolLoading && (poolEmployees?.length ?? 0) > 0;

  const goHome = () => {
    window.location.href = "/";
  };

  if (!businessId && !employeeIdParam && !qrSlug) {
    if (DEV_BYPASS_ENABLED) {
      // DEV-only: allow opening /qr-landing directly.
      // We don't hit the API here; we just seed minimal mock context and let
      // the tester jump straight to other pages.
      setBusinessId(DEV_MOCK.businessId);
      setEmployee(DEV_MOCK.employeeId, DEV_MOCK.employeeName, undefined);
      setAmount(DEV_MOCK.amount);
      setTippingVenue(DEV_MOCK.venue);
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="caretip-container mx-auto w-full max-w-md space-y-4 py-12 sm:py-16">
            <Card className={cf.cardShadcn}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("tipFlow.devBypass.title")}</CardTitle>
                <CardDescription>{t("tipFlow.devBypass.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <button
                  type="button"
                  onClick={() => navigate(`/tip-amount?employeeId=${encodeURIComponent(DEV_MOCK.employeeId)}`)}
                  className={`${cf.btnAccentLg} py-3.5 text-sm`}
                >
                  {t("tipFlow.devBypass.openTipAmount")}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/payment")}
                  className={`${cf.btnSecondaryLg} py-3.5 text-sm`}
                >
                  {t("tipFlow.devBypass.openPayment")}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/rating?session_id=${encodeURIComponent(DEV_MOCK.sessionId)}`)}
                  className="w-full text-sm font-semibold text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  {t("tipFlow.devBypass.openRating")}
                </button>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }
    // Production: no direct entry to an empty QR landing page.
    navigate("/", { replace: true });
    return null;
  }

  if (loading && !employeeIdParam) {
    const teamHeader = headerSelectTeamMember(t);
    return (
      <CustomerFlowShell
        venue={{ name: t("tipFlow.docTitle.default"), logo: null }}
        stepTitle={teamHeader.stepTitle}
        loading
        loadingContext="tipPage"
        loadingRegistrationKey="qr-landing"
      />
    );
  }

  if (error) {
    return (
      <div className={cf.stateCenter}>
        <p className={cf.stateError}>{error}</p>
        <button
          onClick={goHome}
          type="button"
          className={`${cf.btnPrimaryLg} mt-4 max-w-xs`}
        >
          <Home className="w-5 h-5" />
          {t("tipFlow.common.goHomeButton")}
        </button>
      </div>
    );
  }

  if (employeeIdParam && loading) {
    return (
      <CustomerFlowShell
        venue={{
          name: t("tipFlow.common.venue"),
          logo: null,
        }}
        loading
        loadingContext="tipPage"
        loadingRegistrationKey="qr-landing"
      />
    );
  }

  if (selectedEmployee) {
    const qs = new URLSearchParams({ employeeId: selectedEmployee.id, direct: "1" });
    return <Navigate to={`/tip-amount?${qs.toString()}`} replace />;
  }

  if (!businessData) {
    return (
      <div className={cf.stateCenter}>
        <p className={cf.stateError}>{t("tipFlow.errors.businessNotFound")}</p>
        <button type="button" onClick={goHome} className={`${cf.btnSecondaryLg} mt-5 max-w-xs`}>
          {t("tipFlow.common.goHomeButton")}
        </button>
      </div>
    );
  }

  const tableContextLine =
    tippingLocationName && tippingTableName
      ? t("tipFlow.atVenue", { location: tippingLocationName, table: tippingTableName })
      : undefined;

  const teamHeader = headerSelectTeamMember(t);

  return (
    <div className={cf.page}>
      <CustomerJourneyHeader
        venue={venueBrandFromBusiness(businessData, tableContextLine)}
        stepTitle={teamHeader.stepTitle}
      />

      <div className={`${cf.mainTeam} space-y-8`}>
        {repeatCard ? (
          <CustomerRepeatTipPrompt
            employeeName={repeatCard.employee.name ?? t("tipFlow.common.teamMember")}
            employeeAvatar={repeatCard.employee.avatar}
            body={t("tipFlow.qrLanding.repeatBody", {
              name: repeatCard.employee.name ?? t("tipFlow.common.teamMember"),
            })}
            lastTipLabel={t("tipFlow.qrLanding.repeatLastTip", { amount: formatEur(repeatCard.amount) })}
            primaryLabel={t("tipFlow.qrLanding.tipAgain")}
            secondaryLabel={t("tipFlow.qrLanding.repeatNotNow")}
            onPrimary={() => {
              void (async () => {
                setBusinessId(businessData.id);
                setEmployee(
                  repeatCard.employee.id,
                  repeatCard.employee.name ?? t("tipFlow.common.teamMember"),
                  repeatCard.employee.avatar ?? undefined,
                );
                setAmount(repeatCard.amount);
                markCustomerFlowEntered();
                setCheckingOut(true);
                const result = await startGuestTipCheckout(
                  {
                    amount: repeatCard.amount,
                    employeeId: repeatCard.employee.id,
                    businessId: businessData.id,
                    employeeName: repeatCard.employee.name,
                  },
                  t("tipFlow.payment.checkoutStartError"),
                );
                if (result !== "redirected") setCheckingOut(false);
              })();
            }}
            onSecondary={() => {
              setRepeatDismissed(true);
              setRepeatCard(null);
            }}
            primaryDisabled={checkingOut}
          />
        ) : null}

        {businessData.slug?.trim() && poolLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading.tipPage")}</p>
        ) : null}

        {showInlinePool ? (
          <div ref={teamSectionRef}>
            <CustomerTeamPicker
              searchLabel={t("tipFlow.locationLanding.searchTitle")}
              searchPlaceholder={t("tipFlow.qrLanding.searchPlaceholder")}
              teamLabel={t("tipFlow.locationLanding.teamTitle")}
              emptyLabel={t("tipFlow.qrLanding.noMatches")}
              query={poolQuery}
              onQueryChange={setPoolQuery}
              employees={filteredPool}
              onPick={pickEmployeeFromPool}
              tipButtonLabel={t("tipFlow.qrLanding.tipCta")}
              tipButtonAria={(name) => t("tipFlow.locationLanding.tipPerson", { name })}
            />
          </div>
        ) : null}

        {businessData.slug?.trim() && !poolLoading && poolEmployees?.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("tipFlow.qrLanding.noPublicList")}</p>
        ) : null}

        {!showInlinePool && !poolLoading ? (
          <button type="button" onClick={goToSelectEmployee} className={cf.btnPrimaryLg}>
            {businessData.slug?.trim()
              ? t("tipFlow.qrLanding.browseAllTeam")
              : t("tipFlow.qrLanding.selectTeamMemberBtn")}
          </button>
        ) : null}

        <CustomerJourneyAttributionFooter label={t("tipFlow.common.poweredByCareTip")} />
      </div>
    </div>
  );
}

