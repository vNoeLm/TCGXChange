import React, { useEffect, useState } from 'react';
import { sendPasswordResetEmail, updatePassword } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';

type RecoveryState = 'checking' | 'ready' | 'done' | 'invalid';

export function ResetPasswordCard() {
  const { t } = useLanguage();
  const [state, setState] = useState<RecoveryState>('checking');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const urlError =
      hashParams.get('error_description') ||
      searchParams.get('error_description') ||
      hashParams.get('error') ||
      searchParams.get('error');

    if (urlError) {
      setErrorMsg(urlError);
      setState('invalid');
      return;
    }

    const hasTokenInUrl = Boolean(
      hashParams.get('access_token') ||
        hashParams.get('type') === 'recovery' ||
        searchParams.get('code') ||
        searchParams.get('token_hash'),
    );

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) {
        setState((prev) => (prev === 'done' ? 'done' : 'ready'));
        if (window.location.hash) {
          window.history.replaceState({}, '', window.location.pathname + window.location.search);
        }
      }
    });

    const settle = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      if (session) {
        setState((prev) => (prev === 'done' ? 'done' : 'ready'));
        return;
      }
      // Give Supabase a brief window to finish exchanging a URL code/hash on first paint
      if (hasTokenInUrl) {
        window.setTimeout(async () => {
          const { data: retry } = await supabase.auth.getSession();
          if (!alive) return;
          setState((prev) => {
            if (prev === 'done' || prev === 'ready') return prev;
            return retry.session ? 'ready' : 'invalid';
          });
        }, 900);
      } else {
        setState((prev) => (prev === 'done' || prev === 'ready' ? prev : 'invalid'));
      }
    };

    settle();

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword.length < 6) {
      setErrorMsg(t('Password must be at least 6 characters long.', 'A jelszónak legalább 6 karakter hosszúnak kell lennie.'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg(t('The two passwords do not match.', 'A két jelszó nem egyezik.'));
      return;
    }

    setBusy(true);
    try {
      const { error } = await updatePassword(newPassword);
      if (error) {
        setErrorMsg(error.message);
      } else {
        setNewPassword('');
        setConfirmPassword('');
        setState('done');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('Could not update password.', 'Nem sikerült frissíteni a jelszót.'));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!resendEmail.trim()) {
      setErrorMsg(t('Please enter your email address.', 'Kérjük, add meg az e-mail címed.'));
      return;
    }

    setBusy(true);
    try {
      const { error } = await sendPasswordResetEmail(resendEmail.trim());
      if (error) {
        setErrorMsg(error.message);
      } else {
        setInfoMsg(
          t(
            'If an account exists for that email, a fresh reset link has been sent.',
            'Ha létezik fiók ezzel az e-mail címmel, küldtünk egy új visszaállító linket.',
          ),
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('Could not send reset email.', 'Nem sikerült elküldeni a visszaállító e-mailt.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 sm:p-8">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 mb-3">
          <svg className="w-6 h-6 text-zinc-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-zinc-100 mb-1">
          {state === 'done'
            ? t('Password Updated', 'Jelszó frissítve')
            : t('Set New Password', 'Új jelszó beállítása')}
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400">
          {state === 'checking'
            ? t('Verifying your recovery link…', 'Visszaállító link ellenőrzése…')
            : state === 'ready'
            ? t('Choose a strong new password for your TCG XChange account.', 'Válassz egy erős új jelszót a TCG XChange fiókodhoz.')
            : state === 'done'
            ? t('Your password has been updated and your session is active.', 'A jelszavad sikeresen megváltozott, és a munkameneted aktív.')
            : t('This reset link is invalid or has expired. Request a new one below.', 'Ez a visszaállító link érvénytelen vagy lejárt. Igényelj újat alább.')}
        </p>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs font-semibold mb-4">
          {errorMsg}
        </div>
      )}

      {infoMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-[var(--positive)] text-xs font-semibold mb-4">
          {infoMsg}
        </div>
      )}

      {state === 'checking' && (
        <div className="py-8 flex justify-center">
          <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-zinc-200 animate-spin" />
        </div>
      )}

      {state === 'ready' && (
        <form onSubmit={handleResetSubmit} className="flex flex-col gap-3.5">
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              {t('New Password', 'Új jelszó')}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              {t('Confirm New Password', 'Új jelszó megerősítése')}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 transition"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className={`mt-2 w-full py-3 px-4 rounded-xl text-sm font-black transition cursor-pointer shadow-md border ${
              busy
                ? 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-zinc-100 hover:bg-white text-zinc-950 border-zinc-200'
            }`}
          >
            {busy ? t('Updating…', 'Frissítés…') : t('Update Password', 'Jelszó frissítése')}
          </button>
        </form>
      )}

      {state === 'done' && (
        <div className="flex flex-col gap-2.5 mt-2">
          <a
            href="/profile?tab=settings"
            className="w-full py-3 px-4 rounded-xl text-sm font-black text-center bg-zinc-100 hover:bg-white text-zinc-950 border border-zinc-200 transition"
          >
            {t('Go to Account Settings', 'Tovább a fiókbeállításokhoz')}
          </a>
          <a
            href="/"
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
          >
            {t('Back to Catalog', 'Vissza a katalógushoz')}
          </a>
        </div>
      )}

      {state === 'invalid' && (
        <form onSubmit={handleResend} className="flex flex-col gap-3.5">
          <div>
            <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
              {t('Email Address', 'E-mail cím')}
            </label>
            <input
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder={t('you@example.com', 'pelda@email.hu')}
              required
              autoComplete="email"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-600 transition"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className={`w-full py-3 px-4 rounded-xl text-sm font-black transition cursor-pointer shadow-md border ${
              busy
                ? 'bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed'
                : 'bg-zinc-100 hover:bg-white text-zinc-950 border-zinc-200'
            }`}
          >
            {busy ? t('Sending…', 'Küldés…') : t('Send New Reset Link', 'Új visszaállító link küldése')}
          </button>
          <div className="text-center mt-2">
            <a href="/login" className="text-xs font-bold text-zinc-300 hover:text-white underline">
              {t('Back to Sign In', 'Vissza a bejelentkezéshez')}
            </a>
          </div>
        </form>
      )}
    </div>
  );
}
