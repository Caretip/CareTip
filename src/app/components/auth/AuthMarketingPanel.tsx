import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AuthBackToHomeNav } from "./AuthBackToHomeNav";
import {
  getAuthMarketingContent,
  resolveMarketingSceneFromSignUpMode,
  type AuthLane,
  type AuthMarketingScene,
} from "./authMarketingContent";

type AuthMarketingPanelProps = {
  lane?: AuthLane;
  signUpMode?: boolean;
  /** Overrides sign-in/sign-up scene — use for invite, activation, verification, etc. */
  marketingScene?: AuthMarketingScene;
  /** Scales down marketing copy (~30% tighter). */
  compact?: boolean;
  showBackToHome?: boolean;
};

/** Curved brand panel — logo, headline, and one supporting line (business vs staff). */
export function AuthMarketingPanel({
  lane = "business",
  signUpMode = false,
  marketingScene,
  compact = false,
  showBackToHome = false,
}: AuthMarketingPanelProps) {
  const { t } = useTranslation();
  const scene = marketingScene ?? resolveMarketingSceneFromSignUpMode(signUpMode);
  const { i18nPrefix: prefix } = getAuthMarketingContent(lane, scene);

  return (
    <aside
      className={cn(
        "caretip-auth-marketing caretip-auth-marketing--blob-overlay caretip-auth-marketing--focused",
        compact && "caretip-auth-marketing--compact",
      )}
      aria-label={t(`${prefix}.panelAria`)}
    >
      <div className="caretip-auth-marketing__inner">
        {showBackToHome ? <AuthBackToHomeNav variant="marketing" showLogo={false} /> : null}
        <div className="caretip-auth-marketing__content">
          <h2 className="caretip-auth-marketing__headline">{t(`${prefix}.headline`)}</h2>
          <p className="caretip-auth-marketing__body">{t(`${prefix}.body`)}</p>
        </div>
      </div>
    </aside>
  );
}
