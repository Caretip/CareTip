import { motion } from "motion/react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, Euro, Home, Search } from "lucide-react";
import { useTipFlow } from "../../context/TipFlowContext";
import {
  getBusinessById,
  getEmployeeById,
  getBusinessStaffDirectory,
  getTippingContextByQrSlug,
  type BusinessDirectoryEmployee,
  type BusinessInfo,
  type EmployeeDetail,
} from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { prefetchCustomerFlowRoutes } from "../../lib/prefetchCustomerRoutes";
import { CustomerFlowShell } from "./CustomerFlowShell";
import { CustomerJourneyHeader } from "./CustomerJourneyHeader";
import { CustomerJourneyAttributionFooter } from "./CustomerJourneyCareTipAttribution";
import { venueBrandFromBusiness } from "./customerJourneyBrand";
import { headerChooseAmountFor, headerSelectTeamMember } from "./customerJourneyHeaderCopy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../../lib/devCustomerBypass";
import { markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { getRepeatTipDataForBusiness } from "../../lib/repeatTip";
import { formatEur } from "../../lib/formatEur";
import { customerFlowUi as cf } from "./customerFlowUi";

const BRAND_ORANGE = "#e9781c";
const presetAmounts = [5, 10, 15, 20];

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

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

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
      } catch (e) {
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

  const handleAmountSelect = (amount: number) => {
    setSelectedAmount(amount);
    setShowCustomInput(false);
    setCustomAmount("");
  };

  const handleCustomClick = () => {
    setShowCustomInput(true);
    setSelectedAmount(null);
  };

  const handleCustomInput = (value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue > 0) {
      setCustomAmount(value);
      setSelectedAmount(numValue);
    } else {
      setCustomAmount(value);
      setSelectedAmount(null);
    }
  };

  const handleContinueToPayment = () => {
    if (selectedAmount && selectedEmployee) {
      setAmount(selectedAmount);
      navigate("/payment");
    }
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
        trustMessage={teamHeader.trustMessage}
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

  const displayName = selectedEmployee?.name?.trim() || t("tipFlow.common.valuedTeamMember");

  if (employeeIdParam && loading) {
    const amountHeader = headerChooseAmountFor(t, displayName);
    return (
      <CustomerFlowShell
        venue={
          businessData
            ? venueBrandFromBusiness(businessData)
            : { name: t("tipFlow.common.venue"), logo: null }
        }
        stepTitle={amountHeader.stepTitle}
        trustMessage={amountHeader.trustMessage}
        loading
        loadingContext="tipPage"
        loadingRegistrationKey="qr-landing"
      />
    );
  }

  if (selectedEmployee) {
    const employeeVenue = venueBrandFromBusiness(businessData!);
    const amountHeader = headerChooseAmountFor(t, displayName);
    return (
      <CustomerFlowShell
        withBottomCta={Boolean(selectedAmount)}
        venue={employeeVenue}
        stepTitle={amountHeader.stepTitle}
        trustMessage={amountHeader.trustMessage}
        bottomBar={
          selectedAmount ? (
            <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={cf.fixedBottomBar}>
              <div className={cf.fixedBottomInner}>
                <div className={cf.journeyCtaStack}>
                  <button type="button" onClick={handleContinueToPayment} className={cf.btnPrimaryLg}>
                    {t("tipFlow.qrLanding.continuePayment")}
                  </button>
                </div>
              </div>
            </motion.div>
          ) : undefined
        }
      >
        <Card className={cf.cardShadcn}>
          <CardContent className="px-5 py-6 sm:px-7">
            <div className="grid grid-cols-2 gap-3">
              {presetAmounts.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => handleAmountSelect(amount)}
                  className={`${cf.tipPresetTile} flex flex-col justify-center font-semibold ${selectedAmount === amount ? cf.tipPresetOn : cf.tipPresetIdle}`}
                >
                  <div className="mb-1 text-3xl font-bold tabular-nums text-foreground">
                    {formatEur(amount, { minFrac: 0, maxFrac: 0 })}
                  </div>
                  <div className="text-xs text-muted-foreground">{t("tipFlow.qrLanding.tipAmountTile")}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className={cf.cardShadcn}>
          <CardHeader className={`${cf.cardHeaderPadding} pb-3`}>
            <CardTitle className={`${cf.cardTitle} text-lg`}>{t("tipFlow.qrLanding.customAmountTitle")}</CardTitle>
            <CardDescription className={cf.cardDesc}>{t("tipFlow.qrLanding.customAmountDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-6 sm:px-7">
            {!showCustomInput ? (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={handleCustomClick}
                className={cf.dashedCustomTrigger}
              >
                <Euro className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
                <span className="text-sm font-medium text-muted-foreground">{t("tipFlow.qrLanding.enterCustom")}</span>
              </motion.button>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative">
                <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-3xl font-bold text-muted-foreground/40">
                  €
                </div>
                <input
                  type="number"
                  placeholder={t("tipFlow.qrLanding.amountPlaceholder")}
                  value={customAmount}
                  onChange={(e) => handleCustomInput(e.target.value)}
                  className={`${cf.inputAmount} pl-11`}
                  autoFocus
                  step="0.01"
                  min="0"
                />
              </motion.div>
            )}
          </CardContent>
        </Card>

        {selectedAmount ? (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <Card className={cf.cardAccentWash}>
              <CardContent className="px-5 py-6 sm:px-7">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-muted-foreground">{t("tipFlow.qrLanding.totalTip")}</span>
                  <span className="text-3xl font-bold tabular-nums text-primary sm:text-4xl">{formatEur(selectedAmount)}</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}
      </CustomerFlowShell>
    );
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
        trustMessage={teamHeader.trustMessage}
      />

      <div className={`${cf.main} lg:space-y-9 xl:space-y-10`}>
        {(businessData.employeeCount != null && businessData.employeeCount > 0) ||
        (poolEmployees != null && poolEmployees.length > 0) ? (
          <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <div className="flex items-center gap-3 rounded-[1.125rem] border border-black/[0.06] bg-primary/[0.04] p-4">
              <Users className="h-6 w-6 shrink-0 text-primary" />
              <span className="text-sm font-medium text-foreground">
                {t("tipFlow.qrLanding.staffReady", {
                  count: poolEmployees?.length ?? businessData.employeeCount ?? 0,
                })}
              </span>
            </div>
          </motion.div>
        ) : null}

        {businessData.slug?.trim() && poolLoading ? (
          <Card className={cf.cardShadcn}>
            <CardContent className="space-y-3 py-6">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-10 w-full animate-pulse rounded-lg bg-muted" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((k) => (
                  <div key={k} className="aspect-[4/5] animate-pulse rounded-2xl bg-muted" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {showInlinePool ? (
          <motion.div
            ref={teamSectionRef}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.05 }}
          >
            <Card className={cf.cardSearchLight}>
              <CardContent className="space-y-5 px-5 pb-6 pt-5 sm:px-7 sm:pt-6">
                <div className="relative rounded-[1.125rem] border border-black/[0.04] bg-white p-0.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] dark:border-white/10 dark:bg-card">
                  <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/60" />
                  <input
                    type="search"
                    placeholder={t("tipFlow.qrLanding.searchPlaceholder")}
                    value={poolQuery}
                    onChange={(e) => setPoolQuery(e.target.value)}
                    className={`${cf.inputField} border-0 bg-transparent shadow-none focus-visible:ring-0 py-3.5 pl-11 pr-4 placeholder:text-muted-foreground/65`}
                    autoComplete="off"
                  />
                </div>
                {filteredPool.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground/60">{t("tipFlow.qrLanding.noMatches")}</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5">
                    {filteredPool.map((emp, index) => (
                      <motion.li
                        key={emp.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.02 }}
                      >
                        <button
                          type="button"
                          onClick={() => pickEmployeeFromPool(emp)}
                          className={cf.employeeCard}
                        >
                          <ProfileAvatar
                            src={emp.avatar}
                            displayName={emp.name}
                            className={cf.employeeAvatar}
                          />
                          <span className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
                            {emp.name}
                          </span>
                          <span className="line-clamp-2 text-xs text-muted-foreground/70">
                            {emp.jobTitle}
                          </span>
                        </button>
                      </motion.li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ) : null}

        {businessData.slug?.trim() && !poolLoading && poolEmployees?.length === 0 ? (
          <Card className={`${cf.cardMuted} border-dashed`}>
            <CardContent className="py-6 text-center text-sm text-muted-foreground/70 font-medium">
              {t("tipFlow.qrLanding.noPublicList")}
            </CardContent>
          </Card>
        ) : null}

        {showInlinePool ? (
          <p className="text-center text-sm text-muted-foreground/70 px-2">
            {t("tipFlow.qrLanding.browseMore")}{" "}
            <button
              type="button"
              onClick={goToSelectEmployee}
              className="font-semibold text-primary underline underline-offset-2 transition-colors hover:opacity-90"
            >
              {t("tipFlow.qrLanding.openFullDirectory")}
            </button>
          </p>
        ) : (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            <button
              type="button"
              onClick={goToSelectEmployee}
              className={cf.btnPrimaryLg}
            >
              {businessData.slug?.trim()
                ? t("tipFlow.qrLanding.browseAllTeam")
                : t("tipFlow.qrLanding.selectTeamMemberBtn")}
            </button>
          </motion.div>
        )}

        {repeatCard ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <Card className={`${cf.cardMuted} border-dashed border-border/70`}>
              <CardContent className="space-y-3 p-5 sm:p-6">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("tipFlow.qrLanding.repeatOptionalLabel")}
                </p>
                <div className="flex items-start gap-3">
                  <ProfileAvatar
                    src={repeatCard.employee.avatar}
                    displayName={repeatCard.employee.name ?? t("tipFlow.common.teamMember")}
                    className="h-10 w-10 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">
                      {t("tipFlow.qrLanding.repeatBody", {
                        name: repeatCard.employee.name ?? t("tipFlow.common.teamMember"),
                      })}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/80">
                      {t("tipFlow.qrLanding.repeatLastTip", { amount: formatEur(repeatCard.amount) })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setRepeatDismissed(true);
                      setRepeatCard(null);
                    }}
                    className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t("tipFlow.qrLanding.repeatNotNow")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBusinessId(businessData.id);
                      setEmployee(
                        repeatCard.employee.id,
                        repeatCard.employee.name ?? t("tipFlow.common.teamMember"),
                        repeatCard.employee.avatar ?? undefined,
                      );
                      setAmount(repeatCard.amount);
                      markCustomerFlowEntered();
                      navigate("/payment");
                    }}
                    className={`${cf.btnSecondaryLg} ml-auto max-w-full py-2.5 px-4 text-sm sm:w-auto`}
                  >
                    {t("tipFlow.qrLanding.tipAgain")}
                  </button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          <Card className={`${cf.cardMuted} border-primary/12`}>
            <CardContent className="flex items-center justify-center gap-3 py-5 text-center text-xs text-muted-foreground/70 font-medium">
              <svg className="h-5 w-5 shrink-0 text-primary/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              {t("tipFlow.qrLanding.secureFooter")}
            </CardContent>
          </Card>
        </motion.div>

        <CustomerJourneyAttributionFooter label={t("tipFlow.common.poweredByCareTip")} />
      </div>
    </div>
  );
}
