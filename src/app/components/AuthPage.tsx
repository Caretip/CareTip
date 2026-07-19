import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useLocation } from 'react-router';
import { AuthFieldGroup } from './auth/AuthFieldGroup';
import { AuthEmployeeVenueBanner } from './auth/AuthEmployeeVenueBanner';
import { AuthTrustStrip } from './auth/AuthTrustStrip';
import { beginAuthPostLoginTransition, isAuthPostLoginTransitionActive, subscribeAuthPostLoginTransition } from '../lib/authPostLoginTransition';
import {
  beginAuthSignInHandoff,
  markSignInHandoffAuthCompleted,
  markSignInHandoffNavigating,
  isAuthSignInHandoffActive,
  subscribeAuthSignInHandoff,
  endAuthSignInHandoff,
  formatSignInHandoffTimingReport,
  getSignInHandoffTimingSnapshot,
} from '../lib/authSignInHandoff';
import { useSignalLogoutAuthPageReady } from '../lib/useSignalLogoutAuthPageReady';
import { AuthOAuthButtons } from './AuthOAuthButtons';
import { SignInCard2, type AuthRole } from '@/components/ui/sign-in-card-2';
import { useAuth, type User, parseUser } from '../hooks/useAuth';
import { Eye, EyeOff, Check } from 'lucide-react';
import {
  getPasswordChecklist,
  isPasswordStrong,
  getPasswordStrength,
} from '../lib/passwordValidation';
import { toUserFriendlyMessage } from '../lib/errorMessages';
import {
  resendVerificationEmailAPI,
  isApiRequestError,
  EMAIL_NOT_VERIFIED_CODE,
  GOOGLE_ACCOUNT_NOT_REGISTERED_CODE,
  isMfaLoginChallenge,
} from '../lib/api';
import { validateInviteCode } from "../lib/api";
import { logClientError } from '../lib/clientLog';
import {
  caretipBtnPrimaryCompact,
} from '@/lib/caretipButtonSystem';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getPostAuthRedirect } from '../hooks/useAuth';
import { persistCheckoutIntentFromSearchParams } from '../lib/checkoutIntent';
import { commitAuthUser } from '../lib/authUserStore';
import {
  AuthErrorSlot,
  AuthFormStatusSlot,
  AuthStableSubmitButton,
} from './auth/AuthFormStability';
import { sessionMatchesBusinessStaffAuthTarget, shouldShowLoginSessionResumeUi } from '../lib/authSession';
import { shouldShowAuthBootstrapShell } from '../lib/authBootstrapUi';
import { AuthBootstrapShell } from './auth/AuthBootstrapShell';
import {
  clearValidatedInviteContext,
  readValidatedInviteContext,
  saveValidatedInviteContext,
  type ValidatedInviteContext,
} from '../lib/inviteContextStore';
import { scheduleIdleWork } from "@/lib/publicRouteDefer";
import { prefetchDashboardRoutes, preparePostAuthDestination } from "../lib/prefetchAuthenticatedRoutes";
import {
  APP_LOADING_PRIORITY,
  useAppLoadingRegistration,
} from "../lib/globalAppLoading";
import { isAppShellInteractive } from "../lib/appShellLifecycle";

const ROLE_MISMATCH_TOAST_STYLE = { background: '#000000', color: '#ffffff' } as const;

type AuthLane = 'business' | 'employee';

function resolveAuthLane(pathname: string): AuthLane {
  if (pathname === '/employee/login' || pathname === '/join/signup') return 'employee';
  return 'business';
}

export type { AuthRole };

const FIELD_CLASS = "caretip-auth-field";
const FIELD_ICON = "caretip-auth-field caretip-auth-field--has-icon";
const FIELD_PASSWORD = "caretip-auth-field caretip-auth-field--password-toggle";

const FIELD = {
  name: 'fullName',
  inviteCode: 'inviteCode',
  email: 'email',
  password: 'password',
  confirmPassword: 'confirmPassword',
} as const;

