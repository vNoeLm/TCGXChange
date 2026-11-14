import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { sendPasswordResetEmail, signInWithEmail, signInWithGoogle, signUpWithEmail } from '../../lib/auth';
import { COUNTRIES, formatCountryName } from '../../lib/countries';
import { useLanguage } from '../../lib/i18n';
import { backdropCloseProps } from '../../lib/modalBackdrop';

interface AuthModalProps {
  initialMode?: 'signin' | 'signup' | 'forgot';
  onClose?: () => void;
  onSuccess?: () => void;
  isStandalone?: boolean;
}

export function AuthModal({
  initialMode = 'signin',
  onClose,
  onSuccess,
  isStandalone = false,
}: AuthModalProps) {
  const { t, lang } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('HU');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      if (isStandalone) {
        const m = searchParams.get('mode');
        if (m === 'forgot' || m === 'signup' || m === 'signin') {
          setMode(m);
        }
      }
      const oauthErr =
        hashParams.get('error_description') ||
        searchParams.get('error_description') ||
        hashParams.get('error') ||
        searchParams.get('error');
      if (oauthErr) {
        setErrorMsg(oauthErr);
      }
    }
  }, [isStandalone]);

  // Separate from `mounted`: the pre-portal render and the portaled one are different DOM nodes,
  // so flipping straight to "open" once mounted would skip the transition entirely (there is no
  // single node to interpolate across that swap). Waiting until after the portal exists, then
  // flipping this on the node that's actually going to stay, is what makes the fade/scale visible.
  useEffect(() => {
    if (!mounted) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setOauthLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        setErrorMsg(error.message);
        setOauthLoading(false);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('Could not start Google sign-in.', 'Nem sikerült elindítani a Google bejelentkezést.'));
      setOauthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (mode === 'forgot') {
      if (!email.trim()) {
        setErrorMsg(t('Please enter your email address.', 'Kérjük, add meg az e-mail címed.'));
        return;
      }
      setLoading(true);
      try {
        const { error } = await sendPasswordResetEmail(email.trim());
        if (error) {
          setErrorMsg(error.message);
        } else {
          setSuccessMsg(
            t(
              'If an account exists for that email, we sent a password reset link. Check your inbox (and spam folder).',
              'Ha létezik fiók ezzel az e-mail címmel, elküldtük a jelszó-visszaállító linket. Ellenőrizd a beérkező leveleket (és a spam mappát is).',
            ),
          );
        }
      } catch (err: any) {
        setErrorMsg(err.message || t('An unexpected error occurred.', 'Váratlan hiba történt.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email.trim() || !password.trim()) {
      setErrorMsg(t('Please provide both email and password.', 'Kérjük, add meg az e-mail címet és a jelszót is.'));
      return;
    }

    if (mode === 'signup' && !acceptedTerms) {
      setErrorMsg(
        t(
          'Please accept the Terms of Service and Privacy Notice to create an account.',
          'A regisztrációhoz kérjük, fogadd el az ÁSZF-et és az Adatkezelési tájékoztatót.',
        ),
      );
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await signInWithEmail(email.trim(), password);
        if (error) {
          setErrorMsg(error.message);
        } else {
          setSuccessMsg(t('Successfully signed in!', 'Sikeres bejelentkezés!'));
          if (onSuccess) onSuccess();
          else if (isStandalone) window.location.href = '/';
          else if (onClose) onClose();
        }
      } else {
        const { data, error } = await signUpWithEmail(email.trim(), password, displayName.trim(), country);
        if (error) {
          setErrorMsg(error.message);
        } else {
          if (data?.session) {
            setSuccessMsg(t('Account created successfully!', 'A fiók sikeresen létrejött!'));
            if (onSuccess) onSuccess();
            else if (isStandalone) window.location.href = '/';
            else if (onClose) onClose();
          } else {
            setSuccessMsg(
              t(
                'Account created! Please check your email for a confirmation link if required.',
                'A fiók létrejött! Kérjük, ellenőrizd az e-mail fiókodat a megerősítő linkért, ha szükséges.',
              ),
            );
          }
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || t('An unexpected error occurred.', 'Váratlan hiba történt.'));
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 sm:p-8 relative">
      {/* Close button if modal */}
      {!isStandalone && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close authentication modal', 'Bejelentkezési ablak bezárása')}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white p-2 rounded-lg transition cursor-pointer flex items-center justify-center min-w-[36px] min-h-[36px]"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 mb-3">
          <svg className="w-6 h-6 text-zinc-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
        <h2 className="text-xl sm:text-2xl font-black text-zinc-100 mb-1">
          {mode === 'signin'
            ? t('Welcome Back', 'Üdv újra!')
            : mode === 'signup'
            ? t('Create an Account', 'Fiók létrehozása')
            : t('Reset Password', 'Jelszó visszaállítása')}
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400">
          {mode === 'signin'
            ? t('Sign in to access your order history and account', 'Jelentkezz be a rendeléseid és a fiókod eléréséhez')
            : mode === 'signup'
            ? t('Join TCG XChange to manage orders and saved decks', 'Csatlakozz a TCG XChange közösséghez a rendelések és paklik kezeléséhez')
            : t('Enter your email address and we will send you a reset link', 'Add meg az e-mail címed, és küldünk egy visszaállító linket')}
        </p>
      </div>

      {/* Error & Success Messages */}
      {errorMsg && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs font-semibold mb-4">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-[var(--positive)] text-xs font-semibold mb-4">
          {successMsg}
        </div>
      )}

      {mode !== 'forgot' && (
        <div className="mb-4">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={oauthLoading || loading}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-bold transition cursor-pointer border border-zinc-700 bg-zinc-950 hover:bg-zinc-800/80 text-zinc-100 flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
              />
            </svg>
            <span>
              {oauthLoading
                ? t('Redirecting to Google…', 'Átirányítás a Google-hoz…')
                : t('Continue with Google', 'Folytatás Google-fiókkal')}
            </span>
          </button>
          {mode === 'signup' && (
            <p className="text-[11px] text-zinc-500 text-center mt-2 leading-relaxed">
              {lang === 'hu' ? (
                <>
                  A Google-regisztrációval megerősíted, hogy elmúltál 16 éves, és elfogadod az{' '}
                  <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-zinc-300 underline hover:text-white">
                    ÁSZF-et
                  </a>{' '}
                  és az{' '}
                  <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-zinc-300 underline hover:text-white">
                    Adatkezelési tájékoztatót
                  </a>.
                </>
              ) : (
                <>
                  By continuing with Google, you confirm you are 16+ and accept our{' '}
                  <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-zinc-300 underline hover:text-white">
                    Terms
                  </a>{' '}
                  and{' '}
                  <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-zinc-300 underline hover:text-white">
                    Privacy Notice
                  </a>.
                </>
              )}
            </p>
          )}
          <div className="relative flex items-center justify-center my-4">
            <div className="border-t border-zinc-800 w-full" />
            <span className="px-3 text-[11px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900 shrink-0">
              {t('or', 'vagy')}
            </span>
            <div className="border-t border-zinc-800 w-full" />
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        {mode === 'signup' && (
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              {t('Display Name', 'Megjelenítendő név')}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('e.g. MasterRifter', 'pl. MasterRifter')}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 transition"
            />
          </div>
        )}

        {mode === 'signup' && (
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              {t('Country / Region', 'Ország / Régió')}
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-zinc-600 transition cursor-pointer"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {formatCountryName(c, lang)}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-500 mt-1">
              {t(
                'Shown on your public collector profile.',
                'A nyilvános gyűjtői profilodon jelenik meg.',
              )}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
            {t('Email Address', 'E-mail cím')}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('you@example.com', 'pelda@email.hu')}
            required
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 transition"
          />
        </div>

        {mode !== 'forgot' && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                {t('Password', 'Jelszó')}
              </label>
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setPassword('');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className="text-xs font-semibold text-zinc-400 hover:text-zinc-100 transition cursor-pointer"
                >
                  {t('Forgot password?', 'Elfelejtett jelszó?')}
                </button>
              )}
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 transition"
            />
          </div>
        )}

        {mode === 'signup' && (
          <label className="flex items-start gap-2.5 text-xs text-zinc-400 leading-relaxed cursor-pointer select-none mt-0.5">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              required
              className="mt-0.5 rounded border-zinc-700 bg-zinc-950 accent-emerald-500 cursor-pointer"
            />
            {lang === 'hu' ? (
              <span>
                Elmúltam 16 éves, elfogadom az{' '}
                <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-zinc-200 underline hover:text-white">
                  Általános Szerződési Feltételeket
                </a>{' '}
                és tudomásul veszem az{' '}
                <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-zinc-200 underline hover:text-white">
                  Adatkezelési tájékoztatót
                </a>.
              </span>
            ) : (
              <span>
                I am at least 16 years old and I accept the{' '}
                <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-zinc-200 underline hover:text-white">
                  Terms of Service
                </a>{' '}
                and acknowledge the{' '}
                <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-zinc-200 underline hover:text-white">
                  Privacy Notice
                </a>.
              </span>
            )}
          </label>
        )}

        <button
          type="submit"
          disabled={loading}
          className={`mt-2 w-full py-3 px-4 rounded-xl text-sm font-black transition cursor-pointer shadow-md border ${
            loading
              ? 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed'
              : 'bg-zinc-100 hover:bg-white text-zinc-950 border-zinc-200'
          }`}
        >
          {loading
            ? t('Please wait…', 'Kérjük, várj…')
            : mode === 'signin'
            ? t('Sign In', 'Bejelentkezés')
            : mode === 'signup'
            ? t('Create an Account', 'Fiók létrehozása')
            : t('Send Reset Link', 'Visszaállító link küldése')}
        </button>
      </form>

      {/* Switch Mode */}
      <div className="text-center mt-5 text-xs text-zinc-400">
        {mode === 'signin' ? (
          <>
            {t("Don't have an account?", 'Még nincs fiókod?')}{' '}
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className="text-zinc-200 hover:text-white font-bold underline cursor-pointer ml-1"
            >
              {t('Register', 'Regisztráció')}
            </button>
          </>
        ) : mode === 'signup' ? (
          <>
            {t('Already have an account?', 'Már van fiókod?')}{' '}
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className="text-zinc-200 hover:text-white font-bold underline cursor-pointer ml-1"
            >
              {t('Sign In', 'Bejelentkezés')}
            </button>
          </>
        ) : (
          <>
            {t('Remembered your password?', 'Eszembe jutott a jelszavam:')}{' '}
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className="text-zinc-200 hover:text-white font-bold underline cursor-pointer ml-1"
            >
              {t('Back to Sign In', 'Vissza a bejelentkezéshez')}
            </button>
          </>
        )}
      </div>
    </div>
  );

  if (isStandalone) {
    return content;
  }

  // AuthModal has no isOpen prop - callers mount/unmount it directly, so there is no signal to
  // hold it open for an exit transition. `mounted` (already used for the portal) still gives a
  // real, non-instant entrance: rendered closed on the first paint, flipped open a frame later.
  const modalMarkup = (
    <div
      {...(onClose ? backdropCloseProps(onClose) : {})}
      data-state={entered ? 'open' : 'closed'}
      className="tv-overlay fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-state={entered ? 'open' : 'closed'}
        className="tv-modal-panel w-full max-w-md flex justify-center"
      >
        {content}
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && mounted) {
    return createPortal(modalMarkup, document.body);
  }

  return modalMarkup;
}
