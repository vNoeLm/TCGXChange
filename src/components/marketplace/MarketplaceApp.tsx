import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentProfile, isProfileAdmin, onSignedInUserChange } from '../../lib/auth';
import { countActiveFilters } from '../../lib/activeFilterCount';
import { matchesCardVariants } from '../../lib/cardVariants';
import {
  DOMAINS,
  EVENTS,
  FAB_CLASSES,
  FAB_RARITIES,
  FAB_TYPES,
  LORCANA_INKS,
  LORCANA_RARITIES,
  LORCANA_TYPES,
  MTG_RARITIES,
  MTG_TYPES,
  ONEPIECE_COLORS,
  ONEPIECE_RARITIES,
  ONEPIECE_TYPES,
  RARITIES,
  SETS,
  STARWARS_ASPECTS,
  STARWARS_RARITIES,
  STARWARS_TYPES,
  STORAGE_KEYS,
  TAGS,
  TYPES,
  sortSetNames,
} from '../../lib/constants';
import { CARD_CONDITIONS, formatCondition } from '../../lib/collectionDefaults';
import { useCurrency } from '../../lib/currency';
import { parseDomains } from '../../lib/domainColors';
import { gridSizeClasses, type GridSize } from '../../lib/gridSize';
import { useLanguage } from '../../lib/i18n';
import { cardMatchesKeywords } from '../../lib/keywordSearch';
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
  type P2PCardInfo,
  type P2PCartEntry,
  type P2PListing,
  type P2PPost,
} from '../../lib/p2pClient';
import { getProfileUrl } from '../../lib/profileUrl';
import { cardThumbProps } from '../../lib/supabase';
import type { FilterState, UserProfile } from '../../types';
import { AuthModal } from '../auth/AuthModal';
import { GenericCartDrawer, type GenericCartSellerGroup } from '../cart/GenericCartDrawer';
import { CatalogSearchBar } from '../catalog/CatalogSearchBar';
import { CatalogSortDropdown, type SortOption } from '../catalog/CatalogSortDropdown';
import { GridSizeSwitcher } from '../catalog/GridSizeSwitcher';
import { ToolbarContainer } from '../common/ToolbarContainer';
import { FilterDrawer } from '../FilterDrawer';
import { FilterSidebar } from '../FilterSidebar';
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';
import { CardOffersModal } from './CardOffersModal';
import { HoldConfirmModal, type HoldTarget } from './HoldConfirmModal';
import { LikeButton } from './LikeButton';
import { PhotoPostCard } from './PhotoPostCard';
import { SellModal, type SellModeTab } from './SellModal';

const DEFAULT_MKT_FILTERS: FilterState = {
  category: 'singles',
  game: 'riftbound',
  sets: [],
  rarities: [],
  type: '',
  domains: [],
  tags: [],
  keywords: [],
  costMin: 1,
  costMax: 10,
  foilFilter: false,
  signedFilter: 'all',
  overnumberedFilter: 'all',
  altArtFilter: 'all',
  spFilter: 'all',
  baseSetFilter: 'all',
};

const MKT_SORT_OPTIONS: SortOption[] = [
  { mode: 'price_asc', label: 'Price (Low to High)', labelHu: 'Ár (Növekvő)' },
  { mode: 'price_desc', label: 'Price (High to Low)', labelHu: 'Ár (Csökkenő)' },
  { mode: 'newest', label: 'Newest First', labelHu: 'Legújabb elöl' },
  { mode: 'likes', label: 'Most Liked', labelHu: 'Legkedveltebb' },
];

