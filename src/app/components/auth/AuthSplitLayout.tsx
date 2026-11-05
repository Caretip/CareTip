import type { ReactNode } from "react";

import { AuthCurvedBlobShell } from "@/components/ui/auth-switch";

import { AuthMarketingPanel } from "./AuthMarketingPanel";
import type { AuthLane, AuthMarketingScene } from "./authMarketingContent";

type AuthSplitLayoutProps = {
  children: ReactNode;
  topSlot?: ReactNode;
  signUpMode?: boolean;
  authLane?: AuthLane;
  marketingScene?: AuthMarketingScene;
  /** Smaller brand panel for verification / recovery flows. */
  compactMarketing?: boolean;
  /** Hide back-to-home row (rare — default shows on all auth flows). */
  hideBackToHome?: boolean;
  marketingHeadlineAs?: "h1" | "h2";
};

export function AuthSplitLayout({
  children,
  topSlot,
  signUpMode = false,
  authLane = "business",
  marketingScene,
  compactMarketing = false,
  hideBackToHome = false,
  marketingHeadlineAs,
}: AuthSplitLayoutProps) {
  return (
    <AuthCurvedBlobShell
      signUpMode={signUpMode}
      className="caretip-auth-split-layout--curved font-sans"
      brandPanel={
        <AuthMarketingPanel
          lane={authLane}
          signUpMode={signUpMode}
          marketingScene={marketingScene}
          compact={compactMarketing}
          showBackToHome={!hideBackToHome}
          headlineAs={marketingHeadlineAs}
        />
      }
      authPanel={
        <div className="caretip-auth-split-layout__panel-inner">
          {topSlot ? <div className="caretip-auth-split-layout__top-slot">{topSlot}</div> : null}
          {children}
        </div>
      }
    />
  );
}

