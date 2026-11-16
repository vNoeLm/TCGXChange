import { useEffect, useMemo, useState } from 'react';
import { CARD_CONDITIONS, formatCondition } from '../../lib/collectionDefaults';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { parseWantList, planPurchase, type ShopStrategy } from '../../lib/quickShop';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { createHoldRequest, type P2PListing } from '../../lib/p2pClient';
import { useWishlists, wishlistCopies, wishlistWantText } from '../../lib/wishlists';
import type { InventoryCard } from '../../types';

interface QuickBuyModalProps {
  listings: P2PListing[];
  currentUserId: string | null;
  onClose: () => void;
  onSuccess: (conversationId: string) => void;
}

export function QuickBuyModal({ listings, currentUserId, onClose, onSuccess }: QuickBuyModalProps) {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();
  useBodyScrollLock(true);

  const { lists: wishlists, loading: loadingWishlists } = useWishlists();
  const [sourceMode, setSourceMode] = useState<'wishlist' | 'paste'>('wishlist');
  const [selectedWishlistId, setSelectedWishlistId] = useState<string>('');
  const [loadingWishlistText, setLoadingWishlistText] = useState(false);

  const [wantText, setWantText] = useState('');
  const [strategy, setStrategy] = useState<ShopStrategy>('cheapest');
  const [minCondition, setMinCondition] = useState('Any');
  const [allowFoilSubstitute, setAllowFoilSubstitute] = useState(true);
  const [submittingSellerId, setSubmittingSellerId] = useState<string | null>(null);
  const [sentSellers, setSentSellers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!loadingWishlists && wishlists.length > 0 && !selectedWishlistId) {
      const firstNonEmpty = wishlists.find((w) => wishlistCopies(w.items) > 0) || wishlists[0];
      if (firstNonEmpty) setSelectedWishlistId(firstNonEmpty.id);
    }
  }, [loadingWishlists, wishlists, selectedWishlistId]);

  useEffect(() => {
    if (sourceMode !== 'wishlist' || !selectedWishlistId) return;
    const chosen = wishlists.find((w) => w.id === selectedWishlistId);
    if (!chosen) return;
    let cancelled = false;
    setLoadingWishlistText(true);
    wishlistWantText(chosen)
      .then((txt) => {
        if (!cancelled) setWantText(txt);
      })
      .catch(() => {
        if (!cancelled) setWantText('');
      })
      .finally(() => {
        if (!cancelled) setLoadingWishlistText(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceMode, selectedWishlistId, wishlists]);

  const adaptedListings: InventoryCard[] = useMemo(
    () =>
      listings.map((l) => ({
        inventory_id: l.id,
        card_id: l.card_id,
        name: l.card.name,
        card_number: l.card.card_number,
        image_path: l.card.image_path,
        rarity: l.card.rarity,
        card_type: l.card.card_type || '',
        set_id: l.card.set_id || '',
        set_name: l.card.sets?.name || '',
        condition: l.condition,
        is_foil: l.is_foil,
        price_huf: l.price_huf,
        quantity: l.quantity,
        status: l.status,
        seller_id: l.seller_id,
        seller_name: l.seller.display_name,
        seller_avatar: l.seller.avatar_url,
        seller_country: l.seller.country,
      })) as unknown as InventoryCard[],
    [listings]
  );

  const wants = useMemo(() => parseWantList(wantText), [wantText]);
  const plans = useMemo(() => {
    if (wants.length === 0) return null;
    return planPurchase(wants, adaptedListings, {
      minCondition,
      allowFoilSubstitute,
      excludeSellerId: currentUserId,
    });
  }, [wants, adaptedListings, minCondition, allowFoilSubstitute, currentUserId]);

  const activePlan = plans ? plans[strategy] : null;
  const missingLines = activePlan ? activePlan.lines.filter((l) => l.foundQty < l.want.qty) : [];

  const handleHoldBasket = async (sellerId: string) => {
    if (!activePlan) return;
    const basket = activePlan.baskets.find((b) => b.sellerId === sellerId);
    if (!basket || basket.items.length === 0) return;
    setSubmittingSellerId(sellerId);
    setError(null);
    try {
      const res = await createHoldRequest({
        mode: 'listings_batch',
        items: basket.items.map((it) => ({
          listing_id: it.listing.inventory_id,
          quantity: it.qty,
        })),
      });
      setSentSellers((prev) => new Set([...prev, sellerId]));
      if (activePlan.baskets.length === 1) {
        onSuccess(res.conversation_id);
      }
    } catch (err: any) {
      setError(err?.message || t('Hold request failed.', 'Sikertelen félretétel.'));
    } finally {
      setSubmittingSellerId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl max-h-[92vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="px-5 py-3.5 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-base font-black flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span>{t('Quick Buy', 'Gyors vásárlás')}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close', 'Bezárás')}
            className="w-8 h-8 rounded-xl border flex items-center justify-center hover:bg-[var(--bg-raised)] cursor-pointer shrink-0"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Source Switcher: Wishlist (Default) vs Paste List */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl border self-start" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => setSourceMode('wishlist')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                sourceMode === 'wishlist' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              {t('From Wishlist', 'Kívánságlistából')}
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('paste')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                sourceMode === 'paste' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)]' : 'text-[var(--text-secondary)]'
              }`}
            >
              {t('Paste List', 'Lista beillesztése')}
            </button>
          </div>

          {sourceMode === 'wishlist' ? (
            loadingWishlists ? (
              <div className="h-12 rounded-xl animate-pulse" style={{ background: 'var(--bg-surface-2)' }} />
            ) : wishlists.length === 0 ? (
              <div
                className="p-5 rounded-xl border flex flex-col sm:flex-row items-center justify-between gap-3"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
              >
                <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                  {t('You have no wishlists yet.', 'Még nincs egyetlen kívánságlistád sem.')}
                </span>
                <a
                  href="/wishlists"
                  className="px-4 py-2 rounded-xl text-xs font-black shrink-0"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                >
                  {t('+ New Wishlist', '+ Új kívánságlista')}
                </a>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <select
                  value={selectedWishlistId}
                  onChange={(e) => setSelectedWishlistId(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 rounded-xl border text-xs font-bold outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  {wishlists.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({wishlistCopies(w.items)} {t('cards', 'lap')})
                    </option>
                  ))}
                </select>
                <a
                  href="/wishlists"
                  className="px-3.5 py-2.5 rounded-xl border text-xs font-bold text-center hover:border-[var(--accent)] shrink-0"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}
                >
                  {t('+ New Wishlist', '+ Új kívánságlista')}
                </a>
              </div>
            )
          ) : (
            <textarea
              rows={5}
              value={wantText}
              onChange={(e) => setWantText(e.target.value)}
              placeholder={t(
                'Paste decklist or card list:\n3x Riptide Mage\n2x The Waters\' Wage [RAD-100/167]',
                'Illeszd be a kívánt kártyalistát:\n3x Riptide Mage\n2x The Waters\' Wage [RAD-100/167]'
              )}
              className="w-full px-3.5 py-2.5 rounded-xl border text-xs font-mono outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          )}

          {loadingWishlistText && (
            <div className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {t('Loading wishlist cards...', 'Kívánságlista betöltése...')}
            </div>
          )}

          {sourceMode === 'wishlist' && !loadingWishlistText && wishlists.length > 0 && wants.length === 0 && (
            <div className="px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-2" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              <span>{t('This wishlist is empty.', 'Ez a kívánságlista jelenleg üres.')}</span>
              <a href="/wishlists" className="font-bold hover:underline" style={{ color: 'var(--text-accent)' }}>
                {t('Manage Wishlists', 'Kezelés')} →
              </a>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-center">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setStrategy('cheapest')}
                className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  strategy === 'cheapest' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                {t('Cheapest', 'Legolcsóbb')}
              </button>
              <button
                type="button"
                onClick={() => setStrategy('fewest_sellers')}
                className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  strategy === 'fewest_sellers' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                {t('Fewest Sellers', 'Kevés eladó')}
              </button>
            </div>

            <select
              value={minCondition}
              onChange={(e) => setMinCondition(e.target.value)}
              className="px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <option value="Any">{t('Any Condition', 'Bármilyen állapot')}</option>
              {CARD_CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {t('Min:', 'Min:')} {formatCondition(c.id, lang)}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={allowFoilSubstitute}
                onChange={(e) => setAllowFoilSubstitute(e.target.checked)}
                className="rounded accent-[var(--accent)]"
              />
              <span style={{ color: 'var(--text-secondary)' }}>{t('Allow Foil', 'Foil is jó')}</span>
            </label>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-300">
              {error}
            </div>
          )}

          {activePlan && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-3 py-2 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                  {t('Found:', 'Találat:')} {activePlan.copiesFound} / {activePlan.copiesWanted} · {activePlan.baskets.length} {t('sellers', 'eladó')}
                </span>
                <span className="text-base font-black text-emerald-400">
                  {formatPrice(activePlan.totalCost)}
                </span>
              </div>

              {activePlan.baskets.map((basket) => {
                const alreadySent = sentSellers.has(basket.sellerId);
                return (
                  <div
                    key={basket.sellerId}
                    className="p-3.5 rounded-xl border flex flex-col gap-2"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
                          {basket.sellerName}
                        </span>
                        <span className="ml-2 text-xs font-bold text-emerald-400">
                          {formatPrice(basket.subtotal)}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={alreadySent || submittingSellerId === basket.sellerId}
                        onClick={() => handleHoldBasket(basket.sellerId)}
                        className="px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
                        style={{
                          background: alreadySent ? '#10b981' : 'var(--accent-strong)',
                          color: '#09090b',
                        }}
                      >
                        {alreadySent
                          ? t('Hold Sent', 'Félretéve')
                          : submittingSellerId === basket.sellerId
                          ? t('Sending...', 'Küldés...')
                          : t(`Hold (${basket.copies})`, `Félretétel (${basket.copies})`)}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {basket.items.map((it) => (
                        <span
                          key={it.listing.inventory_id}
                          className="text-[11px] px-2 py-0.5 rounded-lg border"
                          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                        >
                          {it.qty}x {it.listing.name} ({formatPrice(it.listing.price_huf)})
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}

              {missingLines.length > 0 && (
                <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
                  <span className="font-bold">{t('Not found:', 'Nem elérhető:')} </span>
                  {missingLines.map((m) => `${m.want.qty - m.foundQty}x ${m.want.name || m.want.number}`).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
