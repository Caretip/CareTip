import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { AuthBootstrapShell } from "../components/auth/AuthBootstrapShell";
import {
  resolveAppLoadingContextMessage,
  resolveCustomerJourneyBootContext,
  resolveLegalDocumentLoadingMessage,
} from "../lib/appLoadingContexts";
import { isCustomerJourneyPath } from "../lib/appLoadingJourney";
import { readDocumentOrStoredLanguage } from "@/i18n/i18n";

/**
 * Branded hold for lazy public-route chunk loads — never leave #root empty on soft SPA nav.
 */
export function PublicRouteChunkHold() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const pathOnly = pathname.split("?")[0]?.split("#")[0] ?? pathname;
  const lng = readDocumentOrStoredLanguage();
  const customerCtx = isCustomerJourneyPath(pathOnly)
    ? resolveCustomerJourneyBootContext(pathOnly)
    : null;
  const tagline =
    resolveLegalDocumentLoadingMessage(pathOnly, t) ??
    (customerCtx ? resolveAppLoadingContextMessage(customerCtx, t, lng) : null) ??
    t("common.gettingReady");
  return (
    <div className="fixed inset-0 z-[9990]" data-testid="public-route-chunk-hold">
      <AuthBootstrapShell calm className="h-full min-h-[100dvh]" tagline={tagline} />
    </div>
  );
}
