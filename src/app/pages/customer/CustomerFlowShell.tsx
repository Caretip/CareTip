import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { customerFlowUi as cf } from "./customerFlowUi";
import { CustomerJourneyHeader } from "./CustomerJourneyHeader";
import { CustomerJourneyCareTipAttribution } from "./CustomerJourneyCareTipAttribution";
import type { CustomerJourneyEmployeeIdentity, CustomerJourneyVenueBrand } from "./customerJourneyBrand";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "@/app/context/AppLoadingManager";
import { GlobalAppLoadingHold } from "@/app/components/GlobalAppLoadingHold";
import { LoadingSpinner } from "@/app/components/ui/loading-spinner";
import type { AppLoadingContext } from "@/app/lib/appLoadingContexts";
import { resolveAppLoadingContextMessage } from "@/app/lib/appLoadingContexts";
import { isAppShellInteractive } from "@/app/lib/appShellLifecycle";
import { isHtmlBootElementPresent } from "@/app/lib/htmlMarketingBootBridge";
import { readDocumentOrStoredLanguage } from "@/i18n/i18n";
import { usePublicHtmlBootHandoff } from "@/app/lib/usePublicHtmlBootHandoff";

type CustomerFlowShellProps = {
  headerLeading?: ReactNode;
  headerTrailing?: ReactNode;
  venue?: CustomerJourneyVenueBrand;
  employee?: CustomerJourneyEmployeeIdentity;
  headerVariant?: "venue" | "employee";
  stepTitle?: string;
  trustMessage?: ReactNode;
  showCareTipAttribution?: boolean;
  loading?: boolean;
  loadingMessage?: string;
  loadingContext?: AppLoadingContext;
  loadingRegistrationKey?: string;
  withBottomCta?: boolean;
  className?: string;
  mainClassName?: string;
  children?: ReactNode;
  bottomBar?: ReactNode;
};

/**
 * Persistent customer journey shell — header stays mounted while body loads.
 * Cold entry uses the global brand overlay; in-journey waits keep progress copy in-shell.
 */
export function CustomerFlowShell({
  headerLeading,
  venue,
  employee,
  headerVariant = "venue",
  stepTitle,
  trustMessage,
  showCareTipAttribution = true,
  headerTrailing,
  loading = false,
  loadingMessage,
  loadingContext = "checkout",
  loadingRegistrationKey = "customer-flow-shell",
  withBottomCta = false,
  className,
  mainClassName,
  children,
  bottomBar,
}: CustomerFlowShellProps) {
  const { t } = useTranslation();
  const softNav = isAppShellInteractive();
  const overlayMessage =
    loadingMessage ??
    resolveAppLoadingContextMessage(loadingContext, t, readDocumentOrStoredLanguage());
  const holdUnderHtmlBoot = isHtmlBootElementPresent();
  usePublicHtmlBootHandoff(loading !== true);

  useAppLoadingRegistration(
    loadingRegistrationKey,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    loading && !softNav,
    overlayMessage,
  );

  const compactCanvas =
    typeof mainClassName === "string" && mainClassName.includes("customer-flow-canvas--compact");
  const pageClass = withBottomCta
    ? compactCanvas
      ? cf.pageWithBottomCtaCompact
      : cf.pageWithBottomCta
    : compactCanvas
      ? cf.pageCompact
      : cf.page;

  return (
    <div
      className={cn(pageClass, className)}
      {...(!loading ? { "data-caretip-route-ready": "" } : {})}
    >
      <div className={cf.frame}>
        <CustomerJourneyHeader
          leading={headerLeading}
          trailing={headerTrailing}
          venue={venue}
          employee={employee}
          variant={headerVariant}
          stepTitle={stepTitle}
          trustMessage={trustMessage}
        />

        <div className={cn(cf.main, mainClassName)}>
          {loading ? (
            softNav && !holdUnderHtmlBoot ? (
              <div
                className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16 sm:py-20"
                role="status"
                aria-busy="true"
                aria-live="polite"
              >
                <LoadingSpinner size="lg" />
                {overlayMessage ? (
                  <p className="max-w-sm text-center text-sm text-muted-foreground">
                    {overlayMessage}
                  </p>
                ) : null}
              </div>
            ) : (
              <GlobalAppLoadingHold className="min-h-[40vh] py-16 sm:py-20" />
            )
          ) : (
            children
          )}

          {!loading && showCareTipAttribution ? (
            <div className="pt-4 sm:pt-6">
              <CustomerJourneyCareTipAttribution label={t("tipFlow.common.poweredByCareTip")} />
            </div>
          ) : null}
        </div>
      </div>

      {!loading ? bottomBar : null}
    </div>
  );
}
