import { useEffect, useState } from 'react';
import { getCurrentProfile, onSignedInUserChange } from '../lib/auth';
import { getBanDetail, getBanSummary, isRestrictedPath } from '../lib/accountAccess';
import { useLanguage } from '../lib/i18n';
import type { UserProfile } from '../types';

const linkStyle: React.CSSProperties = {
  background: 'var(--bg-raised)',
  borderColor: 'var(--border)',
  color: 'var(--text-secondary)',
};

/**
 * Shows a suspension notice for a banned account: a strip on the pages it may still use, and a
 * full-page notice on the marketplace, seller hub and messages, which it may not. Those three
 * pages also redirect to /banned, so a link or a bookmark does not get around the ban.
 */
export function AccountAccessGate({ currentPath }: { currentPath: string }) {
  const { t, lang } = useLanguage();
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = () => {
      getCurrentProfile()
        .then((next) => alive && setProfile(next))
        .catch(() => alive && setProfile(null));
    };
    load();
    const off = onSignedInUserChange(() => load());
    return () => {
      alive = false;
      off();
    };
  }, []);

  const banned = profile?.is_banned === true;
  const restricted = isRestrictedPath(currentPath);
  const onBannedPage = currentPath.startsWith('/banned');

  useEffect(() => {
    if (!banned || !restricted || onBannedPage) return;
    window.location.replace(`/banned?from=${encodeURIComponent(currentPath)}`);
  }, [banned, restricted, onBannedPage, currentPath]);

  if (!banned || onBannedPage) return null;

  if (restricted) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="fixed inset-0 flex items-center justify-center p-5"
        style={{ zIndex: 200, background: 'var(--bg-page)' }}
      >
        <div
          className="w-full max-w-lg rounded-2xl border p-6 sm:p-7 shadow-2xl"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border"
            style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M5.6 5.6l12.8 12.8" />
            </svg>
          </div>
          <h2 className="text-xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
            {t('Account suspended', 'Fiók felfüggesztve')}
          </h2>
          <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
            {getBanSummary(lang)}
          </p>
          <p className="text-xs leading-relaxed mb-5" style={{ color: 'var(--text-tertiary)' }}>
            {getBanDetail(lang)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/" className="px-4 py-2 rounded-xl text-xs font-bold border transition hover:brightness-110" style={linkStyle}>
              {t('Browse the catalog', 'Katalógus böngészése')}
            </a>
            <a href="/store" className="px-4 py-2 rounded-xl text-xs font-bold border transition hover:brightness-110" style={linkStyle}>
              {t('Official store', 'Hivatalos áruház')}
            </a>
            <a href="/banned" className="px-4 py-2 rounded-xl text-xs font-bold border transition hover:brightness-110" style={linkStyle}>
              {t('Details', 'Részletek')}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap"
      style={{ background: 'var(--negative-muted)', borderBottom: '1px solid var(--negative-border)' }}
    >
      <span className="text-xs sm:text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
        {getBanSummary(lang)}
      </span>
      <a href="/banned" className="text-xs font-bold px-3 py-1 rounded-lg border transition cursor-pointer hover:brightness-110 shrink-0" style={linkStyle}>
        {t('Details', 'Részletek')}
      </a>
    </div>
  );
}
