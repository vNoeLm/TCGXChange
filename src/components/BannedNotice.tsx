import { useEffect, useState } from 'react';
import { getCurrentProfile, signOut } from '../lib/auth';
import { BAN_DETAIL, BAN_SUMMARY } from '../lib/accountAccess';

/**
 * The standalone suspension page. A signed-in but unrestricted visitor is sent back to the
 * catalog, so this only ever shows to a suspended account (or while checking).
 */
export function BannedNotice() {
  const [state, setState] = useState<'checking' | 'banned'>('checking');
  const [from, setFrom] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('from');
    if (target && target.startsWith('/')) setFrom(target);

    let alive = true;
    getCurrentProfile()
      .then((profile) => {
        if (!alive) return;
        if (profile?.is_banned) setState('banned');
        else window.location.replace('/');
      })
      .catch(() => {
        if (alive) window.location.replace('/');
      });
    return () => {
      alive = false;
    };
  }, []);

  const leave = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {}
    window.location.replace('/');
  };

  if (state === 'checking') {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm font-semibold animate-pulse" style={{ color: 'var(--text-tertiary)' }}>
          Checking your account…
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(24px,5vw,64px) clamp(16px,3vw,24px)' }}>
      <div
        className="rounded-2xl border p-6 sm:p-8 shadow-xl"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 border"
          style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
        >
          <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M5.6 5.6l12.8 12.8" />
          </svg>
        </div>

        <h1 className="text-2xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
          Account suspended
        </h1>
        <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
          {BAN_SUMMARY}
        </p>
        <p className="text-xs leading-relaxed mb-1" style={{ color: 'var(--text-tertiary)' }}>
          {BAN_DETAIL}
        </p>
        {from && (
          <p className="text-xs mb-1 font-mono" style={{ color: 'var(--text-muted)' }}>
            {from} is not available while the suspension is in place.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-6">
          <a
            href="/"
            className="px-4 py-2.5 rounded-xl text-xs font-black border transition hover:brightness-110"
            style={{ background: 'var(--accent-strong)', borderColor: 'var(--accent)', color: 'var(--text-on-accent, #000)' }}
          >
            Browse the catalog
          </a>
          <a
            href="/store"
            className="px-4 py-2.5 rounded-xl text-xs font-bold border transition hover:brightness-110"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Official store
          </a>
          <a
            href="/profile"
            className="px-4 py-2.5 rounded-xl text-xs font-bold border transition hover:brightness-110"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            My account
          </a>
          <button
            type="button"
            onClick={leave}
            disabled={signingOut}
            className="px-4 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}
