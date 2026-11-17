import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentProfile, isProfileAdmin, onSignedInUserChange } from '../../lib/auth';
import { countActiveFilters, defaultCostBounds } from '../../lib/activeFilterCount';
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
  STARWARS_TRAITS,
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
  fetchListings,
  fetchPosts,
  loadP2PCart,
  p2pCartEntryToGeneric,
  saveP2PCart,
  startP2PConversation,
  toggleLike,
  type P2PCardGroup,
  type P2PCardInfo,
  type P2PCartEntry,
  type P2PListing,
  type P2PPost,
} from '../../lib/p2pClient';
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
import { Pagination, usePagination } from '../Pagination';
import StoreBulkSinglesModal from '../store/StoreBulkSinglesModal';
import { EditListingModal } from './EditListingModal';
import { EditPostModal } from './EditPostModal';
import { HoldConfirmModal, type HoldTarget } from './HoldConfirmModal';
import { MarketplaceCardGroupTile, MarketplaceListingTile } from './MarketplaceCardTile';
import { PhotoPostCard } from './PhotoPostCard';
import { QuickBuyModal } from './QuickBuyModal';
import { SellModal, type SellModeTab } from './SellModal';

function createDefaultMktFilters(game = 'riftbound'): FilterState {
  const { costMin, costMax } = defaultCostBounds(game);
  return {
    category: 'singles',
    game,
    sets: [],
    rarities: [],
    type: '',
    domains: [],
    tags: [],
    keywords: [],
    costMin,
    costMax,
    foilFilter: false,
    signedFilter: 'all',
    overnumberedFilter: 'all',
    altArtFilter: 'all',
    spFilter: 'all',
    baseSetFilter: 'all',
  };
}

const MKT_SORT_OPTIONS: SortOption[] = [
  { mode: 'price_asc', label: 'Price (Low to High)', labelHu: 'Ár (Növekvő)' },
  { mode: 'price_desc', label: 'Price (High to Low)', labelHu: 'Ár (Csökkenő)' },
  { mode: 'newest', label: 'Newest First', labelHu: 'Legújabb elöl' },
  { mode: 'likes', label: 'Most Liked', labelHu: 'Legkedveltebb' },
];

function viewModeFromPath(pathname: string): MarketplaceViewMode {
  const seg = pathname.replace(/^\/marketplace\/?/, '').split('/')[0]?.toLowerCase() || '';
  if (seg === 'listings' || seg === 'all') return 'all_listings';
  if (seg === 'posts' || seg === 'photo-posts' || seg === 'bulk') return 'posts';
  return 'by_card';
}

function pathForViewMode(mode: MarketplaceViewMode): string {
  if (mode === 'all_listings') return '/marketplace/listings';
  if (mode === 'posts') return '/marketplace/posts';
  return '/marketplace';
}

function pathForSellTab(tab: SellModeTab): string {
  if (tab === 'post') return '/marketplace/sell/post';
  return '/marketplace/sell';
}

function parseMarketplaceRoute(pathname: string): {
  viewMode: MarketplaceViewMode;
  likedOnly: boolean;
  mineOnly: boolean;
  sellTab: SellModeTab | null;
  bulkAdderOpen: boolean;
  quickBuyOpen: boolean;
} {
  const parts = pathname.replace(/^\/marketplace\/?/, '').split('/').filter(Boolean).map((p) => p.toLowerCase());
  const seg = parts[0] || '';
  const sub = parts[1] || '';
  return {
    viewMode: viewModeFromPath(pathname),
    likedOnly: seg === 'saved',
    mineOnly: seg === 'my-posts' || seg === 'mine',
    sellTab:
      seg === 'sell'
        ? sub === 'post' || sub === 'photo-post' || sub === 'bulk'
          ? 'post'
          : 'single'
        : null,
    bulkAdderOpen: seg === 'bulk-add',
    quickBuyOpen: seg === 'quick-buy',
  };
}

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

  const { costMin: defaultMinCost, costMax: defaultMaxCost } = defaultCostBounds(f.game);
  if (f.costMin > defaultMinCost || f.costMax < defaultMaxCost) {
    const c = card.cost;
    if (c == null || c < f.costMin || c > f.costMax) return false;
  }

  if (f.foilFilter && listingFoil === false) return false;

  return matchesCardVariants(card, f);
}

