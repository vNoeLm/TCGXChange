import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { isUnreleasedSet } from '../../lib/cardPreview';
import { t } from '../../lib/labels';
import { useSiteTheme } from '../../lib/theme';
import { useUrlOverlay } from '../../lib/useUrlOverlay';
import { useLoadMore, LoadMoreFooter } from '../LoadMore';
import { useWishlists, wishlistCardIds } from '../../lib/wishlists';
import { FilterDrawer } from '../FilterDrawer';
import { countActiveFilters } from '../../lib/activeFilterCount';
import { CardItem } from '../CardItem';
import { CardGroupTile } from './CardGroupTile';
import { CardListingsModal } from './CardListingsModal';
import { QuickShopModal } from './QuickShopModal';
import { groupListingsByCard, type CardListingGroup } from '../../lib/marketplaceGrouping';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { FilterSidebar } from '../FilterSidebar';
import { ListCardModal } from './ListCardModal';
import { matchesCardVariants, compareCardsByRarity } from '../../lib/cardVariants';
import { gridSizeClasses } from '../../lib/gridSize';
import { getCurrentProfile, onSignedInUserChange } from '../../lib/auth';
import { useCart } from '../../lib/useCart';
import { cartItemCount, CART_OPEN_EVENT } from '../../lib/marketplaceCart';
import type { InventoryCard, FilterState } from '../../types';
import {
  SETS, RARITIES, TYPES, DOMAINS, TAGS,
  STORAGE_KEYS, EVENTS, SORT_MODES, type SortMode, sortSetNames,
  MTG_RARITIES, MTG_TYPES,
  ONEPIECE_RARITIES, ONEPIECE_TYPES, ONEPIECE_COLORS,
  LORCANA_RARITIES, LORCANA_TYPES, LORCANA_INKS,
  STARWARS_RARITIES, STARWARS_TYPES, STARWARS_ASPECTS,
  FAB_RARITIES, FAB_TYPES, FAB_CLASSES,
} from '../../lib/constants';

const DEFAULT_FILTERS: FilterState = {
  category: "singles",
  game: "riftbound",
  set: "",
  rarities: [],
  type: "",
  domains: [],
  tags: [],
  costMin: 1,
  costMax: 10,
  stockStatus: "In Stock",
  foilFilter: false,
  signedFilter: 'all',
  altArtFilter: 'all',
  overnumberedFilter: 'all',
  spFilter: 'all',
  baseSetFilter: 'all',
};

