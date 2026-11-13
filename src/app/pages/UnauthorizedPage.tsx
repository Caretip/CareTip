import { useLayoutEffect } from "react";
import { Link, useLocation } from "react-router";
import { ShieldAlert } from "lucide-react";
import { useReleaseAppBootOverlay } from "@/app/context/AppLoadingManager";
import { useTranslation } from "react-i18next";
import { caretipBtnPrimary, caretipBtnSecondary } from "@/lib/caretipButtonSystem";
import { getAuthUser } from "@/app/lib/authUserStore";
import { getPostAuthRedirect } from "@/app/lib/authRedirects";

/** Set by guards that send users here, so the page can offer the right next step. */
export type UnauthorizedRouteState = { area?: "platform-admin" };

export function UnauthorizedPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const releaseAppBootOverlay = useReleaseAppBootOverlay();
  // Standalone page: nothing else registers a loader here, so the boot overlay ("Preparing your
  // account…") stayed up until its safety timeout. Release it as soon as this page mounts.
  useLayoutEffect(() => {
    releaseAppBootOverlay();
  }, [releaseAppBootOverlay]);

  const fromPlatformAdmin = (location.state as UnauthorizedRouteState | null)?.area === "platform-admin";
  const user = getAuthUser();
  // Signed-in users go back to their own workspace; everyone else to the homepage.
  const primary = user
    ? { to: getPostAuthRedirect(user), label: t("auth.unauthorized.dashboard") }
    : { to: "/", label: t("auth.unauthorized.home") };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md text-center">
        <span
          className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-foreground"
          aria-hidden="true"
        >
          <ShieldAlert className="h-6 w-6" />
        </span>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">{t("auth.unauthorized.title")}</h1>
        <p className="mb-6 text-muted-foreground">
          {t(fromPlatformAdmin ? "auth.unauthorized.bodyPlatformAdmin" : "auth.unauthorized.body")}
        </p>
        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <Link to={primary.to} className={`${caretipBtnPrimary} no-underline`}>
            {primary.label}
          </Link>
          {fromPlatformAdmin ? (
            <Link to="/platform-admin/login" className={`${caretipBtnSecondary} no-underline`}>
              {t("auth.unauthorized.platformLogin")}
            </Link>
          ) : user ? (
            <Link to="/" className={`${caretipBtnSecondary} no-underline`}>
              {t("auth.unauthorized.home")}
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}
