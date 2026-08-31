import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AuthSplitLayout } from "@/app/components/auth/AuthSplitLayout";
import { AuthCardBrandMark } from "@/app/components/auth/AuthCardBrandMark";

export type AuthRole = "business" | "employee";

export interface SignInCard2Props {
  isLogin: boolean;
  onToggleMode: () => void;
  children: React.ReactNode;
  className?: string;
  formBusy?: boolean;
  sessionActive?: boolean;
  authLane?: "business" | "employee";
  modeScope?: "both" | "signup-only" | "login-only";
  employeeVenueName?: string;
  inviteVerified?: boolean;
  onEmployeeSignUpClick?: () => void;
  topSlot?: React.ReactNode;
}

/**
 * Premium split-screen auth shell — marketing left, stable card right.
 */
export function SignInCard2({
  isLogin,
  onToggleMode,
  children,
  className,
  formBusy = false,
  sessionActive = false,
  authLane = "business",
  modeScope = "both",
  employeeVenueName,
  inviteVerified = false,
  onEmployeeSignUpClick,
  topSlot,
}: SignInCard2Props) {
  const { t } = useTranslation();
  const isEmployee = authLane === "employee";
  const showModeTabs = !sessionActive && modeScope === "both";

  const isBusinessSignup = !sessionActive && !isLogin && !isEmployee;
  /** Session-resume uses the cross-session notice as the card body — no duplicate title block. */
  const showFormHeadline = !isBusinessSignup && !sessionActive;

  const title = isLogin
    ? isEmployee
      ? t("auth.employeeAuth.titleSignIn")
      : t("auth.signInCard.titleWelcomeBack")
    : isEmployee
      ? employeeVenueName
        ? t("auth.employeeAuth.titleWelcomeVenue", { venue: employeeVenueName })
        : t("auth.employeeAuth.titleJoinTeam")
      : t("auth.signInCard.titleCreateVenue");

  const subtitle = isLogin
    ? isEmployee
      ? t("auth.employeeAuth.subtitleSignIn")
      : null
    : isEmployee
      ? inviteVerified
        ? t("auth.employeeAuth.subtitleInviteVerified")
        : t("auth.employeeAuth.subtitleJoinTeam")
      : t("auth.signInCard.subtitleCreateVenue");

  const handleSignUpTab = () => {
    if (isEmployee && onEmployeeSignUpClick) {
      onEmployeeSignUpClick();
      return;
    }
    if (isLogin) onToggleMode();
  };

  const handleSignInTab = () => {
    if (!isLogin) onToggleMode();
  };

  return (
    <AuthSplitLayout topSlot={topSlot} signUpMode={!sessionActive && !isLogin} authLane={authLane}>
      <div className={cn("caretip-auth-card-wrap", className)}>
        <div
          className={cn(
            "caretip-auth-card caretip-auth-card--stable",
            !isLogin && "caretip-auth-card--signup",
            sessionActive && "caretip-auth-card--session-resume",
          )}
        >
          <AuthCardBrandMark />

          {showFormHeadline ? (
            <div className="caretip-auth-header">
              <h1 className="caretip-auth-title">{title}</h1>
              {subtitle ? <p className="caretip-auth-subtitle">{subtitle}</p> : null}
            </div>
          ) : null}

          {showModeTabs ? (
            <div className="caretip-auth-mode-block">
              <div
                className="caretip-auth-tabs"
                role="tablist"
                aria-label={t("auth.signInCard.tablistAria")}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isLogin}
                  disabled={formBusy}
                  onClick={handleSignInTab}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-sm font-semibold transition-[background-color,color] duration-150 ease-out",
                    isLogin ? "caretip-auth-tab-active" : "caretip-auth-tab-idle",
                    formBusy && "cursor-not-allowed opacity-60",
                  )}
                >
                  {t("auth.signInCard.tabSignIn")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isLogin}
                  disabled={formBusy}
                  onClick={handleSignUpTab}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-sm font-semibold transition-[background-color,color] duration-150 ease-out",
                    !isLogin ? "caretip-auth-tab-active" : "caretip-auth-tab-idle",
                    formBusy && "cursor-not-allowed opacity-60",
                  )}
                >
                  {t("auth.signInCard.tabSignUp")}
                </button>
              </div>
            </div>
          ) : null}

          <div className="caretip-auth-card-body">{children}</div>
        </div>
      </div>
    </AuthSplitLayout>
  );
}
