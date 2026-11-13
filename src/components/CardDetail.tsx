import React, { useState, useEffect, useRef } from 'react';
import type { CatalogCard, UserProfile } from '../types';
import { fetchCardOnly } from '../lib/api';
import { getCardImageUrl } from '../lib/supabase';
import { getCurrentProfile } from '../lib/auth';
import { parseDomains, getEnergyBadgeStyle } from '../lib/domainColors';

const RARITY_COLORS: Record<string, { bg: string; text: string; glow: string }> = {
  Common:          { bg: "rgba(31, 41, 55, 0.9)", text: "#cbd5e1", glow: "rgba(203, 213, 225, 0.2)" },
  Uncommon:        { bg: "rgba(12, 74, 110, 0.9)", text: "#38bdf8", glow: "rgba(56, 189, 248, 0.4)" },
  Rare:            { bg: "rgba(88, 28, 135, 0.9)", text: "#d8b4fe", glow: "rgba(216, 180, 254, 0.5)" },
  Epic:            { bg: "rgba(154, 52, 18, 0.9)", text: "#fb923c", glow: "rgba(251, 146, 60, 0.5)" },
  Showcase:        { bg: "rgba(180, 83, 9, 0.85)", text: "#fef08a", glow: "rgba(250, 204, 21, 0.6)" },
};

import { formatGameText, splitCardTitle, formatCleanCardNumber } from '../lib/formatGameText';
import { TYPE_ICONS, RUNE_ICONS, RARITY_ICONS } from '../lib/riftboundIcons';
import { isOvernumbered, isSigned, isAltArt } from '../lib/cardVariants';
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
import { useCollectionsStore, activeNamedCollection, changeCollectionCard } from '../lib/collectionsStore';
import { printLanguage } from '../lib/cardPreview';
import { useCurrency } from '../lib/currency';
import { useLanguage } from '../lib/i18n';