export function AuthPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const authLane = resolveAuthLane(location.pathname);
  const isEmployeeJoinSignup = location.pathname === '/join/signup';
  const role: AuthRole = authLane === 'employee' ? 'employee' : 'business';

  useEffect(() => {
    if (authLane !== 'business') return;
    persistCheckoutIntentFromSearchParams(new URLSearchParams(location.search));
  }, [authLane, location.search]);

  const [isLogin, setIsLogin] = useState(() => {
    const sp = new URLSearchParams(location.search);
    if (location.pathname === '/signup' || location.pathname === '/join/signup') return false;
    if (location.pathname === '/auth' && sp.get('mode') === 'signup') return false;
    return true;
  });

  const [inviteContext, setInviteContext] = useState<ValidatedInviteContext | null>(null);
  const [inviteGateReady, setInviteGateReady] = useState(!isEmployeeJoinSignup);
  const inviteGateBlocking = isEmployeeJoinSignup && !inviteGateReady;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPasswordChecklist, setShowPasswordChecklist] = useState(false);
  const [unlockedFields, setUnlockedFields] = useState<Set<string>>(() => new Set());
  const { login, register, loginWithOAuth, logout, user, sessionValidated, authStatus } = useAuth();
  const authInFlightRef = useRef(false);
  const postAuthRedirectRef = useRef<string | null>(null);
  /** Suppresses session-resume UI during fresh sign-in before navigation completes. */
  const [authFlowInProgress, setAuthFlowInProgress] = useState(false);

  // Form buttons keep local busy state — never reopen the global brand overlay for sign-in/up.
  useAppLoadingRegistration(
    "auth-invite-gate",
    APP_LOADING_PRIORITY.AUTH,
    inviteGateBlocking && !isAppShellInteractive(),
    t("common.loading.sessionCheck"),
  );

  /** Single post-auth navigation — cover stays until dashboard shell paints (not widgets). */
  const redirectAfterAuth = useCallback(
    async (sessionUser: User) => {
      const target = getPostAuthRedirect(sessionUser);
      if (location.pathname === target) return;
      if (postAuthRedirectRef.current === target) return;
      postAuthRedirectRef.current = target;
      if (!isAuthSignInHandoffActive()) {
        beginAuthSignInHandoff();
      }
      setAuthFlowInProgress(true);
      setIsSubmitting(true);
      markSignInHandoffAuthCompleted();
      try {
        await preparePostAuthDestination(target);
      } catch {
        /* Still navigate — cover stays until layout shell commits. */
      }
      // Cover mounts at root before AuthPage unmounts; soft-nav clears branded overlays.
      flushSync(() => {
        markSignInHandoffNavigating(target);
        beginAuthPostLoginTransition(target);
      });
      navigate(target, { replace: true });
      if (import.meta.env.DEV) {
        // Snapshot mid-flight; final report logs when handoff ends.
        console.info("[AuthHandoff] navigate issued\n" + formatSignInHandoffTimingReport(getSignInHandoffTimingSnapshot()));
      }
    },
    [location.pathname, navigate],
  );

  const resolvedInviteCode =
    authLane === 'employee' && !isLogin
      ? (inviteContext?.inviteCode ?? inviteCode).trim()
      : '';

  const unlockField = (key: string) => {
    setUnlockedFields((prev) => new Set(prev).add(key));
  };

  const isFieldLocked = (key: string) => !unlockedFields.has(key);

  useEffect(() => {
    const p = location.pathname;
    const sp = new URLSearchParams(location.search);
    if (p === '/signup' || p === '/join/signup' || (p === '/auth' && sp.get('mode') === 'signup')) {
      setIsLogin(false);
    } else if (p === '/login' || p === '/employee/login' || p === '/auth' || p === '/business/login') {
      setIsLogin(true);
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    scheduleIdleWork(() => prefetchDashboardRoutes(), 1500);
    scheduleIdleWork(() => {
      void import("../lib/prefetchPublicRoutes").then(({ prefetchLandingRoute }) => {
        prefetchLandingRoute();
      });
    }, 1800);
  }, []);

  /** Business signup must not accept employee invite params — send to /join. */
  useEffect(() => {
    if (authLane !== 'business') return;
    const sp = new URLSearchParams(location.search);
    if (sp.get('role') === 'employee' || sp.get('inviteCode') || sp.get('code')) {
      const code = (sp.get('inviteCode') || sp.get('code'))?.trim();
      navigate(code ? `/join/${encodeURIComponent(code)}` : '/join', { replace: true });
    }
  }, [authLane, location.search, navigate]);

  /** Employee signup requires persisted validated invite context. */
  useEffect(() => {
    if (!isEmployeeJoinSignup) {
      setInviteGateReady(true);
      return;
    }

    let cancelled = false;
    (async () => {
      const stored = readValidatedInviteContext();
      if (stored?.inviteCode?.trim()) {
        if (!cancelled) {
          setInviteContext(stored);
          setInviteCode(stored.inviteCode);
          setInviteGateReady(true);
        }
        return;
      }

      const sp = new URLSearchParams(location.search);
      const fromUrl = (sp.get('inviteCode') || sp.get('code'))?.trim();
      if (fromUrl) {
        try {
          const validated = await validateInviteCode(fromUrl);
          const ctx = saveValidatedInviteContext({
            inviteCode: fromUrl,
            businessName: validated.businessName,
            businessId: validated.businessId,
            businessSlug: validated.businessSlug,
            businessLocation: validated.businessLocation,
          });
          if (!cancelled) {
            setInviteContext(ctx);
            setInviteCode(ctx.inviteCode);
            setInviteGateReady(true);
          }
          return;
        } catch (err) {
          logClientError('AuthPage.inviteGate', err);
        }
      }

      if (!cancelled) {
        navigate('/join', { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEmployeeJoinSignup, location.search, navigate]);

  useEffect(() => {
    setUnlockedFields(new Set());
  }, [isLogin, location.pathname]);

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setShowResendVerification(false);

    if (user != null && !sessionValidated) return;
    if (user != null && sessionValidated) {
      setAuthFlowInProgress(true);
      setIsSubmitting(true);
      await redirectAfterAuth(user);
      return;
    }

    if (!email || !password) {
      setError(t('auth.page.errorBothRequired'));
      return;
    }

    if (!validateEmail(email)) {
      setError(t('auth.page.errorInvalidEmail'));
      return;
    }

    if (!isLogin) {
      if (authLane === 'employee' && !name.trim()) {
        setError(t("auth.page.errorFullName"));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("auth.page.errorPasswordsMismatch"));
        return;
      }
      if (!isPasswordStrong(password)) {
        setError(t("auth.page.errorPasswordWeak"));
        return;
      }
      if (authLane === 'employee' && !resolvedInviteCode) {
        setError(t("auth.page.errorInviteRequired"));
        return;
      }
    }

    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    beginAuthSignInHandoff();
    setAuthFlowInProgress(true);
    setIsSubmitting(true);

    try {
      if (isLogin) {
        const result = await login(email, password);
        if (isMfaLoginChallenge(result)) {
          endAuthSignInHandoff("AuthPage_mfa_challenge");
          navigate('/platform-admin/login', { replace: true });
          return;
        }
        await redirectAfterAuth(parseUser(result.user));
        return;
      } else {
        const payload = {
          email,
          password,
          name: name.trim() ? name.trim() : undefined,
          role: role as 'business' | 'employee',
          inviteCode: authLane === 'employee' ? resolvedInviteCode : undefined,
        };
        if (authLane === 'employee') {
          await validateInviteCode(resolvedInviteCode);
        }
        const created = await register(payload);
        if (authLane === 'employee') {
          clearValidatedInviteContext();
        }
        const verifyTarget = '/verify-email';
        postAuthRedirectRef.current = verifyTarget;
        markSignInHandoffAuthCompleted();
        try {
          await preparePostAuthDestination(verifyTarget);
        } catch {
          /* cover until page paints */
        }
        flushSync(() => {
          markSignInHandoffNavigating(verifyTarget);
          beginAuthPostLoginTransition(verifyTarget);
        });
        navigate(verifyTarget, {
          replace: true,
          state: { pendingEmail: created.email, pendingRole: created.role },
        });
        return;
      }
    } catch (err) {
      logClientError('AuthPage', err);
      endAuthSignInHandoff("AuthPage_submit_error");
      if (isApiRequestError(err) && err.code === EMAIL_NOT_VERIFIED_CODE) {
        // Ensure we don't keep a stale session from a previous login when backend rejects unverified access.
        try {
          localStorage.removeItem("caretip_user");
          window.dispatchEvent(new CustomEvent("caretip-auth-storage-sync"));
        } catch {
          // ignore
        }
        setError(err.message);
        setShowResendVerification(err.canResend === true);
        // No session is issued for unverified users; keep them here with resend.
        return;
      }
      setShowResendVerification(false);
      const raw = err instanceof Error ? err.message : String(err);
      const msg = toUserFriendlyMessage(err);
      if (
        raw.includes('does not have Business permissions') ||
        raw.includes('does not have Staff permissions')
      ) {
        toast.error(msg, { style: ROLE_MISMATCH_TOAST_STYLE });
      } else {
        setError(msg);
      }
    } finally {
      authInFlightRef.current = false;
      // Keep button spinner until unmount when a post-auth redirect is in flight.
      if (!postAuthRedirectRef.current) {
        setIsSubmitting(false);
        setAuthFlowInProgress(false);
      }
    }
  };

  const handleResendVerification = async () => {
    if (!email.trim() || !password) {
      setError(t('auth.page.resendNeedPassword'));
      return;
    }
    setResendBusy(true);
    setError('');
    try {
      const loc = i18n.resolvedLanguage?.toLowerCase().startsWith("de") ? "de" : "en";
      const r = await resendVerificationEmailAPI(email.trim(), password, loc);
      toast.success(r.message || t('auth.page.toastResendDefault'), {
        style: ROLE_MISMATCH_TOAST_STYLE,
      });
    } catch (err) {
      logClientError('AuthPage.resendVerification', err);
      setError(toUserFriendlyMessage(err));
    } finally {
      setResendBusy(false);
    }
  };

  const toggleAuthMode = () => {
    if (authLane === 'employee') {
      navigate(isLogin ? '/join' : '/employee/login', { replace: true });
      setError('');
      setShowResendVerification(false);
      return;
    }

    const nextLogin = !isLogin;
    setIsLogin(nextLogin);
    const base = nextLogin ? '/login' : '/signup';
    navigate(`${base}${location.search}`, { replace: true });
    setError('');
    setShowResendVerification(false);
    setEmail('');
    setPassword('');
    setName('');
    setInviteCode('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setShowPasswordChecklist(false);
    setUnlockedFields(new Set());
  };

  const runGoogleOAuth = async (idToken: string) => {
    if (user != null && sessionValidated) {
      setAuthFlowInProgress(true);
      setIsSubmitting(true);
      await redirectAfterAuth(user);
      return;
    }
    if (!isLogin && authLane === 'employee') {
      if (!name.trim()) {
        setError(t("auth.page.errorFullName"));
        return;
      }
      if (!resolvedInviteCode) {
        setError(t("auth.page.errorInviteRequired"));
        return;
      }
    }
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    beginAuthSignInHandoff();
    setAuthFlowInProgress(true);
    setIsSubmitting(true);
    setError('');
    setShowResendVerification(false);
    commitAuthUser(null);
    try {
      if (!isLogin && authLane === 'employee') {
        await validateInviteCode(resolvedInviteCode);
      }
      const loggedIn = await loginWithOAuth("google", idToken, {
        isLogin,
        ...(!isLogin
          ? {
              intendedRole: role,
              name: name.trim() ? name.trim() : undefined,
              inviteCode: authLane === 'employee' ? resolvedInviteCode : undefined,
            }
          : {}),
      });
      if (!isLogin && authLane === 'employee') {
        clearValidatedInviteContext();
      }
      await redirectAfterAuth(loggedIn);
      return;
    } catch (err) {
      logClientError('AuthPage.oauth', err);
      endAuthSignInHandoff("AuthPage_oauth_error");
      if (isApiRequestError(err) && err.code === GOOGLE_ACCOUNT_NOT_REGISTERED_CODE) {
        setIsLogin(false);
        setError(toUserFriendlyMessage(err));
        return;
      }
      const raw = err instanceof Error ? err.message : String(err);
      const msg = toUserFriendlyMessage(err);
      if (
        raw.includes('does not have Business permissions') ||
        raw.includes('does not have Staff permissions')
      ) {
        toast.error(msg, { style: ROLE_MISMATCH_TOAST_STYLE });
      } else {
        setError(msg);
      }
    } finally {
      authInFlightRef.current = false;
      if (!postAuthRedirectRef.current) {
        setIsSubmitting(false);
        setAuthFlowInProgress(false);
      }
    }
  };

  const employeeSignupIncomplete =
    !isLogin && authLane === 'employee' && (!name.trim() || !resolvedInviteCode);

  const signUpDisabled =
    !isLogin &&
    (!email ||
      !validateEmail(email) ||
      !isPasswordStrong(password) ||
      password !== confirmPassword ||
      employeeSignupIncomplete);

  const showEmployeeSignupFields = !isLogin && authLane === 'employee';

  const resumeSessionPending = user != null && !sessionValidated;

  const postLoginTransitionActive = useSyncExternalStore(
    subscribeAuthPostLoginTransition,
    isAuthPostLoginTransitionActive,
    () => false,
  );
  const signInHandoffActive = useSyncExternalStore(
    subscribeAuthSignInHandoff,
    isAuthSignInHandoffActive,
    () => false,
  );
  const authTransitionPending =
    postLoginTransitionActive ||
    signInHandoffActive ||
    (authFlowInProgress && Boolean(postAuthRedirectRef.current));

  const loginChromeReady =
    !inviteGateBlocking &&
    !shouldShowAuthBootstrapShell({
      authStatus,
      authTransitionPending,
    });
  useSignalLogoutAuthPageReady(loginChromeReady);

  if (inviteGateBlocking) {
    return <AuthBootstrapShell />;
  }
  if (!loginChromeReady) {
    return <AuthBootstrapShell />;
  }

  const showSignInForm =
    authStatus !== "initializing" &&
    (!user ||
      !sessionValidated ||
      (!isLogin && !sessionMatchesBusinessStaffAuthTarget(user.role, role)));
  const showAuthenticatedSessionHint = shouldShowLoginSessionResumeUi({
    authStatus,
    user,
    sessionValidated,
    showSignInForm,
    authFlowInProgress: authFlowInProgress || isSubmitting,
  });

  const sessionRoleLabel =
    user?.role === 'platform_admin' || user?.role === 'admin'
      ? t('auth.page.sessionRolePlatformAdmin')
      : user?.role === 'employee'
        ? t('auth.page.sessionRoleStaff')
        : user?.role === 'business'
          ? t('auth.page.sessionRoleBusiness')
          : user?.role ?? '';

  const sessionHintBanner = showAuthenticatedSessionHint ? (
    <div
      className="caretip-auth-session-resume"
      role="region"
      aria-label={t('auth.page.crossSessionRegionAria')}
    >
      <div className="caretip-auth-notice caretip-auth-notice--session-resume">
        <p className="font-medium leading-snug">{t('auth.page.crossSessionBody', { role: sessionRoleLabel })}</p>
        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={!user}
            onClick={() => {
              if (!user) return;
              beginAuthSignInHandoff();
              void redirectAfterAuth(user);
            }}
            className={cn(caretipBtnPrimaryCompact, "min-h-10 w-full px-4 text-sm sm:w-auto sm:min-w-[10rem] disabled:opacity-50")}
          >
            {t('auth.page.crossSessionContinue')}
          </button>
          <button
            type="button"
            onClick={() => {
              logout();
              setError('');
            }}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.03)] transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-muted/60 sm:w-auto"
          >
            {t('auth.page.crossSessionSwitch')}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="caretip-auth-page relative font-sans">
        <SignInCard2
          isLogin={isLogin}
          onToggleMode={toggleAuthMode}
          formBusy={isSubmitting || authFlowInProgress}
          sessionActive={
            showAuthenticatedSessionHint || authFlowInProgress || postLoginTransitionActive
          }
          authLane={authLane}
          modeScope={isEmployeeJoinSignup ? 'signup-only' : 'both'}
          employeeVenueName={inviteContext?.businessName}
          inviteVerified={Boolean(inviteContext?.inviteCode)}
          onEmployeeSignUpClick={() => navigate('/join', { replace: true })}
        >
          {showAuthenticatedSessionHint ? (
            sessionHintBanner
          ) : showSignInForm ? (
          <form
            onSubmit={handleSubmit}
            aria-busy={isSubmitting || resumeSessionPending}
            className="caretip-auth-form text-foreground"
            noValidate
          >
            <input
              type="text"
              name="bot_trap"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="hidden"
              style={{ display: 'none' }}
            />

            {isEmployeeJoinSignup && inviteContext ? (
              <AuthEmployeeVenueBanner
                businessName={inviteContext.businessName}
                businessLocation={inviteContext.businessLocation}
                verified
              />
            ) : null}

            {showEmployeeSignupFields ? (
              <div className="caretip-auth-employee-fields">
                <AuthFieldGroup label={t('auth.page.labelFullName')} htmlFor="auth-full-name">
                  <input
                    placeholder={t('auth.page.placeholderFullName')}
                    type="text"
                    id="auth-full-name"
                    name={FIELD.name}
                    autoComplete="name"
                    value={name}
                    readOnly={isFieldLocked(FIELD.name)}
                    onFocus={() => unlockField(FIELD.name)}
                    onChange={(e) => setName(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </AuthFieldGroup>
              </div>
            ) : null}

            <div className={cn("caretip-auth-oauth", isSubmitting && "caretip-auth-oauth--busy")}>
              <AuthOAuthButtons
                isLogin={isLogin}
                role={role}
                formBusy={isSubmitting}
                name={name}
                inviteCode={resolvedInviteCode}
                onGoogleCredential={(t) => void runGoogleOAuth(t)}
              />
            </div>

            <div
              className="caretip-auth-oauth-divider relative flex items-center gap-3"
              role="separator"
              aria-label={t('auth.page.dividerEmail')}
            >
              <div className="caretip-auth-divider-line" aria-hidden />
              <span className="caretip-auth-oauth-divider__label">{t('auth.page.dividerEmail')}</span>
              <div className="caretip-auth-divider-line" aria-hidden />
            </div>

            <AuthFieldGroup label={t('auth.page.labelEmail')} htmlFor="auth-email">
              <input
                placeholder={t('auth.page.placeholderEmail')}
                type="email"
                id="auth-email"
                name={FIELD.email}
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={FIELD_CLASS}
              />
            </AuthFieldGroup>

            {isLogin ? (
              <AuthFieldGroup label={t('auth.page.labelPassword')} htmlFor="auth-password">
                <div className="relative">
                  <input
                    placeholder={t('auth.page.placeholderPassword')}
                    type={showPassword ? 'text' : 'password'}
                    id="auth-password"
                    name={FIELD.password}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={FIELD_PASSWORD}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="caretip-auth-field-toggle"
                    aria-label={showPassword ? t('auth.page.hidePassword') : t('auth.page.showPassword')}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </AuthFieldGroup>
            ) : (
              <>
                <div className="caretip-auth-signup-password-row">
                  <AuthFieldGroup label={t('auth.page.labelPassword')} htmlFor="auth-password">
                    <div className="relative">
                      <input
                        placeholder={t('auth.page.placeholderPassword')}
                        type={showPassword ? 'text' : 'password'}
                        id="auth-password"
                        name={FIELD.password}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setShowPasswordChecklist(true);
                        }}
                        onFocus={() => setShowPasswordChecklist(true)}
                        onBlur={() => {
                          if (password.trim() === '') setShowPasswordChecklist(false);
                        }}
                        className={FIELD_PASSWORD}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="caretip-auth-field-toggle"
                        aria-label={showPassword ? t('auth.page.hidePassword') : t('auth.page.showPassword')}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <div className="caretip-auth-password-meter">
                        <div
                          className="caretip-auth-password-meter__fill"
                          style={{
                            transform: `scaleX(${getPasswordStrength(password).score / 100})`,
                            backgroundColor:
                              getPasswordStrength(password).strength === 'strong'
                                ? '#111827'
                                : getPasswordStrength(password).strength === 'fair'
                                  ? '#e9781c'
                                  : '#6B7280',
                            opacity: getPasswordStrength(password).strength === 'weak' ? 0.45 : 1,
                          }}
                        />
                      </div>
                    </div>
                  </AuthFieldGroup>

                  <AuthFieldGroup label={t('auth.page.labelConfirmPassword')} htmlFor="auth-confirm-password">
                    <div className="relative">
                      <input
                        placeholder={t('auth.page.placeholderConfirmPassword')}
                        type={showConfirmPassword ? 'text' : 'password'}
                        id="auth-confirm-password"
                        name={FIELD.confirmPassword}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={FIELD_PASSWORD}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="caretip-auth-field-toggle"
                        aria-label={
                          showConfirmPassword ? t('auth.page.hidePassword') : t('auth.page.showPassword')
                        }
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </AuthFieldGroup>
                </div>

                <div
                  className={cn(
                    'caretip-auth-password-rules-slot',
                    !showPasswordChecklist && 'caretip-auth-password-rules-slot--idle',
                  )}
                  aria-hidden={!showPasswordChecklist}
                >
                  <ul className="caretip-auth-password-rules">
                    {[
                      { key: 'minLength', label: t('auth.page.passwordRuleMinLength'), met: getPasswordChecklist(password).minLength },
                      { key: 'upper', label: t('auth.page.passwordRuleUpper'), met: getPasswordChecklist(password).hasUppercase },
                      { key: 'lower', label: t('auth.page.passwordRuleLower'), met: getPasswordChecklist(password).hasLowercase },
                      { key: 'number', label: t('auth.page.passwordRuleNumber'), met: getPasswordChecklist(password).hasNumber },
                      { key: 'special', label: t('auth.page.passwordRuleSpecial'), met: getPasswordChecklist(password).hasSpecial },
                    ].map(({ key, label, met }) => (
                      <li key={key} className={`flex items-center gap-1.5 ${met ? 'text-primary' : ''}`}>
                        <span
                          className={`flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full ${
                            met ? 'bg-primary text-white' : 'bg-neutral-200 dark:bg-neutral-800'
                          }`}
                        >
                          {met ? <Check className="h-2 w-2" strokeWidth={3} /> : null}
                        </span>
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            <AuthErrorSlot>{error || null}</AuthErrorSlot>

            <div className="caretip-auth-resend-slot">
              {isLogin && showResendVerification && error ? (
                <AuthStableSubmitButton
                  type="button"
                  variant="secondary"
                  loading={resendBusy}
                  loadingAriaLabel={t('auth.page.resendSending')}
                  disabled={isSubmitting}
                  onClick={() => void handleResendVerification()}
                  className="h-10 min-h-10 text-sm"
                >
                  {t('auth.page.resendVerificationEmail')}
                </AuthStableSubmitButton>
              ) : null}
            </div>

            {isLogin && (
              <div className="flex justify-end pt-0.5">
                <Link
                  to="/forgot-password"
                  className="caretip-auth-inline-link"
                >
                  {t('auth.page.forgotPassword')}
                </Link>
              </div>
            )}

            <AuthStableSubmitButton
              type="submit"
              loading={isSubmitting}
              loadingAriaLabel={isLogin ? t("common.loading.signingIn") : t("common.creatingWorkspace")}
              disabled={resumeSessionPending || (!isLogin && signUpDisabled)}
              className="disabled:cursor-not-allowed"
            >
              {isLogin ? t('auth.page.signIn') : t('auth.page.createAccount')}
            </AuthStableSubmitButton>

            <AuthFormStatusSlot>
              {isSubmitting
                ? isLogin
                  ? t("common.loading.signingIn")
                  : t("common.creatingWorkspace")
                : null}
            </AuthFormStatusSlot>

            <AuthTrustStrip />

            <p className="caretip-auth-form-footer">
              {isLogin
                ? authLane === 'employee'
                  ? t('auth.employeeAuth.footerNoAccount')
                  : t('auth.page.footerNoAccount')
                : authLane === 'employee'
                  ? t('auth.employeeAuth.footerHasAccount')
                  : t('auth.page.footerHasAccount')}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  if (authLane === 'employee') {
                    navigate(isLogin ? '/join' : '/employee/login', { replace: true });
                    return;
                  }
                  toggleAuthMode();
                }}
                className="font-semibold text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline disabled:opacity-50"
              >
                {isLogin
                  ? authLane === 'employee'
                    ? t('auth.employeeAuth.footerJoinTeam')
                    : t('auth.page.footerSignUp')
                  : authLane === 'employee'
                    ? t('auth.page.footerSignIn')
                    : t('auth.page.footerSignIn')}
              </button>
            </p>
          </form>
          ) : null}
        </SignInCard2>
    </div>
  );
}
