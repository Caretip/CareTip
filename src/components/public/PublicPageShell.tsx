import type { ReactNode } from "react";
import "@/styles/bundles/marketing-shell.css";
import { Navigation } from "@/app/components/Navigation";
import { Footer } from "@/app/components/Footer";
import { AuthLikePageBackground } from "@/app/components/AuthLikePageBackground";
import { cn } from "@/lib/utils";
import { publicPageUi } from "@/components/public/publicPageUi";
import { usePublicMountProbe } from "@/lib/publicMountProbe";
import { usePublicHtmlBootHandoff } from "@/app/lib/usePublicHtmlBootHandoff";
import { useMarketingShell } from "@/app/context/MarketingShellContext";

type PublicPageShellProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  maxWidth?: "prose" | "wide" | "pricing" | "full";
};

const maxWidthClass = {
  prose: publicPageUi.proseWrap,
  wide: publicPageUi.wideWrap,
  pricing: publicPageUi.pricingWrap,
  full: "mx-auto w-full max-w-[100rem]",
} as const;

export function PublicPageShell({
  children,
  className,
  contentClassName,
  maxWidth = "prose",
}: PublicPageShellProps) {
  usePublicMountProbe("PublicPageShell");
  /** Dismiss HTML cold boot only after this shell has committed (lazy marketing chunks). */
  usePublicHtmlBootHandoff(true);
  const inMarketingShell = useMarketingShell();

  const main = (
    <main
      className={cn(
        publicPageUi.main,
        maxWidthClass[maxWidth],
        maxWidth === "full" && publicPageUi.mainFlushX,
        "caretip-page-enter",
        className,
      )}
    >
      <div className={contentClassName}>{children}</div>
    </main>
  );

  if (inMarketingShell) {
    return (
      <div data-caretip-route-ready="" data-caretip-public-committed="">
        <AuthLikePageBackground animated={false} />
        {main}
        <Footer />
      </div>
    );
  }

  return (
    <div className={publicPageUi.page} data-caretip-route-ready="" data-caretip-public-committed="">
      <AuthLikePageBackground animated={false} />
      <div className={publicPageUi.shell}>
        <Navigation />
        {main}
        <Footer />
      </div>
    </div>
  );
}