export function CardDetail({ inventoryId, cardId, onClose }: { inventoryId?: string, cardId?: string, onClose?: () => void }) {
  const { formatPrice } = useCurrency();
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  // The image on its own, full screen, where it can be rotated (?view=full, so Back closes it).
  const [fullView, openFullView, closeFullView] = useUrlOverlay('view');
  // Personal, from this browser; the tracker shows whichever collection is active in the catalog.
  const [personalCollection, setCollection] = useState<Record<string, number>>({});
  const collectionsStore = useCollectionsStore();
  const activeNamed = activeNamedCollection(collectionsStore);
  const collection = activeNamed ? activeNamed.cards : personalCollection;
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [storeSingle, setStoreSingle] = useState<{ slug: string; price_huf: number; stock_quantity: number; condition?: string; is_foil?: boolean } | null>(null);
  const [moveToast, setMoveToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const moveToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLocalToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (moveToastTimerRef.current) clearTimeout(moveToastTimerRef.current);
    setMoveToast({ msg, type });
    moveToastTimerRef.current = setTimeout(() => setMoveToast(null), 3500);
  };

  const [profile, setProfile] = useState<UserProfile | null>(null);

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
    if (!targetCardId) return;
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

  useEffect(() => {
    const cid = data?.cards?.id;
    if (!cid) {
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
      .then(({ data: row }) => {
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
      })
      .catch(() => {
        if (!cancelled) setStoreSingle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [data?.cards?.id]);

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
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
              border: `1px solid ${rarityStyle.text}38`,
              boxShadow: `0 12px 32px rgba(0,0,0,0.45), 0 0 24px ${rarityStyle.glow}`
            }}
            className="rounded-2xl sm:rounded-3xl overflow-hidden relative p-3.5 sm:p-5 flex items-center justify-center mb-3"
          >
            {activeUrl ? (
              <div 
                style={{ filter: `drop-shadow(0 8px 20px rgba(0,0,0,0.5))` }}
                className="relative z-10 w-full rounded-xl overflow-hidden"
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
          <div
            className="2xl:col-span-2 rounded-2xl p-4 sm:p-5 mb-4 border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span
                  className="text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-lg border"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  {card.sets?.name || 'Base Set'}
                </span>
                <span
                  className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-lg border"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                >
                  #{formatCleanCardNumber(card.card_number)}
                </span>

                {/* Rarity icon + label */}
                {(() => {
                  const isRiftbound = !card.game || card.game === 'riftbound';
                  const isShowcase = (card.rarity || '').toLowerCase() === 'showcase';
                  const rarityKey = (card.rarity || '').toLowerCase();
                  const rarityIcon = isRiftbound ? RARITY_ICONS[rarityKey] : null;
                  return (
                    <span 
                      style={{
                        background: isShowcase
                          ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.35) 0%, rgba(180, 83, 9, 0.25) 100%)'
                          : rarityStyle.bg,
                        color: isShowcase ? '#fef08a' : rarityStyle.text,
                        borderColor: isShowcase ? 'rgba(250, 204, 21, 0.75)' : `${rarityStyle.text}44`,
                        boxShadow: isShowcase ? '0 0 12px rgba(250, 204, 21, 0.4)' : `0 0 10px ${rarityStyle.glow}`,
                      }}
                      className="inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-0.5 rounded-lg border uppercase tracking-wider"
                    >
                      {rarityIcon && <img src={rarityIcon} alt={card.rarity} className="w-3.5 h-3.5 object-contain" />}
                      <span>{card.rarity}</span>
                    </span>
                  );
                })()}

                {isSigned(card) && (
                  <span
                    title={t('Signed Edition', 'Aláírt kiadás')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-purple-500/15 border border-purple-500/40 text-purple-200 uppercase tracking-wider"
                  >
                    <span>{t('Signed', 'Aláírt')}</span>
                  </span>
                )}
                {isOvernumbered(card) && (
                  <span
                    title={t('Overnumbered Edition', 'Számozáson felüli kiadás')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 uppercase tracking-wider"
                  >
                    <span>{t('Overnumbered', 'Számozáson felüli')}</span>
                  </span>
                )}
                {isAltArt(card) && (
                  <span
                    title={t('Alternative Art', 'Alternatív illusztráció')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-pink-500/15 border border-pink-500/40 text-pink-200 uppercase tracking-wider"
                  >
                    <span>{t('Alt Art', 'Alt Art')}</span>
                  </span>
                )}
              </div>

              {(() => {
                const { main, sub } = splitCardTitle(card.name);
                return (
                  <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight tracking-tight uppercase" style={{ color: 'var(--text-primary)' }}>
                      {sub ? main : card.name}
                    </h1>
                    {sub && (
                      <p className="text-xs sm:text-sm font-extrabold uppercase tracking-[0.18em] leading-snug mt-0.5" style={{ color: 'var(--text-accent)' }}>
                        {sub}
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

              <div className="flex items-center gap-2.5 flex-wrap shrink-0">
                {storeSingle && (
                  <a
                    href={`/store/product?slug=${encodeURIComponent(storeSingle.slug)}`}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-black shadow-sm transition hover:brightness-110"
                    style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                      <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
                    </svg>
                    <span>{t('Buy in Store', 'Megvásárlás a Boltban')} · {formatPrice(storeSingle.price_huf)}</span>
                  </a>
                )}
                <PriceChartingButton card={card} />
              </div>
          </div>

            <>
              <div className="min-w-0">
              <div 
                className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3.5 mb-4"
                style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)' }}
              >
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

                {/* Text Abilities & Flavor inside the same unified card */}
                {(card.text || card.ability || card.effect) && (
                  <div className="pt-3 border-t space-y-3.5" style={{ borderColor: 'var(--border-subtle)' }}>
                    {card.ability && (
                      <div>
                        <div 
                          className="text-xs font-black uppercase tracking-wider mb-1.5"
                          style={{ color: 'var(--text-accent)' }}
                        >
                          {t('Ability', 'Képesség')}
                        </div>
                        <div className="text-sm sm:text-base leading-relaxed space-y-1" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.ability) }} />
                      </div>
                    )}
                    
                    {card.effect && (
                      <div
                        className="rounded-xl p-3.5 border"
                        style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border, var(--border))' }}
                      >
                        <div className="text-xs font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-accent)' }}>
                          {t('Effect', 'Hatás')}
                        </div>
                        <div className="text-sm sm:text-base leading-relaxed space-y-1" style={{ color: 'var(--text-primary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.effect) }} />
                      </div>
                    )}

                    {card.text && (
                      <div className={card.ability || card.effect ? "pt-3 border-t" : ""} style={card.ability || card.effect ? { borderColor: 'var(--border-subtle)' } : {}}>
                        <div className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                          {card.game && card.game !== 'riftbound' ? t('Card Text', 'Kártyaszöveg') : t('Flavor Text', 'Hangulatszöveg')}
                        </div>
                        <div className={`text-sm leading-relaxed ${card.game && card.game !== 'riftbound' ? 'whitespace-pre-line' : 'italic'}`} style={{ color: (card.game && card.game !== 'riftbound') ? 'var(--text-primary)' : 'var(--text-secondary)' }} dangerouslySetInnerHTML={{ __html: formatGameText(card.text) }} />
                      </div>
                    )}
                  </div>
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
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="text-sm font-black uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                    <line x1="12" y1="22.08" x2="12" y2="12"/>
                  </svg>
                  <span>{activeNamed ? activeNamed.name : t('My Collection Tracker', 'Gyűjteménykövető')}</span>
                </div>
                {(((collection[card.id] || 0) + (collection[`${card.id}_foil`] || 0)) > 0) && (
                  <span 
                    className="text-xs font-bold px-3 py-1 rounded-full border shrink-0"
                    style={{
                      background: 'var(--accent-muted)',
                      borderColor: 'var(--accent-border)',
                      color: 'var(--text-accent)'
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="20 6 9 17 4 12" /></svg>
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
                      onClick={() => handleUpdateCount(card.id, false, -1)}
                      disabled={!(collection[card.id] > 0)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition border"
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
                      className="min-w-[20px] text-center text-base font-black font-mono"
                      style={{ color: (collection[card.id] > 0) ? 'var(--text-accent)' : 'var(--text-muted)' }}
                    >
                      {collection[card.id] || 0}
                    </span>
                    <button
                      onClick={() => handleUpdateCount(card.id, false, 1)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm cursor-pointer transition border"
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
                        onClick={() => handleUpdateCount(card.id, true, -1)}
                        disabled={!(collection[`${card.id}_foil`] > 0)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30 font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition border"
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
                        className="min-w-[20px] text-center text-base font-black font-mono"
                        style={{ color: (collection[`${card.id}_foil`] > 0) ? 'var(--text-accent)' : 'var(--text-muted)' }}
                      >
                        {collection[`${card.id}_foil`] || 0}
                      </span>
                      <button
                        onClick={() => handleUpdateCount(card.id, true, 1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-sm cursor-pointer transition border"
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

              {/* Move Copies Button */}
              {collectionsStore.collections.length > 0 && (((collection[card.id] || 0) + (collection[`${card.id}_foil`] || 0)) > 0) && (
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

      {moveToast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl border text-xs font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2"
          style={
            moveToast.type === 'error'
              ? { background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }
              : moveToast.type === 'success'
              ? { background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }
              : { background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }
          }
        >
          <span>{moveToast.msg}</span>
        </div>
      )}
    </div>
  );
}

function PriceChartingButton({ card }: { card: CatalogCard; isFoil?: boolean }) {
  const { t } = useLanguage();
  const game = (card.game || 'riftbound').toLowerCase();
  const cmSlug =
    game === 'mtg' ? 'Magic' :
    game === 'onepiece' ? 'OnePiece' :
    game === 'lorcana' ? 'Lorcana' :
    game === 'starwars' ? 'StarWarsUnlimited' :
    game === 'fab' ? 'FleshAndBlood' :
    'Riftbound';
  const url = `https://www.cardmarket.com/en/${cmSlug}/Products/Search?searchString=${encodeURIComponent(card.name)}`;

  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition shadow-sm border hover:brightness-110"
      style={{
        background: 'var(--bg-input)',
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
  const [backLabel, setBackLabel] = useState<'store' | 'deck' | 'binder' | 'profile' | 'wishlists' | 'catalog'>('catalog');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('from');
    const ref = document.referrer || '';
    if (fromParam === 'store' || ref.includes('/store')) {
      setBackLabel('store');
    } else if (ref.includes('/deck')) {
      setBackLabel('deck');
    } else if (ref.includes('/binder')) {
      setBackLabel('binder');
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
      : backLabel === 'binder'
      ? t('← Back to Binder', '← Vissza a Mappához')
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
