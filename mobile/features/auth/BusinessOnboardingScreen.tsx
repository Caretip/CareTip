import { useEffect, useRef, useState } from "react";
import { BackHandler, StyleSheet, Text, View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { AuthExperienceShell } from "@/components/auth/AuthExperienceShell";
import { AuthField } from "@/components/auth/AuthField";
import { AuthContinueButton } from "@/components/auth/AuthContinueButton";
import { AuthScreenHeader } from "@/components/auth/AuthScreenHeader";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { establishAuthenticatedSession } from "@/services/auth/authCacheBoundary";
import { authService } from "@/services/auth/authService";
import { fetchBusinessProfile, patchBusinessProfile } from "@/services/api/businessService";
import { showSuccessToast } from "@/store/toastStore";
import {
  formatOnboardingError,
  isAuthenticationError,
  isBusinessNotFoundError,
} from "@/utils/userFacingError";
import { navigateAfterAuth } from "@/utils/postAuthNavigation";
import { requireOnline } from "@/utils/requireOnline";
import { hapticLight } from "@/utils/haptics";
import { authCardStyles } from "@/components/auth/authCardStyles";
import { authBrand } from "@/theme/authBrand";
import { spacing, typography } from "@/theme";

/**
 * Native business onboarding — same required fields as web
 * (`managerProfileReadyToFinish`: name + businessType + address length > 3).
 * Completes entirely in-app; never opens the web product.
 */
export function BusinessOnboardingScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { user, isAuthenticated, signOut } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const inFlightRef = useRef(false);

  const [legalBusinessName, setLegalBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [registeredAddress, setRegisteredAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [website, setWebsite] = useState("");

  const applyOnboardingFailure = (err: unknown) => {
    setError(formatOnboardingError(err, t));
    if (isAuthenticationError(err) || isBusinessNotFoundError(err)) {
      setNeedsSignIn(true);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetchBusinessProfile()
      .then((profile) => {
        if (cancelled) return;
        setLegalBusinessName(profile.name ?? profile.businessName ?? "");
        setBusinessType(String(profile.type ?? ""));
        setRegisteredAddress(String(profile.registeredAddress ?? profile.location ?? ""));
        setContactPhone(String(profile.contactPhone ?? ""));
        setWebsite(String(profile.website ?? ""));
      })
      .catch((err) => {
        if (cancelled) return;
        applyOnboardingFailure(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // t is stable enough for first-load copy; avoid refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy || loading || inFlightRef.current) return true;
      if (step === 2) {
        setStep(1);
        setError(null);
        return true;
      }
      // Stay on step 1 — popping would flash signup/login then redirect back.
      return true;
    });
    return () => sub.remove();
  }, [busy, loading, step]);

  const goToSignIn = async () => {
    if (busy || inFlightRef.current) return;
    hapticLight();
    if (isAuthenticated) {
      await signOut();
    }
    router.replace("/(auth)/login");
  };

  const handleContinue = async () => {
    if (busy || loading || inFlightRef.current || needsSignIn) return;
    setError(null);
    if (!(await requireOnline())) {
      setError(t("errors.offline"));
      return;
    }
    if (step === 1) {
      if (legalBusinessName.trim().length < 2) {
        setError(t("auth.onboardingNameRequired"));
        return;
      }
      if (!businessType.trim()) {
        setError(t("auth.onboardingTypeRequired"));
        return;
      }
      inFlightRef.current = true;
      setBusy(true);
      try {
        await patchBusinessProfile({
          name: legalBusinessName.trim(),
          legalBusinessName: legalBusinessName.trim(),
          businessType: businessType.trim(),
        });
        showSuccessToast(t("auth.onboardingDetailsSaved"));
        setStep(2);
      } catch (err) {
        applyOnboardingFailure(err);
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }
      return;
    }

    if (registeredAddress.trim().length <= 3) {
      setError(t("auth.onboardingAddressRequired"));
      return;
    }

    inFlightRef.current = true;
    setBusy(true);
    try {
      await patchBusinessProfile({
        registeredAddress: registeredAddress.trim(),
        contactPhone: contactPhone.trim() || null,
        website: website.trim() || null,
      });
      const session = await authService.patchMyOnboardingStatus(true);
      await establishAuthenticatedSession(session.token, session.user, "onboarding-complete");
      showSuccessToast(t("auth.onboardingReady"));
      await navigateAfterAuth(router, session.user);
    } catch (err) {
      applyOnboardingFailure(err);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  return (
    <AuthExperienceShell showSecondaryActions={false}>
      <View style={authCardStyles.formBlock}>
        <AuthScreenHeader
          eyebrow={t("auth.onboardingEyebrow")}
          title={step === 1 ? t("auth.onboardingStep1Title") : t("auth.onboardingStep2Title")}
          subtitle={
            step === 1 ? t("auth.onboardingStep1Subtitle") : t("auth.onboardingStep2Subtitle")
          }
        >
          {user?.email ? <Text style={styles.emailHint}>{user.email}</Text> : null}
        </AuthScreenHeader>

        {loading ? (
          <Text style={styles.loading}>{t("common.loading")}</Text>
        ) : step === 1 ? (
          <View style={authCardStyles.fields}>
            <AuthField
              label={t("auth.onboardingBusinessName")}
              icon="business-outline"
              value={legalBusinessName}
              onChangeText={setLegalBusinessName}
              editable={!busy && !needsSignIn}
            />
            <AuthField
              label={t("auth.onboardingBusinessType")}
              icon="storefront-outline"
              value={businessType}
              onChangeText={setBusinessType}
              editable={!busy && !needsSignIn}
            />
          </View>
        ) : (
          <View style={authCardStyles.fields}>
            <AuthField
              label={t("auth.onboardingAddress")}
              icon="location-outline"
              value={registeredAddress}
              onChangeText={setRegisteredAddress}
              editable={!busy && !needsSignIn}
            />
            <AuthField
              label={t("auth.onboardingPhone")}
              icon="call-outline"
              value={contactPhone}
              onChangeText={setContactPhone}
              keyboardType="phone-pad"
              editable={!busy && !needsSignIn}
            />
            <AuthField
              label={t("auth.onboardingWebsite")}
              icon="globe-outline"
              value={website}
              onChangeText={setWebsite}
              keyboardType="url"
              editable={!busy && !needsSignIn}
            />
            <Text style={styles.reviewHint}>{t("auth.onboardingReviewHint")}</Text>
          </View>
        )}

        {error ? (
          <Text style={authCardStyles.formError} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        {needsSignIn ? (
          <AuthContinueButton
            label={t("auth.backToSignIn")}
            onPress={() => void goToSignIn()}
            loading={busy}
          />
        ) : (
          <AuthContinueButton
            label={step === 1 ? t("common.continue") : t("auth.onboardingFinish")}
            onPress={() => void handleContinue()}
            loading={busy}
            disabled={loading}
          />
        )}

        {step === 2 && !needsSignIn ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (busy) return;
              hapticLight();
              setStep(1);
              setError(null);
            }}
            disabled={busy}
            style={({ pressed }) => [authCardStyles.backRow, pressed ? authCardStyles.pressed : null]}
          >
            <Text style={authCardStyles.backLink}>{t("common.back")}</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => void goToSignIn()}
            disabled={busy || loading}
            style={({ pressed }) => [authCardStyles.backRow, pressed ? authCardStyles.pressed : null]}
          >
            <Text style={authCardStyles.backLink}>{t("auth.backToSignIn")}</Text>
          </Pressable>
        )}
      </View>
    </AuthExperienceShell>
  );
}

const styles = StyleSheet.create({
  emailHint: {
    ...typography.caption,
    color: authBrand.muted,
  },
  reviewHint: {
    ...typography.caption,
    color: authBrand.muted,
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  loading: {
    ...typography.body,
    color: authBrand.muted,
    marginBottom: spacing.lg,
  },
});
