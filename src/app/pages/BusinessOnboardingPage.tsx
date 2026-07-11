import { useEffect, useMemo, useState } from "react";
import "@/styles/bundles/onboarding.css";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Loader2, MapPin, Palette } from "lucide-react";
import { useAuth, getPostAuthRedirect } from "../hooks/useAuth";
import { getAuthSessionFlags } from "../lib/authSessionBootstrap";
import { useRegisterGlobalAppInit, useAppLoadingRegistration, APP_LOADING_PRIORITY } from "../lib/globalAppLoading";
import { GlobalAppLoadingHold } from "../components/GlobalAppLoadingHold";
import { toast } from "sonner";
import { fetchBusinessProfile, patchBusinessProfile, uploadMyBusinessLogo, createBillingCheckoutSession } from "../lib/api";
import {
  clearCheckoutIntent,
  peekCheckoutIntent,
  primeCheckoutSyncExpectation,
  shouldIncludeTrialForIntent,
} from "../lib/checkoutIntent";
import { isOnboardingCompleted, resolveResumeOnboardingStep } from "../lib/onboardingProgress";
import { toUserFriendlyMessage } from "../lib/errorMessages";
import { isApiSubscriptionRequiredError } from "../lib/apiError";
import { logClientError } from "../lib/clientLog";
import { performExternalStripeRedirect } from "../lib/externalStripeRedirect";
import { cn } from "@/lib/utils";
import type { OnboardingStep } from "../components/business/BusinessOnboardingProgress";
import {
  BusinessOnboardingFootnote,
  BusinessOnboardingHeader,
  BusinessOnboardingProgressHeader,
} from "../components/business/BusinessOnboardingShell";
import { BusinessOnboardingGuestPreview } from "../components/business/BusinessOnboardingGuestPreview";
import { BusinessOnboardingLogoUpload } from "../components/business/BusinessOnboardingLogoUpload";
import { BusinessOnboardingFinishCta } from "../components/business/BusinessOnboardingFinishCta";
import { BusinessOnboardingNavFooter } from "../components/business/BusinessOnboardingNavFooter";
import { BusinessOnboardingReviewSummary } from "../components/business/BusinessOnboardingReviewSummary";
import {
  BusinessOnboardingSelectField,
  BusinessOnboardingTextField,
} from "../components/business/BusinessOnboardingFormField";
import {
  onboardingDisplayFont,
  onboardingFormCard,
  onboardingHeadline,
  onboardingSectionCard,
  onboardingSectionTitle,
  onboardingSubhead,
} from "../components/business/businessOnboardingUi";
import { BUSINESS_TYPE_OPTIONS } from "../lib/businessVenueOptions";

const PAGE_HEADLINE_KEYS = [
  "business.onboarding.stepTitle.businessDetails",
  "business.onboarding.stepTitle.brandingSetup",
  "business.onboarding.finalStep.headline",
] as const;

const PAGE_DESC_KEYS = [
  "business.onboarding.stepHint.businessDetails",
  "business.onboarding.stepHint.brandingSetup",
  "business.onboarding.finalStep.description",
] as const;

