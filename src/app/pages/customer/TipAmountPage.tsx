import { useNavigate, useSearchParams } from "react-router";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useTipFlow } from "../../context/TipFlowContext";
import { logClientError } from "../../lib/clientLog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEV_BYPASS_ENABLED, DEV_MOCK } from "../../lib/devCustomerBypass";
import { hasRecentCustomerFlowEntry, markCustomerFlowEntered } from "../../lib/customerFlowGuard";
import { paymentPathFromTipAmount } from "../../lib/tipFlowRoute";
import {
  isCustomerEmployeeContextReady,
  resolveCustomerEmployeeContext,
} from "../../lib/resolveCustomerEmployeeContext";
import { formatEur } from "../../lib/formatEur";
import { isTipAmountInRangeEur, MIN_TIP_AMOUNT_EUR } from "../../lib/tipAmountLimits";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerFlowShell } from "./CustomerFlowShell";
import {
  CustomerJourneyBackButton,
} from "./CustomerJourneyHeader";
import { venueBrandFromFields, useCustomerVenueBrand } from "./customerJourneyBrand";
import { headerChooseAmountFor } from "./customerJourneyHeaderCopy";

export function TipAmountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const employeeId = searchParams.get("employeeId");
  const returnSlug = searchParams.get("returnSlug");
  const returnBusinessSlug = searchParams.get("returnBusinessSlug");
  const returnEmployeeSlug = searchParams.get("returnEmployeeSlug");
  const directFromStaffQr = searchParams.get("direct") === "1";
  const {
    businessId,
    employeeId: employeeIdCtx,
    employeeName,
    employeeAvatar,
    tableQrSlug,
    tippingLocationName,
    tippingTableName,
    setBusinessId,
    setEmployee,
    setAmount,
  } = useTipFlow();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const [resolvedVenueSnapshot, setResolvedVenueSnapshot] = useState<{
    name: string;
    logo: string | null;
  } | null>(null);
  const fallbackVenue = t("tipFlow.common.venue");
  const fetchedVenue = useCustomerVenueBrand(businessId, fallbackVenue);

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
      if (!resolvedVenueSnapshot && businessId) {
        void resolveCustomerEmployeeContext({
          employeeId,
          returnSlug,
          returnBusinessSlug,
          returnEmployeeSlug,
          fallbackTeamMemberLabel: t("tipFlow.common.teamMember"),
          fallbackVenueLabel: fallbackVenue,
        })
          .then((resolved) => {
            setResolvedVenueSnapshot({ name: resolved.businessName, logo: resolved.businessLogo });
          })
          .catch((err) => logClientError("TipAmountPage.resolveVenue", err));
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
        setResolvedVenueSnapshot({ name: resolved.businessName, logo: resolved.businessLogo });
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
    fallbackVenue,
    resolvedVenueSnapshot,
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
    navigate(businessId ? `/qr-landing/${businessId}` : "/");
  };

  const handleContinue = () => {
    const resolvedEmployeeId = employeeId ?? employeeIdCtx;
    if (!selectedAmount || !resolvedEmployeeId) return;
    if (!isTipAmountInRangeEur(selectedAmount)) return;
    if (!businessId) return;
    setAmount(selectedAmount);
    navigate(
      paymentPathFromTipAmount({
        employeeId: resolvedEmployeeId,
        returnSlug,
        returnBusinessSlug,
        returnEmployeeSlug,
      }),
    );
  };

  const resolvedVenue = resolvedVenueSnapshot
    ? venueBrandFromFields(resolvedVenueSnapshot.name, resolvedVenueSnapshot.logo)
    : fetchedVenue;
  const employeeDisplayName = employeeName ?? t("tipFlow.common.teamMember");
  const amountHeader = headerChooseAmountFor(t, employeeDisplayName, { directStaffQr: directFromStaffQr });
  const venueContext =
    tippingLocationName && tippingTableName
      ? t("tipFlow.atVenue", { location: tippingLocationName, table: tippingTableName })
      : undefined;

  if (!employeeId) {
    return (
      <CustomerFlowShell
        venue={{ name: fallbackVenue, logo: null }}
        stepTitle={t("tipFlow.tipAmount.chooseTitle")}
        loading
        loadingContext="tipPage"
        loadingRegistrationKey="tip-amount-journey"
      />
    );
  }

  return (
    <CustomerFlowShell
      withBottomCta={Boolean(selectedAmount)}
      headerLeading={
        <CustomerJourneyBackButton label={t("tipFlow.common.back")} onClick={handleBack} />
      }
      venue={{
        ...resolvedVenue,
        contextLine: venueContext,
      }}
      stepTitle={amountHeader.stepTitle}
      trustMessage={amountHeader.trustMessage}
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
                  onClick={handleContinue}
                  disabled={!businessId}
                  className={cf.btnPrimaryLg}
                >
                  {t("tipFlow.tipAmount.continuePayment")}
                </button>
              </div>
            </div>
          </div>
        ) : undefined
      }
    >
      <Card className={cf.cardShadcn}>
        <CardHeader className={`${cf.cardHeaderPadding} pb-2`}>
          <CardTitle className={cf.cardTitle}>{t("tipFlow.tipAmount.quickSelect")}</CardTitle>
          <CardDescription className={cf.cardDesc}>{t("tipFlow.tipAmount.quickSelectDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5 sm:px-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-3.5">
            {presetAmounts.map((amount) => (
              <button
                key={amount}
                type="button"
                onClick={() => handleAmountSelect(amount)}
                className={`${cf.tipPresetTile} ${
                  selectedAmount === amount ? cf.tipPresetOn : cf.tipPresetIdle
                }`}
              >
                <div className="mb-1 text-2xl font-bold tabular-nums text-foreground sm:text-[1.75rem]">
                  {formatEur(amount, { minFrac: 0, maxFrac: 0 })}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t("tipFlow.tipAmount.tipAmountLabel")}
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={handleCustomClick}
              className={`${cf.tipPresetTile} flex flex-col justify-center ${
                showCustomInput ? cf.tipPresetOn : cf.tipPresetIdle
              }`}
            >
              <div className="text-base font-bold text-foreground sm:text-lg">
                {t("tipFlow.tipAmount.chooseYourAmount")}
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className={cf.cardShadcn}>
        <CardHeader className={`${cf.cardHeaderPadding} pb-2`}>
          <CardTitle className={cf.cardTitle}>{t("tipFlow.tipAmount.customTip")}</CardTitle>
          <CardDescription className={cf.cardDesc}>{t("tipFlow.tipAmount.customTipDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5 sm:px-6">
          {!showCustomInput ? (
            <button type="button" onClick={handleCustomClick} className={cf.dashedCustomTrigger}>
              <span className="text-sm font-medium text-muted-foreground">
                {t("tipFlow.tipAmount.enterCustom")}
              </span>
            </button>
          ) : (
            <div className="relative">
              <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-muted-foreground">
                €
              </div>
              <input
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
          )}
        </CardContent>
      </Card>

      {selectedAmount ? (
        <Card className={cf.cardAccentWash}>
          <CardContent className="px-5 pb-5 pt-6 sm:px-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("tipFlow.tipAmount.tipAmountLabel")}</span>
              <span className="text-2xl font-bold text-foreground">{formatEur(selectedAmount)}</span>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </CustomerFlowShell>
  );
}
