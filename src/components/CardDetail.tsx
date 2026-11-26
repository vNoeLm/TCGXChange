import React, { useState, useEffect, useRef } from 'react';
import type { CatalogCard, UserProfile } from '../types';
import { fetchCardOnly, clearApiCache } from '../lib/api';
import { getCardImageUrl } from '../lib/supabase';
import { getCurrentProfile, isProfileAdmin, canModerateGame } from '../lib/auth';
import { parseDomains, getEnergyBadgeStyle, DOMAIN_STYLES } from '../lib/domainColors';
import { LorcanaInkIcon, LorcanaInkableIcon, LORCANA_INK_COLORS } from '../lib/lorcanaIcons';
import { Toast } from './ui/Toast';
import { CardUpdateModal } from './cards/CardUpdateModal';
import { CardEditorModal } from './admin/CardEditorModal';
import { GAMES } from '../lib/constants';
import { getCardErrataEntries, getCardLegalityMap, getLegalityBadgeStyle, type CardUpdateType } from '../lib/cardUpdates';

const RARITY_COLORS: Record<string, { bg: string; text: string; glow: string }> = {
  Common:          { bg: "rgba(31, 41, 55, 0.9)", text: "#cbd5e1", glow: "rgba(203, 213, 225, 0.2)" },
  Uncommon:        { bg: "rgba(12, 74, 110, 0.9)", text: "#38bdf8", glow: "rgba(56, 189, 248, 0.4)" },
  Rare:            { bg: "rgba(88, 28, 135, 0.9)", text: "#d8b4fe", glow: "rgba(216, 180, 254, 0.5)" },
  Epic:            { bg: "rgba(154, 52, 18, 0.9)", text: "#fb923c", glow: "rgba(251, 146, 60, 0.5)" },
  Showcase:        { bg: "rgba(180, 83, 9, 0.85)", text: "#fef08a", glow: "rgba(250, 204, 21, 0.6)" },
  "Super Rare":    { bg: "rgba(154, 52, 18, 0.9)", text: "#fb923c", glow: "rgba(251, 146, 60, 0.5)" },
  "Secret Rare":   { bg: "rgba(180, 83, 9, 0.85)", text: "#fef08a", glow: "rgba(250, 204, 21, 0.6)" },
  Leader:          { bg: "rgba(127, 29, 29, 0.9)", text: "#fca5a5", glow: "rgba(239, 68, 68, 0.5)" },
  "Treasure Rare": { bg: "rgba(13, 148, 136, 0.9)", text: "#99f6e4", glow: "rgba(45, 212, 191, 0.5)" },
  Promo:           { bg: "rgba(190, 24, 93, 0.9)", text: "#fbcfe8", glow: "rgba(236, 72, 153, 0.45)" },
  Legendary:       { bg: "rgba(180, 83, 9, 0.9)", text: "#fde68a", glow: "rgba(245, 158, 11, 0.55)" },
  Enchanted:       { bg: "rgba(157, 23, 77, 0.9)", text: "#fbcfe8", glow: "rgba(236, 72, 153, 0.6)" },
  Iconic:          { bg: "rgba(14, 116, 144, 0.9)", text: "#a5f3fc", glow: "rgba(56, 189, 248, 0.6)" },
  Special:         { bg: "rgba(107, 33, 168, 0.9)", text: "#e9d5ff", glow: "rgba(168, 85, 247, 0.5)" },
};

const ONEPIECE_RARITY_CODES: Record<string, string> = {
  common: 'C',
  uncommon: 'UC',
  rare: 'R',
  'super rare': 'SR',
  'secret rare': 'SEC',
  leader: 'L',
  'treasure rare': 'TR',
  promo: 'P',
  special: 'SP',
};

const ONEPIECE_ATTRIBUTE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  strike:  { bg: 'rgba(217, 119, 6, 0.2)',  text: '#fbbf24', border: 'rgba(245, 158, 11, 0.55)' },
  slash:   { bg: 'rgba(14, 165, 233, 0.2)', text: '#38bdf8', border: 'rgba(56, 189, 248, 0.55)' },
  ranged:  { bg: 'rgba(16, 185, 129, 0.2)', text: '#34d399', border: 'rgba(52, 211, 153, 0.55)' },
  special: { bg: 'rgba(168, 85, 247, 0.2)', text: '#c084fc', border: 'rgba(192, 132, 252, 0.55)' },
  wisdom:  { bg: 'rgba(59, 130, 246, 0.2)', text: '#60a5fa', border: 'rgba(96, 165, 250, 0.55)' },
};

