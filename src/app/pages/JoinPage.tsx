import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import '@/styles/bundles/auth.css';
import '@/styles/caretip-auth-join.css';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { CareTipLogo } from '@/app/components/CareTipLogo';
import { AuthStableSubmitButton } from '@/app/components/auth/AuthFormStability';
import { AuthTrustStrip } from '@/app/components/auth/AuthTrustStrip';
import { validateInviteCode } from '../lib/api';
import { toUserFriendlyMessage } from '../lib/errorMessages';
import { logClientError } from '../lib/clientLog';
import { saveValidatedInviteContext } from '../lib/inviteContextStore';

export function JoinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const prefilledCode = useMemo(() => (params.code ? String(params.code) : ''), [params.code]);
  const [code, setCode] = useState(prefilledCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = code.trim();
    if (!cleaned) return;
    setError('');
    setBusy(true);
    try {
      const validated = await validateInviteCode(cleaned);
      saveValidatedInviteContext({
        inviteCode: cleaned,
        businessName: validated.businessName,
        businessId: validated.businessId,
        businessSlug: validated.businessSlug,
        businessLocation: validated.businessLocation,
      });
      navigate('/join/signup', { replace: true });
    } catch (err) {
      logClientError('JoinPage.validateInvite', err);
      setError(toUserFriendlyMessage(err) || t('join.invalidCodeFallback'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="caretip-join font-sans" data-caretip-route-ready="">
      <nav className="caretip-join__bar" aria-label={t('staticPages.common.backToHome')}>
        <Link to="/" className="caretip-join__back touch-manipulation">
          <ArrowLeft strokeWidth={2.25} aria-hidden />
          {t('staticPages.common.backToHome')}
        </Link>
        <CareTipLogo size="auth" variant="wordmark" tone="white" className="caretip-join__logo" />
      </nav>

      <main className="caretip-join__main">
        <header>
          <p className="caretip-join__eyebrow">{t('join.eyebrow')}</p>
          <h1 className="caretip-join__title">{t('join.title')}</h1>
          <p className="caretip-join__subtitle">{t('join.subtitle')}</p>
        </header>

        <section className="caretip-join__card" aria-label={t('join.title')}>
          <div className="caretip-join__icon" aria-hidden>
            <KeyRound />
          </div>
          <form onSubmit={handleContinue} noValidate>
            <label className="caretip-join__label" htmlFor="join-invite-code">
              {t('join.inviteLabel')}
            </label>
            <input
              id="join-invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              placeholder={t('join.placeholder')}
              className="caretip-join__code"
              autoComplete="one-time-code"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'join-invite-error' : undefined}
            />
            {error ? (
              <p id="join-invite-error" className="caretip-join__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="caretip-join__submit">
              <AuthStableSubmitButton
                type="submit"
                loading={busy}
                loadingAriaLabel={t('join.checking')}
                disabled={!code.trim()}
                className="disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('join.continue')}
              </AuthStableSubmitButton>
            </div>
            <AuthTrustStrip />
          </form>
          <p className="caretip-join__footer">
            {t('join.footerPrompt')} <Link to="/employee/login">{t('join.signIn')}</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
