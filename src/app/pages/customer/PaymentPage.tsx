import { useNavigate, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { useTipFlow } from "../../context/TipFlowContext";
import { createTipCheckoutSession } from "../../lib/api";
import { toUserFriendlyMessage } from "../../lib/errorMessages";
import { logClientError } from "../../lib/clientLog";
import { setPendingTipFromCheckout } from "../../lib/repeatTip";
import { ProfileAvatar } from "../../components/ui/profile-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../../lib/devCustomerBypass";
import { hasRecentCustomerFlowEntry, markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import {
  isCustomerEmployeeContextReady,
  resolveCustomerEmployeeContext,
} from "../../lib/resolveCustomerEmployeeContext";
import { PaymentMethodsAvailable } from "../../components/payments/PaymentMethodsAvailable";
import { formatEur } from "../../lib/formatEur";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerFlowShell } from "./CustomerFlowShell";
import {
  CustomerJourneyBackButton,
} from "./CustomerJourneyHeader";
import { venueBrandFromFields, useCustomerVenueBrand } from "./customerJourneyBrand";
import { headerCompletePaymentFor } from "./customerJourneyHeaderCopy";
import { redirectToStripeCheckoutUrl } from "../../lib/safeCheckoutRedirect";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../../lib/globalAppLoading";
import { resolveAppLoadingContextMessage } from "../../lib/appLoadingContexts";

export function PaymentPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const employeeIdFromUrl = searchParams.get("employeeId");
  const amountFromUrlRaw = searchParams.get("amount");
  const amountFromUrlParsed =
    amountFromUrlRaw != null && amountFromUrlRaw.trim() !== "" ? Number(amountFromUrlRaw) : NaN;
  const amountFromUrl =
    Number.isFinite(amountFromUrlParsed) && amountFromUrlParsed > 0 ? amountFromUrlParsed : null;
  const returnSlugFromUrl = searchParams.get("returnSlug");
  const returnBusinessSlugFromUrl = searchParams.get("returnBusinessSlug");
  const returnEmployeeSlugFromUrl = searchParams.get("returnEmployeeSlug");
  const {
    amount: tipAmountCtx,
    employeeId: employeeIdCtx,
    employeeName,
    employeeAvatar,
    staffProfileSlug,
    staffTipReturnBusinessSlug,
    staffTipReturnEmployeeSlug,
    businessId,
    locationId,
    tableId,
    setBusinessId,
    setEmployee,
    setAmount,
  } = useTipFlow();
  const [processing, setProcessing] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [resolvedVenueSnapshot, setResolvedVenueSnapshot] = useState<{
    name: string;
    logo: string | null;
  } | null>(null);
  const fallbackVenue = t("tipFlow.common.venue");
  const fetchedVenue = useCustomerVenueBrand(businessId, fallbackVenue);

  const resolvedEmployeeId = employeeIdCtx ?? employeeIdFromUrl;
  const tipAmountVal =
    tipAmountCtx != null && Number.isFinite(tipAmountCtx) && tipAmountCtx > 0
      ? tipAmountCtx
      : amountFromUrl;
  const totalAmount = tipAmountVal ?? 0;
  const missingContext = !resolvedEmployeeId || !businessId || tipAmountVal == null;

  useEffect(() => {
    if (!resolvedEmployeeId) {
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;

    if (
      isCustomerEmployeeContextReady(resolvedEmployeeId, {
        businessId,
        employeeId: employeeIdCtx,
        employeeName,
      })
    ) {
      setContextReady(true);
      if (!resolvedVenueSnapshot && businessId) {
        void resolveCustomerEmployeeContext({
          employeeId: resolvedEmployeeId,
          returnSlug: returnSlugFromUrl,
          returnBusinessSlug: returnBusinessSlugFromUrl,
          returnEmployeeSlug: returnEmployeeSlugFromUrl,
          fallbackTeamMemberLabel: t("tipFlow.common.teamMember"),
          fallbackVenueLabel: fallbackVenue,
        })
          .then((resolved) => {
            setResolvedVenueSnapshot({ name: resolved.businessName, logo: resolved.businessLogo });
          })
          .catch((err) => logClientError("PaymentPage.resolveVenue", err));
      }
      return;
    }

    (async () => {
      if (!import.meta.env.DEV && hasRecentCustomerFlowEntry() && businessId && employeeName) {
        if (!cancelled) setContextReady(true);
        return;
      }

      try {
        const resolved = await resolveCustomerEmployeeContext({
          employeeId: resolvedEmployeeId,
          returnSlug: returnSlugFromUrl,
          returnBusinessSlug: returnBusinessSlugFromUrl,
          returnEmployeeSlug: returnEmployeeSlugFromUrl,
          fallbackTeamMemberLabel: t("tipFlow.common.teamMember"),
          fallbackVenueLabel: t("tipFlow.common.venue"),
        });
        if (cancelled) return;
        setBusinessId(resolved.businessId);
        setEmployee(resolved.employeeId, resolved.employeeName, resolved.employeeAvatar);
        setResolvedVenueSnapshot({ name: resolved.businessName, logo: resolved.businessLogo });
        markCustomerFlowEntered();
        setContextReady(true);
      } catch (err) {
        if (cancelled) return;
        logClientError("PaymentPage.resolve", err);
        navigate("/", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    businessId,
    employeeIdCtx,
    employeeName,
    navigate,
    resolvedEmployeeId,
    returnBusinessSlugFromUrl,
    returnEmployeeSlugFromUrl,
    returnSlugFromUrl,
    setBusinessId,
    setEmployee,
    t,
    fallbackVenue,
    resolvedVenueSnapshot,
  ]);

  useEffect(() => {
    if (!DEV_BYPASS_ENABLED) return;
    if (resolvedEmployeeId && businessId) return;
    if (resolvedEmployeeId && !businessId) {
      if (amountFromUrl == null && (tipAmountCtx == null || tipAmountCtx <= 0)) {
        setAmount(DEV_MOCK.amount);
      }
      return;
    }
    setBusinessId(DEV_MOCK.businessId);
    setEmployee(DEV_MOCK.employeeId, DEV_MOCK.employeeName, undefined);
    if (amountFromUrl == null && (tipAmountCtx == null || tipAmountCtx <= 0)) {
      setAmount(DEV_MOCK.amount);
    }
  }, [amountFromUrl, businessId, resolvedEmployeeId, setAmount, setBusinessId, setEmployee, tipAmountCtx]);

  useEffect(() => {
    if (searchParams.get("canceled") === "1") {
      toast.message(t("tipFlow.payment.canceledTitle"), {
        description: t("tipFlow.payment.canceledDesc"),
      });
    }
  }, [searchParams, t]);

  const handleBack = () => {
    const eid = resolvedEmployeeId;
    if (eid && staffTipReturnBusinessSlug && staffTipReturnEmployeeSlug) {
      const qs = new URLSearchParams({
        employeeId: eid,
        returnBusinessSlug: staffTipReturnBusinessSlug,
        returnEmployeeSlug: staffTipReturnEmployeeSlug,
        direct: "1",
      });
      navigate(`/tip-amount?${qs.toString()}`);
      return;
    }
    if (eid && staffProfileSlug) {
      navigate(
        `/tip-amount?employeeId=${encodeURIComponent(eid)}&returnSlug=${encodeURIComponent(staffProfileSlug)}&direct=1`,
      );
      return;
    }
    navigate(eid ? `/tip-amount?employeeId=${eid}` : "/");
  };

  const handlePayment = async () => {
    if (!resolvedEmployeeId || !businessId || tipAmountVal == null) return;

    setProcessing(true);
    try {
      const { sessionId, url } = await createTipCheckoutSession({
        amount: totalAmount,
        employeeId: resolvedEmployeeId,
        businessId,
        tipAmount: tipAmountVal,
        locationId: locationId ?? null,
        tableId: tableId ?? null,
      });
      if (!url) {
        toast.error(t("tipFlow.payment.checkoutStartError"));
        setProcessing(false);
        return;
      }
      setPendingTipFromCheckout({
        sessionId,
        businessId,
        employeeId: resolvedEmployeeId,
        employeeName: employeeName ?? null,
        amount: tipAmountVal,
      });
      redirectToStripeCheckoutUrl(url);
    } catch (err) {
      logClientError("PaymentPage.checkout", err);
      toast.error(toUserFriendlyMessage(err));
      setProcessing(false);
    }
  };

  const showCheckout = contextReady && !missingContext;
  const stripeRedirectMessage = resolveAppLoadingContextMessage("stripeRedirect", t);

  useAppLoadingRegistration(
    "payment-stripe-redirect",
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    processing,
    stripeRedirectMessage,
  );

  const employeeDisplayName = employeeName ?? t("tipFlow.common.teamMember");
  const paymentHeader = headerCompletePaymentFor(t, employeeDisplayName);
  const resolvedVenue = resolvedVenueSnapshot
    ? venueBrandFromFields(resolvedVenueSnapshot.name, resolvedVenueSnapshot.logo)
    : fetchedVenue;

  return (
    <CustomerFlowShell
      withBottomCta={showCheckout}
      headerLeading={
        <CustomerJourneyBackButton
          label={t("tipFlow.common.back")}
          onClick={handleBack}
          disabled={processing}
        />
      }
      venue={resolvedVenue}
      stepTitle={paymentHeader.stepTitle}
      trustMessage={paymentHeader.trustMessage}
      loading={!contextReady}
      loadingContext="checkout"
      loadingRegistrationKey="payment-page-checkout"
      bottomBar={
        showCheckout ? (
          <div className={cf.fixedBottomBar}>
            <div className={cf.fixedBottomInner}>
              <div className={cf.journeyCtaStack}>
                <button
                  type="button"
                  onClick={handlePayment}
                  disabled={processing}
                  className={cf.btnAccentLg}
                >
                  {processing ? (
                    <>
                      <span className="inline-block size-5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                      {stripeRedirectMessage}
                    </>
                  ) : (
                    t("tipFlow.payment.payAmount", { amount: formatEur(totalAmount) })
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : undefined
      }
    >
      {contextReady && missingContext ? (
        <div className="text-center">
          <div className={`${cf.cardMuted} mx-auto max-w-md px-5 py-8 sm:px-8`}>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("tipFlow.payment.missingContext")}
            </p>
            <button type="button" onClick={() => navigate("/")} className={`${cf.btnPrimaryLg} mt-6`}>
              {t("tipFlow.common.goHomeButton")}
            </button>
          </div>
        </div>
      ) : null}

      {showCheckout ? (
        <>
          <Card className={cf.paymentSummary}>
            <CardContent className="p-0">
              <div className="customer-flow-payment-summary__hero">
                <ProfileAvatar
                  src={employeeAvatar}
                  displayName={employeeName ?? t("tipFlow.common.teamMember")}
                  className={cf.employeeSummaryAvatar}
                />
                <div className="min-w-0">
                  <p className={cf.paymentAmountLabel}>{t("tipFlow.payment.payingTipTo")}</p>
                  <p className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                    {employeeName ?? t("tipFlow.common.teamMember")}
                  </p>
                </div>
              </div>
              <div className="customer-flow-payment-summary__line">
                <span className="text-muted-foreground">{t("tipFlow.tipAmount.tipAmountLabel")}</span>
                <span className="font-medium tabular-nums text-foreground">{formatEur(tipAmountVal)}</span>
              </div>
              <div className="customer-flow-payment-summary__amount">
                <span className="text-base font-semibold text-foreground sm:text-lg">
                  {t("tipFlow.payment.amountToPay")}
                </span>
                <span className={cf.paymentAmountDisplay}>{formatEur(totalAmount)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className={cf.cardShadcn}>
            <CardHeader className={`${cf.cardHeaderPadding} pb-2`}>
              <CardTitle className={cf.cardTitle}>{t("tipFlow.payment.selectMethodTitle")}</CardTitle>
              <CardDescription className={cf.cardDesc}>
                {t("tipFlow.payment.selectMethodDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5 sm:px-6">
              <PaymentMethodsAvailable />
            </CardContent>
          </Card>

          <div className={cf.stripeNote}>{t("tipFlow.payment.stripeCardNote")}</div>

          <Card className={cf.trustCard}>
            <CardContent className="flex items-start gap-3.5 px-5 py-4 pl-6 sm:px-6 sm:pl-7">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                <Lock className="size-5" aria-hidden />
              </div>
              <div className="text-sm leading-relaxed text-muted-foreground">
                <p className="mb-1 font-semibold text-foreground">{t("tipFlow.payment.secureTitle")}</p>
                <p>{t("tipFlow.payment.secureBody")}</p>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </CustomerFlowShell>
  );
}
