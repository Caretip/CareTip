import { useTranslation } from "react-i18next";
import { AuthBootstrapShell } from "../components/auth/AuthBootstrapShell";

/**
 * Branded hold for lazy public-route chunk loads — never leave #root empty on soft SPA nav.
 */
export function PublicRouteChunkHold() {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[9990]" data-testid="public-route-chunk-hold">
      <AuthBootstrapShell calm className="h-full min-h-[100dvh]" tagline={t("common.gettingReady")} />
    </div>
  );
}
