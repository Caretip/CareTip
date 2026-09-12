import { useNavigate, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTipFlow } from "../../context/TipFlowContext";
import { logClientError } from "../../lib/clientLog";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../../lib/devCustomerBypass";
import { hasRecentCustomerFlowEntry, markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import {
  isCustomerEmployeeContextReady,
  resolveCustomerEmployeeContext,
} from "../../lib/resolveCustomerEmployeeContext";
import { startGuestTipCheckout } from "../../lib/startGuestTipCheckout";
import { formatEur } from "../../lib/formatEur";
import { isTipAmountInRangeEur, MIN_TIP_AMOUNT_EUR } from "../../lib/tipAmountLimits";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerFlowShell } from "./CustomerFlowShell";
import { CustomerJourneyBackButton } from "./CustomerJourneyHeader";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../../lib/globalAppLoading";
import { resolveAppLoadingContextMessage } from "../../lib/appLoadingContexts";

export function TipAmountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const employeeId = searchParams.get("employeeId");
  const returnSlug = searchParams.get("returnSlug");
  const returnBusinessSlug = searchParams.get("returnBusinessSlug");
  const returnEmployeeSlug = searchParams.get("returnEmployeeSlug");
  const {
    businessId,
    employeeId: employeeIdCtx,
    employeeName,
    employeeAvatar,
    tableQrSlug,
    locationId,
    tableId,
    setBusinessId,
    setEmployee,
    setAmount,
  } = useTipFlow();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [contextReady, setContextReady] = useState(() =>
    Boolean(
      employeeId &&
        isCustomerEmployeeContextReady(employeeId, {
          businessId,
          employeeId: employeeIdCtx,
          employeeName,
        }),
    ),
  );

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;

    if (
      isCustomerEmployeeContextReady(employeeId, {
        businessId,
        employeeId: employeeIdCtx,
        employeeName,
      })
    ) {
      setContextReady(true);
      return;
    }

    (async () => {
      if (!import.meta.env.DEV && hasRecentCustomerFlowEntry() && businessId && employeeName) {
        if (!cancelled) setContextReady(true);
        return;
      }

      try {
        const resolved = await resolveCustomerEmployeeContext({
          employeeId,
          returnSlug,
          returnBusinessSlug,
          returnEmployeeSlug,
          fallbackTeamMemberLabel: t("tipFlow.common.teamMember"),
          fallbackVenueLabel: t("tipFlow.common.venue"),
        });
        if (cancelled) return;
        setBusinessId(resolved.businessId);
        setEmployee(resolved.employeeId, resolved.employeeName, resolved.employeeAvatar);
        markCustomerFlowEntered();
        setContextReady(true);
      } catch (err) {
        if (cancelled) return;
        logClientError("TipAmountPage.resolve", err);
        navigate("/", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    businessId,
    employeeId,
    employeeIdCtx,
    employeeName,
    navigate,
    returnSlug,
    returnBusinessSlug,
    returnEmployeeSlug,
    setBusinessId,
    setEmployee,
    t,
  ]);

  useEffect(() => {
    if (employeeId) return;
    if (DEV_BYPASS_ENABLED) {
      const qs = new URLSearchParams();
      qs.set("employeeId", DEV_MOCK.employeeId);
      navigate(`/tip-amount?${qs.toString()}`, { replace: true });
      return;
    }
    navigate(businessId ? `/qr-landing/${businessId}` : "/", { replace: true });
  }, [employeeId, businessId, navigate]);

  useEffect(() => {
    if (searchParams.get("canceled") === "1") {
      toast.message(t("tipFlow.payment.canceledTitle"), {
        description: t("tipFlow.payment.canceledDesc"),
      });
    }
  }, [searchParams, t]);

  const presetAmounts = [5, 10, 15];

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
    if (!isNaN(numValue) && isTipAmountInRangeEur(numValue)) {
      setCustomAmount(value);
      setSelectedAmount(numValue);
    } else {
      setCustomAmount(value);
      setSelectedAmount(null);
    }
  };

  const handleBack = () => {
    if (returnBusinessSlug && returnEmployeeSlug) {
      navigate(
        `/${encodeURIComponent(returnBusinessSlug)}/${encodeURIComponent(returnEmployeeSlug)}?preview=1`,
      );
      return;
    }
    if (returnSlug) {
      navigate(`/staff/${returnSlug}?preview=1`);
      return;
    }
    if (tableQrSlug) {
      navigate(`/table/${encodeURIComponent(tableQrSlug)}`);
      return;
    }
    navigate(businessId ? `/qr-landing/${businessId}` : "/", { replace: true });
  };

  const stripeRedirectMessage = resolveAppLoadingContextMessage("stripeRedirect", t);

  useAppLoadingRegistration(
    "tip-amount-stripe-redirect",
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    processing,
    stripeRedirectMessage,
  );

  const handleContinue = async () => {
    const resolvedEmployeeId = employeeId ?? employeeIdCtx;
    if (!selectedAmount || !resolvedEmployeeId) return;
    if (!isTipAmountInRangeEur(selectedAmount)) return;
    if (!businessId) return;
    setAmount(selectedAmount);
    setProcessing(true);
    const result = await startGuestTipCheckout(
      {
        amount: selectedAmount,
        employeeId: resolvedEmployeeId,
        businessId,
        employeeName,
        locationId,
        tableId,
      },
      t("tipFlow.payment.checkoutStartError"),
    );
    if (result !== "redirected") setProcessing(false);
  };

  const employeeDisplayName = employeeName ?? t("tipFlow.common.teamMember");

  if (!employeeId) {
    return (
      <CustomerFlowShell
        headerVariant="employee"
        employee={{ name: t("tipFlow.common.teamMember") }}
        loading
        loadingContext="tipPage"
        loadingRegistrationKey="tip-amount-journey"
      />
    );
  }

  return (
    <CustomerFlowShell
      withBottomCta={Boolean(selectedAmount)}
      headerVariant="employee"
      headerLeading={
        <CustomerJourneyBackButton
          label={t("tipFlow.common.back")}
          onClick={handleBack}
          disabled={processing}
        />
      }
        employee={{
          name: employeeDisplayName,
          avatar: employeeAvatar ?? null,
        }}
        stepTitle={t("tipFlow.tipAmount.choosePrompt")}
      loading={!contextReady}
      loadingContext="tipPage"
      loadingRegistrationKey="tip-amount-journey"
      mainClassName={cf.mainCompact}
      bottomBar={
        selectedAmount ? (
          <div className={cf.fixedBottomBar}>
            <div className={cf.fixedBottomInner}>
              <div className={cf.journeyCtaStack}>
                <button
                  type="button"
                  onClick={() => void handleContinue()}
                  disabled={!businessId || processing}
                  className={cf.btnPrimaryLg}
                >
                  {processing ? (
                    <>
                      <span className="inline-block size-5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                      {stripeRedirectMessage}
                    </>
                  ) : (
                    t("tipFlow.tipAmount.continuePayment")
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : undefined
      }
    >
      <section className="space-y-3" aria-label={t("tipFlow.tipAmount.quickSelect")}>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {presetAmounts.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => handleAmountSelect(amount)}
              aria-pressed={selectedAmount === amount && !showCustomInput}
              className={`${cf.tipPresetTile} ${
                selectedAmount === amount && !showCustomInput ? cf.tipPresetOn : cf.tipPresetIdle
              }`}
            >
              <span className="text-2xl font-bold tabular-nums text-foreground sm:text-[1.75rem]">
                {formatEur(amount, { minFrac: 0, maxFrac: 0 })}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={handleCustomClick}
            aria-pressed={showCustomInput}
            className={`${cf.tipPresetTile} flex flex-col justify-center ${
              showCustomInput ? cf.tipPresetOn : cf.tipPresetIdle
            }`}
          >
            <span className="text-sm font-semibold text-foreground sm:text-base">
              {t("tipFlow.tipAmount.chooseYourAmount")}
            </span>
          </button>
        </div>

        {showCustomInput ? (
          <div className="relative pt-1">
            <label className="sr-only" htmlFor="tip-custom-amount">
              {t("tipFlow.tipAmount.customTip")}
            </label>
            <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-muted-foreground">
              €
            </div>
            <input
              id="tip-custom-amount"
              type="number"
              placeholder={t("tipFlow.tipAmount.amountPlaceholder")}
              value={customAmount}
              onChange={(e) => handleCustomInput(e.target.value)}
              className={`${cf.inputAmount} pl-11 text-2xl sm:text-3xl`}
              autoFocus
              step="0.01"
              min={MIN_TIP_AMOUNT_EUR}
            />
          </div>
        ) : null}
      </section>
    </CustomerFlowShell>
  );
}