function OnePieceAttributeIcon({ attr }: { attr: string }) {
  const key = attr.trim().toLowerCase();
  if (key === 'slash') {
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14.5 17.5L3 6V3h3l11.5 11.5" /><path d="M13 19l6-6" /><path d="M16 16l4 4" /><path d="M19 21l2-2" />
      </svg>
    );
  }
  if (key === 'ranged') {
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
    );
  }
  if (key === 'special') {
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z" />
      </svg>
    );
  }
  if (key === 'wisdom') {
    return (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

import { formatGameText, splitCardTitle, formatCleanCardNumber } from '../lib/formatGameText';
import { TYPE_ICONS, RUNE_ICONS, RARITY_ICONS } from '../lib/riftboundIcons';
import { isOvernumbered, isSigned, isAltArt, isPromoCard, getDisplaySetLabel } from '../lib/cardVariants';
import { getCardPowerRequirement } from '../lib/cardPowerData';
import { isNeutralCard } from '../lib/riftboundRules';
import { supabase } from '../lib/supabase';
import { CardImageViewer } from './CardImageViewer';
import { useUrlOverlay } from '../lib/useUrlOverlay';
import { AuthModal } from './auth/AuthModal';
import { CardValuePanel } from './CardValuePanel';
import { MoveCardModal } from './collection/MoveCardModal';
import { WishlistControls } from './wishlists/WishlistControls';
import { hasFoilVariant } from '../lib/cardVariants';
import { saveLocalCollection } from '../lib/collectionClient';
import { PERSONAL_COLLECTION_ID } from '../lib/collectionDefaults';
import {
  useCollectionsStore,
  activeNamedCollection,
  changeCollectionCard,
  isCombinedCollection,
  mergeCollectionCards,
  getCardCollectionBreakdown,
} from '../lib/collectionsStore';
import { printLanguage } from '../lib/cardPreview';
import { useCurrency } from '../lib/currency';
import { useLanguage } from '../lib/i18n';
import { STORE_PUBLIC_LAUNCH } from '../lib/storeConstants';
import { isP2PEnabledFor } from '../lib/p2pConstants';
import { useSiteFlags } from '../lib/siteFlags';
import { fetchListings } from '../lib/p2pClient';
import { getCardmarketSearchUrl } from '../lib/cardmarketUrls';

export function CardDetail({ inventoryId, cardId, onClose }: { inventoryId?: string, cardId?: string, onClose?: () => void }) {
  const { formatPrice } = useCurrency();
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [swuSide, setSwuSide] = useState<'front' | 'back'>('front');
  // The image on its own, full screen, where it can be rotated (?view=full, so Back closes it).
  const [fullView, openFullView, closeFullView] = useUrlOverlay('view');
  // Personal, from this browser; the tracker shows whichever collection is active in the catalog.
  const [personalCollection, setCollection] = useState<Record<string, number>>({});
  const collectionsStore = useCollectionsStore();
  const isCombined = isCombinedCollection(collectionsStore);
  const activeNamed = activeNamedCollection(collectionsStore);
  const collection = isCombined
    ? mergeCollectionCards(personalCollection, collectionsStore.collections)
    : activeNamed
    ? activeNamed.cards
    : personalCollection;
  const personalDisplayName =
    collectionsStore.personalSettings?.name && collectionsStore.personalSettings.name !== 'Personal'
      ? collectionsStore.personalSettings.name
      : t('Personal', 'Személyes');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [storeSingle, setStoreSingle] = useState<{ slug: string; price_huf: number; stock_quantity: number; condition?: string; is_foil?: boolean } | null>(null);
  const [p2pSummary, setP2pSummary] = useState<{ offerCount: number; lowestPriceHuf: number } | null>(null);
  const [moveToast, setMoveToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const moveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLocalToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (moveToastTimerRef.current) clearTimeout(moveToastTimerRef.current);
    setMoveToast({ msg, type });
    moveToastTimerRef.current = setTimeout(() => setMoveToast(null), 3500);
  };

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [cardUpdateModalTab, setCardUpdateModalTab] = useState<CardUpdateType | null>(null);
  const [cardEditorOpen, setCardEditorOpen] = useState(false);

  useEffect(() => {
    const loadCollection = () => {
      const saved = localStorage.getItem("tcg_user_collection") || localStorage.getItem("tcg_collection");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const dict: Record<string, number> = {};
            parsed.forEach((id: string) => { if (typeof id === 'string') dict[id] = 1; });
            setCollection(dict);
          } else if (parsed && typeof parsed === 'object') {
            setCollection(parsed);
          }
        } catch (e) {}
      }
    };
    loadCollection();

    const handleColChange = (e: Event) => {
      const custom = e as CustomEvent<{ collection: Record<string, number> }>;
      if (custom.detail?.collection) setCollection(custom.detail.collection);
    };
    window.addEventListener('tcg-collection-change', handleColChange);

    getCurrentProfile().then(p => setProfile(p));

    return () => {
      window.removeEventListener('tcg-collection-change', handleColChange);
    };
  }, []);

  const handleUpdateCount = (targetCardId: string, isFoil: boolean, delta: number) => {
    if (!targetCardId || isCombined) return;
    const targetKey = isFoil ? `${targetCardId}_foil` : targetCardId;
    if (activeNamed) {
      changeCollectionCard(activeNamed.id, targetKey, delta);
      return;
    }
    const next = { ...personalCollection };
    const current = next[targetKey] || 0;
    const updated = current + delta;
    if (updated <= 0) {
      delete next[targetKey];
    } else {
      next[targetKey] = updated;
    }
    setCollection(next);
    saveLocalCollection(next);
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const resolvedCardId = cardId || inventoryId || searchParams.get('card_id') || searchParams.get('card') || searchParams.get('id');

    if (resolvedCardId) {
      setLoading(true);
      setSwuSide('front');
      fetchCardOnly(resolvedCardId)
        .then(row => {
          setData({ cards: row });
          const first = row?.image_path;
          if (first) setActiveUrl(getCardImageUrl(first));
          setLoading(false);
        })
        .catch(() => { setError('Card not found.'); setLoading(false); });
    } else {
      setError('No ID provided.'); setLoading(false);
    }
  }, [inventoryId, cardId]);

  const siteFlags = useSiteFlags();

  useEffect(() => {
    const cid = data?.cards?.id;
    if (!siteFlags.store_public || !cid) {
      setStoreSingle(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('store_products')
      .select('slug, price_huf, stock_quantity, attributes')
      .eq('category', 'singles')
      .eq('status', 'active')
      .gt('stock_quantity', 0)
      .filter('attributes->>card_id', 'eq', String(cid))
      .order('price_huf', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(
        ({ data: row }) => {
          if (cancelled) return;
          if (row) {
            setStoreSingle({
              slug: row.slug,
              price_huf: Number(row.price_huf),
              stock_quantity: Number(row.stock_quantity),
              condition: row.attributes?.condition,
              is_foil: Boolean(row.attributes?.is_foil),
            });
          } else {
            setStoreSingle(null);
          }
        },
        () => {
          if (!cancelled) setStoreSingle(null);
        }
      );
    return () => {
      cancelled = true;
    };
  }, [data?.cards?.id, siteFlags.store_public]);

  const p2pEnabled = isP2PEnabledFor(isProfileAdmin(profile), siteFlags.p2p_public);
  useEffect(() => {
    const cid = data?.cards?.id;
    if (!p2pEnabled || !cid) {
      setP2pSummary(null);
      return;
    }
    let cancelled = false;
    fetchListings({ view: 'all_listings', card_id: String(cid) })
      .then((res) => {
        if (cancelled) return;
        const list = res.listings || [];
        if (list.length === 0) {
          setP2pSummary(null);
          return;
        }
        const minPrice = Math.min(...list.map((l) => l.price_huf));
        setP2pSummary({ offerCount: list.length, lowestPriceHuf: minPrice });
      })
      .catch(() => {
        if (!cancelled) setP2pSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [data?.cards?.id, p2pEnabled]);

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60dvh' }}>
      <span style={{ color:'var(--accent-light)' }}>Loading…</span>
    </div>
  );
  if (error || !data) return (
    <div style={{ maxWidth:600, margin:'80px auto', textAlign:'center' }}>
      <p style={{ color:'var(--text-muted)' }}>{error || 'Not found.'}</p>
      <BackLink />
    </div>
  );

  const card = data.cards;
  const domainValue = card.domain || 'Colorless';
  const parsedDomains = parseDomains(card.domain);
  const isNeutral = isNeutralCard(card);
  const shownDomains = isNeutral ? parsedDomains.map(d => ({ ...d, key: 'neutral', name: 'Neutral' })) : parsedDomains;
  const rarityStyle = RARITY_COLORS[card.rarity] ?? RARITY_COLORS.Common;

  return (
    <div className={`w-full mx-auto relative ${onClose ? 'p-4 sm:p-6 lg:p-8' : 'px-4 sm:px-6 py-6 sm:py-10 max-w-6xl 2xl:max-w-[1400px]'}`}>
      <style>{`
        @keyframes foilShine {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      <BackLink onClose={onClose} />

      <div className="grid grid-cols-1 lg:grid-cols-[clamp(280px,38%,440px)_1fr] 2xl:grid-cols-[clamp(300px,26%,380px)_1fr] gap-6 sm:gap-8 lg:gap-12 items-start">

        {/* ── Left: image column ── */}
        <div className="w-full max-w-[280px] xs:max-w-[320px] sm:max-w-[360px] lg:max-w-none mx-auto">
          {/* Main display */}
          <div 
            style={{
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border)',
            }}
            className="rounded-xl overflow-hidden relative p-3 sm:p-4 flex items-center justify-center mb-3"
          >
            {activeUrl ? (
              <div 
                className="relative z-10 w-full rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => openFullView('full')}
                  className="group block w-full cursor-zoom-in"
                  aria-label={`View ${card.name} full screen`}
                  title={t('Full view', 'Teljes képernyős nézet')}
                >
                  <img
                    src={activeUrl}
                    alt={card.name}
                    className="w-full h-auto block rounded-xl transition-transform duration-300 group-hover:scale-[1.015]"
                    onError={() => {
                      const fallback = card?.image_path ? getCardImageUrl(card.image_path) : null;
                      if (fallback && activeUrl !== fallback) {
                        setActiveUrl(fallback);
                      }
                    }}
                  />
                  <span
                    className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-full flex items-center justify-center opacity-80 group-hover:opacity-100 transition shadow-md"
                    style={{ background: 'rgba(15,23,42,0.85)', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.2)' }}
                    aria-hidden="true"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 3 21 3 21 9" />
                      <polyline points="9 21 3 21 3 15" />
                      <line x1="21" y1="3" x2="14" y2="10" />
                      <line x1="3" y1="21" x2="10" y2="14" />
                    </svg>
                  </span>
                </button>
              </div>
            ) : (
              <div className="relative z-10 text-center text-zinc-400 py-10">
                <div className="text-6xl font-black bg-gradient-to-br from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                  {card.name.split(' ').map((w: string) => w[0]).join('').slice(0,2)}
                </div>
                <div className="text-xs mt-2 font-medium">{t('No image uploaded', 'Nincs feltöltött kép')}</div>
              </div>
            )}
          </div>

          {activeUrl && (
            <CardImageViewer
              src={activeUrl}
              alt={card.name}
              open={fullView === 'full'}
              onClose={closeFullView}
              landscapeCard={(card.card_type || '').toLowerCase() === 'battlefield'}
            />
          )}
        </div>

        {/* ── Right: info column (two columns side by side on a wide screen) ── */}
        <div className="w-full min-w-0 2xl:grid 2xl:grid-cols-2 2xl:gap-x-5 2xl:items-start">
          {/* Card Header Banner */}
          <div className="2xl:col-span-2 mb-4">
            <div className="min-w-0 flex flex-col items-center text-center">
              <div className="flex items-center justify-center gap-2 flex-wrap mb-1">
                {card.game === 'onepiece' ? (
                  <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                    {[
                      card.card_number ? formatCleanCardNumber(card.card_number, card.game, card.set_code || card.sets?.code) : null,
                      card.rarity ? (ONEPIECE_RARITY_CODES[card.rarity.toLowerCase()] || card.rarity.toUpperCase()) : null,
                      card.card_type ? card.card_type.toUpperCase() : null,
                    ].filter(Boolean).join(' | ')}
                  </span>
                ) : (
                  <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                    {getDisplaySetLabel(card) || 'Base Set'}
                    {card.card_number ? ` · #${formatCleanCardNumber(card.card_number, card.game, card.set_code || card.sets?.code)}` : ''}
                  </span>
                )}
              </div>

              {(() => {
                const { main, sub } = splitCardTitle(card.name);
                const versionSub =
                  card.game === 'lorcana'
                    ? (card.metadata?.version || sub)
                    : card.game === 'starwars'
                    ? (card.metadata?.subtitle || sub)
                    : sub;
                return (
                  <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight tracking-tight uppercase" style={{ color: 'var(--text-primary)' }}>
                      {versionSub ? main : card.name}
                    </h1>
                    {versionSub && (
                      <p className="text-xs sm:text-sm font-extrabold uppercase tracking-[0.18em] leading-snug mt-0.5" style={{ color: 'var(--text-accent)' }}>
                        {card.game === 'lorcana' ? `Version: ${versionSub}` : versionSub}
                      </p>
                    )}
                  </div>
                );
              })()}

              {printLanguage(card.name) && (
                <p className="text-[11px] font-semibold mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {printLanguage(card.name)} {t('print - official English text shown below.', 'nyomat – alább a hivatalos angol szöveg látható.')}
                </p>
              )}
            </div>
          </div>

            <>
              <div className="min-w-0">
              <div 
                className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5 mb-4"
                style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)' }}
              >
                {(card.rarity || isPromoCard(card) || isSigned(card) || isOvernumbered(card) || isAltArt(card)) && (
                  <div className="flex items-center justify-between gap-2 flex-wrap pb-2.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                    {card.rarity && (() => {
                      const isRiftbound = !card.game || card.game === 'riftbound';
                      const isShowcase = (card.rarity || '').toLowerCase() === 'showcase';
                      const rarityKey = (card.rarity || '').toLowerCase();
                      const rarityIcon = isRiftbound ? RARITY_ICONS[rarityKey] : null;
                      return (
                        <span
                          style={{
                            background: isShowcase
                              ? 'rgba(180, 83, 9, 0.25)'
                              : rarityStyle.bg,
                            color: isShowcase ? '#fef08a' : rarityStyle.text,
                            borderColor: isShowcase ? 'rgba(250, 204, 21, 0.5)' : `${rarityStyle.text}44`,
                          }}
                          className="inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-0.5 rounded-lg border uppercase tracking-wider"
                        >
                          {rarityIcon && <img src={rarityIcon} alt={card.rarity} className="w-3.5 h-3.5 object-contain" />}
                          <span>{card.rarity}</span>
                        </span>
                      );
                    })()}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isPromoCard(card) && (card.rarity || '').toLowerCase() !== 'promo' && (
                        <span
                          title="Promo"
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-pink-500/15 border border-pink-500/40 text-pink-200 uppercase tracking-wider"
                        >
                          <span>Promo</span>
                        </span>
                      )}
                      {isSigned(card) && (
                        <span
                          title={t('Signed Edition', 'Aláírt kiadás')}
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-purple-500/15 border border-purple-500/40 text-purple-200 uppercase tracking-wider"
                        >
                          <span>{t('Signed', 'Aláírt')}</span>
                        </span>
                      )}
                      {(!card.game || card.game === 'riftbound') && isOvernumbered(card) && (
                        <span
                          title="Overnumbered"
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 uppercase tracking-wider"
                        >
                          <span>Overnumbered</span>
                        </span>
                      )}
                      {isAltArt(card) && (
                        <span
                          title="Alt Art"
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-pink-500/15 border border-pink-500/40 text-pink-200 uppercase tracking-wider"
                        >
                          <span>Alt Art</span>
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {card.game === 'onepiece' ? (() => {
                  const isLeader = (card.card_type || '').toLowerCase() === 'leader';
                  const opCostLabel = isLeader ? 'Life' : 'Cost';
                  const opCostValue = card.cost != null ? String(card.cost) : '-';
                  const rawAttr = card.attribute ?? card.metadata?.attribute ?? null;
                  const opAttrParts = rawAttr ? String(rawAttr).split(/[/,&]+/).map((s: string) => s.trim()).filter(Boolean) : [];
                  const rawPower = card.might != null ? String(card.might).trim() : '';
                  const opPowerValue = /^\d+$/.test(rawPower) ? rawPower : '-';
                  const rawCounter = card.counter ?? card.metadata?.counter ?? null;
                  const opCounterValue = rawCounter !== null && rawCounter !== undefined && rawCounter !== '' ? String(rawCounter) : '-';
                  const rawBlock = card.block_icon ?? card.metadata?.block_icon ?? null;
                  const opBlockValue = rawBlock !== null && rawBlock !== undefined && rawBlock !== '' ? String(rawBlock) : '-';
                  const opTypeText = card.subtype
                    ? card.subtype.split(/[/,]+/).map((s: string) => s.trim()).filter(Boolean).join('/')
                    : '-';
                  const opEffect = card.effect || card.text || '';
                  const opTrigger = card.metadata?.trigger && card.metadata.trigger !== '-' ? String(card.metadata.trigger) : '';
                  const opIllustration = card.illustration_type || card.metadata?.illustration_type || '';
                  const opSetName = card.sets?.name || card.set_name || '-';
                  const opColors = parseDomains(card.domain);

                  return (
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-2 divide-y sm:divide-y-0" style={{ borderColor: 'var(--border-subtle)' }}>
                        {/* Cost / Life */}
                        <div className="py-3 px-3.5 rounded-tl-xl border-b flex items-center justify-between gap-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{opCostLabel}</span>
                          <span className="text-base font-black font-mono" style={{ color: 'var(--text-primary)' }}>{opCostValue}</span>
                        </div>

                        {/* Attribute */}
                        <div className="py-3 px-3.5 rounded-tr-xl border-b border-l flex items-center justify-between gap-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Attribute</span>
                          {opAttrParts.length > 0 ? (
                            <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                              {opAttrParts.map((attrName) => {
                                const style = ONEPIECE_ATTRIBUTE_COLORS[attrName.toLowerCase()] || { bg: 'var(--bg-surface)', text: 'var(--text-primary)', border: 'var(--border)' };
                                return (
                                  <span key={attrName} className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold px-2.5 py-0.5 rounded-full border" style={{ background: style.bg, color: style.text, borderColor: style.border }}>
                                    <OnePieceAttributeIcon attr={attrName} />
                                    <span>{attrName}</span>
                                  </span>
                                );
                              })}
                            </span>
                          ) : (
                            <span className="text-base font-black" style={{ color: 'var(--text-primary)' }}>-</span>
                          )}
                        </div>

                        {/* Power */}
                        <div className="py-3 px-3.5 border-b flex items-center justify-between gap-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Power</span>
                          <span className="text-base font-black font-mono" style={{ color: opPowerValue === '-' ? 'var(--text-secondary)' : 'var(--text-accent)' }}>{opPowerValue}</span>
                        </div>

                        {/* Counter */}
                        <div className="py-3 px-3.5 border-b border-l flex items-center justify-between gap-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Counter</span>
                          <span className="text-base font-black font-mono" style={{ color: 'var(--text-primary)' }}>{opCounterValue}</span>
                        </div>

                        {/* Color */}
                        <div className="py-3 px-3.5 rounded-bl-xl flex items-center justify-between gap-2" style={{ background: 'var(--bg-input)' }}>
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Color</span>
                          {card.domain ? (
                            <span className="inline-flex items-center gap-2 flex-wrap justify-end">
                              {opColors.map((dc) => (
                                <span key={dc.key} className="inline-flex items-center gap-1.5 text-sm sm:text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                                  <span className="w-3 h-3 rounded-full border border-white/30 shrink-0" style={{ background: dc.bg }} />
                                  <span>{dc.name}</span>
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>-</span>
                          )}
                        </div>

                        {/* Block icon */}
                        <div className="py-3 px-3.5 rounded-br-xl border-l flex items-center justify-between gap-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Block icon</span>
                          {opBlockValue !== '-' ? (
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-sm font-black font-mono border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                              {opBlockValue}
                            </span>
                          ) : (
                            <span className="text-base font-black" style={{ color: 'var(--text-secondary)' }}>-</span>
                          )}
                        </div>
                      </div>

                      {/* Type */}
                      <div className="rounded-xl p-3.5 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                        <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Type</div>
                        <div className="text-sm sm:text-base font-bold" style={{ color: 'var(--text-primary)' }}>{opTypeText}</div>
                      </div>

                      {/* Effect (and optional Trigger) */}
                      {(opEffect || opTrigger) && (
                        <div className="rounded-xl p-3.5 border space-y-3" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          {opEffect && (
                            <div>
                              <div className="text-xs font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-accent)' }}>Effect</div>
                              <div className="text-sm sm:text-base leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(opEffect) }} />
                            </div>
                          )}
                          {opTrigger && (
                            <div className={opEffect ? 'pt-3 border-t' : ''} style={{ borderColor: 'var(--border-subtle)' }}>
                              <div className="text-xs font-black uppercase tracking-wider mb-1.5 text-amber-400">Trigger</div>
                              <div className="text-sm sm:text-base leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(opTrigger) }} />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Card Set(s) & Illustration Type */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className={`rounded-xl p-3 border ${opIllustration ? '' : 'sm:col-span-2'}`} style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Card Set(s)</div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{opSetName}</div>
                        </div>
                        {opIllustration && (
                          <div className="rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Illustration Type</div>
                            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{opIllustration}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : card.game === 'starwars' ? (() => {
                  const meta = card.metadata || {};
                  const swuAspects: string[] = Array.isArray(meta.aspects) && meta.aspects.length > 0
                    ? meta.aspects
                    : (card.domain || '')
                        .split(/[/,]+/)
                        .map((s: string) => s.trim())
                        .filter(Boolean);
                  const swuTypes: string[] = Array.isArray(meta.types) && meta.types.length > 0
                    ? meta.types
                    : (card.card_type ? [card.card_type] : []);
                  const swuArenas: string[] = Array.isArray(meta.arenas) ? meta.arenas : [];
                  const swuTraits: string[] = Array.isArray(meta.traits) && meta.traits.length > 0
                    ? meta.traits
                    : (card.subtype ? card.subtype.split(/[,/•·]+/).map((s: string) => s.trim()).filter(Boolean) : []);
                  const swuKeywords: string[] = Array.isArray(meta.keywords) ? meta.keywords : [];

                  const hpVal = card.might_bonus ?? meta.hp ?? null;
                  const powerVal = card.might ?? meta.power ?? null;
                  const upgradeHpVal = meta.upgrade_hp ?? null;
                  const upgradePowerVal = meta.upgrade_power ?? null;
                  const hasCost = card.cost != null && !swuTypes.includes('Base');
                  const collectorNumber = meta.collector_number || card.card_number || '-';
                  const setName = card.sets?.name || card.set_name || '-';

                  const frontBody = [meta.front_text, meta.epic_action].filter(Boolean).join('\n\n') || card.text || '';
                  const backBody = meta.back_text || card.ability || '';

                  const swuStatCards: Array<{ key: string; label: string; value: string | number; accent?: boolean }> = [];
                  if (hasCost) swuStatCards.push({ key: 'cost', label: t('Cost', 'Költség'), value: card.cost });
                  if (powerVal != null) swuStatCards.push({ key: 'power', label: t('Power', 'Erő'), value: powerVal, accent: true });
                  if (hpVal != null) swuStatCards.push({ key: 'hp', label: 'HP', value: hpVal });
                  if (upgradePowerVal != null) {
                    swuStatCards.push({
                      key: 'upgPower',
                      label: 'Upgrade Power',
                      value: Number(upgradePowerVal) > 0 ? `+${upgradePowerVal}` : upgradePowerVal,
                      accent: true,
                    });
                  }
                  if (upgradeHpVal != null) {
                    swuStatCards.push({
                      key: 'upgHp',
                      label: 'Upgrade HP',
                      value: Number(upgradeHpVal) > 0 ? `+${upgradeHpVal}` : upgradeHpVal,
                    });
                  }
                  const swuStatGridCls =
                    swuStatCards.length >= 5 ? 'grid-cols-2 sm:grid-cols-5' :
                    swuStatCards.length === 4 ? 'grid-cols-2 sm:grid-cols-4' :
                    swuStatCards.length === 3 ? 'grid-cols-3' :
                    swuStatCards.length === 2 ? 'grid-cols-2' : 'grid-cols-1';

                  const hasDoubleSide = Boolean(meta.art_back || backBody);
                  const activeSideBody = hasDoubleSide
                    ? (swuSide === 'back' ? backBody : frontBody)
                    : (frontBody || backBody);
                  const activeSideLabel = hasDoubleSide
                    ? (swuSide === 'back' ? t('Reverse side card text', 'Hátlap szövege') : t('Front side card text', 'Előlap szövege'))
                    : t('Card Text', 'Kártyaszöveg');

                  return (
                    <div className="flex flex-col gap-2.5">
                      {/* Aspect(s), Type(s), Arena matching Riftbound Domain / Type tiles */}
                      <div className={`grid grid-cols-1 ${swuArenas.length > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2.5`}>
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            {swuAspects.length > 1 ? 'Aspect(s)' : 'Aspect'}
                          </div>
                          <div className="flex items-center gap-2 text-base font-black flex-wrap">
                            {swuAspects.length > 0 ? swuAspects.map((asp, idx) => {
                              const ds = DOMAIN_STYLES[asp] || DOMAIN_STYLES['No Aspect'];
                              return (
                                <span key={`${asp}-${idx}`} className="inline-flex items-center gap-1.5" style={{ color: ds.text }}>
                                  <span className="w-3 h-3 rounded-full shrink-0 border border-white/30" style={{ background: ds.dot }} />
                                  <span>{asp}</span>
                                  {idx < swuAspects.length - 1 && <span className="font-normal" style={{ color: 'var(--text-muted)' }}>/</span>}
                                </span>
                              );
                            }) : <span style={{ color: 'var(--text-primary)' }}>No Aspect</span>}
                          </div>
                        </div>

                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            {swuTypes.length > 1 ? 'Type(s)' : t('Type', 'Típus')}
                          </div>
                          <div className="text-base font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                            {swuTypes.join(', ') || '-'}
                          </div>
                        </div>

                        {swuArenas.length > 0 && (
                          <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                              Arena
                            </div>
                            <div className="text-base font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                              {swuArenas.join(', ')}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Cost / Power / HP / Upgrade Power / Upgrade HP Stat Grid */}
                      {swuStatCards.length > 0 && (
                        <div className={`grid ${swuStatGridCls} gap-2.5`}>
                          {swuStatCards.map((st) => (
                            <div
                              key={st.key}
                              className="border rounded-xl p-3 flex flex-col items-center justify-center text-center"
                              style={{
                                background: st.accent ? 'var(--accent-muted)' : 'var(--bg-input)',
                                borderColor: st.accent ? 'var(--accent-border)' : 'var(--border-subtle)',
                              }}
                            >
                              <div
                                className="text-xs font-black uppercase tracking-wider mb-0.5"
                                style={{ color: st.accent ? 'var(--text-accent)' : 'var(--text-tertiary)' }}
                              >
                                {st.label}
                              </div>
                              <div
                                className="text-2xl sm:text-3xl font-black font-mono"
                                style={{ color: st.accent ? 'var(--text-accent)' : 'var(--text-primary)' }}
                              >
                                {st.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Traits & Keywords matching Riftbound Címkék box */}
                      {(swuTraits.length > 0 || swuKeywords.length > 0) && (
                        <div className={`grid grid-cols-1 ${swuTraits.length > 0 && swuKeywords.length > 0 ? 'sm:grid-cols-2' : ''} gap-2.5`}>
                          {swuTraits.length > 0 && (
                            <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                              <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                Trait(s)
                              </div>
                              <div className="flex gap-1.5 flex-wrap">
                                {swuTraits.map((tr) => (
                                  <span
                                    key={tr}
                                    className="text-xs font-bold px-2.5 py-1 rounded-lg border uppercase tracking-wider"
                                    style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                                  >
                                    {tr}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {swuKeywords.length > 0 && (
                            <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                              <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                                Keyword(s)
                              </div>
                              <div className="flex gap-1.5 flex-wrap">
                                {swuKeywords.map((kw) => (
                                  <span
                                    key={kw}
                                    className="text-xs font-bold px-2.5 py-1 rounded-lg border uppercase tracking-wider"
                                    style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}
                                  >
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Unified Card Text Container (active Front or Back side only) */}
                      {(activeSideBody || hasDoubleSide) && (
                        <div className="rounded-xl p-3.5 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>
                              {activeSideLabel}
                            </div>
                            {hasDoubleSide && (
                              <div
                                className="inline-flex items-center gap-1 p-0.5 rounded-lg border"
                                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                              >
                                {(['front', 'back'] as const).map((side) => {
                                  const active = swuSide === side;
                                  return (
                                    <button
                                      key={side}
                                      type="button"
                                      onClick={() => {
                                        setSwuSide(side);
                                        const nextImg = side === 'back' ? (meta.art_back || card.image_path) : card.image_path;
                                        if (nextImg) setActiveUrl(getCardImageUrl(nextImg));
                                      }}
                                      className="px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition cursor-pointer"
                                      style={
                                        active
                                          ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                                          : { background: 'transparent', color: 'var(--text-secondary)' }
                                      }
                                    >
                                      {side === 'front' ? t('Front', 'Előlap') : t('Back', 'Hátlap')}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          {activeSideBody ? (
                            <div
                              className="text-sm sm:text-base leading-relaxed whitespace-pre-line"
                              style={{ color: 'var(--text-primary)' }}
                              dangerouslySetInnerHTML={{ __html: formatGameText(activeSideBody) }}
                            />
                          ) : (
                            <div className="text-sm italic" style={{ color: 'var(--text-muted)' }}>-</div>
                          )}
                        </div>
                      )}

                      {/* Set & Card Number Footer */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Set</div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{setName}</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Card Number</div>
                          <div className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{collectorNumber}</div>
                        </div>
                      </div>
                    </div>
                  );
                })() : card.game === 'fab' ? (() => {
                  const meta = card.metadata || {};
                  const pitchNum = card.energy != null && card.energy !== '' ? Number(card.energy) : (meta.pitch != null ? Number(meta.pitch) : null);
                  const pitchDotColor = pitchNum === 1 ? '#ef4444' : pitchNum === 2 ? '#eab308' : pitchNum === 3 ? '#3b82f6' : null;
                  const fabClasses: string[] = Array.isArray(meta.classes) ? meta.classes : [];
                  const fabTalents: string[] = Array.isArray(meta.talents) ? meta.talents : [];
                  const classTalentText = [...fabTalents, ...fabClasses].join(' ') || card.domain || 'Generic';
                  const typeLineText = meta.typebox || card.subtype || card.card_type || '-';

                  const attackVal = card.might ?? meta.attack ?? null;
                  const defenseVal = card.might_bonus ?? meta.defense ?? null;
                  const intellectVal = meta.intellect ?? null;
                  const lifeVal = meta.life ?? null;
                  const showCost = card.cost != null && !['Hero', 'Weapon'].includes(card.card_type);
                  const setName = card.sets?.name || card.set_name || '-';

                  const legalityMap: Record<string, string> = meta.legality && typeof meta.legality === 'object' ? meta.legality : {};
                  const legalityFormats = [
                    'Classic Constructed',
                    'Blitz',
                    'Silver Age',
                    'Commoner',
                    'Living Legend',
                    'Ultimate Pit Fight',
                  ];

                  const fabStatCards: Array<{ key: string; label: string; value: React.ReactNode; accent?: boolean }> = [];
                  if (pitchNum != null && !Number.isNaN(pitchNum)) {
                    fabStatCards.push({
                      key: 'pitch',
                      label: 'Pitch',
                      value: (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{pitchNum}</span>
                          <span className="inline-flex items-center gap-0.5">
                            {Array.from({ length: Math.min(Math.max(pitchNum, 1), 3) }).map((_, i) => (
                              <span key={i} className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: pitchDotColor || '#ef4444' }} />
                            ))}
                          </span>
                        </span>
                      ),
                    });
                  }
                  if (showCost) fabStatCards.push({ key: 'cost', label: t('Cost', 'Költség'), value: card.cost });
                  if (attackVal != null) fabStatCards.push({ key: 'atk', label: t('Attack', 'Támadás'), value: attackVal, accent: true });
                  if (defenseVal != null) fabStatCards.push({ key: 'def', label: t('Defense', 'Védekezés'), value: defenseVal });
                  if (intellectVal != null) fabStatCards.push({ key: 'int', label: 'Intellect', value: intellectVal });
                  if (lifeVal != null) fabStatCards.push({ key: 'life', label: 'Life', value: lifeVal, accent: true });

                  const fabStatGridCls =
                    fabStatCards.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' :
                    fabStatCards.length === 3 ? 'grid-cols-3' :
                    fabStatCards.length === 2 ? 'grid-cols-2' : 'grid-cols-1';

                  return (
                    <div className="flex flex-col gap-2.5">
                      {/* Class/Talent & Full Type Line matching Riftbound Domain/Type tiles */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            {t('Class / Talent', 'Osztály')}
                          </div>
                          <div className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
                            {classTalentText}
                          </div>
                        </div>

                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            {t('Type', 'Típus')}
                          </div>
                          <div className="text-base font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                            {typeLineText}
                          </div>
                        </div>
                      </div>

                      {/* Stat Tiles Grid (Pitch, Cost, Attack, Defense / Intellect, Life) */}
                      {fabStatCards.length > 0 && (
                        <div className={`grid ${fabStatGridCls} gap-2.5`}>
                          {fabStatCards.map((st) => (
                            <div
                              key={st.key}
                              className="border rounded-xl p-3 flex flex-col items-center justify-center text-center"
                              style={{
                                background: st.accent ? 'var(--accent-muted)' : 'var(--bg-input)',
                                borderColor: st.accent ? 'var(--accent-border)' : 'var(--border-subtle)',
                              }}
                            >
                              <div
                                className="text-xs font-black uppercase tracking-wider mb-0.5"
                                style={{ color: st.accent ? 'var(--text-accent)' : 'var(--text-tertiary)' }}
                              >
                                {st.label}
                              </div>
                              <div
                                className="text-2xl sm:text-3xl font-black font-mono"
                                style={{ color: st.accent ? 'var(--text-accent)' : 'var(--text-primary)' }}
                              >
                                {st.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Card Text Container */}
                      {card.text && (
                        <div className="rounded-xl p-3.5 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <div className="text-xs font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-accent)' }}>
                            {t('Card Text', 'Képesség')}
                          </div>
                          <div
                            className="text-sm sm:text-base leading-relaxed whitespace-pre-line"
                            style={{ color: 'var(--text-primary)' }}
                            dangerouslySetInnerHTML={{ __html: formatGameText(card.text) }}
                          />
                        </div>
                      )}

                      {/* Legality 6-format Grid (Classic Constructed, Blitz, Silver Age, Commoner, Living Legend, UPF) */}
                      {Object.keys(legalityMap).length > 0 && (
                        <div className="rounded-xl p-3.5 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-tertiary)' }}>
                            Legality
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
                            {legalityFormats.map((fmt) => {
                              const status = legalityMap[fmt] || 'Not legal';
                              const isLegal = status === 'Legal';
                              return (
                                <div key={fmt} className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                                  <span className="font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>{fmt}</span>
                                  <span
                                    className="px-2 py-0.5 rounded-md border text-xs font-bold shrink-0"
                                    style={
                                      isLegal
                                        ? { background: 'rgba(16, 185, 129, 0.14)', borderColor: 'rgba(16, 185, 129, 0.4)', color: '#34d399' }
                                        : { background: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.35)', color: '#fca5a5' }
                                    }
                                  >
                                    {status}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Set & Card Number Footer */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Set</div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{setName}</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Card Number</div>
                          <div className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{card.card_number || '-'}</div>
                        </div>
                      </div>
                    </div>
                  );
                })() : card.game === 'lorcana' ? (() => {
                  const meta = card.metadata || {};
                  const inkwellVal = meta.inkwell;
                  const inkColors = parseDomains(card.domain);
                  const classifications = card.subtype
                    ? card.subtype.split(/[•·,/]+/).map((s: string) => s.trim()).filter(Boolean)
                    : [];
                  const strVal = card.might ?? meta.strength ?? null;
                  const willVal = card.might_bonus ?? meta.willpower ?? null;
                  const moveVal = meta.move_cost ?? null;
                  const loreVal = card.energy ?? meta.lore ?? null;
                  const collectorNumber = meta.collector_number
                    ? String(meta.collector_number).replace(/\s*•\s*/g, ' ')
                    : (card.card_number || '-');
                  const legalFormatsList: string[] = Array.isArray(meta.legal_formats)
                    ? meta.legal_formats.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
                    : [];
                  const flavorText = meta.flavor_text ? String(meta.flavor_text).trim() : '';
                  const setName = card.sets?.name || card.set_name || '-';

                  const statCards: Array<{ key: string; label: string; value: string | number; accent?: boolean; gold?: boolean; icon: React.ReactNode }> = [
                    {
                      key: 'cost',
                      label: t('Ink Cost', 'Tintaköltség'),
                      value: card.cost ?? '-',
                      icon: <LorcanaInkableIcon inkable={inkwellVal === true} className="w-5 h-5 text-amber-300 shrink-0" />,
                    },
                  ];
                  if (strVal != null) {
                    statCards.push({
                      key: 'str',
                      label: t('Strength', 'Erő'),
                      value: strVal,
                      accent: true,
                      icon: (
                        <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                          <circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1l2.1-2.1M17 7l2.1-2.1" />
                        </svg>
                      ),
                    });
                  }
                  if (willVal != null) {
                    statCards.push({
                      key: 'will',
                      label: 'Willpower',
                      value: willVal,
                      icon: (
                        <svg className="w-5 h-5 text-sky-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      ),
                    });
                  }
                  if (moveVal != null) {
                    statCards.push({
                      key: 'move',
                      label: t('Movement', 'Mozgás'),
                      value: moveVal,
                      icon: (
                        <svg className="w-5 h-5 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      ),
                    });
                  }
                  if (loreVal != null) {
                    statCards.push({
                      key: 'lore',
                      label: 'Lore',
                      value: loreVal,
                      gold: true,
                      icon: (
                        <svg className="w-5 h-5 fill-current text-amber-400 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                          <polygon points="12,2 20,12 12,22 4,12" />
                        </svg>
                      ),
                    });
                  }
                  const statGridCls =
                    statCards.length === 4 ? 'grid-cols-2 sm:grid-cols-4' :
                    statCards.length === 3 ? 'grid-cols-3' :
                    statCards.length === 2 ? 'grid-cols-2' : 'grid-cols-1';

                  return (
                    <div className="flex flex-col gap-2.5">
                      {/* Identity Row matching Riftbound's Domain / Type boxes */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            {inkColors.length > 1 ? t('Ink Colors', 'Tinták') : t('Ink Color', 'Tinta')}
                          </div>
                          <div className="flex items-center gap-2 text-base font-black flex-wrap">
                            {inkColors.length > 0 ? inkColors.map((dc, idx) => {
                              const inkHex = LORCANA_INK_COLORS[dc.key.toLowerCase()] || dc.border;
                              return (
                                <span key={dc.key} className="inline-flex items-center gap-1.5" style={{ color: inkHex }}>
                                  <LorcanaInkIcon ink={dc.key} className="w-5 h-5 shrink-0" />
                                  <span>{dc.name}</span>
                                  {idx < inkColors.length - 1 && <span className="font-normal" style={{ color: 'var(--text-muted)' }}>/</span>}
                                </span>
                              );
                            }) : <span style={{ color: 'var(--text-primary)' }}>-</span>}
                          </div>
                        </div>

                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            {t('Card Type', 'Típus')}
                          </div>
                          <div className="flex items-center gap-2 text-base font-bold flex-wrap leading-snug" style={{ color: 'var(--text-primary)' }}>
                            <span>{card.card_type || '-'}</span>
                            {meta.special_rarity && (
                              <span
                                className="text-[11px] font-black px-2 py-0.5 rounded-lg border uppercase tracking-wider"
                                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                              >
                                {meta.special_rarity}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            Inkwell
                          </div>
                          <div
                            className="flex items-center gap-2 text-base font-bold"
                            style={{ color: inkwellVal === true ? '#fbbf24' : 'var(--text-primary)' }}
                          >
                            {typeof inkwellVal === 'boolean' ? (
                              <>
                                <LorcanaInkableIcon inkable={inkwellVal} className="w-5 h-5 shrink-0" />
                                <span>{inkwellVal ? t('Inkable', 'Tintázható') : t('Uninkable', 'Nem tintázható')}</span>
                              </>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>-</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Stat Tiles Grid matching Riftbound's big centered stat cards */}
                      <div className={`grid ${statGridCls} gap-2.5`}>
                        {statCards.map((st) => (
                          <div
                            key={st.key}
                            className="border rounded-xl p-3 flex flex-col items-center justify-center text-center"
                            style={{
                              background: st.gold ? 'rgba(234, 179, 8, 0.1)' : st.accent ? 'var(--accent-muted)' : 'var(--bg-input)',
                              borderColor: st.gold ? 'rgba(234, 179, 8, 0.3)' : st.accent ? 'var(--accent-border)' : 'var(--border-subtle)',
                            }}
                          >
                            <div
                              className="text-xs font-black uppercase tracking-wider mb-0.5"
                              style={{ color: st.gold ? '#fbbf24' : st.accent ? 'var(--text-accent)' : 'var(--text-tertiary)' }}
                            >
                              {st.label}
                            </div>
                            <div
                              className="text-2xl sm:text-3xl font-black font-mono flex items-center justify-center gap-1.5"
                              style={{ color: st.gold ? '#fde047' : st.accent ? 'var(--text-accent)' : 'var(--text-primary)' }}
                            >
                              <span>{st.value}</span>
                              {st.icon}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Classifications Box identical to Riftbound Tags */}
                      {classifications.length > 0 && (
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                            Classification
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            {classifications.map((cls: string) => (
                              <span
                                key={cls}
                                className="text-xs font-bold px-2.5 py-1 rounded-lg border uppercase tracking-wider"
                                style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                              >
                                {cls}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Ability / Card Text & Optional Flavor Text in one container (same pattern as Riftbound) */}
                      {(card.text || flavorText) && (
                        <div className="rounded-xl p-3.5 border space-y-3" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          {card.text && (
                            <div>
                              <div className="text-xs font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-accent)' }}>
                                {t('Card Text', 'Képesség')}
                              </div>
                              <div
                                className="text-sm sm:text-base leading-relaxed whitespace-pre-line"
                                style={{ color: 'var(--text-primary)' }}
                                dangerouslySetInnerHTML={{ __html: formatGameText(card.text) }}
                              />
                            </div>
                          )}
                          {flavorText && (
                            <div className={card.text ? 'pt-3 border-t' : ''} style={{ borderColor: 'var(--border-subtle)' }}>
                              <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                                {t('Flavor Text', 'Hangulatszöveg')}
                              </div>
                              <p className="text-sm italic leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                {flavorText}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Set, Collector Number & Legal Formats Metadata */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 rounded-xl p-3 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Set</div>
                          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{setName}</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Collector Number</div>
                          <div className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>{collectorNumber}</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Legal Formats</div>
                          {legalFormatsList.length > 0 ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {legalFormatsList.map((fmt) => (
                                <span
                                  key={fmt}
                                  className="px-2 py-0.5 rounded-lg border text-xs font-bold"
                                  style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.35)', color: '#34d399' }}
                                >
                                  {fmt}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                <>
                <div className="flex flex-col gap-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {card.game === 'mtg' && card.cost != null && (
                      <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                        <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('Mana Value', 'Mana érték')}</div>
                        <div className="text-base font-black" style={{ color: 'var(--text-primary)' }}>{card.cost}</div>
                      </div>
                    )}

                    {(card.game === 'onepiece' || card.game === 'lorcana' || card.game === 'starwars' || card.game === 'fab') && (
                      <>
                        {card.domain && (
                          <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                              {card.game === 'onepiece' ? t('Color', 'Szín') : card.game === 'lorcana' ? 'Ink' : card.game === 'starwars' ? 'Aspect' : card.game === 'fab' ? t('Class', 'Osztály') : t('Domain', 'Domén')}
                            </div>
                            <div className="text-base font-black" style={{ color: 'var(--text-primary)' }}>{card.domain}</div>
                          </div>
                        )}
                      </>
                    )}

                    {(!card.game || card.game === 'riftbound') && ((card.domain && card.domain !== 'Colorless') || isNeutral) && (() => {
                      return (
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                            {shownDomains.length > 1 ? t('Domains', 'Domének') : t('Domain', 'Domén')}
                          </div>
                          <div className="flex items-center gap-2 text-base font-black flex-wrap">
                            {shownDomains.map((d, idx) => {
                              const icon = RUNE_ICONS[d.key];
                              return (
                                <span key={d.key} className="inline-flex items-center gap-1.5" style={{ color: d.border }}>
                                  {icon && <img src={icon} alt={d.name} className="w-5 h-5 object-contain" />}
                                  {d.name}
                                  {idx < shownDomains.length - 1 && <span className="font-normal" style={{ color: 'var(--text-muted)' }}>/</span>}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {(() => {
                      const rawType = (card.card_type || '').toLowerCase();
                      const superType = (card.subtype || '').toLowerCase();
                      const isRiftbound = !card.game || card.game === 'riftbound';
                      const isChampionUnit = isRiftbound && rawType === 'unit' && superType === 'champion';
                      const typeIcon = isRiftbound ? TYPE_ICONS[rawType] : null;
                      const superIcon = isRiftbound ? TYPE_ICONS[superType] : null;

                      let displayType = card.card_type || '';
                      if (card.game === 'fab') {
                        if (card.subtype) {
                          const domainClean = (card.domain || '').trim();
                          if (domainClean && card.subtype.toLowerCase().startsWith(domainClean.toLowerCase())) {
                            displayType = card.subtype.slice(domainClean.length).trim();
                            if (displayType.startsWith('-')) displayType = displayType.slice(1).trim();
                          } else {
                            displayType = card.subtype;
                          }
                        }
                      }

                      const isLegend = rawType === 'legend' || (card.card_type || '').toLowerCase() === 'legend';
                      const displaySubtype = isRiftbound && !isLegend && superType !== 'champion' ? card.subtype : null;

                      return (
                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('Type', 'Típus')}</div>
                          <div className="flex items-center gap-1.5 text-base font-bold flex-wrap leading-snug break-words" style={{ color: 'var(--text-primary)' }}>
                            {isChampionUnit ? (
                              <>
                                {superIcon && <img src={superIcon} alt={superType} title={card.subtype} className="w-5 h-5 object-contain shrink-0" />}
                                <span className="text-amber-300 break-words">{card.subtype}</span>
                              </>
                            ) : (
                              <>
                                {typeIcon && <img src={typeIcon} alt={rawType} title={card.card_type} className="w-5 h-5 object-contain shrink-0" />}
                                <span className="break-words">{displayType}</span>
                                {displaySubtype && (
                                  <>
                                    <span className="mx-0.5" style={{ color: 'var(--text-muted)' }}>·</span>
                                    {superIcon && <img src={superIcon} alt={superType} title={displaySubtype} className="w-5 h-5 object-contain shrink-0" />}
                                    <span className="text-amber-300 break-words">{displaySubtype}</span>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Stats Grid inside the same card */}
                  {(() => {
                    const isRiftbound = !card.game || card.game === 'riftbound';
                    const isOnePiece = card.game === 'onepiece';
                    const isLorcana = card.game === 'lorcana';
                    const isSWU = card.game === 'starwars';
                    const isFaB = card.game === 'fab';

                    const powerReq = getCardPowerRequirement(card);
                    const hasPowerCost = isRiftbound && powerReq.power > 0 && powerReq.domains.length > 0;
                    const hasEnergy = isRiftbound && card.energy != null;

                    const hasCost = (isOnePiece || isLorcana || isSWU || isFaB) && card.cost != null;
                    const hasMight = card.might != null;
                    const hasMightBonus = card.might_bonus != null;
                    const hasLore = isLorcana && card.energy != null;
                    const hasFaBPitch = isFaB && card.energy != null;

                    if (!hasEnergy && !hasMight && !hasMightBonus && !hasPowerCost && !hasCost && !hasLore && !hasFaBPitch) return null;

                    let statCount = 0;
                    if (isRiftbound) {
                      statCount = (hasEnergy ? 1 : 0) + (hasPowerCost ? 1 : 0) + (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0);
                    } else if (isOnePiece) {
                      statCount = (hasCost ? 1 : 0) + (hasMight ? 1 : 0);
                    } else if (isLorcana) {
                      statCount = (hasCost ? 1 : 0) + (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0) + (hasLore ? 1 : 0);
                    } else if (isSWU) {
                      statCount = (hasCost ? 1 : 0) + (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0);
                    } else if (isFaB) {
                      statCount = (hasFaBPitch ? 1 : 0) + (hasCost ? 1 : 0) + (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0);
                    } else {
                      statCount = (hasMight ? 1 : 0) + (hasMightBonus ? 1 : 0);
                    }

                    const gridClass = statCount === 4 ? "grid-cols-2 sm:grid-cols-4" : statCount === 3 ? "grid-cols-3" : statCount === 2 ? "grid-cols-2" : "grid-cols-1";

                    return (
                      <div className={`grid ${gridClass} gap-2.5`}>
                        {hasEnergy && (
                          <div 
                            className="border rounded-xl p-3 flex flex-col items-center justify-center text-center"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                          >
                            <div className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              {t('Energy', 'Energia')}
                            </div>
                            <div className="text-2xl sm:text-3xl font-black font-mono" style={{ color: 'var(--text-primary)' }}>
                              {card.energy}
                            </div>
                          </div>
                        )}

                        {hasPowerCost && (
                          <div 
                            className="border rounded-xl p-3 flex flex-col items-center justify-center text-center"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                          >
                            <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                              {t('Power Cost', 'Erőköltség')}
                            </div>
                            <div className="flex items-center gap-2 my-auto flex-wrap justify-center">
                              {powerReq.isMixed ? (
                                <div className="flex items-center gap-1.5 font-black text-base" style={{ color: 'var(--text-primary)' }}>
                                  {powerReq.domains.map((domKey, idx) => {
                                    const runeIcon = RUNE_ICONS[domKey];
                                    return (
                                      <React.Fragment key={domKey}>
                                        {idx > 0 && <span className="font-bold text-sm" style={{ color: 'var(--text-muted)' }}>/</span>}
                                        {runeIcon ? (
                                          <img src={runeIcon} alt={domKey} className="w-7 h-7 object-contain drop-shadow" title={domKey} />
                                        ) : (
                                          <span className="capitalize text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>{domKey}</span>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                                  <span className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>{powerReq.power}x</span>
                                  {RUNE_ICONS[powerReq.domains[0]] ? (
                                    <img
                                      src={RUNE_ICONS[powerReq.domains[0]]}
                                      alt={powerReq.domains[0]}
                                      className="w-7 h-7 object-contain drop-shadow"
                                      title={`${powerReq.power}x ${powerReq.domains[0]}`}
                                    />
                                  ) : (
                                    <span className="capitalize text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>{powerReq.domains[0]}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {hasFaBPitch && (() => {
                          const pitch = Number(card.energy);
                          const colorClass = pitch === 1 ? 'border-red-500/40 bg-red-500/10 text-red-400'
                            : pitch === 2 ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : pitch === 3 ? 'border-blue-500/40 bg-blue-500/10 text-blue-400'
                            : 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300';
                          const label = pitch === 1 ? 'Pitch 1 (Red)' : pitch === 2 ? 'Pitch 2 (Yellow)' : pitch === 3 ? 'Pitch 3 (Blue)' : `Pitch ${pitch}`;
                          return (
                            <div className={`rounded-xl p-3 flex flex-col items-center justify-center text-center border ${colorClass}`}>
                              <div className="text-xs font-black uppercase tracking-wider mb-0.5 opacity-90">{label}</div>
                              <div className="flex items-center gap-1.5 justify-center mt-1">
                                {Array.from({ length: Math.min(Math.max(pitch, 1), 3) }).map((_, i) => (
                                  <span key={i} className="w-3.5 h-3.5 rounded-full bg-current inline-block" />
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {hasCost && (
                          <div 
                            className="rounded-xl p-3 flex flex-col items-center justify-center text-center border"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                          >
                            <div className="text-xs font-black uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              {isLorcana ? 'Ink Cost' : t('Cost', 'Költség')}
                            </div>
                            <div className="text-2xl sm:text-3xl font-black" style={{ color: 'var(--text-primary)' }}>{card.cost}</div>
                          </div>
                        )}

                        {hasMight && (
                          <div 
                            className="rounded-xl p-3 flex flex-col items-center justify-center text-center border" 
                            style={{ 
                              background: isFaB ? 'rgba(239, 68, 68, 0.1)' : 'var(--accent-muted)', 
                              borderColor: isFaB ? 'rgba(239, 68, 68, 0.3)' : 'var(--accent-border)' 
                            }}
                          >
                            <div 
                              className="text-xs font-black uppercase tracking-wider mb-0.5" 
                              style={{ color: isFaB ? '#f87171' : 'var(--text-accent)' }}
                            >
                              {isOnePiece || isSWU ? t('Power', 'Erő') : isLorcana ? t('Strength', 'Erő') : isFaB ? t('Attack', 'Támadás') : t('Might', 'Erő (Might)')}
                            </div>
                            <div 
                              className="text-2xl sm:text-3xl font-black" 
                              style={{ color: isFaB ? '#f87171' : 'var(--text-accent)' }}
                            >
                              {card.might}
                            </div>
                          </div>
                        )}

                        {hasMightBonus && (
                          <div
                            className="rounded-xl p-3 flex flex-col items-center justify-center text-center border"
                            style={{ 
                              background: isSWU ? 'rgba(239, 68, 68, 0.1)' : isFaB ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-input)', 
                              borderColor: isSWU ? 'rgba(239, 68, 68, 0.3)' : isFaB ? 'rgba(59, 130, 246, 0.3)' : 'var(--border-subtle)' 
                            }}
                            title={isRiftbound ? t("Might added to the unit this is attached to", "A csatolt egységhez adott erő") : undefined}
                          >
                            <div 
                              className="text-xs font-black uppercase tracking-wider mb-0.5" 
                              style={{ color: isSWU ? '#f87171' : isFaB ? '#60a5fa' : 'var(--text-tertiary)' }}
                            >
                              {isLorcana ? 'Willpower' : isSWU ? 'HP' : isFaB ? t('Defense', 'Védekezés') : t('Might Bonus', 'Erő bónusz')}
                            </div>
                            <div 
                              className="text-2xl sm:text-3xl font-black" 
                              style={{ color: isSWU ? '#f87171' : isFaB ? '#60a5fa' : 'var(--text-primary)' }}
                            >
                              {isRiftbound && card.might_bonus >= 0 ? `+${card.might_bonus}` : card.might_bonus}
                            </div>
                          </div>
                        )}

                        {hasLore && (
                          <div 
                            className="rounded-xl p-3 flex flex-col items-center justify-center text-center border" 
                            style={{ background: 'rgba(234, 179, 8, 0.1)', borderColor: 'rgba(234, 179, 8, 0.3)' }}
                          >
                            <div className="text-xs font-black uppercase tracking-wider mb-0.5 text-amber-400">Lore</div>
                            <div className="text-2xl sm:text-3xl font-black text-amber-300 flex items-center justify-center gap-1.5">
                              <span>{card.energy}</span>
                              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-amber-400 shrink-0" aria-label="Lore">
                                <polygon points="12,2 20,12 12,22 4,12" />
                              </svg>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Traits / Classifications / Affiliations / Tags */}
                  {(() => {
                    const isSWU = card.game === 'starwars';
                    const isLorcana = card.game === 'lorcana';
                    const isOnePiece = card.game === 'onepiece';

                    const extraPills: string[] = [];
                    if ((isSWU || isLorcana || isOnePiece) && card.subtype) {
                      const parts = card.subtype.split(/[·•,]/).map((s: string) => s.trim()).filter(Boolean);
                      extraPills.push(...parts);
                    }

                    const rawTags: string[] = (Array.isArray(card.tags) ? card.tags : (card.tags?.tags || []))
                      .filter((tItem: string) => { const s = String(tItem || '').trim().toLowerCase(); return s !== 'star' && s !== '*'; });
                    const allPills = Array.from(new Set([...extraPills, ...rawTags]))
                      .filter((tItem: string) => { const s = String(tItem || '').trim().toLowerCase(); return s !== 'star' && s !== '*'; });
                    if (allPills.length === 0) return null;

                    const sectionTitle = isSWU
                      ? t('Traits', 'Jellemzők')
                      : isLorcana
                      ? t('Classifications', 'Besorolások')
                      : isOnePiece
                      ? t('Affiliations & Traits', 'Frakciók és jellemzők')
                      : t('Tags', 'Címkék');

                    return (
                      <div className="rounded-xl p-3" style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                        <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>{sectionTitle}</div>
                        <div className="flex gap-1.5 flex-wrap">
                          {allPills.map((tag: string) => (
                            <span 
                              key={tag} 
                              className="text-xs font-bold px-2.5 py-1 rounded-lg border uppercase tracking-wider"
                              style={{
                                background: 'var(--bg-surface)',
                                color: 'var(--text-secondary)',
                                borderColor: 'var(--border)'
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Text Abilities & Flavor inside one unified container */}
                {(card.text || card.ability || card.effect) && (
                  <div className="rounded-xl p-3.5 border space-y-3" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                    {card.ability && (
                      <div>
                        <div 
                          className="text-xs font-black uppercase tracking-wider mb-1.5"
                          style={{ color: 'var(--text-accent)' }}
                        >
                          {t('Ability', 'Képesség')}
                        </div>
                        <div className="text-sm sm:text-base leading-relaxed whitespace-pre-line space-y-1" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.ability) }} />
                      </div>
                    )}
                    
                    {card.effect && (
                      <div className={card.ability ? 'pt-3 border-t' : ''} style={{ borderColor: 'var(--border-subtle)' }}>
                        <div className="text-xs font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-accent)' }}>
                          {t('Effect', 'Hatás')}
                        </div>
                        <div className="text-sm sm:text-base leading-relaxed space-y-1" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.effect) }} />
                      </div>
                    )}

                    {card.text && String(card.text).trim().length > 0 && (
                      <div className={card.ability || card.effect ? 'pt-3 border-t' : ''} style={{ borderColor: 'var(--border-subtle)' }}>
                        <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                          {card.game && card.game !== 'riftbound' ? t('Card Text', 'Kártyaszöveg') : t('Flavor Text', 'Hangulatszöveg')}
                        </div>
                        <div className={`text-sm leading-relaxed ${card.game && card.game !== 'riftbound' ? 'whitespace-pre-line' : 'italic'}`} style={{ color: (card.game && card.game !== 'riftbound') ? 'var(--text-primary)' : 'var(--text-secondary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.text) }} />
                      </div>
                    )}
                  </div>
                )}
                </>
                )}

                {card.artist && (
                  <div className="pt-2.5 flex items-center gap-1.5 text-xs border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 19l7-7 3 3-7 7-3-3z" />
                      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                    </svg>
                    <span>{t('Illustrated by', 'Illusztrálta')}</span>
                    <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{card.artist}</span>
                  </div>
                )}

                {(() => {
                  const errataList = getCardErrataEntries(card);
                  const legMap = getCardLegalityMap(card);
                  const showUnifiedLegality = card.game !== 'fab' && Object.keys(legMap).length > 0;
                  if (errataList.length === 0 && !showUnifiedLegality) return null;
                  return (
                    <div className="pt-3 border-t space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                      {errataList.length > 0 && (
                        <div className="rounded-xl p-3.5 border space-y-2" style={{ background: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
                          <div className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                            <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <span>{t('Official Card Errata', 'Kártya Errata')}</span>
                          </div>
                          <div className="space-y-2">
                            {errataList.map((entry) => (
                              <div key={entry.id} className="text-xs sm:text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }}>
                                {entry.date && (
                                  <span className="font-mono text-[11px] font-bold text-amber-300 mr-2">[{entry.date}]</span>
                                )}
                                <span dangerouslySetInnerHTML={{ __html: formatGameText(entry.text) }} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {showUnifiedLegality && (
                        <div className="rounded-xl p-3.5 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                          <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                            {t('Format Legality', 'Formátum legalitás')}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
                            {Object.entries(legMap).map(([fmt, status]) => {
                              const badge = getLegalityBadgeStyle(status);
                              return (
                                <div key={fmt} className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                                  <span className="font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>{fmt}</span>
                                  <span
                                    className="px-2 py-0.5 rounded-md border text-xs font-bold shrink-0"
                                    style={{ background: badge.bg, borderColor: badge.border, color: badge.text }}
                                  >
                                    {status}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-3 mb-4">
                {(siteFlags.store_public && storeSingle) || (p2pEnabled && p2pSummary) ? (
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {siteFlags.store_public && storeSingle && (
                      <a
                        href={`/store/product?slug=${encodeURIComponent(storeSingle.slug)}`}
                        className="flex-1 min-w-[200px] inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-black shadow-sm transition hover:brightness-110"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                          <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
                        </svg>
                        <span>{t('Buy in Store', 'Megvásárlás a Boltban')} · {formatPrice(storeSingle.price_huf)}</span>
                      </a>
                    )}
                    {p2pEnabled && p2pSummary && (
                      <a
                        href={`/marketplace?q=${encodeURIComponent(card.card_number || card.name || '')}`}
                        className="flex-1 min-w-[200px] inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-black border transition hover:border-[var(--accent)]"
                        style={{
                          background: 'var(--bg-surface-2)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                          <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                        <span>
                          {t('Community P2P', 'Piactér')}: {p2pSummary.offerCount} {t('offers from', 'ajánlat tól')} {formatPrice(p2pSummary.lowestPriceHuf)}
                        </span>
                      </a>
                    )}
                  </div>
                ) : null}

                {/* Primary external market action — full width */}
                <PriceChartingButton card={card} />

                {(() => {
                  const canDirectEdit = canModerateGame(profile, card.game);
                  const openUpdateTab = (targetTab: CardUpdateType) => {
                    if (!profile) {
                      showLocalToast(
                        t('Sign in to request a card errata or legality update.', 'Jelentkezz be kártyafrissítés vagy errata kéréséhez.'),
                        'info'
                      );
                      return;
                    }
                    if (profile.is_banned) {
                      showLocalToast(t('Suspended accounts cannot submit card updates.', 'Felfüggesztett fiókkal nem küldhető kártyafrissítés.'), 'error');
                      return;
                    }
                    setCardUpdateModalTab(targetTab);
                  };

                  if (!canDirectEdit) {
                    return (
                      <button
                        type="button"
                        onClick={() => openUpdateTab('errata')}
                        className="w-full min-h-9 inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition border cursor-pointer hover:border-[var(--border-hover)]"
                        style={{
                          background: 'transparent',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }}
                        title={t('Suggest errata or legality update', 'Errata vagy legalitás javaslata')}
                      >
                        <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        <span>{t('Suggest Errata / Legality', 'Errata / Legalitás javaslata')}</span>
                      </button>
                    );
                  }

                  return (
                    <div
                      className="pt-3 mt-1 border-t"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div
                        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-2"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span>{t('Moderation / Admin', 'Moderáció / Admin')}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => openUpdateTab('errata')}
                          className="w-full min-h-10 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm font-bold transition border cursor-pointer hover:brightness-110"
                          style={{
                            background: 'var(--bg-surface-2)',
                            borderColor: 'var(--border)',
                            color: 'var(--text-primary)',
                          }}
                          title={t('Edit card errata and legality', 'Kártya errata és legalitás szerkesztése')}
                        >
                          <svg aria-hidden="true" className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <path d="m9 12 2 2 4-4" />
                          </svg>
                          <span className="truncate">{t('Errata / Legality', 'Errata / Legalitás')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setCardEditorOpen(true)}
                          className="w-full min-h-10 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs sm:text-sm font-bold transition border cursor-pointer hover:brightness-110"
                          style={{
                            background: 'var(--bg-surface-2)',
                            borderColor: 'var(--border)',
                            color: 'var(--text-primary)',
                          }}
                          title={t('Edit card details, set, tags, image, and Cardmarket link', 'Kártya adatok, szett, tagek, kép és Cardmarket link szerkesztése')}
                        >
                          <svg aria-hidden="true" className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          <span className="truncate">{t('Edit Card', 'Kártya szerkesztése')}</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
              </div>

          <div className="min-w-0">
          {/* What it's worth: market reference and estimated value */}
          <CardValuePanel card={card} />

          {/* Collection Tracking Section */}
          <div
              className="rounded-2xl p-4 sm:p-5 mb-4 border"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="text-xs sm:text-sm font-black uppercase tracking-wider flex items-center gap-2 min-w-0" style={{ color: 'var(--text-primary)' }}>
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                    <line x1="12" y1="22.08" x2="12" y2="12"/>
                  </svg>
                  <span className="truncate">
                    {isCombined
                      ? t('All Collections (Combined)', 'Minden gyűjtemény (Összesítve)')
                      : activeNamed
                      ? activeNamed.name
                      : t('My Collection Tracker', 'Gyűjteménykövető')}
                  </span>
                </div>
                {(((collection[card.id] || 0) + (collection[`${card.id}_foil`] || 0)) > 0) && (
                  <span 
                    className="text-[11px] sm:text-xs font-bold px-2.5 sm:px-3 py-1 rounded-full border shrink-0 max-w-full"
                    style={{
                      background: 'var(--accent-muted)',
                      borderColor: 'var(--accent-border)',
                      color: 'var(--text-accent)'
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></svg>
                      {(collection[card.id] || 0) + (collection[`${card.id}_foil`] || 0)} {t('Total Copies', 'Összes példány')}
                    </span>
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Normal Copy Stepper */}
                <div 
                  className="border rounded-xl p-3 flex items-center justify-between transition-colors"
                  style={{
                    background: 'var(--bg-input)',
                    borderColor: (collection[card.id] > 0) ? 'var(--accent)' : 'var(--border-subtle)'
                  }}
                >
                  <div>
                    <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('Normal', 'Normál')}</div>
                    
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdateCount(card.id, false, -1)}
                      disabled={isCombined || !(collection[card.id] > 0)}
                      aria-label={t('Decrease normal quantity', 'Normál példány csökkentése')}
                      className="tv-touch-target w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition border"
                      style={{
                        background: 'var(--bg-surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)'
                      }}
                      title="-1"
                    >
                      −
                    </button>
                    <span 
                      className="min-w-[20px] text-center text-base font-black font-mono tabular-nums"
                      style={{ color: (collection[card.id] > 0) ? 'var(--text-accent)' : 'var(--text-muted)' }}
                    >
                      {collection[card.id] || 0}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUpdateCount(card.id, false, 1)}
                      disabled={isCombined}
                      aria-label={t('Increase normal quantity', 'Normál példány növelése')}
                      className="tv-touch-target w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition border"
                      style={{
                        background: 'var(--bg-surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)'
                      }}
                      title="+1"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Foil Copy Stepper */}
                {hasFoilVariant(card) && (
                  <div 
                    className="border rounded-xl p-3 flex items-center justify-between transition-colors"
                    style={{
                      background: 'var(--bg-input)',
                      borderColor: (collection[`${card.id}_foil`] > 0) ? 'var(--accent)' : 'var(--border-subtle)'
                    }}
                  >
                    <div>
                      <div className="text-sm font-bold flex items-center gap-1.5" style={{ color: 'var(--text-accent)' }}>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                        <span>{t('Foil', 'Fóliás')}</span>
                      </div>
                      
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleUpdateCount(card.id, true, -1)}
                        disabled={isCombined || !(collection[`${card.id}_foil`] > 0)}
                        aria-label={t('Decrease foil quantity', 'Fóliás példány csökkentése')}
                        className="tv-touch-target w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition border"
                        style={{
                          background: 'var(--bg-surface)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)'
                        }}
                        title="-1"
                      >
                        −
                      </button>
                      <span 
                        className="min-w-[20px] text-center text-base font-black font-mono tabular-nums"
                        style={{ color: (collection[`${card.id}_foil`] > 0) ? 'var(--text-accent)' : 'var(--text-muted)' }}
                      >
                        {collection[`${card.id}_foil`] || 0}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUpdateCount(card.id, true, 1)}
                        disabled={isCombined}
                        aria-label={t('Increase foil quantity', 'Fóliás példány növelése')}
                        className="tv-touch-target w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition border"
                        style={{
                          background: 'var(--bg-surface)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)'
                        }}
                        title="+1"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Per-collection breakdown in Combined mode */}
              {isCombined && (() => {
                const breakdown = getCardCollectionBreakdown(
                  card.id,
                  personalCollection,
                  personalDisplayName,
                  collectionsStore.collections,
                );
                if (breakdown.length === 0) return null;
                return (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {breakdown.map((entry) => (
                      <span
                        key={entry.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold"
                        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        <span>{entry.name}:</span>
                        <span className="font-black font-mono" style={{ color: 'var(--text-accent)' }}>
                          {entry.normal > 0 && entry.foil > 0
                            ? `${entry.total}x (${entry.foil} ${t('foil', 'fólia')})`
                            : entry.foil > 0
                            ? `${entry.foil}x ${t('Foil', 'Fólia')}`
                            : `${entry.normal}x`}
                        </span>
                      </span>
                    ))}
                  </div>
                );
              })()}

              {/* Move Copies Button */}
              {!isCombined && collectionsStore.collections.length > 0 && (((collection[card.id] || 0) + (collection[`${card.id}_foil`] || 0)) > 0) && (
                <button
                  type="button"
                  onClick={() => setShowMoveModal(true)}
                  className="mt-3 w-full py-2 px-3 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition hover:brightness-110 active:scale-95 shadow-sm"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title="Move copies of this card between collections"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 3l4 4-4 4" />
                    <path d="M3 7h18" />
                    <path d="M7 21l-4-4 4-4" />
                    <path d="M21 17H3" />
                  </svg>
                  <span>{t('Move copies', 'Példányok mozgatása')}</span>
                </button>
              )}
            </div>

          {/* Wishlists (catalog view): how many copies each of your lists wants */}
          <WishlistControls
            cardId={card.id}
            game={card.game || 'riftbound'}
            hasFoil={hasFoilVariant(card)}
            signedIn={Boolean(profile)}
            onRequireSignIn={() => setShowAuthModal(true)}
          />
          </div>
        </>
        </div>
      </div>

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            getCurrentProfile().then(p => setProfile(p));
          }}
        />
      )}

      <MoveCardModal
        open={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        card={card ? { id: card.id, name: card.name } : null}
        hasFoil={card ? hasFoilVariant(card) : false}
        initialFoil={(collection[card.id] || 0) === 0 && (collection[`${card.id}_foil`] || 0) > 0}
        sourceId={activeNamed ? activeNamed.id : PERSONAL_COLLECTION_ID}
        personalCards={personalCollection}
        applyPersonal={(next) => { setCollection(next); saveLocalCollection(next); }}
        onToast={(msg, type) => showLocalToast(msg, type || 'info')}
      />

      <CardUpdateModal
        open={Boolean(cardUpdateModalTab)}
        onClose={() => setCardUpdateModalTab(null)}
        card={card}
        mode={canModerateGame(profile, card.game) ? 'direct' : 'request'}
        initialTab={cardUpdateModalTab || 'errata'}
        onSaved={(updatedCard) => {
          clearApiCache();
          setData((prev: any) => ({ ...(prev || {}), cards: updatedCard }));
          showLocalToast(
            t('Card errata and legality updated.', 'Kártya adatok és legalitás frissítve.'),
            'success'
          );
        }}
        onSubmittedRequest={() => {
          showLocalToast(
            t('Update request sent to the game moderator team!', 'Frissítési kérelem elküldve a moderátoroknak!'),
            'success'
          );
        }}
      />

      <CardEditorModal
        open={cardEditorOpen}
        onClose={() => setCardEditorOpen(false)}
        mode="edit"
        card={card}
        allowedGames={GAMES.map((g) => ({ id: g.id, label: g.name }))}
        onSaved={(updatedCard) => {
          clearApiCache();
          setData((prev: any) => ({ ...(prev || {}), cards: updatedCard }));
          if (updatedCard?.image_path) {
            setActiveUrl(getCardImageUrl(updatedCard.image_path));
          }
          showLocalToast(
            t('Card details and pricing link updated.', 'Kártyaadatok és árlink frissítve.'),
            'success'
          );
        }}
      />

      <Toast
        open={Boolean(moveToast)}
        message={moveToast?.msg ?? null}
        type={moveToast?.type ?? 'info'}
        onDismiss={() => setMoveToast(null)}
        dismissLabel={t('Dismiss notification', 'Értesítés bezárása')}
      />
    </div>
  );
}

function PriceChartingButton({ card }: { card: CatalogCard; isFoil?: boolean }) {
  const { t } = useLanguage();
  const url = getCardmarketSearchUrl(card);

  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="w-full min-h-10 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs sm:text-sm font-bold transition border hover:border-[var(--accent)]"
      style={{
        background: 'var(--bg-surface-2)',
        borderColor: 'var(--border)',
        color: 'var(--text-primary)'
      }}
    >
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
        <polyline points="17 6 23 6 23 12"/>
      </svg>
      <span>{t('Check on Cardmarket', 'Megtekintés Cardmarketen')}</span>
    </a>
  );
}

function BackLink({ onClose }: { onClose?: () => void }) {
  const { t } = useLanguage();
  const [backLabel, setBackLabel] = useState<'store' | 'deck' | 'profile' | 'wishlists' | 'catalog'>('catalog');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('from');
    const ref = document.referrer || '';
    if (fromParam === 'store' || ref.includes('/store')) {
      setBackLabel('store');
    } else if (ref.includes('/deck')) {
      setBackLabel('deck');
    } else if (ref.includes('/profile') || ref.includes('/user')) {
      setBackLabel('profile');
    } else if (ref.includes('/wishlists')) {
      setBackLabel('wishlists');
    } else {
      setBackLabel('catalog');
    }
  }, []);

  if (onClose) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); onClose(); }}
        className="absolute top-3 right-3 sm:top-5 sm:right-5 z-30 w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition shadow-lg cursor-pointer active:scale-95 border"
        style={{
          background: 'var(--bg-surface-2)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)'
        }}
        title={t('Close', 'Bezárás')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    );
  }

  const labelText =
    backLabel === 'store'
      ? t('← Back to Store', '← Vissza a Boltba')
      : backLabel === 'deck'
      ? t('← Back to Deck Builder', '← Vissza a Pakliépítőbe')
      : backLabel === 'profile'
      ? t('← Back to Profile', '← Vissza a Profilhoz')
      : backLabel === 'wishlists'
      ? t('← Back to Wishlists', '← Vissza a Kívánságlistákhoz')
      : t('← Back to Catalog', '← Vissza a Katalógusba');

  return (
    <button
      onClick={(e) => {
        if (window.history.length > 1) {
          e.preventDefault();
          window.history.back();
        } else {
          window.location.href = backLabel === 'store' ? '/store?category=singles' : '/';
        }
      }}
      className="inline-flex items-center gap-2 text-xs font-bold mb-4 px-3.5 py-2 rounded-xl border transition cursor-pointer hover:border-[var(--border-hover)]"
      style={{
        background: 'var(--bg-surface-2)',
        borderColor: 'var(--border)',
        color: 'var(--text-secondary)'
      }}
    >
      {labelText}
    </button>
  );
}
