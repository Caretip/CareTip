import type { ReactNode } from "react";
import "@/styles/bundles/marketing-shell.css";
import { Navigation } from "@/app/components/Navigation";
import { Footer } from "@/app/components/Footer";
import { AuthLikePageBackground } from "@/app/components/AuthLikePageBackground";
import { cn } from "@/lib/utils";
import { publicPageUi } from "@/components/public/publicPageUi";
import { usePublicMountProbe } from "@/lib/publicMountProbe";

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
  return (
    <div className={publicPageUi.page}>
      <AuthLikePageBackground animated={false} />
      <div className={publicPageUi.shell}>
        <Navigation />
        <main className={cn(publicPageUi.main, maxWidthClass[maxWidth], "caretip-page-enter", className)}>
          <div className={contentClassName}>{children}</div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
