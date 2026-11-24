import React, { useMemo, useState } from 'react';
import { CONTACT_EMAIL, DISCORD_USERNAME, LEGAL_PAGES, HELP_PAGES } from '../lib/site';
import { useLanguage } from '../lib/i18n';
import { useSiteFlags } from '../lib/siteFlags';
import { TcgLogo } from './TcgLogo';

type FooterLink = { label: string; labelHu?: string; href?: string; action?: 'request_product' };

const COMPANY_LEGAL_HREFS = new Set(['/legal/terms', '/legal/impressum', '/legal/withdrawal']);

const iconProps = { className: 'w-4 h-4', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

const iconBox = 'w-8 h-8 rounded-lg border flex items-center justify-center transition';

/**
 * The site footer: community links, contact, and publisher IP notices.
 * Commercial/store links and official company legal pages are shown only when enabled in site flags.
 */
export function LegalFooter() {
  const { isHu, t } = useLanguage();
  const siteFlags = useSiteFlags();

  const footerColumns = useMemo(() => {
    const showCommercial = siteFlags.store_public || siteFlags.official_company_info;
    const exploreLinks: FooterLink[] = [
      { label: 'Catalog', labelHu: 'Katalógus', href: '/' },
      ...(siteFlags.p2p_public ? [{ label: 'Marketplace', labelHu: 'Piactér', href: '/marketplace' }] : []),
      ...(siteFlags.store_public ? [{ label: 'Store', labelHu: 'Bolt', href: '/store' }] : []),
      { label: 'Wishlists', labelHu: 'Kívánságlisták', href: '/wishlists' },
      { label: 'Decks', labelHu: 'Paklik', href: '/decks' },
    ];

    const cols: { title: string; titleHu: string; links: FooterLink[] }[] = [
      { title: 'Explore', titleHu: 'Felfedezés', links: exploreLinks },
    ];

    if (showCommercial) {
      const supportLinks: FooterLink[] = [
        ...(siteFlags.store_public ? [{ label: 'Store Support', labelHu: 'Ügyfélszolgálat', href: '/support' }] : []),
        ...HELP_PAGES,
      ];
      if (supportLinks.length > 0) {
        cols.push({ title: 'Support', titleHu: 'Támogatás', links: supportLinks });
      }
    }

    const helpLinks: FooterLink[] = [
      ...(showCommercial ? [{ label: 'Request a Product', labelHu: 'Termék igénylése', action: 'request_product' as const }] : []),
      { label: 'Contact us', labelHu: 'Kapcsolat', href: `mailto:${CONTACT_EMAIL}` },
    ];
    cols.push({ title: 'Help', titleHu: 'Segítség', links: helpLinks });

    const visibleLegal = siteFlags.official_company_info
      ? LEGAL_PAGES
      : LEGAL_PAGES.filter((p) => !COMPANY_LEGAL_HREFS.has(p.href));
    cols.push({ title: 'Legal', titleHu: 'Jogi információk', links: visibleLegal });

    return cols;
  }, [siteFlags.p2p_public, siteFlags.store_public, siteFlags.official_company_info]);
  // Discord has no link for a person, only a username - so the button copies it.
  const [copied, setCopied] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [reqProductName, setReqProductName] = useState('');
  const [reqGameOrBrand, setReqGameOrBrand] = useState('');
  const [reqEmail, setReqEmail] = useState('');
  const [reqNotes, setReqNotes] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqStatus, setReqStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const submitProductRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqProductName.trim()) return;
    setReqSubmitting(true);
    setReqStatus(null);
    try {
      const res = await fetch('/api/store/product-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: reqProductName.trim(),
          game_or_brand: reqGameOrBrand.trim(),
          email: reqEmail.trim(),
          notes: reqNotes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setReqStatus({
          ok: true,
          msg: t(
            'Thank you! Your product request has been sent to our store team.',
            'Köszönjük! A termékigénylést továbbítottuk a Store csapatunknak.'
          ),
        });
        setReqProductName('');
        setReqGameOrBrand('');
        setReqNotes('');
      } else {
        setReqStatus({ ok: false, msg: data.error || t('Could not submit request.', 'Nem sikerült elküldeni az igénylést.') });
      }
    } catch {
      setReqStatus({ ok: false, msg: t('Network error submitting request.', 'Hálózati hiba történt a küldés során.') });
    } finally {
      setReqSubmitting(false);
    }
  };

  const copyDiscord = async () => {
    try {
      await navigator.clipboard.writeText(DISCORD_USERNAME);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Discord username', DISCORD_USERNAME);
    }
  };

  return (
    <footer
      data-nosnippet=""
      className="mt-auto border-t"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-header)',
        color: 'var(--text-tertiary)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
        <div
          className={`grid grid-cols-2 ${
            footerColumns.length === 4
              ? 'md:grid-cols-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]'
              : 'md:grid-cols-3 lg:grid-cols-[1.8fr_1fr_1fr_1fr]'
          } gap-x-6 gap-y-7`}
        >
          <div className={`col-span-2 ${footerColumns.length === 4 ? 'md:col-span-4' : 'md:col-span-3'} lg:col-span-1 min-w-0`}>
            <div className="flex items-center gap-2 mb-1.5">
              <TcgLogo className="w-6 h-6 shrink-0" />
              <span className="inline-flex items-baseline text-base font-black tracking-tight" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                TCG XChange<span className="text-[#f97316] font-bold text-xs ml-0.5">.net</span>
              </span>
              <span className="text-[11px] font-semibold">© {new Date().getFullYear()}</span>
            </div>
            <p className="text-xs leading-relaxed max-w-xs mb-3">
              {t(
                'Unofficial community TCG catalog, collection tracker, and deck builder. Not affiliated with any game publisher.',
                'Független közösségi TCG katalógus, gyűjteménykezelő és paklikészítő. Nem áll kapcsolatban a játékkiadókkal.'
              )}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                aria-label={`Email ${CONTACT_EMAIL}`}
                title={CONTACT_EMAIL}
                className={`${iconBox} hover:text-[var(--text-primary)]`}
                style={{ borderColor: 'var(--border)' }}
              >
                <svg {...iconProps}>
                  <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" />
                </svg>
              </a>
              <button
                type="button"
                onClick={copyDiscord}
                aria-label={`Discord: ${DISCORD_USERNAME} - copy username`}
                title={`Discord: ${DISCORD_USERNAME} (click to copy)`}
                className="tv-touch-target min-h-8 py-1.5 px-2 rounded-lg border inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer transition hover:text-[var(--text-primary)]"
                style={{ borderColor: 'var(--border)' }}
              >
                <svg {...iconProps}>
                  <path d="M8.5 17.5c-2.4-.5-4.3-1.4-5.5-2.6.3-3.6 1.3-6.6 3-9.1 1.3-.6 2.6-1 4-1.2l.6 1.1a9.6 9.6 0 012.8 0l.6-1.1c1.4.2 2.7.6 4 1.2 1.7 2.5 2.7 5.5 3 9.1-1.2 1.2-3.1 2.1-5.5 2.6l-1-1.6" />
                  <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
                </svg>
                <span>{copied ? t('Copied', 'Másolva') : DISCORD_USERNAME}</span>
              </button>
            </div>
          </div>

          {footerColumns.map((col) => {
            const colTitle = isHu ? col.titleHu : col.title;
            return (
              <nav key={col.title} aria-label={colTitle} className="min-w-0">
                <h3 className="text-[11px] font-black uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-primary)' }}>{colTitle}</h3>
                <ul className="flex flex-col gap-1.5">
                  {col.links.map((link) => {
                    const linkText = isHu && link.labelHu ? link.labelHu : link.label;
                    return (
                      <li key={link.label} className="text-xs">
                        {link.action === 'request_product' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setReqStatus(null);
                              setRequestModalOpen(true);
                            }}
                            className="hover:text-[var(--text-primary)] hover:underline underline-offset-2 transition cursor-pointer text-left"
                          >
                            {linkText}
                          </button>
                        ) : link.href ? (
                          <a href={link.href} className="hover:text-[var(--text-primary)] hover:underline underline-offset-2 transition">{linkText}</a>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 opacity-70" aria-disabled="true">
                            {linkText}
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded border" style={{ borderColor: 'var(--border)' }}>
                              {t('Soon', 'Hamarosan')}
                            </span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </nav>
            );
          })}
        </div>

        {/* Dedicated publisher & IP disclaimers section below a full-width divider */}
        <div data-nosnippet="" className="mt-7 pt-5 border-t space-y-1.5" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            <strong className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Riftbound:</strong>{' '}
            TCG XChange was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            <strong className="font-semibold" style={{ color: 'var(--text-secondary)' }}>One Piece Card Game:</strong>{' '}
            One Piece Card Game images, card text, and related marks are property of Bandai Co., Ltd. ©Eiichiro Oda/Shueisha ©Eiichiro Oda/Shueisha, Toei Animation. TCG XChange is not affiliated with or endorsed by Bandai, Shueisha, or Toei Animation.
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            <strong className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Disney Lorcana:</strong>{' '}
            Disney Lorcana artwork, text, characters, and related marks are property of Disney and Ravensburger. ©Disney. ©Ravensburger. TCG XChange is not affiliated with or endorsed by Disney or Ravensburger.
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            <strong className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Star Wars: Unlimited:</strong>{' '}
            Star Wars: Unlimited and related marks are property of Lucasfilm Ltd. and Fantasy Flight Games. TM &amp; © Lucasfilm Ltd. © Fantasy Flight Games. TCG XChange is not affiliated with or endorsed by Lucasfilm Ltd., Disney, or Fantasy Flight Games.
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            <strong className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Flesh and Blood:</strong>{' '}
            Flesh and Blood TCG is a trademark and copyright of Legend Story Studios. All card images and text are © Legend Story Studios. TCG XChange is not affiliated with or endorsed by Legend Story Studios.
          </p>
        </div>
      </div>

      {requestModalOpen && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-xs" onClick={() => !reqSubmitting && setRequestModalOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('Request a Product', 'Termék igénylése')}
            className="relative z-10 w-full max-w-md rounded-2xl border p-5 shadow-2xl space-y-4"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>{t('Request a Product', 'Termék igénylése')}</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    "Looking for a booster box, playmat, sleeve or deck box we don't carry yet? Let us know!",
                    'Keresel egy adott booster boxot, playmatet, kártyavédőt vagy paklitartót, amit még nem látsz a kínálatban? Írd meg nekünk!'
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRequestModalOpen(false)}
                aria-label={t('Close', 'Bezárás')}
                className="p-1.5 rounded-lg border cursor-pointer hover:bg-[var(--bg-raised)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {reqStatus && (
              <div
                className="p-3 rounded-xl border text-xs font-medium"
                style={
                  reqStatus.ok
                    ? { background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }
                    : { background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }
                }
              >
                {reqStatus.msg}
              </div>
            )}

            <form onSubmit={submitProductRequest} className="space-y-3">
              <label className="block">
                <span className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>{t('Product name *', 'Termék neve *')}</span>
                <input
                  required
                  value={reqProductName}
                  onChange={(e) => setReqProductName(e.target.value)}
                  placeholder="e.g. Ultimate Guard Katana Sleeves Red (100)"
                  className="w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </label>
              <label className="block">
                <span className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>{t('Game or Brand (optional)', 'Játék vagy Márka (opcionális)')}</span>
                <input
                  value={reqGameOrBrand}
                  onChange={(e) => setReqGameOrBrand(e.target.value)}
                  placeholder="e.g. Riftbound, One Piece, Dragon Shield..."
                  className="w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </label>
              <label className="block">
                <span className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>{t('Notes / Quantity desired (optional)', 'Megjegyzés / Kívánt mennyiség (opcionális)')}</span>
                <textarea
                  rows={2}
                  value={reqNotes}
                  onChange={(e) => setReqNotes(e.target.value)}
                  placeholder={t('Any specific color, edition, or quantity...', 'Szín, kiadás vagy kívánt darabszám...')}
                  className="w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRequestModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  {t('Close', 'Bezárás')}
                </button>
                <button
                  type="submit"
                  disabled={reqSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {reqSubmitting ? t('Sending...', 'Küldés...') : t('Submit Request', 'Igénylés küldése')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </footer>
  );
}