export function MarketplaceApp() {
  const { lang, t } = useLanguage();

  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [activeGame, setActiveGame] = useState<string>('riftbound');

  const initialRoute = typeof window !== 'undefined' ? parseMarketplaceRoute(window.location.pathname) : null;

  const [viewMode, setViewMode] = useState<MarketplaceViewMode>(() => initialRoute?.viewMode || 'by_card');
  const [likedOnly, setLikedOnly] = useState(() => initialRoute?.likedOnly || false);
  const [mineOnly, setMineOnly] = useState(() => initialRoute?.mineOnly || false);

  // Filters & Toolbar
  const [filters, setFilters] = useState<FilterState>(() => createDefaultMktFilters());
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
  const [sellModalTab, setSellModalTab] = useState<SellModeTab | null>(() => initialRoute?.sellTab || null);
  const [editingListing, setEditingListing] = useState<P2PListing | null>(null);
  const [editingPost, setEditingPost] = useState<P2PPost | null>(null);
  const [bulkAdderOpen, setBulkAdderOpen] = useState(() => initialRoute?.bulkAdderOpen || false);
  const [quickBuyOpen, setQuickBuyOpen] = useState(() => initialRoute?.quickBuyOpen || false);
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [likeBusyId, setLikeBusyId] = useState<string | null>(null);

  // Hold Cart
  const [cart, setCart] = useState<P2PCartEntry[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartBump, setCartBump] = useState(0);
  const [sendingSellerCartId, setSendingSellerCartId] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{ text: string; conversationId?: string } | null>(null);

  const pushMarketplacePath = useCallback((targetPath: string) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.pathname !== targetPath) {
      url.pathname = targetPath;
      window.history.pushState(null, '', url.toString());
    }
  }, []);

  const currentFeedPath = useCallback(
    (vm = viewMode, liked = likedOnly, mine = mineOnly) => {
      if (liked) return '/marketplace/saved';
      if (mine) return '/marketplace/my-posts';
      return pathForViewMode(vm);
    },
    [viewMode, likedOnly, mineOnly]
  );

  const changeViewMode = useCallback((next: MarketplaceViewMode) => {
    setViewMode(next);
    pushMarketplacePath(pathForViewMode(next));
  }, [pushMarketplacePath]);

  const openSellModal = useCallback((tab: SellModeTab) => {
    setSellModalTab(tab);
    setBulkAdderOpen(false);
    setQuickBuyOpen(false);
    pushMarketplacePath(pathForSellTab(tab));
  }, [pushMarketplacePath]);

  const openBulkAdder = useCallback(() => {
    setSellModalTab(null);
    setBulkAdderOpen(true);
    setQuickBuyOpen(false);
    pushMarketplacePath('/marketplace/bulk-add');
  }, [pushMarketplacePath]);

  const openQuickBuy = useCallback(() => {
    setSellModalTab(null);
    setBulkAdderOpen(false);
    setQuickBuyOpen(true);
    pushMarketplacePath('/marketplace/quick-buy');
  }, [pushMarketplacePath]);

  const closeSubRouteModal = useCallback(() => {
    setSellModalTab(null);
    setBulkAdderOpen(false);
    setQuickBuyOpen(false);
    pushMarketplacePath(currentFeedPath());
  }, [pushMarketplacePath, currentFeedPath]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const parsed = parseMarketplaceRoute(window.location.pathname);
      setViewMode(parsed.viewMode);
      setLikedOnly(parsed.likedOnly);
      setMineOnly(parsed.mineOnly);
      setSellModalTab(parsed.sellTab);
      setBulkAdderOpen(parsed.bulkAdderOpen);
      setQuickBuyOpen(parsed.quickBuyOpen);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!authLoading && !userProfile && (sellModalTab || bulkAdderOpen || quickBuyOpen || likedOnly || mineOnly)) {
      setShowAuthModal(true);
    }
  }, [authLoading, userProfile, sellModalTab, bulkAdderOpen, quickBuyOpen, likedOnly, mineOnly]);

  // Sync game from Navbar GameSelector
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME);
      if (saved) {
        setActiveGame(saved);
        setFilters(createDefaultMktFilters(saved));
      }
    } catch {}

    const onGameChange = (e: Event) => {
      const next = (e as CustomEvent)?.detail?.game;
      if (typeof next === 'string' && next) {
        setActiveGame(next);
        setFilters(createDefaultMktFilters(next));
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
      if (viewMode === 'posts') {
        const res = await fetchPosts({
          type: 'all',
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

  const feedTopRef = useRef<HTMLDivElement>(null);

  const paginationResetKey = useMemo(
    () =>
      `${activeGame}|${viewMode}|${likedOnly}|${mineOnly}|${qLower}|${sellerLower}|${conditionFilter}|${countryFilter}|${sortBy}|${JSON.stringify(filters)}`,
    [activeGame, viewMode, likedOnly, mineOnly, qLower, sellerLower, conditionFilter, countryFilter, sortBy, filters]
  );

  const postPager = usePagination(filteredPosts, 18, paginationResetKey);
  const groupPager = usePagination(filteredCardGroups, 24, paginationResetKey);
  const listingPager = usePagination(filteredListings, 24, paginationResetKey);

  const visibleCount =
    viewMode === 'posts'
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

      {/* Compact Toolbar Matching Catalog & Image 2 */}
      <ToolbarContainer>
        {/* Row 1: Filters + Search + Seller */}
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

        {/* Row 2: Sort + Grid Size + [New Post] [Quick Buy] [Cart] */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <CatalogSortDropdown
              value={sortBy}
              onChange={setSortBy}
              options={MKT_SORT_OPTIONS}
              className="w-48 shrink-0 z-40"
            />
            {viewMode !== 'posts' && (
              <GridSizeSwitcher size={gridSize} onChange={handleGridSizeChange} />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!requireSignedIn()) return;
                openSellModal(viewMode === 'posts' ? 'post' : 'single');
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
              onClick={async () => {
                if (!requireSignedIn()) return;
                if (listings.length === 0) {
                  await fetchListings({ view: 'all_listings', game: activeGame }).then((res) =>
                    setListings(res.listings || [])
                  );
                }
                openQuickBuy();
              }}
              className="h-9 px-3.5 rounded-xl border text-xs font-black inline-flex items-center gap-1.5 transition cursor-pointer hover:brightness-110"
              style={{
                background: 'var(--accent-strong)',
                borderColor: 'var(--accent)',
                color: 'var(--text-on-accent)',
              }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span>{t('Quick Buy', 'Gyors vásárlás')}</span>
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

        {/* Row 3: View Mode Pills (Saved right next to Bulk; My Posts inline) */}
        <div className="pt-2 border-t flex flex-wrap items-center gap-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="text-[11px] font-bold mr-1" style={{ color: 'var(--text-tertiary)' }}>
            {t('View:', 'Nézet:')}
          </span>
          {(
            [
              { id: 'by_card', label: t('By Card', 'Kártyánként') },
              { id: 'all_listings', label: t('All Listings', 'Összes hirdetés') },
              { id: 'posts', label: t('Posts & Lots', 'Posztok & Csomagok') },
            ] as Array<{ id: MarketplaceViewMode; label: string }>
          ).map((tab) => {
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => changeViewMode(tab.id)}
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
              const nextLiked = !likedOnly;
              setLikedOnly(nextLiked);
              pushMarketplacePath(currentFeedPath(viewMode, nextLiked, mineOnly));
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition cursor-pointer"
            style={
              likedOnly
                ? {
                    background: '#e11d48',
                    borderColor: '#fda4af',
                    color: '#ffffff',
                    boxShadow: '0 2px 10px rgba(225, 29, 72, 0.45)',
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
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span>{t('Saved', 'Kedvelések')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!requireSignedIn()) return;
              const nextMine = !mineOnly;
              setMineOnly(nextMine);
              pushMarketplacePath(currentFeedPath(viewMode, likedOnly, nextMine));
            }}
            className="px-3 py-1 rounded-full text-xs font-bold border transition cursor-pointer"
            style={
              mineOnly
                ? {
                    background: 'var(--accent-strong)',
                    borderColor: 'var(--accent)',
                    color: 'var(--text-on-accent)',
                  }
                : {
                    background: 'var(--bg-input)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-secondary)',
                  }
            }
          >
            {t('My Posts', 'Saját')}
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
        <div ref={feedTopRef} className="text-xs font-bold px-1 scroll-mt-20" style={{ color: 'var(--text-tertiary)' }}>
          {visibleCount}{' '}
          {viewMode === 'posts' ? t('posts & lots', 'poszt / csomag') : t('results', 'találat')}
        </div>
      )}

      {/* Feed */}
      {loadingData ? (
        <div className={`grid ${gridSizeClasses(gridSize)}`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="aspect-[5/8] rounded-2xl animate-pulse" style={{ background: 'var(--bg-surface)' }} />
          ))}
        </div>
      ) : viewMode === 'posts' ? (
        filteredPosts.length === 0 ? (
          <EmptyState
            label={t('No posts or lots yet.', 'Még nincs poszt vagy csomag.')}
            ctaLabel={t('New Post', 'Új hirdetés')}
            onAction={() => {
              if (requireSignedIn()) openSellModal('post');
            }}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
              {postPager.pageItems.map((post) => (
                <PhotoPostCard
                  key={post.id}
                  post={post}
                  currentUserId={userProfile?.id || null}
                  likeBusy={likeBusyId === post.id}
                  onToggleLike={handleTogglePostLike}
                  onEditPost={(targetPost) => setEditingPost(targetPost)}
                />
              ))}
            </div>
            <Pagination state={postPager} noun={t('posts & lots', 'poszt')} scrollTargetRef={feedTopRef} />
          </>
        )
      ) : viewMode === 'by_card' && !mineOnly ? (
        filteredCardGroups.length === 0 ? (
          <EmptyState
            label={t('No listings match filters.', 'Nincs a szűrőknek megfelelő találat.')}
            ctaLabel={t('New Post', 'Új hirdetés')}
            onAction={() => {
              if (requireSignedIn()) openSellModal('single');
            }}
          />
        ) : (
          <>
            <div className={`grid ${gridSizeClasses(gridSize)}`}>
              {groupPager.pageItems.map((grp) => (
                <MarketplaceCardGroupTile
                  key={grp.key}
                  group={grp}
                  gridSize={gridSize}
                  onOpen={() => {
                    window.location.href = `/marketplace/item?card=${encodeURIComponent(grp.card_id)}&foil=${grp.is_foil}`;
                  }}
                />
              ))}
            </div>
            <Pagination state={groupPager} noun={t('cards', 'kártya')} scrollTargetRef={feedTopRef} />
          </>
        )
      ) : filteredListings.length === 0 ? (
        <EmptyState
          label={t('No listings match filters.', 'Nincs a szűrőknek megfelelő hirdetés.')}
          ctaLabel={t('New Post', 'Új hirdetés')}
          onAction={() => {
            if (requireSignedIn()) openSellModal('single');
          }}
        />
      ) : (
        <>
          <div className={`grid ${gridSizeClasses(gridSize)}`}>
            {listingPager.pageItems.map((item) => {
              const isOwn = Boolean(userProfile && userProfile.id === item.seller_id);
              const imgSrc =
                item.images?.[0] || (item.card.image_path ? cardThumbProps(item.card.image_path, 'grid').src : null);

              return (
                <MarketplaceListingTile
                  key={item.id}
                  listing={item}
                  gridSize={gridSize}
                  isOwn={isOwn}
                  likeBusy={likeBusyId === item.id}
                  onOpenDetail={() => {
                    window.location.href = `/marketplace/item?listing=${encodeURIComponent(item.id)}`;
                  }}
                  onToggleLike={() => handleToggleListingLike(item.id)}
                  onHold={() => {
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
                  onAddToCart={() => handleAddToCart(item)}
                  onMessage={() =>
                    handleMessageSeller(
                      item.seller_id,
                      t(`Hi! Question about ${item.card.name} (${item.card.card_number}).`, `Szia! Kérdésem lenne a ${item.card.name} (${item.card.card_number}) lappal kapcsolatban.`)
                    )
                  }
                  onEdit={() => setEditingListing(item)}
                />
              );
            })}
          </div>
          <Pagination state={listingPager} noun={t('listings', 'hirdetés')} scrollTargetRef={feedTopRef} />
        </>
      )}

      {/* Existing Shared Catalog FilterDrawer + FilterSidebar */}
      <FilterDrawer
        open={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        title={t('Filters', 'Szűrők')}
        activeCount={activeFilterBadgeCount}
        applyLabel={t(`Show ${visibleCount} Results`, `${visibleCount} találat`)}
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
            tags: activeGame === 'starwars' ? STARWARS_TRAITS : isRiftbound ? TAGS : [],
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

      {sellModalTab && userProfile && (
        <SellModal
          initialTab={sellModalTab}
          game={activeGame}
          onTabChange={(nextTab) => {
            setSellModalTab(nextTab);
            pushMarketplacePath(pathForSellTab(nextTab));
          }}
          onClose={closeSubRouteModal}
          onOpenBulkAdder={openBulkAdder}
          onSuccess={(createdType) => {
            setSellModalTab(null);
            if (createdType === 'post') changeViewMode('posts');
            else if (viewMode === 'posts') changeViewMode('all_listings');
            else pushMarketplacePath(currentFeedPath());
            loadFeed();
          }}
        />
      )}

      {bulkAdderOpen && userProfile && (
        <StoreBulkSinglesModal
          mode="marketplace"
          products={[]}
          endpoint="/api/marketplace/bulk-singles"
          backLabel={t('Marketplace', 'Piactér')}
          initialGame={activeGame}
          onClose={closeSubRouteModal}
          onDone={() => {
            loadFeed();
          }}
        />
      )}

      {quickBuyOpen && userProfile && (
        <QuickBuyModal
          listings={listings}
          currentUserId={userProfile?.id || null}
          onClose={closeSubRouteModal}
          onSuccess={(conversationId) => {
            closeSubRouteModal();
            setBannerNotice({
              text: t('Hold request sent.', 'Félretétel elküldve.'),
              conversationId,
            });
            loadFeed();
          }}
        />
      )}

      {holdTarget && (
        <HoldConfirmModal
          target={holdTarget}
          onClose={() => setHoldTarget(null)}
          onSuccess={(conversationId) => {
            setHoldTarget(null);
            setBannerNotice({
              text: t('Hold request sent.', 'Félretétel elküldve.'),
              conversationId,
            });
            loadFeed();
          }}
        />
      )}

      {editingListing && (
        <EditListingModal
          listing={editingListing}
          onClose={() => setEditingListing(null)}
          onSaved={() => {
            setEditingListing(null);
            loadFeed();
          }}
          onDeleted={() => {
            setEditingListing(null);
            loadFeed();
          }}
        />
      )}

      {editingPost && (
        <EditPostModal
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={() => {
            setEditingPost(null);
            loadFeed();
          }}
          onDeleted={() => {
            setEditingPost(null);
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
