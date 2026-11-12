import { useLayoutEffect } from "react";
import { Link } from "react-router";
import { useReleaseAppBootOverlay } from "@/app/context/AppLoadingManager";
import { useTranslation } from "react-i18next";
import { caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";

export function UnauthorizedPage() {
  const { t } = useTranslation();
  const releaseAppBootOverlay = useReleaseAppBootOverlay();
  // Standalone page: nothing else registers a loader here, so the boot overlay ("Preparing your
  // account…") stayed up until its safety timeout. Release it as soon as this page mounts.
  useLayoutEffect(() => {
    releaseAppBootOverlay();
  }, [releaseAppBootOverlay]);
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-semibold text-foreground mb-2">{t("auth.unauthorized.title")}</h1>
        <p className="text-muted-foreground mb-6">{t("auth.unauthorized.body")}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className={`${caretipBtnSecondary} no-underline`}
          >
            {t("auth.unauthorized.home")}
          </Link>
          <Link
            to="/platform-admin/login"
            className={`${caretipBtnPrimary} no-underline`}
          >
            {t("auth.unauthorized.platformLogin")}
          </Link>
        </div>
      </div>
    </main>
  );
}
