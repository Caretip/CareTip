import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

const BAR = "rounded-xl bg-muted";

/**
 * Instant first frame of the login / sign-up pages while their code arrives, in the page's own
 * shape (brand panel + form sheet on phones, panel + card on larger screens). Not a loader: a tap on
 * Login must move at once, and a full-screen loader between two pages reads as a flash.
 */
export function AuthEntrySkeleton({ signUp = false }: { signUp?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      data-auth-entry-skeleton=""
      role="status"
      aria-busy="true"
      className="flex min-h-[100dvh] flex-col bg-background font-sans md:flex-row md:bg-[#f8f8f7] md:dark:bg-background"
    >
      <div className="bg-primary px-5 pb-[3.25rem] pt-3 text-black md:flex md:w-[46%] md:flex-col md:rounded-br-[100%] md:px-11 md:pt-3">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-black"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("staticPages.common.backToHome")}
        </Link>
        <p className="mt-7 text-3xl font-bold leading-tight tracking-tight md:mb-0 md:mt-auto">
          {t(signUp ? "auth.mobileWebAuth.registerTitle" : "auth.mobileWebAuth.loginTitle")}
        </p>
        <p className="mt-2.5 text-[0.9375rem] leading-snug md:mb-auto md:mt-1 md:invisible">
          {t(signUp ? "auth.mobileWebAuth.registerSubtitle" : "auth.mobileWebAuth.loginSubtitle")}
        </p>
      </div>
      <div
        aria-hidden
        className="-mt-[1.625rem] flex flex-1 flex-col gap-4 rounded-t-[1.75rem] bg-background px-5 pt-8 md:ml-[7%] md:mt-8 md:h-[35rem] md:max-w-[26rem] md:flex-none md:basis-[26rem] md:justify-center md:rounded-2xl md:border md:border-border"
      >
        <div className={`h-[3.25rem] w-full ${BAR}`} />
        <div className={`h-[3.25rem] w-full ${BAR}`} />
        <div className={`mt-4 h-[3.25rem] w-full ${BAR}`} />
      </div>
    </div>
  );
}
