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
import { CareTipBrandedLoaderMark } from "@/app/components/CareTipPageLoader";
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
 * Customer journey shell. Wait states do not paint this chrome — HTML boot or one branded mark owns the wait.
 * Destination paint sets `[data-caretip-route-ready]` and dismisses HTML boot.
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
  const checkoutTransition =
    loading && (loadingContext === "stripeRedirect" || loadingContext === "checkout");
  usePublicHtmlBootHandoff(!loading);

  useAppLoadingRegistration(
    loadingRegistrationKey,
    APP_LOADING_PRIORITY.ROUTE_GUARD,
    (loading && !softNav && !holdUnderHtmlBoot) || (checkoutTransition && !holdUnderHtmlBoot),
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

  if (loading) {
    if (holdUnderHtmlBoot || !softNav) {
      return <GlobalAppLoadingHold className={className} />;
    }
    return (
      <div
        className={cn(
          "flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6",
          className,
        )}
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <CareTipBrandedLoaderMark tagline={overlayMessage} showTagline />
      </div>
    );
  }

  return (
    <div
      className={cn(pageClass, className)}
      data-caretip-route-ready=""
      data-caretip-public-committed=""
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
          {children}

          {showCareTipAttribution ? (
            <div className="pt-4 sm:pt-6">
              <CustomerJourneyCareTipAttribution label={t("tipFlow.common.poweredByCareTip")} />
            </div>
          ) : null}
        </div>
      </div>

      {bottomBar}
    </div>
  );
}
