import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentProfile, isProfileAdmin, onSignedInUserChange } from '../../lib/auth';
import { GAMES } from '../../lib/constants';
import { CARD_CONDITIONS, formatCondition } from '../../lib/collectionDefaults';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { isP2PEnabledFor, type MarketplaceViewMode } from '../../lib/p2pConstants';
import {
  createHoldRequest,
  deleteListing,
  deleteMarketplacePost,
  fetchListings,
  fetchPosts,
  loadP2PCart,
  p2pCartEntryToGeneric,
  saveP2PCart,
  startP2PConversation,
  toggleLike,
  updateMarketplacePost,
  type P2PCardGroup,
  type P2PCartEntry,
  type P2PListing,
  type P2PPost,
} from '../../lib/p2pClient';
import { getProfileUrl } from '../../lib/profileUrl';
import { cardThumbProps } from '../../lib/supabase';
import type { UserProfile } from '../../types';
import { AuthModal } from '../auth/AuthModal';
import { GenericCartDrawer, type GenericCartSellerGroup } from '../cart/GenericCartDrawer';
import { ToolbarContainer } from '../common/ToolbarContainer';
import { CardOffersModal } from './CardOffersModal';
import { HoldConfirmModal, type HoldTarget } from './HoldConfirmModal';
import { LikeButton } from './LikeButton';
import { PhotoPostCard } from './PhotoPostCard';
import { SellModal, type SellModeTab } from './SellModal';

