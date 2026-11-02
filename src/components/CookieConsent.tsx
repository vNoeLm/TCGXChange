import { useEffect, useState } from 'react';
import { useExitTransition } from '../lib/useExitTransition';
import { useLanguage } from '../lib/i18n';

const CONSENT_KEY = 'tcgxchange_cookie_consent';

/**
 * A one-time notice on first visit. Everything the site stores (collection, theme, sign-in) is
 * essential to it working - there are no ads or analytics trackers - so this is an acknowledgement
 * rather than a set of toggles. Accepting is remembered in this browser.
 */
export function CookieConsent() {
  const { t } = useLanguage();
  const [needsConsent, setNeedsConsent] = useState(false);
  const anim = useExitTransition(needsConsent, 400);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY) && !localStorage.getItem('tcg_vault_cookie_consent')) setNeedsConsent(true);
    } catch {
      // Storage blocked: nothing could be remembered either way, so there is nothing to ask about.
    }
  }, []);

  if (!anim.rendered) return null;

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true, at: new Date().toISOString() }));
    } catch {
      // Still dismiss it for this visit.
    }
    setNeedsConsent(false);
  };

  return (
    <div
      role="dialog"
      aria-label={t('Cookie notice', 'Sütikről szóló tájékoztató')}
      data-state={anim.state}
      className="tv-toast fixed left-3 right-3 sm:left-4 sm:right-auto bottom-24 sm:bottom-20 z-[45] sm:max-w-sm rounded-2xl border p-4 shadow-2xl backdrop-blur-md"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center border"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
          aria-hidden="true"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-5-5z" />
            <circle cx="8.5" cy="12.5" r="0.6" fill="currentColor" />
            <circle cx="12" cy="16" r="0.6" fill="currentColor" />
            <circle cx="15.5" cy="13" r="0.6" fill="currentColor" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
            {t('Cookies and local storage', 'Sütik és helyi tárhely')}
          </h2>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t(
              'TCG XChange uses strictly necessary browser storage for your sign-in session, collection, cart, and theme. There are no ads or analytics trackers.',
              'A TCG XChange kizárólag a működéshez elengedhetetlen böngészőtárhelyet használ a bejelentkezéshez, a gyűjteményhez, a kosárhoz és a témához. Nincsenek hirdetési vagy analitikai követők.',
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={accept}
              className="px-4 h-9 rounded-xl text-xs font-black cursor-pointer transition"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
            >
              {t('Got it', 'Rendben')}
            </button>
            <a
              href="/legal/cookies"
              className="text-xs font-bold underline underline-offset-2 cursor-pointer"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {t('Cookies', 'Sütik')}
            </a>
            <a
              href="/legal/privacy"
              className="text-xs font-bold underline underline-offset-2 cursor-pointer"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {t('Privacy', 'Adatkezelés')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
