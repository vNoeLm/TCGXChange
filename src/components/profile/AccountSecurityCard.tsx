import React, { useEffect, useState } from 'react';
import {
  sendPasswordResetEmail,
  syncProfileEmail,
  updateEmailAddress,
  updatePassword,
  verifyCurrentPassword,
} from '../../lib/auth';
import { useLanguage } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';

interface AccountSecurityCardProps {
  email: string | null;
  onToast: (msg: string) => void;
  onEmailSynced?: (nextEmail: string) => void;
}

export function AccountSecurityCard({ email, onToast, onEmailSynced }: AccountSecurityCardProps) {
  const { t } = useLanguage();
  const [currentEmail, setCurrentEmail] = useState<string | null>(email);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [hasPasswordIdentity, setHasPasswordIdentity] = useState(true);

  const [emailFormOpen, setEmailFormOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  const [passwordFormOpen, setPasswordFormOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const [noticeBanner, setNoticeBanner] = useState<string | null>(null);

  const loadAuthDetails = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentEmail(user.email || email);
    setPendingEmail((user as any).new_email || null);
    if (Array.isArray(user.identities) && user.identities.length > 0) {
      setHasPasswordIdentity(user.identities.some((id) => id.provider === 'email'));
    }
  };

  useEffect(() => {
    setCurrentEmail((prev) => prev || email);
  }, [email]);

  useEffect(() => {
    loadAuthDetails();

    if (typeof window !== 'undefined') {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const searchParams = new URLSearchParams(window.location.search);
      const urlMessage = hashParams.get('message') || searchParams.get('message');
      const emailChanged = searchParams.get('emailChanged');

      if (urlMessage) {
        setNoticeBanner(urlMessage);
      } else if (emailChanged === '1') {
        syncProfileEmail().then((synced) => {
          if (synced) {
            setCurrentEmail(synced);
            onEmailSynced?.(synced);
          }
          setNoticeBanner(t('Your email address has been confirmed and updated.', 'Az e-mail címed megerősítésre és frissítésre került.'));
        });
      }

      if (hashParams.get('message') || hashParams.get('access_token') || searchParams.get('emailChanged') || searchParams.get('message')) {
        const cleaned = new URLSearchParams(window.location.search);
        cleaned.delete('emailChanged');
        cleaned.delete('message');
        const nextQuery = cleaned.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`);
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'USER_UPDATED' && session?.user) {
        setCurrentEmail(session.user.email || null);
        setPendingEmail((session.user as any).new_email || null);
        if (session.user.email) {
          syncProfileEmail().then((synced) => {
            if (synced) onEmailSynced?.(synced);
          });
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSuccess(null);

    const trimmedEmail = newEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setEmailError(t('Please enter a valid email address.', 'Kérjük, adj meg egy érvényes e-mail címet.'));
      return;
    }
    if (currentEmail && trimmedEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setEmailError(t('New email must be different from your current email.', 'Az új e-mail címnek el kell térnie a jelenlegitől.'));
      return;
    }
    if (hasPasswordIdentity && !emailCurrentPassword) {
      setEmailError(t('Please enter your current password to confirm.', 'A megerősítéshez kérjük, add meg a jelenlegi jelszavad.'));
      return;
    }

    setEmailBusy(true);
    try {
      if (hasPasswordIdentity && currentEmail) {
        const { error: verifyErr } = await verifyCurrentPassword(currentEmail, emailCurrentPassword);
        if (verifyErr) {
          setEmailError(t('Current password is incorrect.', 'A jelenlegi jelszó hibás.'));
          return;
        }
      }

      const { data, error } = await updateEmailAddress(trimmedEmail);
      if (error) {
        setEmailError(error.message);
        return;
      }

      const nextPending = (data?.user as any)?.new_email || trimmedEmail;
      setPendingEmail(nextPending);
      setNewEmail('');
      setEmailCurrentPassword('');
      const msg = t(
        'Confirmation link(s) sent. Check your new email inbox (and your current email inbox if double confirmation is enabled) to finish updating your email.',
        'Megerősítő link(ek) elküldve. Ellenőrizd az új e-mail fiókodat (és a jelenlegit is, ha a kettős megerősítés aktív) a módosítás véglegesítéséhez.',
      );
      setEmailSuccess(msg);
      onToast(t('Email confirmation link sent.', 'E-mail megerősítő link elküldve.'));
    } catch (err: any) {
      setEmailError(err?.message || t('Could not update email address.', 'Nem sikerült módosítani az e-mail címet.'));
    } finally {
      setEmailBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (hasPasswordIdentity && !currentPassword) {
      setPasswordError(t('Please enter your current password.', 'Kérjük, add meg a jelenlegi jelszavad.'));
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(t('New password must be at least 6 characters long.', 'Az új jelszónak legalább 6 karakter hosszúnak kell lennie.'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('The two new passwords do not match.', 'A két új jelszó nem egyezik.'));
      return;
    }

    setPasswordBusy(true);
    try {
      if (hasPasswordIdentity && currentEmail) {
        const { error: verifyErr } = await verifyCurrentPassword(currentEmail, currentPassword);
        if (verifyErr) {
          setPasswordError(t('Current password is incorrect.', 'A jelenlegi jelszó hibás.'));
          return;
        }
      }

      const { error } = await updatePassword(newPassword);
      if (error) {
        setPasswordError(error.message);
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setHasPasswordIdentity(true);
      setPasswordSuccess(t('Your password has been updated.', 'A jelszavad sikeresen megváltozott.'));
      onToast(t('Password updated successfully!', 'A jelszó sikeresen frissítve!'));
    } catch (err: any) {
      setPasswordError(err?.message || t('Could not update password.', 'Nem sikerült frissíteni a jelszót.'));
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleSendResetLink = async () => {
    if (!currentEmail || resetBusy) return;
    setPasswordError(null);
    setPasswordSuccess(null);
    setResetBusy(true);
    try {
      const { error } = await sendPasswordResetEmail(currentEmail);
      if (error) {
        setPasswordError(error.message);
      } else {
        setPasswordSuccess(
          t(
            'Password reset link sent to your email address. Check your inbox.',
            'Jelszó-visszaállító link elküldve az e-mail címedre. Ellenőrizd a beérkező leveleket.',
          ),
        );
        onToast(t('Password reset link sent.', 'Jelszó-visszaállító link elküldve.'));
      }
    } catch (err: any) {
      setPasswordError(err?.message || t('Could not send reset email.', 'Nem sikerült elküldeni a visszaállító e-mailt.'));
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div
      className="rounded-lg p-5 border space-y-4"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
        <svg className="w-4 h-4 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>{t('Account & Security', 'Fiók és biztonság')}</span>
      </h3>

      {noticeBanner && (
        <div
          className="rounded-xl border px-3.5 py-2.5 text-xs font-semibold flex items-center justify-between gap-3"
          style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
        >
          <span>{noticeBanner}</span>
          <button
            type="button"
            onClick={() => setNoticeBanner(null)}
            className="text-[11px] font-bold underline shrink-0 cursor-pointer"
          >
            {t('Dismiss', 'Bezárás')}
          </button>
        </div>
      )}

      {/* Email row */}
      <div className="pt-4 border-t border-[var(--border-subtle)] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
              {t('Email Address', 'E-mail cím')}
            </div>
            <div className="text-sm font-semibold text-[var(--text-primary)] mt-0.5 break-all">
              {currentEmail || t('No email linked', 'Nincs e-mail csatolva')}
            </div>
            {pendingEmail && (
              <div className="text-xs font-medium mt-1" style={{ color: 'var(--accent)' }}>
                {t('Pending confirmation for:', 'Megerősítésre váró új e-mail:')}{' '}
                <span className="font-mono font-bold">{pendingEmail}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setEmailFormOpen((v) => !v);
              setEmailError(null);
              setEmailSuccess(null);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold border transition hover:brightness-110 cursor-pointer self-start sm:self-auto shrink-0"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {emailFormOpen ? t('Cancel', 'Mégse') : t('Change Email', 'E-mail módosítása')}
          </button>
        </div>

        {emailFormOpen && (
          <form
            onSubmit={handleChangeEmail}
            className="rounded-xl border p-4 space-y-3"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
          >
            {emailError && (
              <p role="alert" className="text-xs font-semibold" style={{ color: 'var(--negative)' }}>
                {emailError}
              </p>
            )}
            {emailSuccess && (
              <p className="text-xs font-semibold leading-relaxed" style={{ color: 'var(--positive)' }}>
                {emailSuccess}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                  {t('New Email Address', 'Új e-mail cím')}
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={t('new@example.com', 'uj@email.hu')}
                  required
                  autoComplete="email"
                  className="w-full rounded-xl px-3 py-2 text-sm border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
              {hasPasswordIdentity && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                    {t('Current Password', 'Jelenlegi jelszó')}
                  </label>
                  <input
                    type="password"
                    value={emailCurrentPassword}
                    onChange={(e) => setEmailCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl px-3 py-2 text-sm border outline-none focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              <p className="text-[11px] text-[var(--text-muted)]">
                {t(
                  'Your email stays unchanged until you click the confirmation link.',
                  'Az e-mail címed a megerősítő link megnyitásáig változatlan marad.',
                )}
              </p>
              <button
                type="submit"
                disabled={emailBusy}
                className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
              >
                {emailBusy ? t('Sending…', 'Küldés…') : t('Update Email', 'E-mail frissítése')}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Password row */}
      <div className="pt-4 border-t border-[var(--border-subtle)] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
            {t('Password', 'Jelszó')}
          </div>
          <button
            type="button"
            onClick={() => {
              setPasswordFormOpen((v) => !v);
              setPasswordError(null);
              setPasswordSuccess(null);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold border transition hover:brightness-110 cursor-pointer self-start sm:self-auto shrink-0"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {passwordFormOpen ? t('Cancel', 'Mégse') : t('Change Password', 'Jelszó módosítása')}
          </button>
        </div>

        {passwordFormOpen && (
          <form
            onSubmit={handleChangePassword}
            className="rounded-xl border p-4 space-y-3"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
          >
            {passwordError && (
              <p role="alert" className="text-xs font-semibold" style={{ color: 'var(--negative)' }}>
                {passwordError}
              </p>
            )}
            {passwordSuccess && (
              <p className="text-xs font-semibold leading-relaxed" style={{ color: 'var(--positive)' }}>
                {passwordSuccess}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {hasPasswordIdentity && (
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                    {t('Current Password', 'Jelenlegi jelszó')}
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl px-3 py-2 text-sm border outline-none focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
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
                  className="w-full rounded-xl px-3 py-2 text-sm border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
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
                  className="w-full rounded-xl px-3 py-2 text-sm border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              {currentEmail ? (
                <button
                  type="button"
                  onClick={handleSendResetLink}
                  disabled={resetBusy}
                  className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer disabled:opacity-50"
                >
                  {resetBusy
                    ? t('Sending reset email…', 'Visszaállító e-mail küldése…')
                    : t('Forgot current password? Send reset link', 'Elfelejtetted a jelenlegi jelszavad? Küldj visszaállító linket')}
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={passwordBusy}
                className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
              >
                {passwordBusy ? t('Updating…', 'Frissítés…') : t('Update Password', 'Jelszó frissítése')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
