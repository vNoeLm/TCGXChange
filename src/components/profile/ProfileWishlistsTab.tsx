import { useMemo, useState } from 'react';
import { getAuthHeaders } from '../../lib/p2pClient';
import { useLanguage } from '../../lib/i18n';
import { useCurrency } from '../../lib/currency';
import { GAMES } from '../../lib/constants';
import { cardThumbProps } from '../../lib/supabase';
import { useCardValueData, valueOfCard } from '../../lib/cardValues';
import { setWishlistPublic, wishlistCopies, type Wishlist } from '../../lib/wishlists';

export interface ProfileWishlistCardDetail {
  id: string;
  name: string;
  card_number: string;
  set_id?: string | null;
  set_name?: string | null;
  set_code?: string | null;
  rarity?: string | null;
  game: string;
  image_path?: string | null;
  market_price_eur?: number | null;
  market_price_foil_eur?: number | null;
  metadata?: Record<string, any> | null;
}

interface ProfileWishlistsTabProps {
  targetUserId: string;
  targetDisplayName: string;
  isMe: boolean;
  viewerUserId: string | null;
  loading: boolean;
  wishlists: Wishlist[];
  cardsById: Map<string, ProfileWishlistCardDetail>;
  onVisibilityChanged: (wishlistId: string, isPublic: boolean) => void;
  onOpenCardPreview?: (card: ProfileWishlistCardDetail) => void;
  onRequireAuth: () => void;
  onToast: (msg: string, type?: 'info' | 'error') => void;
}

function formatCardCodeLabel(card: ProfileWishlistCardDetail): string {
  const num = String(card.card_number || '').trim();
  const code = String(card.set_code || '').trim();
  if (!num) return code;
  if (code && !num.toUpperCase().startsWith(code.toUpperCase())) {
    return `${code}-${num}`;
  }
  return num;
}