function cardMatchesCatalogFilters(card: P2PCardInfo | undefined, f: FilterState, listingFoil?: boolean): boolean {
  if (!card) return false;
  if (f.sets.length > 0 && !f.sets.includes(card.sets?.name || '')) return false;
  if (f.rarities.length > 0 && !f.rarities.includes(card.rarity || '')) return false;

  if (f.type) {
    if (f.type.toLowerCase() === 'champion') {
      if ((card.subtype || '').toLowerCase() !== 'champion') return false;
    } else if ((card.card_type || '') !== f.type) {
      return false;
    }
  }

  if (f.domains.length > 0) {
    const doms = parseDomains(card.domain).map((d) => d.name.toLowerCase());
    if (!f.domains.some((d) => doms.includes(d.toLowerCase()))) return false;
  }

  if (f.tags.length > 0) {
    const cardTags = Array.isArray(card.tags) ? card.tags : [];
    if (!f.tags.some((t) => cardTags.includes(t))) return false;
  }

  if (f.keywords && f.keywords.length > 0) {
    if (!cardMatchesKeywords(card, f.keywords, f.keywordMode || 'and')) return false;
  }

  if (f.costMin > 1 || f.costMax < 10) {
    const c = card.cost;
    if (c == null || c < f.costMin || c > f.costMax) return false;
  }

  if (f.foilFilter && listingFoil === false) return false;

  return matchesCardVariants(card, f);
}

