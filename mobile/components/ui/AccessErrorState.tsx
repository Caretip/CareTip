import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useI18n } from "@/hooks/useI18n";
import { openAuthenticatedBillingWeb } from "@/utils/openBillingWeb";
import {
  friendlyErrorMessage,
  isAuthenticationError,
  isOnboardingIncompleteError,
  isPermissionError,
  isSubscriptionRequiredError,
} from "@/utils/friendlyError";

type AccessErrorStateProps = {
  error: unknown;
  fallbackMessage: string;
  onRetry?: () => void;
  /** QR-specific empty illustration when permission-denied. */
  permissionVariant?: "generic" | "qr";
};

/**
 * Maps API access failures to distinct UX:
 * subscription → upgrade EmptyState
 * onboarding → onboarding EmptyState
 * authentication → ErrorState (sign-in copy)
 * authorization → permission EmptyState
 * other → retryable ErrorState
 */
export function AccessErrorState({
  error,
  fallbackMessage,
  onRetry,
  permissionVariant = "generic",
}: AccessErrorStateProps) {
  const { t } = useI18n();

  if (isSubscriptionRequiredError(error)) {
    return (
      <EmptyState
        title={t("errors.subscriptionRequiredTitle")}
        message={friendlyErrorMessage(error, t("errors.subscriptionRequiredBody"), t)}
        actionLabel={t("errors.managePlan")}
        onAction={() => void openAuthenticatedBillingWeb()}
      />
    );
  }

  if (isOnboardingIncompleteError(error)) {
    return (
      <EmptyState
        title={t("errors.onboardingIncompleteTitle")}
        message={friendlyErrorMessage(error, t("errors.onboardingIncompleteBody"), t)}
      />
    );
  }

  if (isAuthenticationError(error)) {
    return (
      <ErrorState
        message={friendlyErrorMessage(error, t("errors.unauthorized"), t)}
        onRetry={onRetry}
      />
    );
  }

  if (isPermissionError(error)) {
    return (
      <EmptyState
        variant={permissionVariant}
        title={t("errors.permissionTitle")}
        message={friendlyErrorMessage(error, t("errors.permissionBody"), t)}
      />
    );
  }

  return (
    <ErrorState
      message={friendlyErrorMessage(error, fallbackMessage, t)}
      onRetry={onRetry}
    />
  );
}