export function MarketplaceApp() {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();

  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [viewMode, setViewMode] = useState<MarketplaceViewMode>('by_card');
  const [likedOnly, setLikedOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('q') || '';
  });
  const [gameFilter, setGameFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [foilFilter, setFoilFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  // Data
  const [loadingData, setLoadingData] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [listings, setListings] = useState<P2PListing[]>([]);
  const [cardGroups, setCardGroups] = useState<P2PCardGroup[]>([]);
  const [posts, setPosts] = useState<P2PPost[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Interactions & Modals
  const [sellModalTab, setSellModalTab] = useState<SellModeTab | null>(null);
  const [activeCardGroup, setActiveCardGroup] = useState<P2PCardGroup | null>(null);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);

  // P2P Multi-Seller Cart
  const [cart, setCart] = useState<P2PCartEntry[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartBump, setCartBump] = useState(0);
  const [sendingSellerCartId, setSendingSellerCartId] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{ text: string; conversationId?: string } | null>(null);

  useEffect(() => {
    setCart(loadP2PCart());
    getCurrentProfile().then((p) => {
      setUserProfile(p);
      setAuthLoading(false);
    });
    const unsub = onSignedInUserChange(() => {
      getCurrentProfile().then((p) => {
        setUserProfile(p);
        setAuthLoading(false);
      });
    });
    return () => unsub();
  }, []);

  const isAdmin = isProfileAdmin(userProfile);
  const isAllowed = isP2PEnabledFor(isAdmin);

  const loadFeed = useCallback(async () => {
    if (!isAllowed) return;
    setLoadingData(true);
    setFetchError(null);
    try {
      if (viewMode === 'photo_posts' || viewMode === 'bulk') {
        const res = await fetchPosts({
          type: viewMode === 'bulk' ? 'bulk' : 'photo_post',
          q: searchQuery.trim() || undefined,
          game: gameFilter || undefined,
          country: countryFilter || undefined,
          liked_only: likedOnly ? 'true' : undefined,
          mine: mineOnly ? 'true' : undefined,
          sort: sortBy,
        });
        setPosts(res.posts || []);
        setSchemaReady(res.schemaReady !== false);
      } else {
        const res = await fetchListings({
          view: mineOnly ? 'mine' : viewMode,
          q: searchQuery.trim() || undefined,
          game: gameFilter || undefined,
          condition: conditionFilter || undefined,
          foil: foilFilter || undefined,
          country: countryFilter || undefined,
          liked_only: likedOnly ? 'true' : undefined,
          sort: sortBy,
        });
        setListings(res.listings || []);
        setCardGroups(res.cards || []);
        setSchemaReady(res.schemaReady !== false);
      }
    } catch (err: any) {
      setFetchError(err?.message || t('Could not load marketplace feed.', 'Nem sikerült betölteni a piacteret.'));
    } finally {
      setLoadingData(false);
    }
  }, [
    isAllowed,
    viewMode,
    searchQuery,
    gameFilter,
    conditionFilter,
    foilFilter,
    countryFilter,
    likedOnly,
    mineOnly,
    sortBy,
    t,
  ]);

  useEffect(() => {
    if (!authLoading && isAllowed) {
      const timer = setTimeout(() => {
        loadFeed();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [authLoading, isAllowed, loadFeed]);

  const requireSignedIn = (): boolean => {
    if (!userProfile) {
      setShowAuthModal(true);
      return false;
    }
    return true;
  };

  const handleToggleListingLike = async (listingId: string) => {
    if (!requireSignedIn()) return;
    setLikeBusyId(listingId);
    try {
      const res = await toggleLike({ listing_id: listingId });
      setListings((prev) =>
        prev.map((l) => (l.id === listingId ? { ...l, liked_by_me: res.liked, likes_count: res.likes_count } : l))
      );
      setCardGroups((prev) =>
        prev.map((g) => ({
          ...g,
          offers: g.offers.map((o) =>
            o.id === listingId ? { ...o, liked_by_me: res.liked, likes_count: res.likes_count } : o
          ),
        }))
      );
      if (activeCardGroup) {
        setActiveCardGroup((prev) =>
          prev
            ? {
                ...prev,
                offers: prev.offers.map((o) =>
                  o.id === listingId ? { ...o, liked_by_me: res.liked, likes_count: res.likes_count } : o
                ),
              }
            : null
        );
      }
    } catch (err: any) {
      setFetchError(err?.message || 'Could not update saved bookmark.');
    } finally {
      setLikeBusyId(null);
    }
  };

  const handleTogglePostLike = async (postId: string) => {
    if (!requireSignedIn()) return;
    setLikeBusyId(postId);
    try {
      const res = await toggleLike({ post_id: postId });
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, liked_by_me: res.liked, likes_count: res.likes_count } : p))
      );
    } catch (err: any) {
      setFetchError(err?.message || 'Could not update saved bookmark.');
    } finally {
      setLikeBusyId(null);
    }
  };

  const handleMessageSeller = async (sellerId: string, prefill?: string) => {
    if (!requireSignedIn()) return;
    try {
      const res = await startP2PConversation(sellerId, prefill);
      window.location.href = `/messages?conversation=${encodeURIComponent(res.conversation_id)}`;
    } catch (err: any) {
      setFetchError(err?.message || t('Could not start chat.', 'Nem sikerült elindítani a chatet.'));
    }
  };

  const handleAddToCart = (listing: P2PListing) => {
    if (!requireSignedIn()) return;
    setCart((prev) => {
      const existing = prev.find((e) => e.listingId === listing.id);
      let next: P2PCartEntry[];
      if (existing) {
        next = prev.map((e) =>
          e.listingId === listing.id
            ? { ...e, quantity: Math.min(listing.quantity, e.quantity + 1), listing }
            : e
        );
      } else {
        next = [...prev, { listingId: listing.id, quantity: 1, listing }];
      }
      saveP2PCart(next);
      return next;
    });
    setCartBump((b) => b + 1);
  };

  const handleUpdateCartQty = (id: string, nextQty: number) => {
    setCart((prev) => {
      const next =
        nextQty <= 0
          ? prev.filter((e) => e.listingId !== id)
          : prev.map((e) =>
              e.listingId === id ? { ...e, quantity: Math.min(e.listing.quantity, nextQty) } : e
            );
      saveP2PCart(next);
      return next;
    });
  };

  const handleRemoveCartItem = (id: string) => {
    setCart((prev) => {
      const next = prev.filter((e) => e.listingId !== id);
      saveP2PCart(next);
      return next;
    });
  };

  const sellerCartGroups: GenericCartSellerGroup[] = useMemo(() => {
    const map = new Map<string, GenericCartSellerGroup>();
    for (const entry of cart) {
      const sid = entry.listing.seller_id;
      let grp = map.get(sid);
      if (!grp) {
        grp = {
          sellerId: sid,
          sellerName: entry.listing.seller.display_name,
          subtotal: 0,
          items: [],
          meta: { seller: entry.listing.seller },
        };
        map.set(sid, grp);
      }
      grp.items.push(p2pCartEntryToGeneric(entry));
      grp.subtotal += entry.listing.price_huf * entry.quantity;
    }
    return Array.from(map.values());
  }, [cart]);

  const handleRequestSellerGroupHold = async (group: GenericCartSellerGroup) => {
    if (!requireSignedIn()) return;
    setSendingSellerCartId(group.sellerId);
    try {
      const res = await createHoldRequest({
        mode: 'listings_batch',
        items: group.items.map((it) => ({ listing_id: it.id, quantity: it.quantity })),
      });
      // Remove held seller items from local cart
      const remaining = cart.filter((e) => e.listing.seller_id !== group.sellerId);
      setCart(remaining);
      saveP2PCart(remaining);
      setCartOpen(false);
      setBannerNotice({
        text: t(
          `Hold request sent to ${group.sellerName}! Continue in P2P Messages to arrange handover.`,
          `Félretételi kérelem elküldve neki: ${group.sellerName}! Folytasd a Piactér üzenetekben.`
        ),
        conversationId: res.conversation_id,
      });
      loadFeed();
    } catch (err: any) {
      setFetchError(err?.message || t('Failed to send hold request.', 'Sikertelen félretétel.'));
    } finally {
      setSendingSellerCartId(null);
    }
  };

  const cartTotalCount = cart.reduce((s, e) => s + e.quantity, 0);
  const cartSubtotal = cart.reduce((s, e) => s + e.listing.price_huf * e.quantity, 0);

  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="h-48 rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div
          className="rounded-2xl border p-8 flex flex-col items-center gap-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <span
            className="text-[11px] font-black uppercase tracking-widest px-3 py-1 rounded-full border"
            style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
          >
            {t('Private Preview', 'Privát előnézet')}
          </span>
          <h1 className="text-xl font-black" style={{ color: 'var(--text-primary)' }}>
            {t('Community P2P Marketplace Coming Soon', 'A közösségi Piactér hamarosan nyit')}
          </h1>
          <p className="text-xs sm:text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
            {t(
              'The community marketplace is currently undergoing admin testing. Check back soon or visit our official Store!',
              'A közösségi P2P piactér jelenleg adminisztrátori tesztelés alatt áll. Addig is nézz szét a hivatalos Boltban!'
            )}
          </p>
          <a
            href="/store"
            className="mt-2 px-5 py-2.5 rounded-xl text-xs font-black transition"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            {t('Visit Store', 'Ugrás a Boltba')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {t('Community Marketplace', 'Közösségi Piactér')}
            </h1>
            {!isP2PEnabledFor(false) && (
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Admin Beta
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {t(
              'Fixed-price P2P singles, Facebook-style photo posts, and bulk lots. Hold items and arrange meetup/shipping directly in P2P chat.',
              'Fix áras egyedi lapok, fotós posztok és bulk csomagok. Foglald le és egyeztess közvetlenül a piactéri üzenetekben.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!requireSignedIn()) return;
              setMineOnly((m) => !m);
            }}
            className="px-3.5 py-2 rounded-xl border text-xs font-bold transition cursor-pointer"
            style={
              mineOnly
                ? { background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }
                : { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
            }
          >
            {t('My Posts', 'Saját hirdetéseim')}
          </button>

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="px-3.5 py-2 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer hover:border-[var(--accent)]"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            <span>{t('Hold Cart', 'Kosár')}</span>
            {cartTotalCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-zinc-950">
                {cartTotalCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (!requireSignedIn()) return;
              const defaultTab: SellModeTab =
                viewMode === 'bulk' ? 'bulk' : viewMode === 'photo_posts' ? 'photo_post' : 'single';
              setSellModalTab(defaultTab);
            }}
            className="px-4 py-2 rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-lg transition cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{t('Create Post / Sell', 'Új hirdetés')}</span>
          </button>
        </div>
      </div>

      {/* Migration Notice if DB tables missing */}
      {!schemaReady && (
        <div className="px-4 py-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200 flex items-center justify-between gap-3">
          <span>
            {t(
              'Database migration 20261116100000_p2p_posts_bulk_and_holds.sql has not been applied yet. Run it in the Supabase SQL Editor to enable Photo Posts, Bulk Lots, and P2P Holds.',
              'A 20261116100000_p2p_posts_bulk_and_holds.sql migráció még nem futott le. Futtasd a Supabase SQL Editorban a teljes funkcionalitáshoz.'
            )}
          </span>
        </div>
      )}

      {/* Success Toast / CTA */}
      {bannerNotice && (
        <div
          className="px-4 py-3 rounded-2xl border flex flex-wrap items-center justify-between gap-3"
          style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.4)' }}
        >
          <span className="text-xs font-bold text-emerald-300">{bannerNotice.text}</span>
          <div className="flex items-center gap-2">
            {bannerNotice.conversationId && (
              <a
                href={`/messages?conversation=${encodeURIComponent(bannerNotice.conversationId)}`}
                className="px-3 py-1.5 rounded-lg text-xs font-black bg-emerald-500 text-zinc-950"
              >
                {t('Open P2P Chat', 'Piactéri chat megnyitása')}
              </a>
            )}
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="text-xs font-bold text-emerald-300/80 hover:text-emerald-200 cursor-pointer"
            >
              {t('Dismiss', 'Bezár')}
            </button>
          </div>
        </div>
      )}

      {/* View Mode Tabs + Filters */}
      <ToolbarContainer>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'by_card', label: t('By Card', 'Kártyák szerint') },
                { id: 'all_listings', label: t('All Listings', 'Összes ajánlat') },
                { id: 'photo_posts', label: t('Multi-Card Posts', 'Fotós posztok') },
                { id: 'bulk', label: t('Bulk', 'Bulk csomagok') },
              ] as Array<{ id: MarketplaceViewMode; label: string }>
            ).map((tab) => {
              const active = viewMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewMode(tab.id)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer"
                  style={
                    active
                      ? {
                          background: 'var(--accent-muted)',
                          borderColor: 'var(--accent)',
                          color: 'var(--text-accent)',
                        }
                      : {
                          background: 'var(--bg-surface-2)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }
                  }
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              if (!userProfile && !likedOnly) {
                setShowAuthModal(true);
                return;
              }
              setLikedOnly((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer"
            style={
              likedOnly
                ? {
                    background: 'rgba(244, 63, 94, 0.14)',
                    borderColor: 'rgba(244, 63, 94, 0.5)',
                    color: '#fb7185',
                  }
                : {
                    background: 'var(--bg-surface-2)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-secondary)',
                  }
            }
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill={likedOnly ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span>{t('Saved', 'Mentettek')}</span>
          </button>
        </div>

        {/* Search & Filter Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
          <div className="relative lg:col-span-2">
            <svg
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-tertiary)' }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('Search card name, #num, seller, or post...', 'Keresés név, szám, eladó vagy leírás alapján...')}
              className="w-full pl-9 pr-3 py-2 rounded-xl border text-xs outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <select
            value={gameFilter}
            onChange={(e) => setGameFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="">{t('All Games', 'Összes játék')}</option>
            {GAMES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          {viewMode !== 'photo_posts' && viewMode !== 'bulk' ? (
            <>
              <select
                value={conditionFilter}
                onChange={(e) => setConditionFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <option value="">{t('Any Condition', 'Minden állapot')}</option>
                {CARD_CONDITIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatCondition(c.id, lang)}
                  </option>
                ))}
              </select>

              <select
                value={foilFilter}
                onChange={(e) => setFoilFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <option value="">{t('Normal & Foil', 'Normál és Foil')}</option>
                <option value="false">{t('Normal only', 'Csak normál')}</option>
                <option value="true">{t('Foil only', 'Csak Foil')}</option>
              </select>
            </>
          ) : (
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border text-xs font-semibold outline-none lg:col-span-2"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <option value="">{t('All Countries', 'Minden ország')}</option>
              <option value="HU">Hungary (HU)</option>
              <option value="DE">Germany (DE)</option>
              <option value="AT">Austria (AT)</option>
              <option value="SK">Slovakia (SK)</option>
              <option value="RO">Romania (RO)</option>
            </select>
          )}

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="newest">{t('Newest First', 'Legfrissebb elöl')}</option>
            <option value="price_asc">{t('Lowest Price', 'Ár szerint növekvő')}</option>
            <option value="price_desc">{t('Highest Price', 'Ár szerint csökkenő')}</option>
            <option value="likes">{t('Most Saved', 'Legtöbbször mentett')}</option>
          </select>
        </div>
      </ToolbarContainer>

      {fetchError && (
        <div className="px-4 py-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-300">
          {fetchError}
        </div>
      )}

      {/* Main Content Area */}
      {loadingData ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-64 rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
          ))}
        </div>
      ) : viewMode === 'photo_posts' || viewMode === 'bulk' ? (
        posts.length === 0 ? (
          <EmptyMarketplaceState
            title={
              viewMode === 'bulk'
                ? t('No bulk lots matching your filters yet.', 'Nincs a szűrésnek megfelelő bulk csomag.')
                : t('No multi-card photo posts yet.', 'Még nincs fotós poszt.')
            }
            subtitle={t(
              'Be the first to upload photos and share your cards with the community!',
              'Legyél Te az első, aki képekkel hirdeti a kártyáit!'
            )}
            ctaLabel={viewMode === 'bulk' ? t('Post a Bulk Lot', 'Bulk csomag hirdetése') : t('Create Photo Post', 'Fotós poszt készítése')}
            onAction={() => {
              if (requireSignedIn()) setSellModalTab(viewMode === 'bulk' ? 'bulk' : 'photo_post');
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {posts.map((post) => (
              <PhotoPostCard
                key={post.id}
                post={post}
                currentUserId={userProfile?.id || null}
                likeBusy={likeBusyId === post.id}
                onToggleLike={handleTogglePostLike}
                onHoldRequest={(target) => {
                  if (requireSignedIn()) setHoldTarget(target);
                }}
                onMessageSeller={handleMessageSeller}
                onDeletePost={async (id) => {
                  await deleteMarketplacePost(id);
                  loadFeed();
                }}
                onMarkSoldOut={async (id) => {
                  await updateMarketplacePost({ id, status: 'sold_out' });
                  loadFeed();
                }}
              />
            ))}
          </div>
        )
      ) : viewMode === 'by_card' && !mineOnly ? (
        cardGroups.length === 0 ? (
          <EmptyMarketplaceState
            title={t('No cards currently listed matching these filters.', 'Nincs a szűrésnek megfelelő eladó kártya.')}
            subtitle={t(
              'Try clearing filters or post your own singles in seconds.',
              'Módosítsd a szűrőket, vagy töltsd fel a saját lapjaidat másodpercek alatt.'
            )}
            ctaLabel={t('Sell a Single Card', 'Kártya meghirdetése')}
            onAction={() => {
              if (requireSignedIn()) setSellModalTab('single');
            }}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
            {cardGroups.map((grp) => {
              const thumb = grp.card.image_path ? cardThumbProps(grp.card.image_path, 'grid') : null;
              return (
                <button
                  key={grp.key}
                  type="button"
                  onClick={() => setActiveCardGroup(grp)}
                  className="rounded-2xl border p-2.5 flex flex-col gap-2 text-left transition hover:border-[var(--accent)] cursor-pointer group"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                >
                  <div className="relative aspect-[5/7] w-full rounded-xl overflow-hidden bg-[var(--bg-input)]">
                    {thumb && (
                      <img
                        src={thumb.src}
                        srcSet={thumb.srcSet}
                        sizes={thumb.sizes}
                        alt={grp.card.name}
                        loading="lazy"
                        className="w-full h-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    )}
                    {grp.is_foil && (
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-500 text-zinc-950 shadow">
                        Foil
                      </span>
                    )}
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-black bg-black/80 text-white border border-white/10">
                      {grp.offer_count} {t('offers', 'ajánlat')}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>
                      {grp.card.name}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {grp.card.card_number} {grp.card.sets?.code ? `· ${grp.card.sets.code}` : ''}
                    </div>
                  </div>

                  <div className="pt-1.5 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div>
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        {t('From', 'Tól')}
                      </div>
                      <div className="text-xs sm:text-sm font-black" style={{ color: 'var(--text-accent)' }}>
                        {formatPrice(grp.lowest_price_huf)}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg" style={{ background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }}>
                      {grp.total_quantity} db
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : listings.length === 0 ? (
        <EmptyMarketplaceState
          title={t('No listings found.', 'Nincs találat.')}
          subtitle={t('Create a fixed-price listing to get started.', 'Tegyél fel egy fix áras hirdetést!')}
          ctaLabel={t('Sell a Single Card', 'Egyedi lap eladása')}
          onAction={() => {
            if (requireSignedIn()) setSellModalTab('single');
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {listings.map((item) => {
            const isOwn = Boolean(userProfile && userProfile.id === item.seller_id);
            const imgSrc = item.images?.[0] || (item.card.image_path ? cardThumbProps(item.card.image_path, 'grid').src : null);

            return (
              <div
                key={item.id}
                className="rounded-2xl border p-3.5 flex flex-col gap-3 justify-between"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex gap-3">
                  {imgSrc && (
                    <img
                      src={imgSrc}
                      alt={item.card.name}
                      className="w-16 h-22 rounded-xl object-cover border shrink-0"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-xs sm:text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.card.name} {item.is_foil ? '(Foil)' : ''}
                        </h3>
                        <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                          {item.card.card_number} {item.card.sets?.name ? `· ${item.card.sets.name}` : ''}
                        </p>
                      </div>
                      <LikeButton
                        compact
                        liked={item.liked_by_me}
                        count={item.likes_count}
                        busy={likeBusyId === item.id}
                        onToggle={() => handleToggleListingLike(item.id)}
                      />
                    </div>

                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[11px]">
                      <span className="font-bold px-2 py-0.5 rounded-md border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                        {formatCondition(item.condition, lang)}
                      </span>
                      <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>
                        {item.quantity} {t('avail.', 'db')}
                      </span>
                      {mineOnly && (
                        <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                          {item.status}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                      <a href={getProfileUrl(item.seller)} className="font-bold hover:underline truncate" style={{ color: 'var(--text-primary)' }}>
                        {item.seller.display_name}
                      </a>
                      <span style={{ color: 'var(--text-tertiary)' }}>· {item.seller.country}</span>
                      {item.seller.rating_count > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-amber-400 font-bold">
                          <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                          <span>{item.seller.rating_avg.toFixed(1)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {item.description && (
                  <p className="text-[11px] line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                    {item.description}
                  </p>
                )}

                <div className="pt-2.5 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="text-base font-black" style={{ color: 'var(--text-accent)' }}>
                    {formatPrice(item.price_huf)}
                  </div>

                  {isOwn ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteListing(item.id);
                        loadFeed();
                      }}
                      className="px-3 py-1.5 rounded-xl border text-xs font-bold text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {t('Remove', 'Törlés')}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handleMessageSeller(
                            item.seller_id,
                            t(`Hi! Question about ${item.card.name} (${item.card.card_number}).`, `Szia! Érdeklődnék a ${item.card.name} (${item.card.card_number}) lap iránt.`)
                          )
                        }
                        className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer hover:border-[var(--accent)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        {t('Chat', 'Üzenet')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddToCart(item)}
                        className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer hover:border-[var(--accent)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        {t('+ Cart', '+ Kosár')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!requireSignedIn()) return;
                          setHoldTarget({
                            mode: 'listing',
                            title: item.card.name,
                            subtitle: `${item.card.card_number}${item.is_foil ? ' · Foil' : ''} · ${formatCondition(item.condition, lang)}`,
                            sellerName: item.seller.display_name,
                            priceHuf: item.price_huf,
                            maxQuantity: item.quantity,
                            listingId: item.id,
                            imageUrl: imgSrc,
                          });
                        }}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-black cursor-pointer"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                      >
                        {t('Hold', 'Félretétel')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Multi-seller P2P Hold Cart Drawer */}
      <GenericCartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onOpen={() => setCartOpen(true)}
        floatingButton={cartTotalCount > 0}
        bumpKey={cartBump}
        title={t('Hold Cart', 'Félretételi kosár')}
        subtitle={t('Grouped per seller — arranged directly in chat', 'Eladónként csoportosítva — egyeztetés üzenetben')}
        totalCount={cartTotalCount}
        subtotalHuf={cartSubtotal}
        groupBySeller
        sellerGroups={sellerCartGroups}
        onClear={() => {
          setCart([]);
          saveP2PCart([]);
        }}
        onUpdateQuantity={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        renderSellerControls={(group) => (
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              disabled={sendingSellerCartId === group.sellerId}
              onClick={() => handleRequestSellerGroupHold(group)}
              className="px-3.5 py-2 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
            >
              {sendingSellerCartId === group.sellerId
                ? t('Sending...', 'Küldés...')
                : t(`Hold All from ${group.sellerName}`, `Félretétel tőle: ${group.sellerName}`)}
            </button>
          </div>
        )}
        emptyTitle={t('Your P2P hold cart is empty', 'A félretételi kosarad üres')}
        emptySubtitle={t(
          'Add singles from sellers to request one bundled hold per seller.',
          'Adj hozzá lapokat eladóktól, hogy egyben kérd a félretételt.'
        )}
      />

      {sellModalTab && (
        <SellModal
          initialTab={sellModalTab}
          onClose={() => setSellModalTab(null)}
          onSuccess={(createdType) => {
            setSellModalTab(null);
            if (createdType === 'bulk') setViewMode('bulk');
            else if (createdType === 'photo_post') setViewMode('photo_posts');
            else if (viewMode === 'photo_posts' || viewMode === 'bulk') setViewMode('all_listings');
            loadFeed();
          }}
        />
      )}

      {activeCardGroup && (
        <CardOffersModal
          group={activeCardGroup}
          currentUserId={userProfile?.id || null}
          likeBusyId={likeBusyId}
          onClose={() => setActiveCardGroup(null)}
          onToggleLike={handleToggleListingLike}
          onAddToCart={handleAddToCart}
          onHoldNow={(target) => {
            if (requireSignedIn()) setHoldTarget(target);
          }}
          onMessageSeller={handleMessageSeller}
        />
      )}

      {holdTarget && (
        <HoldConfirmModal
          target={holdTarget}
          onClose={() => setHoldTarget(null)}
          onSuccess={(conversationId) => {
            setHoldTarget(null);
            setActiveCardGroup(null);
            setBannerNotice({
              text: t(
                'Hold request sent! Continue with the seller in P2P Messages.',
                'Félretételi kérelem elküldve! Folytasd a Piactér üzenetekben.'
              ),
              conversationId,
            });
            loadFeed();
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            getCurrentProfile().then(setUserProfile);
          }}
        />
      )}
    </div>
  );
}

function EmptyMarketplaceState({
  title,
  subtitle,
  ctaLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  ctaLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      className="rounded-2xl border p-10 text-center flex flex-col items-center gap-3"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div
        className="w-12 h-12 rounded-2xl border flex items-center justify-center"
        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--accent)' }}
      >
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
      <h3 className="text-sm sm:text-base font-black" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <p className="text-xs max-w-md" style={{ color: 'var(--text-secondary)' }}>
        {subtitle}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="mt-1 px-4 py-2 rounded-xl text-xs font-black cursor-pointer"
        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
      >
        {ctaLabel}
      </button>
    </div>
  );
}