export function MarketplaceApp() {
  const { theme } = useSiteTheme();
  const mktCart = useCart();
  const mktCartCount = cartItemCount(mktCart);
  const [showFilters, setShowFilters] = useState(false);

  // Filters State driven by global game
  const [filters, setFilters] = useState<FilterState>(() => {
    const savedGame = (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME)) || 'riftbound';
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const sellerId = params?.get('seller_id') || undefined;
    // "Show in marketplace" on a wishlist links here with ?wishlist=<id>.
    const wishlistId = params?.get('wishlist') || undefined;
    return { ...DEFAULT_FILTERS, game: savedGame, sellerId, wishlistId };
  });
  const [sellerFilterName, setSellerFilterName] = useState<string | null>(null);

  // Search, Sort, and Grid
  const [searchQuery, setSearchQuery] = useState('');
  const [sellerSearch, setSellerSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('Price (Low to High)');
  const [sortOpen, setSortOpen] = useState(false);
  const [gridSize, setGridSize] = useState<'small' | 'normal' | 'large'>('normal');
  // "cards" groups every listing of a card into one tile (Cardmarket-style); "listings" shows
  // each listing separately. Left unset it follows whether the view is scoped to one seller.
  const [viewOverride, setViewOverride] = useState<'cards' | 'listings' | null>(null);
  // Country whose marketplace is shown: the signed-in user's profile country, HU for guests.
  const [viewerCountry, setViewerCountry] = useState('HU');
  // Both overlays live in the URL - ?card= for a card's listings, ?listing= for one listing - so
  // Back closes the top one and either can be shared as a link.
  const [selectedGroupCardId, openGroup, closeGroup] = useUrlOverlay('card');
  const handleOpenGroup = useCallback((group: CardListingGroup) => {
    openGroup(group.card_id);
  }, [openGroup]);

  // Listings State
  const [cards, setCards] = useState<InventoryCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedInventoryId, openListing, closeListing] = useUrlOverlay('listing');
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [isQuickShopOpen, setIsQuickShopOpen] = useState(false);
  const [quickShopText, setQuickShopText] = useState('');

  const sortRef = useRef<HTMLDivElement>(null);
  const lastLoggedSearchRef = useRef<string>('');
  const hasLoadedOnceRef = useRef(false);

  // The catalog's "Quick Shop this list" button hands its want-list over through sessionStorage.
  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem('tcg_quickshop_prefill');
      if (prefill) {
        sessionStorage.removeItem('tcg_quickshop_prefill');
        setQuickShopText(prefill);
        setIsQuickShopOpen(true);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    // Global Game Sync
    const handleGameChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ game: string }>;
      if (customEvent.detail?.game) {
        const freshFilters: FilterState = {
          ...DEFAULT_FILTERS,
          game: customEvent.detail.game,
        };
        setFilters(freshFilters);
      }
    };
    window.addEventListener(EVENTS.GAME_CHANGE, handleGameChange);

    return () => {
      window.removeEventListener(EVENTS.GAME_CHANGE, handleGameChange);
    };
  }, []);

  // Resolve the display name for the "filtered by seller" banner.
  useEffect(() => {
    if (!filters.sellerId) {
      setSellerFilterName(null);
      return;
    }
    let cancelled = false;
    import('../../lib/reviews').then(({ fetchSellerRatingSummary }) => {
      fetchSellerRatingSummary(filters.sellerId).then(s => {
        if (!cancelled) setSellerFilterName(s.display_name || 'this seller');
      });
    });
    return () => {
      cancelled = true;
    };
  }, [filters.sellerId]);

  const clearSellerFilter = () => {
    setFilters(prev => ({ ...prev, sellerId: undefined }));
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('seller_id');
      window.history.replaceState(window.history.state, '', url.toString());
    }
  };

  const { lists: allWishlists } = useWishlists();
  const wishlists = useMemo(() => allWishlists.filter(w => w.game === (filters.game || 'riftbound')), [allWishlists, filters.game]);

  // Load marketplace listings
  const fetchMarketplaceListings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.game) params.set('game', filters.game);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (sellerSearch.trim()) params.set('seller', sellerSearch.trim());
      if (filters.set) params.set('set', filters.set);
      if (filters.rarities && filters.rarities.length > 0) params.set('rarities', filters.rarities.join(','));
      if (filters.type) params.set('type', filters.type);
      if (filters.domains && filters.domains.length > 0) params.set('domains', filters.domains.join(','));
      if (filters.tags && filters.tags.length > 0) params.set('tags', filters.tags.join(','));
      if (filters.foilFilter) params.set('foil', 'true');
      if (filters.sellerId) params.set('seller_id', filters.sellerId);
      params.set('viewer_country', viewerCountry);
      params.set('status', 'in_stock');
      params.set('pageSize', '500');

      setFetchError(null);
      const res = await fetch(`/api/marketplace/listings?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setCards(json.data || []);
          setTotalCount(json.count || (json.data ? json.data.length : 0));
        } else {
          setFetchError(json.error || 'Failed to load marketplace listings.');
        }
      } else {
        setFetchError('Failed to load marketplace listings.');
      }
    } catch (err: any) {
      console.warn('Marketplace fetch error:', err);
      setFetchError(err?.message || ('Network error loading listings.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadCountry = () => getCurrentProfile().then(p => setViewerCountry((p?.country || 'HU').toUpperCase())).catch(() => {});
    loadCountry();
    return onSignedInUserChange((session) => {
      if (session) loadCountry();
      else setViewerCountry('HU');
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmedQuery = searchQuery.trim();
      if (trimmedQuery.length >= 2 && trimmedQuery !== lastLoggedSearchRef.current) {
        lastLoggedSearchRef.current = trimmedQuery;
        fetch('/api/analytics/search-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmedQuery, game: filters.game, context: 'marketplace' }),
        }).catch(() => {});
      }
      fetchMarketplaceListings();
      // The debounce is for typing; the first load has nothing to wait for.
    }, hasLoadedOnceRef.current ? 150 : 0);
    hasLoadedOnceRef.current = true;

    const handleMarketplaceChange = () => fetchMarketplaceListings();
    window.addEventListener('tcg-marketplace-changed', handleMarketplaceChange);
    window.addEventListener(EVENTS.STORE_INVENTORY_CHANGE, handleMarketplaceChange);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('tcg-marketplace-changed', handleMarketplaceChange);
      window.removeEventListener(EVENTS.STORE_INVENTORY_CHANGE, handleMarketplaceChange);
    };
  }, [filters, searchQuery, sellerSearch, viewerCountry]);

  // Lock body scroll when detail modal open
  useEffect(() => {
    if (selectedInventoryId || selectedGroupCardId) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = orig;
      };
    }
  }, [selectedInventoryId, selectedGroupCardId]);

  // Close sort dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter & sort listings
  const sortedCards = useMemo(() => {
    const wishlist = filters.wishlistId ? wishlists.find(w => w.id === filters.wishlistId) : undefined;
    const wishlistIds = wishlist ? wishlistCardIds(wishlist.items) : null;
    const filtered = cards.filter(card =>
      matchesCardVariants(card, filters) && (!wishlistIds || wishlistIds.has(card.card_id))
    );
    return filtered.sort((a, b) => {
      if (sortMode === 'Price (Low to High)') {
        return (a.price_huf ?? 0) - (b.price_huf ?? 0);
      }
      if (sortMode === 'Price (High to Low)') {
        return (b.price_huf ?? 0) - (a.price_huf ?? 0);
      }
      if (sortMode === 'Quantity (High to Low)') {
        return (b.quantity || 0) - (a.quantity || 0);
      }
      if (sortMode === 'Quantity (Low to High)') {
        return (a.quantity || 0) - (b.quantity || 0);
      }
      if (sortMode === 'Card Number (Asc)') {
        return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
      }
      if (sortMode === 'Card Number (Desc)') {
        return (b.card_number || '').localeCompare(a.card_number || '', undefined, { numeric: true });
      }
      if (sortMode === 'Rarity (High to Low)') {
        return compareCardsByRarity(a, b, 'desc');
      }
      if (sortMode === 'Rarity (Low to High)') {
        return compareCardsByRarity(a, b, 'asc');
      }
      if (sortMode === 'Name (A to Z)') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortMode === 'Name (Z to A)') {
        return (b.name || '').localeCompare(a.name || '');
      }
      return 0;
    });
  }, [cards, filters, sortMode, wishlists]);

  const sellerScoped = Boolean(filters.sellerId) || sellerSearch.trim() !== '';
  useEffect(() => { setViewOverride(null); }, [sellerScoped]);
  const view: 'cards' | 'listings' = viewOverride ?? (sellerScoped ? 'listings' : 'cards');

  const groupedCards = useMemo(() => {
    const groups = groupListingsByCard(cards.filter(card => matchesCardVariants(card, filters)));
    return groups.sort((a, b) => {
      if (sortMode === 'Price (Low to High)') return (a.lowest_price || Infinity) - (b.lowest_price || Infinity);
      if (sortMode === 'Price (High to Low)') return b.lowest_price - a.lowest_price;
      if (sortMode === 'Quantity (High to Low)') return b.total_quantity - a.total_quantity;
      if (sortMode === 'Quantity (Low to High)') return a.total_quantity - b.total_quantity;
      if (sortMode === 'Name (A to Z)') return (a.representative.name || '').localeCompare(b.representative.name || '');
      if (sortMode === 'Name (Z to A)') return (b.representative.name || '').localeCompare(a.representative.name || '');
      if (sortMode === 'Card Number (Asc)') return (a.representative.card_number || '').localeCompare(b.representative.card_number || '', undefined, { numeric: true });
      if (sortMode === 'Card Number (Desc)') return (b.representative.card_number || '').localeCompare(a.representative.card_number || '', undefined, { numeric: true });
      if (sortMode === 'Rarity (High to Low)') return compareCardsByRarity(a.representative, b.representative, 'desc');
      if (sortMode === 'Rarity (Low to High)') return compareCardsByRarity(a.representative, b.representative, 'asc');
      return 0;
    });
  }, [cards, filters, sortMode]);

  const selectedGroup = useMemo(
    () => (selectedGroupCardId ? groupedCards.find(g => g.card_id === selectedGroupCardId) || null : null),
    [groupedCards, selectedGroupCardId]
  );

  const isRiftbound = !filters.game || filters.game === 'riftbound';
  const isOnePiece = filters.game === 'onepiece';
  const [allSetsForGame, setAllSetsForGame] = useState<string[]>([]);

  useEffect(() => {
    const g = filters.game || 'riftbound';
    if (g === 'riftbound') {
      setAllSetsForGame(SETS);
    } else {
      supabase
        .from('sets')
        .select('name, release_date')
        .eq('game', g)
        .order('release_date', { ascending: false })
        .then(({ data }) => {
          if (data && data.length > 0) {
            const released = data.filter(s => !isUnreleasedSet(s.release_date));
            setAllSetsForGame(released.map(s => s.name));
          }
        });
    }
  }, [filters.game]);

  const availableSets = useMemo(() => {
    const setNames = new Set(allSetsForGame.length > 0 ? allSetsForGame : (isRiftbound ? SETS : []));
    cards.forEach(c => {
      if (c.set_name) setNames.add(c.set_name);
    });
    return isRiftbound ? sortSetNames(Array.from(setNames)) : Array.from(setNames);
  }, [cards, allSetsForGame, isRiftbound]);

  const sidebar = (
    <FilterSidebar
      filters={filters}
      setFilters={setFilters}
      options={{
        sets: availableSets,
        wishlists: wishlists.map(w => ({ id: w.id, name: w.name })),
        rarities:
          filters.game === 'mtg' ? MTG_RARITIES :
          filters.game === 'onepiece' ? ONEPIECE_RARITIES :
          filters.game === 'lorcana' ? LORCANA_RARITIES :
          filters.game === 'starwars' ? STARWARS_RARITIES :
          filters.game === 'fab' ? FAB_RARITIES :
          RARITIES,
        types:
          filters.game === 'mtg' ? MTG_TYPES :
          filters.game === 'onepiece' ? ONEPIECE_TYPES :
          filters.game === 'lorcana' ? LORCANA_TYPES :
          filters.game === 'starwars' ? STARWARS_TYPES :
          filters.game === 'fab' ? FAB_TYPES :
          TYPES,
        domains:
          filters.game === 'onepiece' ? ONEPIECE_COLORS :
          filters.game === 'lorcana' ? LORCANA_INKS :
          filters.game === 'starwars' ? STARWARS_ASPECTS :
          filters.game === 'fab' ? FAB_CLASSES :
          isRiftbound ? DOMAINS : [],
        tags: isRiftbound ? TAGS : [],
      }}
    />
  );

  const activeFilterBadgeCount = useMemo(() => countActiveFilters(filters), [filters]);

  // Only the grid is batched - the "N cards for sale across M listings" line uses the full lists.
  const shownTotal = view === 'cards' ? groupedCards.length : sortedCards.length;
  const loadMoreState = useLoadMore(
    shownTotal,
    48,
    JSON.stringify([filters, searchQuery, sellerSearch, sortMode, view])
  );

  // ─── LIVE MARKETPLACE ───────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 24px' }}>
      {/* The page's heading for screen readers - the big title banner that used to sit here took
          a screenful on a phone; its two actions now sit with the other controls below. */}
      <h1 className="sr-only">Community Marketplace</h1>

      {filters.sellerId && (
        <div
          className="rounded-xl px-4 py-2.5 mb-6 border flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)' }}
        >
          <span className="text-xs sm:text-sm font-bold" style={{ color: 'var(--text-accent)' }}>
            Showing listings from {sellerFilterName || 'this seller'}
          </span>
          <button
            type="button"
            onClick={clearSellerFilter}
            className="text-xs font-bold px-3 py-1 rounded-lg border transition cursor-pointer hover:brightness-110"
            style={{ borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Filters live in their own off-canvas panel (see FilterDrawer's own comment for why),
          triggered by the Filters button below, not pinned in the page layout. */}
      <div className="grid grid-cols-1">
        <main className="min-w-0">
          {/* Search, Sort & Grid Controls */}
          <div className="mb-5">
            <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 items-stretch sm:items-center">
              {/* Filters trigger - opens the off-canvas panel */}
              <button
                type="button"
                onClick={() => setShowFilters(true)}
                className="h-11 px-3.5 flex items-center justify-center gap-2 rounded-xl border text-xs font-bold transition cursor-pointer shrink-0 hover:brightness-110" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
              >
                <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span>Filters</span>
                {activeFilterBadgeCount > 0 && (
                  <span className="w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center shrink-0" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}>
                    {activeFilterBadgeCount}
                  </span>
                )}
              </button>

              {/* Search Bar */}
              <div className="flex-1 relative">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  type="text"
                  placeholder={'Search by card name, number, or artist…'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-11 rounded-xl pl-10 pr-4 text-sm outline-none transition border" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Seller Search */}
              <div className="relative sm:w-52 shrink-0">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <input
                  type="text"
                  placeholder={'Filter by seller…'}
                  value={sellerSearch}
                  onChange={(e) => setSellerSearch(e.target.value)}
                  className="w-full h-11 rounded-xl pl-10 pr-4 text-sm outline-none transition border" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                />
              </div>

              {/* Sort & Grid Size Controls */}
              {/* Sort and card size: a row each on a phone - side by side, the size switcher ran
                  ~40px past the screen edge and cut "Large" off. */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
                {/* Sort Dropdown */}
                <div className="relative w-full sm:w-56 shrink-0 z-40" ref={sortRef}>
                  <button
                    type="button"
                    onClick={() => setSortOpen(prev => !prev)}
                    className="w-full h-11 px-3.5 flex items-center justify-between gap-1.5 rounded-xl border text-xs font-semibold transition shadow-sm cursor-pointer select-none hover:brightness-110" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
                  >
                    <span className="truncate">{sortMode}</span>
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${sortOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--text-tertiary)' }}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {sortOpen && (
                    <div className="absolute right-0 mt-1.5 w-full sm:w-56 rounded-xl border shadow-2xl z-50 overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
                      {SORT_MODES.map((mode, idx) => {
                        const isSelected = sortMode === mode;
                        const isLighterPair = Math.floor(idx / 2) % 2 === 0;
                        const isPairEnd = idx % 2 === 1 && idx < SORT_MODES.length - 1;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => { setSortMode(mode); setSortOpen(false); }}
                            className={`w-full flex items-center justify-between px-3.5 py-2 text-xs font-semibold transition cursor-pointer text-left ${
                              isPairEnd ? 'border-b border-[var(--border-subtle)]' : ''
                            } ${
                              isSelected
                                ? 'bg-[var(--accent-muted)] text-[var(--text-accent)] font-bold'
                                : `${isLighterPair ? 'bg-[var(--bg-surface-2)]' : 'bg-[var(--bg-input)]'} text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]`
                            }`}
                          >
                            <span>{mode}</span>
                            {isSelected && (
                              <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Grid Size Switcher */}
                <div className="grid grid-cols-3 sm:flex h-11 box-border gap-1 items-center border p-1 rounded-xl w-full sm:w-auto" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                  {(["small", "normal", "large"] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setGridSize(s)}
                      className={`h-full px-2.5 sm:px-3 text-[11px] sm:text-xs rounded-lg transition cursor-pointer capitalize border ${
                        gridSize === s
                          ? 'text-[var(--text-primary)] font-bold bg-[var(--bg-raised)] border-[var(--border-hover)] shadow-sm'
                          : 'bg-transparent border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] font-semibold'
                      }`}
                    >
                      {t(s)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mt-3">
            <div className="flex flex-col gap-3 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>View:</span>
              {([
                { id: 'cards', label: 'By card' },
                { id: 'listings', label: 'All listings' },
              ] as const).map(pill => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setViewOverride(pill.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer border ${
                    view === pill.id
                      ? 'bg-[var(--accent-muted)] text-[var(--text-accent)] border-[var(--accent-border)] shadow-sm'
                      : 'border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  }`}
                  style={view === pill.id ? undefined : { background: 'var(--bg-surface-2)' }}
                >
                  {pill.label}
                </button>
              ))}
            </div>
            </div>

            {/* Actions: Cart + Quick Shop + List Card for Sale */}
            <div className="grid grid-cols-2 lg:flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent(CART_OPEN_EVENT))}
                className="px-3.5 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer shadow-sm active:scale-95 flex items-center justify-center gap-1.5 border"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                title="Open Marketplace Cart"
              >
                <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
                <span>Cart ({mktCartCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setIsQuickShopOpen(true)}
                className="px-4 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer shadow-sm active:scale-95 flex items-center justify-center gap-2 border"
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
                title="Paste a want-list and let us find the cards for you"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>Quick Shop</span>
              </button>
              <button
                type="button"
                onClick={() => setIsListModalOpen(true)}
                className="col-span-2 lg:col-span-1 px-4 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer shadow-sm active:scale-95 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <circle cx="7" cy="7" r="1" />
                </svg>
                <span className="whitespace-nowrap">+ List Card for Sale</span>
              </button>
            </div>
            </div>

            <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {view === 'cards'
                ? `${groupedCards.length} ${groupedCards.length === 1 ? 'card' : 'cards'} for sale across ${sortedCards.length} ${sortedCards.length === 1 ? 'listing' : 'listings'}`
                : `${sortedCards.length} marketplace ${sortedCards.length === 1 ? 'listing' : 'listings'} found`}
            </p>
          </div>

          {/* Cards Grid */}
          {loading ? (
            <div className={`grid ${gridSizeClasses(gridSize)}`}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ borderRadius: 16, background: "var(--bg-surface-2)", height: 320, animation: "pulse 1.5s ease-in-out infinite" }} />
              ))}
            </div>
          ) : fetchError ? (
            <div 
              className="rounded-3xl p-12 text-center border shadow-sm"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', borderWidth: 1, borderStyle: 'solid', color: 'var(--negative)' }}>
                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h3 className="text-base font-bold mb-1" style={{ color: 'var(--negative)' }}>
                Error loading marketplace listings
              </h3>
              <p className="text-xs max-w-sm mx-auto mb-5" style={{ color: 'var(--text-tertiary)' }}>
                {fetchError}
              </p>
              <button
                type="button"
                onClick={() => fetchMarketplaceListings()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer hover:brightness-110 border" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
              >
                Retry
              </button>
            </div>
          ) : (view === 'cards' ? groupedCards.length : sortedCards.length) === 0 ? (
            <div 
              className="rounded-3xl p-12 text-center border shadow-sm"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <div className="w-14 h-14 rounded-2xl border flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </div>
              <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                No marketplace listings found
              </h3>
              <p className="text-xs max-w-sm mx-auto mb-5" style={{ color: 'var(--text-tertiary)' }}>
                Try clearing filters or search term, or be the first to list a card by clicking "+ List Card for Sale"!
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsListModalOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-md"
                >
                  + List a Card Now
                </button>
                <a
                  href="/"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer border"
                  style={{
                    background: 'var(--accent-muted)',
                    borderColor: 'var(--accent)',
                    color: 'var(--text-accent)'
                  }}
                >
                  <span>Browse Catalog</span>
                  <span>→</span>
                </a>
              </div>
            </div>
          ) : view === 'cards' ? (
            <div className={`grid ${gridSizeClasses(gridSize)}`}>
              {groupedCards.slice(0, loadMoreState.shown).map((group, i) => (
                <CardGroupTile
                  key={group.card_id}
                  group={group}
                  onClick={handleOpenGroup}
                  gridSize={gridSize}
                  priority={i < 4}
                />
              ))}
            </div>
          ) : (
            <div className={`grid ${gridSizeClasses(gridSize)}`}>
              {sortedCards.slice(0, loadMoreState.shown).map((card, i) => (
                <CardItem
                  key={card.inventory_id}
                  card={card}
                  onClick={openListing}
                  gridSize={gridSize}
                  priority={i < 4}
                />
              ))}
            </div>
          )}
          {!loading && !fetchError && (
            <LoadMoreFooter state={loadMoreState} total={shownTotal} noun={view === 'cards' ? 'cards' : 'listings'} />
          )}
        </main>
      </div>

      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        title="Filter Marketplace"
        activeCount={activeFilterBadgeCount}
        applyLabel={`Apply & View ${totalCount} Listing${totalCount === 1 ? '' : 's'}`}
      >
        {sidebar}
      </FilterDrawer>

      {/* Per-card listings (Cardmarket-style detail) */}
      {selectedGroup && (
        <CardListingsModal
          group={selectedGroup}
          onClose={closeGroup}
          onSelectListing={openListing}
        />
      )}

      {/* Card Detail Modal */}
      <CardPreviewOverlay inventoryId={selectedInventoryId} onClose={closeListing} zIndex={100} />

      <QuickShopModal
        isOpen={isQuickShopOpen}
        onClose={() => setIsQuickShopOpen(false)}
        game={filters.game || 'riftbound'}
        initialText={quickShopText}
      />

      {/* List Card Modal */}
      <ListCardModal
        isOpen={isListModalOpen}
        onClose={() => setIsListModalOpen(false)}
        onSuccess={() => fetchMarketplaceListings()}
        
      />
    </div>
  );
}