export function ProfileWishlistsTab({
  targetUserId,
  targetDisplayName,
  isMe,
  viewerUserId,
  loading,
  wishlists,
  cardsById,
  onVisibilityChanged,
  onOpenCardPreview,
  onRequireAuth,
  onToast,
}: ProfileWishlistsTabProps) {
  const { t, lang } = useLanguage();
  const { formatPrice } = useCurrency();
  const values = useCardValueData();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const visibleLists = useMemo(() => {
    if (isMe) return wishlists;
    return wishlists.filter((w) => w.is_public);
  }, [wishlists, isMe]);

  const activeList = useMemo(() => {
    if (visibleLists.length === 0) return null;
    return visibleLists.find((w) => w.id === selectedId) || visibleLists[0];
  }, [visibleLists, selectedId]);

  const gameLabelMap = useMemo(() => new Map<string, string>(GAMES.map((g) => [g.id, g.label])), []);

  const wantedEntries = useMemo(() => {
    if (!activeList?.items) return [];
    const grouped = new Map<
      string,
      {
        cardId: string;
        card: ProfileWishlistCardDetail | undefined;
        normalQty: number;
        foilQty: number;
      }
    >();

    for (const [key, rawQty] of Object.entries(activeList.items)) {
      const qty = Number(rawQty) || 0;
      if (qty <= 0) continue;
      const isFoil = key.endsWith('_foil');
      const cardId = isFoil ? key.slice(0, -5) : key;
      const entry = grouped.get(cardId) || {
        cardId,
        card: cardsById.get(cardId),
        normalQty: 0,
        foilQty: 0,
      };
      if (isFoil) entry.foilQty += qty;
      else entry.normalQty += qty;
      grouped.set(cardId, entry);
    }

    const q = searchQuery.trim().toLowerCase();
    return Array.from(grouped.values())
      .filter((item) => {
        if (!q) return true;
        const c = item.card;
        if (!c) return false;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.card_number || '').toLowerCase().includes(q) ||
          (c.set_code || '').toLowerCase().includes(q) ||
          (c.set_name || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const na = a.card?.card_number || a.cardId;
        const nb = b.card?.card_number || b.cardId;
        return na.localeCompare(nb, undefined, { numeric: true });
      });
  }, [activeList, cardsById, searchQuery]);

  const handleToggleVisibility = async (list: Wishlist) => {
    const nextPublic = !list.is_public;
    setTogglingId(list.id);
    try {
      const saved = await setWishlistPublic(list.id, nextPublic);
      onVisibilityChanged(list.id, saved);
      onToast(
        saved
          ? t('Wishlist is now public on your profile.', 'A kívánságlista mostantól nyilvános a profilodon.')
          : t('Wishlist is now private.', 'A kívánságlista mostantól privát.')
      );
    } catch (err: any) {
      onToast(err?.message || t('Could not update visibility.', 'Nem sikerült módosítani a láthatóságot.'), 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleOneClickMessage = async (card: ProfileWishlistCardDetail, normalQty: number, foilQty: number) => {
    if (!activeList) return;
    if (!viewerUserId) {
      onRequireAuth();
      return;
    }
    const actionKey = card.id;
    setSendingKey(actionKey);
    try {
      const code = formatCardCodeLabel(card);
      const codeStr = code ? ` (${code})` : '';
      const variantHint =
        lang === 'hu'
          ? foilQty > 0 && normalQty === 0
            ? ' [Foil]'
            : normalQty > 0 && foilQty > 0
              ? ' [Normál / Foil]'
              : ''
          : foilQty > 0 && normalQty === 0
            ? ' [Foil]'
            : normalQty > 0 && foilQty > 0
              ? ' [Normal / Foil]'
              : '';

      const message =
        lang === 'hu'
          ? `Szia! Láttam a kívánságlistádon a(z) ${card.name}${codeStr}${variantHint} lapot — nálam van belőle, érdekelne még?`
          : `Hi! I saw ${card.name}${codeStr}${variantHint} on your wishlist — I have it available, are you still looking for it?`;

      const headers = await getAuthHeaders();
      const res = await fetch('/api/marketplace/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          seller_id: targetUserId,
          wishlist_id: activeList.id,
          message,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !json?.conversation_id) {
        throw new Error(json?.error || t('Could not send message.', 'Nem sikerült elküldeni az üzenetet.'));
      }
      window.location.href = `/messages?conversation=${encodeURIComponent(json.conversation_id)}`;
    } catch (err: any) {
      onToast(err?.message || t('Could not start chat.', 'Nem sikerült megnyitni a beszélgetést.'), 'error');
    } finally {
      setSendingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="h-32 rounded-xl border animate-pulse"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          />
        ))}
      </div>
    );
  }

  if (visibleLists.length === 0) {
    return (
      <div
        className="rounded-2xl p-10 text-center border mb-8"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <p className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          {isMe
            ? t('You have no wishlists yet.', 'Még nincs kívánságlistád.')
            : lang === 'hu'
              ? `${targetDisplayName} jelenleg nem osztott meg nyilvános kívánságlistát.`
              : `${targetDisplayName} has not shared any public wishlists yet.`}
        </p>
        {isMe && (
          <a
            href="/wishlists"
            className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-xl text-xs font-bold border transition hover:brightness-110"
            style={{ background: 'var(--accent-strong)', borderColor: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            <span>{t('Manage Wishlists', 'Kívánságlisták kezelése')}</span>
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="mb-8 space-y-5">
      {/* Wishlist Switcher + Visibility Control */}
      <div
        className="rounded-2xl p-4 border flex flex-col gap-3"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {visibleLists.map((list) => {
              const selected = activeList?.id === list.id;
              const gameLabel = gameLabelMap.get(list.game) || list.game;
              const copies = wishlistCopies(list.items);
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => setSelectedId(list.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition inline-flex items-center gap-2 ${
                    selected
                      ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-sm'
                      : 'bg-[var(--bg-surface-2)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {isMe && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: list.is_public ? 'var(--positive)' : 'var(--text-muted)' }}
                      title={list.is_public ? t('Public', 'Nyilvános') : t('Private', 'Privát')}
                    />
                  )}
                  <span>{list.name}</span>
                  <span className="text-[10px] font-semibold opacity-75">{gameLabel}</span>
                  <span
                    className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                  >
                    {copies}
                  </span>
                </button>
              );
            })}
          </div>

          {isMe && activeList && (
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => handleToggleVisibility(activeList)}
                disabled={togglingId === activeList.id}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition hover:brightness-110 inline-flex items-center gap-1.5 disabled:opacity-50"
                style={
                  activeList.is_public
                    ? { background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }
                    : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                }
              >
                {activeList.is_public ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
                <span>
                  {activeList.is_public ? t('Public on profile', 'Nyilvános a profilon') : t('Private', 'Privát')}
                </span>
              </button>
              <a
                href={`/wishlists?list=${encodeURIComponent(activeList.id)}`}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border transition hover:brightness-110 inline-flex items-center gap-1.5"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <span>{t('Edit List', 'Lista szerkesztése')}</span>
              </a>
            </div>
          )}
        </div>

        {/* Filter bar inside active list */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <svg
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-tertiary)' }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('Filter cards in this wishlist…', 'Kártyák szűrése a kívánságlistában…')}
              className="w-full h-9 pl-9 pr-3 rounded-xl text-xs border outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
          {!isMe && activeList && (
            <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {t(
                'Have one of these cards? Click Message to contact the collector directly.',
                'Van valamelyikből eladó vagy cseréd? Kattints az Üzenet gombra a gyors kapcsolatfelvételhez.'
              )}
            </span>
          )}
        </div>
      </div>

      {/* Wanted Cards Grid */}
      {wantedEntries.length === 0 ? (
        <div
          className="rounded-2xl p-8 text-center border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
            {t('No matching cards on this wishlist.', 'Nincs találat ezen a kívánságlistán.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {wantedEntries.map(({ cardId, card, normalQty, foilQty }) => {
            if (!card) return null;
            const thumb = cardThumbProps(card.image_path || null);
            const code = formatCardCodeLabel(card);
            const unitHuf = valueOfCard(card as any, foilQty > 0 && normalQty === 0, values).valueHuf;
            const busy = sendingKey === card.id;

            return (
              <div
                key={card.id}
                className="rounded-xl p-3 border flex items-center gap-3.5 transition hover:border-[var(--accent-border)]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <button
                  type="button"
                  onClick={() => (onOpenCardPreview ? onOpenCardPreview(card) : (window.location.href = `/card?id=${encodeURIComponent(card.id)}`))}
                  className="w-16 aspect-[5/7] rounded-lg overflow-hidden shrink-0 border cursor-pointer bg-black/20"
                  style={{ borderColor: 'var(--border-subtle)' }}
                  title={card.name}
                >
                  {thumb.src && (
                    <img
                      src={thumb.src}
                      srcSet={thumb.srcSet}
                      alt={card.name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>

                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="min-w-0">
                    <a
                      href={`/card?id=${encodeURIComponent(card.id)}`}
                      className="text-sm font-black truncate block hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {card.name}
                    </a>
                    <div className="flex items-center gap-2 text-[11px] font-semibold flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                      {code && <span className="font-mono">{code}</span>}
                      {unitHuf !== null && (
                        <span className="font-bold" style={{ color: 'var(--positive)' }}>
                          {formatPrice(unitHuf)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {normalQty > 0 && (
                      <span
                        className="px-2 py-0.5 rounded-md text-[11px] font-bold border"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        {t('Normal', 'Normál')} × {normalQty}
                      </span>
                    )}
                    {foilQty > 0 && (
                      <span
                        className="px-2 py-0.5 rounded-md text-[11px] font-bold border"
                        style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                      >
                        Foil × {foilQty}
                      </span>
                    )}
                  </div>

                  {!isMe && (
                    <button
                      type="button"
                      onClick={() => handleOneClickMessage(card, normalQty, foilQty)}
                      disabled={busy}
                      className="mt-0.5 px-3 py-1.5 rounded-lg text-xs font-black cursor-pointer transition hover:brightness-110 inline-flex items-center justify-center gap-1.5 disabled:opacity-50 self-start"
                      style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                    >
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <span>{busy ? t('Sending…', 'Küldés…') : t('I have this · Message', 'Van ilyenem · Üzenet')}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