export function MarketplaceApp() {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();

  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Navbar game sync
  const [activeGame, setActiveGame] = useState<string>('riftbound');

  const [viewMode, setViewMode] = useState<MarketplaceViewMode>('by_card');
  const [likedOnly, setLikedOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  // Filters & Toolbar
  const [filters, setFilters] = useState<FilterState>(() => ({ ...DEFAULT_MKT_FILTERS }));
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('q') || '';
  });
  const [sellerSearch, setSellerSearch] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [sortBy, setSortBy] = useState('price_asc');
  const [gridSize, setGridSize] = useState<GridSize>(() => {
    if (typeof window === 'undefined') return 'normal';
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.INVENTORY_GRID);
      if (saved === 'small' || saved === 'normal' || saved === 'large') return saved;
    } catch {}
    return 'normal';
  });

  // Data
  const [loadingData, setLoadingData] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);
  const [listings, setListings] = useState<P2PListing[]>([]);
  const [cardGroups, setCardGroups] = useState<P2PCardGroup[]>([]);
  const [posts, setPosts] = useState<P2PPost[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Modals & Actions
  const [sellModalTab, setSellModalTab] = useState<SellModeTab | null>(null);
  const [activeCardGroup, setActiveCardGroup] = useState<P2PCardGroup | null>(null);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);

  // Hold Cart
  const [cart, setCart] = useState<P2PCartEntry[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartBump, setCartBump] = useState(0);
  const [sendingSellerCartId, setSendingSellerCartId] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{ text: string; conversationId?: string } | null>(null);

  // Sync game from Navbar GameSelector
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME);
      if (saved) {
        setActiveGame(saved);
        setFilters((prev) => ({ ...DEFAULT_MKT_FILTERS, game: saved }));
      }
    } catch {}

    const onGameChange = (e: Event) => {
      const next = (e as CustomEvent)?.detail?.game;
      if (typeof next === 'string' && next) {
        setActiveGame(next);
        setFilters({ ...DEFAULT_MKT_FILTERS, game: next });
      }
    };
    window.addEventListener(EVENTS.GAME_CHANGE, onGameChange);
    return () => window.removeEventListener(EVENTS.GAME_CHANGE, onGameChange);
  }, []);

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

  const handleGridSizeChange = (next: GridSize) => {
    setGridSize(next);
    try {
      localStorage.setItem(STORAGE_KEYS.INVENTORY_GRID, next);
    } catch {}
  };

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
          game: activeGame || undefined,
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
          game: activeGame || undefined,
          condition: conditionFilter || undefined,
          country: countryFilter || undefined,
          liked_only: likedOnly ? 'true' : undefined,
          sort: sortBy,
        });
        setListings(res.listings || []);
        setCardGroups(res.cards || []);
        setSchemaReady(res.schemaReady !== false);
      }
    } catch (err: any) {
      setFetchError(err?.message || t('Failed to load marketplace.', 'Nem sikerült betölteni a piacteret.'));
    } finally {
      setLoadingData(false);
    }
  }, [isAllowed, viewMode, activeGame, conditionFilter, countryFilter, likedOnly, mineOnly, sortBy, t]);

  useEffect(() => {
    if (!authLoading && isAllowed) {
      loadFeed();
    }
  }, [authLoading, isAllowed, loadFeed]);

  // Client-side FilterSidebar + Search + Seller filtering
  const qLower = searchQuery.trim().toLowerCase();
  const sellerLower = sellerSearch.trim().toLowerCase();

  const filteredListings = useMemo(() => {
    return listings.filter((item) => {
      if (sellerLower && !item.seller.display_name.toLowerCase().includes(sellerLower)) return false;
      if (qLower) {
        const hay = [item.card.name, item.card.card_number, item.card.artist, item.card.sets?.name, item.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return cardMatchesCatalogFilters(item.card, filters, item.is_foil);
    });
  }, [listings, filters, qLower, sellerLower]);

  const filteredCardGroups = useMemo(() => {
    return cardGroups
      .map((grp) => {
        const matchedOffers = grp.offers.filter((offer) => {
          if (sellerLower && !offer.seller.display_name.toLowerCase().includes(sellerLower)) return false;
          return cardMatchesCatalogFilters(offer.card, filters, offer.is_foil);
        });
        if (matchedOffers.length === 0) return null;
        if (qLower) {
          const hay = [grp.card.name, grp.card.card_number, grp.card.artist, grp.card.sets?.name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(qLower)) return null;
        }
        return {
          ...grp,
          offers: matchedOffers,
          offer_count: matchedOffers.length,
          total_quantity: matchedOffers.reduce((s, o) => s + o.quantity, 0),
          lowest_price_huf: Math.min(...matchedOffers.map((o) => o.price_huf)),
        };
      })
      .filter(Boolean) as P2PCardGroup[];
  }, [cardGroups, filters, qLower, sellerLower]);

  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      if (sellerLower && !post.seller.display_name.toLowerCase().includes(sellerLower)) return false;
      if (qLower) {
        const hay = [
          post.title,
          post.body,
          post.seller.display_name,
          ...post.tagged_cards.map((tc) => `${tc.card?.name || ''} ${tc.card?.card_number || ''}`),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      if (countActiveFilters(filters) > 0 && post.tagged_cards.length > 0) {
        if (!post.tagged_cards.some((tc) => cardMatchesCatalogFilters(tc.card, filters, tc.is_foil))) {
          return false;
        }
      }
      return true;
    });
  }, [posts, filters, qLower, sellerLower]);

  const availableSets = useMemo(() => {
    const isRiftbound = !activeGame || activeGame === 'riftbound';
    const setNames = new Set(isRiftbound ? SETS : []);
    listings.forEach((l) => {
      if (l.card.sets?.name) setNames.add(l.card.sets.name);
    });
    posts.forEach((p) => {
      p.tagged_cards.forEach((tc) => {
        if (tc.card?.sets?.name) setNames.add(tc.card.sets.name);
      });
    });
    return isRiftbound ? sortSetNames(Array.from(setNames)) : Array.from(setNames);
  }, [activeGame, listings, posts]);

  const activeFilterBadgeCount =
    countActiveFilters(filters) + (conditionFilter ? 1 : 0) + (countryFilter ? 1 : 0);

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
      setFetchError(err?.message || 'Failed.');
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
      setFetchError(err?.message || 'Failed.');
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
      setFetchError(err?.message || t('Could not start chat.', 'Chat indítása sikertelen.'));
    }
  };

  const handleAddToCart = (listing: P2PListing) => {
    if (!requireSignedIn()) return;
    setCart((prev) => {
      const existing = prev.find((e) => e.listingId === listing.id);
      const next: P2PCartEntry[] = existing
        ? prev.map((e) =>
            e.listingId === listing.id
              ? { ...e, quantity: Math.min(listing.quantity, e.quantity + 1), listing }
              : e
          )
        : [...prev, { listingId: listing.id, quantity: 1, listing }];
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
      const remaining = cart.filter((e) => e.listing.seller_id !== group.sellerId);
      setCart(remaining);
      saveP2PCart(remaining);
      setCartOpen(false);
      setBannerNotice({
        text: t(`Hold request sent to ${group.sellerName}.`, `Félretételi kérelem elküldve: ${group.sellerName}.`),
        conversationId: res.conversation_id,
      });
      loadFeed();
    } catch (err: any) {
      setFetchError(err?.message || t('Hold request failed.', 'Sikertelen félretétel.'));
    } finally {
      setSendingSellerCartId(null);
    }
  };

  const cartTotalCount = cart.reduce((s, e) => s + e.quantity, 0);
  const cartSubtotal = cart.reduce((s, e) => s + e.listing.price_huf * e.quantity, 0);

  const visibleCount =
    viewMode === 'photo_posts' || viewMode === 'bulk'
      ? filteredPosts.length
      : viewMode === 'by_card' && !mineOnly
      ? filteredCardGroups.length
      : filteredListings.length;

  const isRiftbound = !activeGame || activeGame === 'riftbound';

  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="h-32 rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
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
          <h1 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>
            {t('Marketplace Coming Soon', 'Piactér hamarosan')}
          </h1>
          <a
            href="/store"
            className="mt-1 px-5 py-2 rounded-xl text-xs font-black"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            {t('Store', 'Bolt')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-4">
      {!schemaReady && (
        <div className="px-4 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200">
          {t(
            'Run supabase/migrations/20261116100000_p2p_posts_bulk_and_holds.sql in Supabase SQL Editor.',
            'Futtasd a 20261116100000_p2p_posts_bulk_and_holds.sql migrációt a Supabase SQL Editorban.'
          )}
        </div>
      )}

      {bannerNotice && (
        <div
          className="px-4 py-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2"
          style={{ background: 'rgba(16, 185, 129, 0.12)', borderColor: 'rgba(16, 185, 129, 0.4)' }}
        >
          <span className="text-xs font-bold text-emerald-300">{bannerNotice.text}</span>
          <div className="flex items-center gap-2">
            {bannerNotice.conversationId && (
              <a
                href={`/messages?conversation=${encodeURIComponent(bannerNotice.conversationId)}`}
                className="px-3 py-1 rounded-lg text-xs font-black bg-emerald-500 text-zinc-950"
              >
                {t('Open Chat', 'Chat megnyitása')}
              </a>
            )}
            <button
              type="button"
              onClick={() => setBannerNotice(null)}
              className="text-xs font-bold text-emerald-300 cursor-pointer"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Compact Catalog-Style Toolbar (No bloated title/subtitle hero, no extra Game Selector) */}
      <ToolbarContainer>
        {/* Row 1: Filters Button + Search Bar + Seller Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowFilterDrawer(true)}
            className="h-10 px-3.5 flex items-center justify-center gap-2 rounded-xl border text-xs font-bold transition cursor-pointer shrink-0 hover:border-[var(--accent)]"
            style={{
              background: activeFilterBadgeCount > 0 ? 'var(--accent-muted)' : 'var(--bg-input)',
              borderColor: activeFilterBadgeCount > 0 ? 'var(--accent)' : 'var(--border)',
              color: activeFilterBadgeCount > 0 ? 'var(--text-accent)' : 'var(--text-primary)',
            }}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <span>{t('Filters', 'Szűrők')}</span>
            {activeFilterBadgeCount > 0 && (
              <span
                className="w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
              >
                {activeFilterBadgeCount}
              </span>
            )}
          </button>

          <CatalogSearchBar value={searchQuery} onChange={setSearchQuery} />

          <div className="relative sm:w-52 shrink-0">
            <svg
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-muted)' }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <input
              type="text"
              value={sellerSearch}
              onChange={(e) => setSellerSearch(e.target.value)}
              placeholder={t('Filter seller...', 'Szűrés eladó...')}
              className="w-full h-10 rounded-xl pl-9 pr-3 text-xs font-medium outline-none border border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {/* Row 2: Sort + Grid Size + Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <CatalogSortDropdown
              value={sortBy}
              onChange={setSortBy}
              options={MKT_SORT_OPTIONS}
              className="w-48 shrink-0 z-40"
            />
            {viewMode !== 'photo_posts' && viewMode !== 'bulk' && (
              <GridSizeSwitcher size={gridSize} onChange={handleGridSizeChange} />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!requireSignedIn()) return;
                const defaultTab: SellModeTab =
                  viewMode === 'bulk' ? 'bulk' : viewMode === 'photo_posts' ? 'photo_post' : 'single';
                setSellModalTab(defaultTab);
              }}
              className="h-9 px-3.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition cursor-pointer bg-emerald-500 text-zinc-950 hover:brightness-110"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>{t('New Post', 'Új hirdetés')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!requireSignedIn()) return;
                setMineOnly((m) => !m);
              }}
              className="h-9 px-3 rounded-xl border text-xs font-bold transition cursor-pointer"
              style={
                mineOnly
                  ? { background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }
                  : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
              }
            >
              {t('My Posts', 'Saját')}
            </button>

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="h-9 px-3 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer hover:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <span>{t('Cart', 'Kosár')} ({cartTotalCount})</span>
            </button>
          </div>
        </div>

        {/* Row 3: View Mode Pills + Saved Right Next to Bulk (No Auctions) */}
        <div className="pt-2 border-t flex flex-wrap items-center gap-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="text-[11px] font-bold mr-1" style={{ color: 'var(--text-tertiary)' }}>
            {t('View:', 'Nézet:')}
          </span>
          {(
            [
              { id: 'by_card', label: t('By Card', 'Kártyánként') },
              { id: 'all_listings', label: t('All Listings', 'Összes hirdetés') },
              { id: 'photo_posts', label: t('Photo Posts', 'Fotós posztok') },
              { id: 'bulk', label: t('Bulk', 'Bulk') },
            ] as Array<{ id: MarketplaceViewMode; label: string }>
          ).map((tab) => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id)}
                className="px-3 py-1 rounded-full text-xs font-bold border transition cursor-pointer"
                style={
                  active
                    ? {
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent)',
                        color: 'var(--text-accent)',
                      }
                    : {
                        background: 'var(--bg-input)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)',
                      }
                }
              >
                {tab.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              if (!userProfile && !likedOnly) {
                setShowAuthModal(true);
                return;
              }
              setLikedOnly((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition cursor-pointer"
            style={
              likedOnly
                ? {
                    background: 'rgba(244, 63, 94, 0.15)',
                    borderColor: 'rgba(244, 63, 94, 0.5)',
                    color: '#fb7185',
                  }
                : {
                    background: 'var(--bg-input)',
                    borderColor: 'var(--border-subtle)',
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
            <span>{t('Saved', 'Kedvelések')}</span>
          </button>
        </div>
      </ToolbarContainer>

      {fetchError && (
        <div className="px-4 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-300">
          {fetchError}
        </div>
      )}

      {/* Results Count */}
      {!loadingData && (
        <div className="text-xs font-bold px-1" style={{ color: 'var(--text-tertiary)' }}>
          {visibleCount}{' '}
          {viewMode === 'photo_posts'
            ? t('posts', 'poszt')
            : viewMode === 'bulk'
            ? t('bulk lots', 'bulk csomag')
            : t('results', 'találat')}
        </div>
      )}

      {/* Content */}
      {loadingData ? (
        <div className={`grid ${gridSizeClasses(gridSize)}`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="aspect-[5/8] rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
          ))}
        </div>
      ) : viewMode === 'photo_posts' || viewMode === 'bulk' ? (
        filteredPosts.length === 0 ? (
          <EmptyState
            label={viewMode === 'bulk' ? t('No bulk lots yet.', 'Nincs bulk csomag.') : t('No photo posts yet.', 'Nincs fotós poszt.')}
            ctaLabel={t('Create Post', 'Új hirdetés')}
            onAction={() => {
              if (requireSignedIn()) setSellModalTab(viewMode === 'bulk' ? 'bulk' : 'photo_post');
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {filteredPosts.map((post) => (
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
        filteredCardGroups.length === 0 ? (
          <EmptyState
            label={t('No listings match your filters.', 'Nincs a szűrőknek megfelelő találat.')}
            ctaLabel={t('New Listing', 'Új hirdetés')}
            onAction={() => {
              if (requireSignedIn()) setSellModalTab('single');
            }}
          />
        ) : (
          <div className={`grid ${gridSizeClasses(gridSize)}`}>
            {filteredCardGroups.map((grp) => {
              const thumb = grp.card.image_path ? cardThumbProps(grp.card.image_path, 'grid') : null;
              const offerWord = grp.offer_count === 1 ? t('offer', 'ajánlat') : t('offers', 'ajánlat');
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
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-black bg-black/85 text-white border border-white/10">
                      {grp.offer_count} {offerWord}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase truncate" style={{ color: 'var(--text-primary)' }}>
                      {grp.card.name}
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {grp.card.sets?.name || ''}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {[grp.card.card_number, grp.card.card_type, grp.card.rarity].filter(Boolean).join(' · ')}
                    </div>
                  </div>

                  <div className="pt-1.5 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
                    <span className="text-xs font-black text-emerald-400">
                      {formatPrice(grp.lowest_price_huf)}
                    </span>
                    <span className="text-[10px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                      {grp.total_quantity} {t('In Stock', 'elérhető')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : filteredListings.length === 0 ? (
        <EmptyState
          label={t('No listings match your filters.', 'Nincs a szűrőknek megfelelő hirdetés.')}
          ctaLabel={t('New Listing', 'Új hirdetés')}
          onAction={() => {
            if (requireSignedIn()) setSellModalTab('single');
          }}
        />
      ) : (
        <div className={`grid ${gridSizeClasses(gridSize)}`}>
          {filteredListings.map((item) => {
            const isOwn = Boolean(userProfile && userProfile.id === item.seller_id);
            const imgSrc =
              item.images?.[0] || (item.card.image_path ? cardThumbProps(item.card.image_path, 'grid').src : null);

            return (
              <div
                key={item.id}
                className="rounded-2xl border p-2.5 flex flex-col gap-2 justify-between"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div>
                  {/* Artwork + Overlay Like & Foil */}
                  <div className="relative aspect-[5/7] w-full rounded-xl overflow-hidden bg-[var(--bg-input)] mb-2">
                    {imgSrc && (
                      <img
                        src={imgSrc}
                        alt={item.card.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute top-2 left-2">
                      <LikeButton
                        compact
                        liked={item.liked_by_me}
                        count={item.likes_count}
                        busy={likeBusyId === item.id}
                        onToggle={() => handleToggleListingLike(item.id)}
                      />
                    </div>
                    {item.is_foil && (
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500 text-zinc-950">
                        Foil
                      </span>
                    )}
                    <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/80 text-zinc-200">
                      {formatCondition(item.condition, lang)}
                    </span>
                  </div>

                  {/* Card Info */}
                  <div className="min-w-0">
                    <h3 className="text-xs font-black uppercase truncate" style={{ color: 'var(--text-primary)' }}>
                      {item.card.name}
                    </h3>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {item.card.sets?.name || ''}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {[item.card.card_number, item.card.card_type, item.card.rarity].filter(Boolean).join(' · ')}
                    </div>
                  </div>

                  {/* Seller Row */}
                  <a
                    href={getProfileUrl(item.seller)}
                    className="mt-2 flex items-center gap-1.5 text-[11px] hover:underline min-w-0"
                  >
                    <span
                      className="text-[9px] font-black px-1 py-0.5 rounded border shrink-0"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                    >
                      {item.seller.country}
                    </span>
                    {item.seller.avatar_url && (
                      <img
                        src={item.seller.avatar_url}
                        alt={item.seller.display_name}
                        className="w-4 h-4 rounded-full object-cover shrink-0"
                        style={resolveAvatarImageStyle(item.seller.avatar_url)}
                      />
                    )}
                    <span className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {item.seller.display_name}
                    </span>
                    {item.seller.rating_count > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-400 shrink-0">
                        <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        <span>{item.seller.rating_avg.toFixed(1)}</span>
                      </span>
                    )}
                  </a>
                </div>

                {/* Price + CTA */}
                <div className="pt-2 border-t flex flex-col gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-black text-emerald-400">
                      {formatPrice(item.price_huf)}
                    </span>
                    <span className="text-[10px] font-bold text-emerald-400/90">
                      {item.quantity} {t('In Stock', 'elérhető')}
                    </span>
                  </div>

                  {isOwn ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (mineOnly) {
                          await deleteListing(item.id);
                          loadFeed();
                        }
                      }}
                      disabled={!mineOnly}
                      className="w-full py-1.5 rounded-xl border text-[11px] font-bold transition cursor-pointer disabled:opacity-70"
                      style={{
                        background: 'var(--bg-surface-2)',
                        borderColor: 'var(--border)',
                        color: mineOnly ? '#fb7185' : 'var(--text-secondary)',
                      }}
                    >
                      {mineOnly ? t('Remove', 'Törlés') : t('Yours', 'Sajátod')}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
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
                        className="flex-1 py-1.5 rounded-xl text-[11px] font-black cursor-pointer"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                      >
                        {t('Hold', 'Félretétel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddToCart(item)}
                        title={t('Add to Cart', 'Kosárba')}
                        className="w-8 h-7 rounded-xl border flex items-center justify-center cursor-pointer hover:border-[var(--accent)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleMessageSeller(
                            item.seller_id,
                            t(`Hi! Question about ${item.card.name} (${item.card.card_number}).`, `Szia! Kérdésem lenne a ${item.card.name} (${item.card.card_number}) lappal kapcsolatban.`)
                          )
                        }
                        title={t('Message Seller', 'Üzenet az eladónak')}
                        className="w-8 h-7 rounded-xl border flex items-center justify-center cursor-pointer hover:border-[var(--accent)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Existing Shared Catalog FilterDrawer + FilterSidebar */}
      <FilterDrawer
        open={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        title={t('Filters', 'Szűrők')}
        activeCount={activeFilterBadgeCount}
        applyLabel={t(`Show ${visibleCount} Results`, `${visibleCount} találat megjelenítése`)}
      >
        <div className="flex flex-col gap-3 mb-4 pb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Condition', 'Állapot')}
            </label>
            <select
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <option value="">{t('Any Condition', 'Minden állapot')}</option>
              {CARD_CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatCondition(c.id, lang)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Country', 'Ország')}
            </label>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-xs font-semibold outline-none"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <option value="">{t('All Countries', 'Minden ország')}</option>
              <option value="HU">Hungary (HU)</option>
              <option value="DE">Germany (DE)</option>
              <option value="AT">Austria (AT)</option>
              <option value="SK">Slovakia (SK)</option>
              <option value="RO">Romania (RO)</option>
            </select>
          </div>
        </div>

        <FilterSidebar
          filters={filters}
          setFilters={(next) => {
            setFilters(next);
            if (activeFilterBadgeCount > 0 && countActiveFilters(next) === 0) {
              setConditionFilter('');
              setCountryFilter('');
            }
          }}
          options={{
            sets: availableSets,
            rarities:
              activeGame === 'mtg'
                ? MTG_RARITIES
                : activeGame === 'onepiece'
                ? ONEPIECE_RARITIES
                : activeGame === 'lorcana'
                ? LORCANA_RARITIES
                : activeGame === 'starwars'
                ? STARWARS_RARITIES
                : activeGame === 'fab'
                ? FAB_RARITIES
                : RARITIES,
            types:
              activeGame === 'mtg'
                ? MTG_TYPES
                : activeGame === 'onepiece'
                ? ONEPIECE_TYPES
                : activeGame === 'lorcana'
                ? LORCANA_TYPES
                : activeGame === 'starwars'
                ? STARWARS_TYPES
                : activeGame === 'fab'
                ? FAB_TYPES
                : TYPES,
            domains:
              activeGame === 'onepiece'
                ? ONEPIECE_COLORS
                : activeGame === 'lorcana'
                ? LORCANA_INKS
                : activeGame === 'starwars'
                ? STARWARS_ASPECTS
                : activeGame === 'fab'
                ? FAB_CLASSES
                : isRiftbound
                ? DOMAINS
                : [],
            tags: isRiftbound ? TAGS : [],
          }}
        />
      </FilterDrawer>

      {/* P2P Hold Cart Drawer */}
      <GenericCartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onOpen={() => setCartOpen(true)}
        floatingButton={cartTotalCount > 0}
        bumpKey={cartBump}
        title={t('Hold Cart', 'Kosár')}
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
                : t(`Hold All (${group.sellerName})`, `Félretétel (${group.sellerName})`)}
            </button>
          </div>
        )}
        emptyTitle={t('Cart is empty', 'A kosarad üres')}
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
              text: t('Hold request sent.', 'Félretétel elküldve.'),
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

function EmptyState({
  label,
  ctaLabel,
  onAction,
}: {
  label: string;
  ctaLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      className="rounded-2xl border p-8 text-center flex flex-col items-center gap-3"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="px-4 py-2 rounded-xl text-xs font-black cursor-pointer"
        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
      >
        {ctaLabel}
      </button>
    </div>
  );
}