export function BusinessOnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, sessionValidated, setHasCompletedOnboarding, refetchUser, logout } = useAuth();
  const [step, setStep] = useState<OnboardingStep>(1);
  const [syncingOnboarding, setSyncingOnboarding] = useState(true);

  const [legalBusinessName, setLegalBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [registeredAddress, setRegisteredAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [savedLogoPath, setSavedLogoPath] = useState<string | null>(null);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  const checkoutIntent = peekCheckoutIntent();
  const onboardingBusyMessage =
    step === 3 &&
    checkoutIntent &&
    checkoutIntent.planKey !== "enterprise" &&
    checkoutIntent.planKey !== "basic"
      ? t("common.loading.checkout")
      : t("common.creatingWorkspace");

  useAppLoadingRegistration(
    "onboarding-submit",
    APP_LOADING_PRIORITY.APP_INIT,
    busy,
    onboardingBusyMessage,
  );

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(savedLogoPath);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile, savedLogoPath]);

  useEffect(() => {
    if (!sessionValidated || !user) return;

    if (isOnboardingCompleted(user)) {
      navigate(getPostAuthRedirect(user), { replace: true });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { onboardingStatusFromServer } = getAuthSessionFlags();
        const fresh = onboardingStatusFromServer ? user : await refetchUser();
        if (cancelled) return;

        if (fresh && isOnboardingCompleted(fresh)) {
          navigate(getPostAuthRedirect(fresh), { replace: true });
          return;
        }

        const profile = await fetchBusinessProfile({ silent: true }).catch(() => null);
        if (cancelled) return;

        if (profile) {
          setLegalBusinessName(profile.name ?? "");
          setBusinessType(profile.type ?? "");
          setRegisteredAddress(profile.registeredAddress ?? "");
          setContactPhone(profile.contactPhone ?? "");
          setWebsite(profile.website ?? "");
          setSavedLogoPath(profile.logo ?? null);
          setEmployeeCount(profile.employeeCount ?? 0);
          setStep(resolveResumeOnboardingStep(profile, profile.onboardingStep ?? fresh?.onboardingStep));
        } else if (fresh?.onboardingStep) {
          setStep(fresh.onboardingStep);
        }
      } catch (err) {
        logClientError("BusinessOnboardingPage.syncOnboarding", err);
      } finally {
        if (!cancelled) setSyncingOnboarding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, refetchUser, sessionValidated, user]);

  const canContinue = useMemo(() => {
    if (step === 1) return legalBusinessName.trim().length > 1 && businessType.trim().length > 0;
    if (step === 2) return registeredAddress.trim().length > 3;
    return true;
  }, [step, legalBusinessName, businessType, registeredAddress]);

  const previewData = useMemo(
    () => ({
      legalBusinessName,
      businessType,
      registeredAddress,
      contactPhone,
      website,
      logoFile,
      savedLogoPath,
      employeeCount,
      onboardingStep: 3 as OnboardingStep,
      businessId: user?.businessId,
    }),
    [
      legalBusinessName,
      businessType,
      registeredAddress,
      contactPhone,
      website,
      logoFile,
      savedLogoPath,
      employeeCount,
      user?.businessId,
    ],
  );

  const saveStep = async (targetStep: OnboardingStep) => {
    if (targetStep === 1) {
      await patchBusinessProfile({
        legalBusinessName: legalBusinessName.trim(),
        businessType: businessType.trim() || null,
      });
      return;
    }
    if (targetStep === 2) {
      await patchBusinessProfile({
        registeredAddress: registeredAddress.trim() || null,
        contactPhone: contactPhone.trim() || null,
        website: website.trim() || null,
      });
      if (logoFile) {
        try {
          const uploaded = await uploadMyBusinessLogo(logoFile);
          setSavedLogoPath(uploaded.path ?? null);
        } catch (err) {
          setLogoFile(null);
          if (isApiSubscriptionRequiredError(err)) {
            toast.info(t("business.onboarding.toastLogoDeferred"));
          } else {
            toast.error(toUserFriendlyMessage(err));
          }
        }
      }
      return;
    }
  };

  const handleAuthFailure = () => {
    logout();
    toast.error(t("business.onboarding.toastSessionExpired"));
  };

  const goBack = () => {
    if (busy || step === 1) return;
    setStep((s) => (s === 2 ? 1 : 2));
  };

  const goForward = async () => {
    if (busy || !canContinue) return;
    setBusy(true);
    try {
      if (step !== 3) {
        await saveStep(step);
        setStep((s) => (s === 1 ? 2 : 3));
        setBusy(false);
        return;
      }
      const updated = await setHasCompletedOnboarding(true);
      const refreshed = (await refetchUser()) ?? updated;
      if (!refreshed) {
        toast.success(t("business.onboarding.toastSavedLoadingDashboard"));
        navigate("/dashboard", { replace: true });
        setBusy(false);
        return;
      }

      const checkoutIntent = peekCheckoutIntent();
      if (
        checkoutIntent &&
        checkoutIntent.planKey !== "enterprise" &&
        checkoutIntent.planKey !== "basic"
      ) {
        try {
          primeCheckoutSyncExpectation(checkoutIntent.planKey);
          const session = await createBillingCheckoutSession({
            planKey: checkoutIntent.planKey,
            billingCycle: checkoutIntent.billingCycle,
            includeTrial: shouldIncludeTrialForIntent(checkoutIntent),
            checkoutFlow: "onboarding",
          });
          clearCheckoutIntent();
          const redirect = performExternalStripeRedirect(session.url, "checkout");
          if (redirect.ok) {
            return;
          }
          toast.error(t("business.billing.checkoutNoUrl"));
        } catch (err) {
          toast.error(toUserFriendlyMessage(err) || t("business.billing.checkoutError"));
        }
      }

      navigate(getPostAuthRedirect(refreshed), { replace: true });
      setBusy(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Authentication required") || msg.includes("Invalid or expired token")) {
        handleAuthFailure();
        setBusy(false);
        return;
      }
      toast.error(toUserFriendlyMessage(err));
      setBusy(false);
    }
  };

  const redirectingToDashboard = Boolean(user && isOnboardingCompleted(user));
  const pageInitBlocking = syncingOnboarding || redirectingToDashboard;

  useRegisterGlobalAppInit("onboarding-init", pageInitBlocking);

  if (pageInitBlocking) {
    return <GlobalAppLoadingHold />;
  }

  const isReviewStep = step === 3;

  return (
    <div className="business-onboarding-page flex min-h-screen flex-col">
      <BusinessOnboardingHeader />

      <main className="business-onboarding-main flex-1">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="business-onboarding-shell mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8"
        >
          <div className="space-y-8 lg:space-y-10">
            <BusinessOnboardingProgressHeader step={step} />

            {isReviewStep ? (
              <div className="business-onboarding-final-layout space-y-8">
                <header className="space-y-3 text-center lg:text-left">
                  <h1
                    id="onboarding-page-title"
                    className={onboardingHeadline}
                    style={{ fontFamily: onboardingDisplayFont }}
                  >
                    {t(PAGE_HEADLINE_KEYS[step - 1])}
                  </h1>
                  <p className={cn(onboardingSubhead, "mx-auto lg:mx-0")}>{t(PAGE_DESC_KEYS[step - 1])}</p>
                </header>

                <div className="business-onboarding-final-grid">
                  <aside
                    className="business-onboarding-preview-aside min-w-0"
                    aria-label={t("business.onboarding.preview.panelAria")}
                  >
                    <BusinessOnboardingGuestPreview {...previewData} variant="final" />
                  </aside>

                  <div className="business-onboarding-final-content min-w-0 space-y-6">
                    <BusinessOnboardingReviewSummary
                      legalBusinessName={legalBusinessName}
                      businessType={businessType}
                      registeredAddress={registeredAddress}
                      contactPhone={contactPhone}
                      website={website}
                      logoPreviewUrl={logoPreviewUrl}
                    />
                    <BusinessOnboardingFinishCta
                      busy={busy}
                      disabled={!canContinue}
                      onFinish={() => void goForward()}
                      onBack={goBack}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="business-onboarding-split business-onboarding-split--entry">
                <div className={cn(onboardingFormCard, "business-onboarding-workspace min-w-0")}>
                  <header className="mb-8 space-y-3 border-b border-zinc-200/70 pb-8 dark:border-zinc-800/70">
                    <h1
                      id="onboarding-page-title"
                      className={onboardingHeadline}
                      style={{ fontFamily: onboardingDisplayFont }}
                    >
                      {t(PAGE_HEADLINE_KEYS[step - 1])}
                    </h1>
                    <p className={onboardingSubhead}>{t(PAGE_DESC_KEYS[step - 1])}</p>
                  </header>

                  <section className="space-y-8" aria-labelledby="onboarding-page-title">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={step}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        className="space-y-8"
                      >
                        {step === 1 ? (
                          <div className="space-y-6">
                            <BusinessOnboardingTextField
                              label={t("business.onboarding.fields.legalName")}
                              placeholder={t("business.onboarding.fields.legalNamePlaceholder")}
                              value={legalBusinessName}
                              onChange={setLegalBusinessName}
                              hint={t("business.onboarding.fields.legalNameHint")}
                            />
                            <BusinessOnboardingSelectField
                              label={t("business.onboarding.fields.businessType")}
                              value={businessType}
                              onChange={setBusinessType}
                              placeholder={t("business.onboarding.fields.businessTypePlaceholder")}
                              hint={t("business.onboarding.fields.businessTypeHint")}
                            >
                              {BUSINESS_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {t(opt.labelKey)}
                                </option>
                              ))}
                            </BusinessOnboardingSelectField>
                          </div>
                        ) : null}

                        {step === 2 ? (
                          <div className="space-y-6">
                            <div className={onboardingSectionCard}>
                              <h2 className={onboardingSectionTitle}>
                                <Palette className="h-4 w-4 text-orange-600 dark:text-orange-400" aria-hidden />
                                {t("business.onboarding.sections.branding")}
                              </h2>
                              <BusinessOnboardingLogoUpload file={logoFile} onFile={setLogoFile} />
                            </div>

                            <div className={onboardingSectionCard}>
                              <h2 className={onboardingSectionTitle}>
                                <MapPin className="h-4 w-4 text-orange-600 dark:text-orange-400" aria-hidden />
                                {t("business.onboarding.sections.locationContact")}
                              </h2>
                              <div className="space-y-6">
                                <BusinessOnboardingTextField
                                  label={t("business.onboarding.fields.address")}
                                  placeholder={t("business.onboarding.fields.addressPlaceholder")}
                                  value={registeredAddress}
                                  onChange={setRegisteredAddress}
                                  hint={t("business.onboarding.fields.addressHint")}
                                />
                                <BusinessOnboardingTextField
                                  label={t("business.onboarding.fields.phone")}
                                  placeholder={t("business.onboarding.fields.phonePlaceholder")}
                                  value={contactPhone}
                                  onChange={setContactPhone}
                                  hint={t("business.onboarding.fields.phoneHint")}
                                  optional
                                />
                                <BusinessOnboardingTextField
                                  label={t("business.onboarding.fields.website")}
                                  placeholder={t("business.onboarding.fields.websitePlaceholder")}
                                  value={website}
                                  onChange={setWebsite}
                                  hint={t("business.onboarding.fields.websiteHint")}
                                  optional
                                />
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </motion.div>
                    </AnimatePresence>

                    <BusinessOnboardingNavFooter
                      primaryLabel={
                        busy ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            {t("business.onboarding.actions.saving")}
                          </>
                        ) : (
                          t("business.onboarding.actions.continue")
                        )
                      }
                      onPrimary={() => void goForward()}
                      onBack={goBack}
                      showBack={step > 1}
                      busy={busy}
                      disabled={!canContinue}
                      backLabel={t("business.onboarding.actions.back")}
                    />
                  </section>
                </div>
              </div>
            )}

            <BusinessOnboardingFootnote />
          </div>
        </motion.div>
      </main>
    </div>
  );
}
