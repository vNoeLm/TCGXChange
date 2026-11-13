import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { signInWithEmail, signUpWithEmail } from '../../lib/auth';
import { COUNTRIES, formatCountryName } from '../../lib/countries';
import { useLanguage } from '../../lib/i18n';
import { backdropCloseProps } from '../../lib/modalBackdrop';

interface AuthModalProps {
  initialMode?: 'signin' | 'signup';
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
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('HU');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Separate from `mounted`: the pre-portal render and the portaled one are different DOM nodes,
  // so flipping straight to "open" once mounted would skip the transition entirely (there is no
  // single node to interpolate across that swap). Waiting until after the portal exists, then
  // flipping this on the node that's actually going to stay, is what makes the fade/scale visible.
  useEffect(() => {
    if (!mounted) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

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
          {mode === 'signin' ? t('Welcome Back', 'Üdv újra!') : t('Create an Account', 'Fiók létrehozása')}
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400">
          {mode === 'signin'
            ? t('Sign in to access your order history and account', 'Jelentkezz be a rendeléseid és a fiókod eléréséhez')
            : t('Join TCG XChange to manage orders and saved decks', 'Csatlakozz a TCG XChange közösséghez a rendelések és paklik kezeléséhez')}
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

        <div>
          <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
            {t('Password', 'Jelszó')}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 transition"
          />
        </div>

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
            : t('Create an Account', 'Fiók létrehozása')}
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
        ) : (
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
