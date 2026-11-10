import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { isUnreleasedSet } from '../../lib/cardPreview';
import { t as label } from '../../lib/labels';
import { useLanguage } from '../../lib/i18n';
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
import { useBodyScrollLock } from '../../lib/scrollLock';
import { FilterSidebar } from '../FilterSidebar';
import { ListCardModal } from './ListCardModal';
import { compareCardsByRarity } from '../../lib/cardVariants';
import { matchesMarketplaceCard } from '../../lib/marketplaceCardFilter';
import { gridSizeClasses } from '../../lib/gridSize';
import { getCurrentProfile, onSignedInUserChange } from '../../lib/auth';
import { useCart } from '../../lib/useCart';
import { SearchCommandIntelliSense } from '../common/SearchCommandIntelliSense';
import { cartItemCount, CART_OPEN_EVENT } from '../../lib/marketplaceCart';
import type { InventoryCard, FilterState, MarketplaceBulkListing, MarketplaceAuction } from '../../types';
import { BulkCard } from './BulkCard';
import { BulkDetailModal } from './BulkDetailModal';
import { AuctionCard } from './AuctionCard';
import { AuctionDetailModal } from './AuctionDetailModal';
import { AddListingModal, type AddListingTab } from './AddListingModal';
import { parseMarketplaceUrlParams, type MarketplaceViewTab } from '../../lib/marketplaceUrlState';
import {
  getLikedListingIds,
  getEffectiveLikeCount,
  syncUserLikesWithServer,
  saveStoredLikeCount,
  clearUserLikes,
  EVENTS as INTERACTION_EVENTS,
} from '../../lib/marketplaceInteractions';
import {
  SETS, RARITIES, TYPES, DOMAINS, TAGS,
  STORAGE_KEYS, EVENTS, SORT_MODE_GROUPS, type SortMode, sortSetNames, GAMES,
  MTG_RARITIES, MTG_TYPES,
  ONEPIECE_RARITIES, ONEPIECE_TYPES, ONEPIECE_COLORS,
  LORCANA_RARITIES, LORCANA_TYPES, LORCANA_INKS,
  STARWARS_RARITIES, STARWARS_TYPES, STARWARS_ASPECTS,
  FAB_RARITIES, FAB_TYPES, FAB_CLASSES,
} from '../../lib/constants';

const DEFAULT_FILTERS: FilterState = {
  category: "singles",
  game: "riftbound",
  sets: [],
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

const SORT_MODE_LABELS_HU: Record<string, string> = {
  'Price (Low to High)': 'Ár (Növekvő)',
  'Price (High to Low)': 'Ár (Csökkenő)',
  'Most Liked': 'Legkedveltebb',
  'Quantity (High to Low)': 'Mennyiség (Csökkenő)',
  'Quantity (Low to High)': 'Mennyiség (Növekvő)',
  'Card Number (Asc)': 'Kártyaszám (Növekvő)',
  'Card Number (Desc)': 'Kártyaszám (Csökkenő)',
  'Rarity (High to Low)': 'Ritkaság (Csökkenő)',
  'Rarity (Low to High)': 'Ritkaság (Növekvő)',
  'Name (A to Z)': 'Név (A - Z)',
  'Name (Z to A)': 'Név (Z - A)',
};

export function MarketplaceApp() {
  const { theme } = useSiteTheme();
  const { t, lang } = useLanguage();
  const getSortModeLabel = (mode: string) => (lang === 'hu' && SORT_MODE_LABELS_HU[mode]) ? SORT_MODE_LABELS_HU[mode] : mode;
  const mktCart = useCart();
  const mktCartCount = cartItemCount(mktCart);
  const [showFilters, setShowFilters] = useState(false);

  // Filters State driven by global game (initialized to SSR-safe defaults; restored on mount)
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    game: 'riftbound',
  }));
  const [sellerFilterName, setSellerFilterName] = useState<string | null>(null);

  // Search, Sort, and Grid
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [sellerSearch, setSellerSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('Price (Low to High)');
  const [sortOpen, setSortOpen] = useState(false);
  const [gridSize, setGridSize] = useState<'small' | 'normal' | 'large'>('normal');
  // "cards" groups every listing of a card into one tile; "listings" shows each listing;
  // "bulk" shows bulk lots; "auctions" shows live auctions; "likes" shows user liked items.
  const [view, setView] = useState<'cards' | 'listings' | 'bulk' | 'auctions' | 'likes'>('cards');
  // Country whose marketplace is shown: the signed-in user's profile country, HU for guests.
  const [viewerCountry, setViewerCountry] = useState('HU');
  // Overlays live in the URL - ?card=, ?listing=
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
  const [isQuickShopOpen, setIsQuickShopOpen] = useState(false);
  const [quickShopText, setQuickShopText] = useState('');

  // Saved Likes State (initialized to SSR-safe defaults; restored on mount)
  const [likedListingIds, setLikedListingIds] = useState<Set<string>>(() => new Set());

  // Bulk & Auctions State
  const [bulkListings, setBulkListings] = useState<MarketplaceBulkListing[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [selectedBulkId, openBulk, closeBulk] = useUrlOverlay('bulk');
  const [deepLinkedBulk, setDeepLinkedBulk] = useState<MarketplaceBulkListing | null>(null);

  const [auctions, setAuctions] = useState<MarketplaceAuction[]>([]);
  const [auctionsLoading, setAuctionsLoading] = useState(false);
  const [selectedAuctionId, openAuction, closeAuction] = useUrlOverlay('auction');
  const [deepLinkedAuction, setDeepLinkedAuction] = useState<MarketplaceAuction | null>(null);

  const selectViewTab = useCallback((nextView: MarketplaceViewTab) => {
    setView(nextView);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      if (nextView === 'cards') {
        url.searchParams.delete('tab');
      } else {
        url.searchParams.set('tab', nextView);
      }
      window.history.replaceState(window.history.state, '', url.toString());
    }
  }, []);

  // Unified Add Listing Modal State
  const [isAddListingOpen, setIsAddListingOpen] = useState(false);
  const [addListingInitialTab, setAddListingInitialTab] = useState<AddListingTab>('single');

  const openAddListing = (tab?: AddListingTab) => {
    const chosenTab: AddListingTab = tab || (view === 'bulk' ? 'bulk' : view === 'auctions' ? 'auction' : 'single');
    setAddListingInitialTab(chosenTab);
    setIsAddListingOpen(true);
  };

  const sortRef = useRef<HTMLDivElement>(null);
  const lastLoggedSearchRef = useRef<string>('');
  const hasLoadedOnceRef = useRef(false);

  // Fetch bulk listings from /api/marketplace/bulk
  const fetchBulkListings = async () => {
    setBulkLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.game) params.set('game', filters.game);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (filters.sellerId) params.set('seller_id', filters.sellerId);
      if (sellerSearch.trim()) params.set('seller', sellerSearch.trim());
      params.set('status', 'in_stock');

      const res = await fetch(`/api/marketplace/bulk?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          const list = json.data || [];
          setBulkListings(list);
          list.forEach((b: any) => {
            if (b.id && typeof b.likes_count === 'number') {
              saveStoredLikeCount(b.id, b.likes_count);
            }
          });
        }
      }
    } catch (e) {
      console.warn('Bulk fetch error:', e);
    } finally {
      setBulkLoading(false);
    }
  };

  // Fetch auctions from /api/marketplace/auctions
  const fetchAuctions = async () => {
    setAuctionsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.game) params.set('game', filters.game);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (filters.sellerId) params.set('seller_id', filters.sellerId);
      if (sellerSearch.trim()) params.set('seller', sellerSearch.trim());
      params.set('status', 'active');

      const res = await fetch(`/api/marketplace/auctions?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          const list = json.data || [];
          setAuctions(list);
          list.forEach((a: any) => {
            if (a.id && typeof a.likes_count === 'number') {
              saveStoredLikeCount(a.id, a.likes_count);
            }
          });
        }
      }
    } catch (e) {
      console.warn('Auctions fetch error:', e);
    } finally {
      setAuctionsLoading(false);
    }
  };

  // Sync liked items & interaction events
  useEffect(() => {
    const handleListingLiked = (e: Event) => {
      setLikedListingIds(getLikedListingIds());
      const detail = (e as CustomEvent).detail;
      if (!detail?.listingId) return;
      setCards(prev => prev.map(c => c.inventory_id === detail.listingId ? { ...c, likes_count: detail.count } : c));
      setBulkListings(prev => prev.map(b => b.id === detail.listingId ? { ...b, likes_count: detail.count } : b));
      setAuctions(prev => prev.map(a => a.id === detail.listingId ? { ...a, likes_count: detail.count } : a));
    };

    window.addEventListener(INTERACTION_EVENTS.LISTING_LIKED, handleListingLiked);

    // Initial server sync for likes
    syncUserLikesWithServer().then(() => {
      setLikedListingIds(getLikedListingIds());
    });

    return () => {
      window.removeEventListener(INTERACTION_EVENTS.LISTING_LIKED, handleListingLiked);
    };
  }, []);

  // Hydration sync: restore active game, tab view, & deep-link modal params safely after mount
  useEffect(() => {
    setLikedListingIds(getLikedListingIds());

    const savedGame = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME);
    const validGame = savedGame && GAMES.some(g => g.id === savedGame && g.active !== false) ? savedGame : 'riftbound';
    const params = new URLSearchParams(window.location.search);
    const sellerId = params.get('seller_id') || undefined;
    const wishlistId = params.get('wishlist') || undefined;

    setFilters(prev => ({
      ...prev,
      game: validGame,
      sellerId: sellerId || prev.sellerId,
      wishlistId: wishlistId || prev.wishlistId,
    }));

    const syncUrlState = () => {
      const rawSearch = window.location.search;
      const searchParams = new URLSearchParams(rawSearch);
      const parsed = parseMarketplaceUrlParams(rawSearch);
      if (parsed.view) {
        setView(parsed.view);
      }
      // Support *_id query aliases by normalizing into useUrlOverlay canonical params
      if (parsed.auctionId && !searchParams.get('auction')) openAuction(parsed.auctionId);
      if (parsed.bulkId && !searchParams.get('bulk')) openBulk(parsed.bulkId);
      if (parsed.listingId && !searchParams.get('listing')) openListing(parsed.listingId);
      if (parsed.cardId && !searchParams.get('card')) openGroup(parsed.cardId);
    };

    syncUrlState();
    window.addEventListener('popstate', syncUrlState);
    return () => window.removeEventListener('popstate', syncUrlState);
  }, [openAuction, openBulk, openListing, openGroup]);

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

  const { lists: allWishlists, loading: wishlistsLoading } = useWishlists();
  const wishlists = useMemo(() => allWishlists.filter(w => w.game === (filters.game || 'riftbound')), [allWishlists, filters.game]);

  // "Show in marketplace" links here with ?wishlist=<id>.
  const wishlistFilter = useMemo(
    () => (filters.wishlistId ? wishlists.find(w => w.id === filters.wishlistId) || null : null),
    [filters.wishlistId, wishlists]
  );
  const wishlistFilterIds = useMemo(
    () => (wishlistFilter ? wishlistCardIds(wishlistFilter.items) : null),
    [wishlistFilter]
  );

  const clearWishlistFilter = () => {
    setFilters(prev => ({ ...prev, wishlistId: undefined }));
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('wishlist');
      window.history.replaceState(window.history.state, '', url.toString());
    }
  };

  /** One place for the filters that apply to a card, so the grouped tiles and the per-listing view can't drift apart. */
  const matchesFilters = useCallback(
    (card: InventoryCard) => matchesMarketplaceCard(card, filters, wishlistFilterIds),
    [filters, wishlistFilterIds]
  );

  // Load marketplace listings
  const fetchMarketplaceListings = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.game) params.set('game', filters.game);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (sellerSearch.trim()) params.set('seller', sellerSearch.trim());
      if (filters.sets && filters.sets.length > 0) params.set('sets', filters.sets.join(','));
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
          if (Array.isArray(json.data)) {
            json.data.forEach((c: any) => {
              if (c.inventory_id && typeof c.likes_count === 'number') {
                saveStoredLikeCount(c.inventory_id, c.likes_count);
              }
            });
          }
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
    const syncLikes = () => {
      syncUserLikesWithServer().then(({ likedListingIds: lIds }) => {
        setLikedListingIds(new Set(lIds));
      }).catch(() => {});
    };

    loadCountry();
    syncLikes();
    return onSignedInUserChange((session) => {
      if (session) {
        loadCountry();
        syncLikes();
      } else {
        setViewerCountry('HU');
        clearUserLikes();
        setLikedListingIds(new Set());
      }
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
      fetchBulkListings();
      fetchAuctions();
      // The debounce is for typing; the first load has nothing to wait for.
    }, hasLoadedOnceRef.current ? 150 : 0);
    hasLoadedOnceRef.current = true;

    const handleMarketplaceChange = () => {
      fetchMarketplaceListings();
      fetchBulkListings();
      fetchAuctions();
    };
    window.addEventListener('tcg-marketplace-changed', handleMarketplaceChange);
    window.addEventListener(EVENTS.STORE_INVENTORY_CHANGE, handleMarketplaceChange);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('tcg-marketplace-changed', handleMarketplaceChange);
      window.removeEventListener(EVENTS.STORE_INVENTORY_CHANGE, handleMarketplaceChange);
    };
  }, [filters, searchQuery, sellerSearch, viewerCountry]);

  // Lock body scroll when detail modal open
  useBodyScrollLock(Boolean(selectedInventoryId || selectedGroupCardId || selectedBulkId || selectedAuctionId));

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
    const filtered = cards.filter(matchesFilters);
    return filtered.sort((a, b) => {
      if (sortMode === 'Price (Low to High)') {
        return (a.price_huf ?? 0) - (b.price_huf ?? 0);
      }
      if (sortMode === 'Price (High to Low)') {
        return (b.price_huf ?? 0) - (a.price_huf ?? 0);
      }
      if (sortMode === 'Most Liked') {
        const aLikes = getEffectiveLikeCount(a.inventory_id, 'listing', a.likes_count);
        const bLikes = getEffectiveLikeCount(b.inventory_id, 'listing', b.likes_count);
        return bLikes - aLikes;
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
  }, [cards, matchesFilters, sortMode]);

  const groupedCards = useMemo(() => {
    const groups = groupListingsByCard(cards.filter(matchesFilters));
    return groups.sort((a, b) => {
      if (sortMode === 'Price (Low to High)') return (a.lowest_price || Infinity) - (b.lowest_price || Infinity);
      if (sortMode === 'Price (High to Low)') return b.lowest_price - a.lowest_price;
      if (sortMode === 'Most Liked') {
        const aLikes = a.listings.reduce((sum, l) => sum + getEffectiveLikeCount(l.inventory_id, 'listing', l.likes_count), 0);
        const bLikes = b.listings.reduce((sum, l) => sum + getEffectiveLikeCount(l.inventory_id, 'listing', l.likes_count), 0);
        return bLikes - aLikes;
      }
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
  }, [cards, matchesFilters, sortMode]);

  const sortedBulk = useMemo(() => {
    let list = [...bulkListings];
    if (filters.sellerId) {
      list = list.filter(b => b.seller_id === filters.sellerId);
    }
    if (sellerSearch.trim()) {
      const q = sellerSearch.trim().toLowerCase();
      list = list.filter(b => (b.seller_name || '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => {
      if (sortMode === 'Price (Low to High)') return (a.price_huf ?? 0) - (b.price_huf ?? 0);
      if (sortMode === 'Price (High to Low)') return (b.price_huf ?? 0) - (a.price_huf ?? 0);
      if (sortMode === 'Name (A to Z)') return (a.title || '').localeCompare(b.title || '');
      if (sortMode === 'Name (Z to A)') return (b.title || '').localeCompare(a.title || '');
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [bulkListings, filters.sellerId, sellerSearch, sortMode]);

  const sortedAuctions = useMemo(() => {
    let list = [...auctions];
    if (filters.sellerId) {
      list = list.filter(a => a.seller_id === filters.sellerId);
    }
    if (sellerSearch.trim()) {
      const q = sellerSearch.trim().toLowerCase();
      list = list.filter(a => (a.seller_name || '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => {
      if (sortMode === 'Price (Low to High)') return (a.current_bid_huf || a.base_price_huf) - (b.current_bid_huf || b.base_price_huf);
      if (sortMode === 'Price (High to Low)') return (b.current_bid_huf || b.base_price_huf) - (a.current_bid_huf || a.base_price_huf);
      if (sortMode === 'Name (A to Z)') return (a.title || '').localeCompare(b.title || '');
      if (sortMode === 'Name (Z to A)') return (b.title || '').localeCompare(a.title || '');
      return new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime();
    });
  }, [auctions, filters.sellerId, sellerSearch, sortMode]);

  const likedCards = useMemo(() => {
    return cards.filter(c => likedListingIds.has(c.inventory_id));
  }, [cards, likedListingIds]);

  const likedBulk = useMemo(() => {
    return bulkListings.filter(b => likedListingIds.has(b.id));
  }, [bulkListings, likedListingIds]);

  const likedAuctions = useMemo(() => {
    return auctions.filter(a => likedListingIds.has(a.id));
  }, [auctions, likedListingIds]);

  const likedTotalCount = likedCards.length + likedBulk.length + likedAuctions.length;

  // Resolve deep-linked items even if they belong to another game filter or ended status
  useEffect(() => {
    if (!selectedAuctionId || auctionsLoading) return;
    if (auctions.some(a => a.id === selectedAuctionId) || deepLinkedAuction?.id === selectedAuctionId) return;
    fetch('/api/marketplace/auctions?status=all&game=all')
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        const match = Array.isArray(json?.data) ? json.data.find((a: any) => a.id === selectedAuctionId) : null;
        if (match) setDeepLinkedAuction(match);
      })
      .catch(() => {});
  }, [selectedAuctionId, auctions, auctionsLoading, deepLinkedAuction]);

  useEffect(() => {
    if (!selectedBulkId || bulkLoading) return;
    if (bulkListings.some(b => b.id === selectedBulkId) || deepLinkedBulk?.id === selectedBulkId) return;
    fetch('/api/marketplace/bulk?status=all&game=all')
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        const match = Array.isArray(json?.data) ? json.data.find((b: any) => b.id === selectedBulkId) : null;
        if (match) setDeepLinkedBulk(match);
      })
      .catch(() => {});
  }, [selectedBulkId, bulkListings, bulkLoading, deepLinkedBulk]);

  const selectedBulk = useMemo(
    () =>
      selectedBulkId
        ? bulkListings.find(b => b.id === selectedBulkId) ||
          (deepLinkedBulk?.id === selectedBulkId ? deepLinkedBulk : null)
        : null,
    [bulkListings, selectedBulkId, deepLinkedBulk]
  );

  const selectedAuction = useMemo(
    () =>
      selectedAuctionId
        ? auctions.find(a => a.id === selectedAuctionId) ||
          (deepLinkedAuction?.id === selectedAuctionId ? deepLinkedAuction : null)
        : null,
    [auctions, selectedAuctionId, deepLinkedAuction]
  );

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
  const shownTotal = view === 'cards'
    ? groupedCards.length
    : view === 'bulk'
    ? sortedBulk.length
    : view === 'auctions'
    ? sortedAuctions.length
    : view === 'likes'
    ? likedTotalCount
    : sortedCards.length;
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
      <h1 className="sr-only">{t(`Community Marketplace`, `Közösségi piactér`)}</h1>

      {filters.sellerId && (
        <div
          className="rounded-xl px-4 py-2.5 mb-6 border flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)' }}
        >
          <span className="text-xs sm:text-sm font-bold" style={{ color: 'var(--text-accent)' }}>
            {t(`Showing listings from`, `Hirdetések tőle:`)} {sellerFilterName || t(`this seller`, `ez az eladó`)}
          </span>
          <button
            type="button"
            onClick={clearSellerFilter}
            className="text-xs font-bold px-3 py-1 rounded-lg border transition cursor-pointer hover:brightness-110"
            style={{ borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
          >
            {t(`Clear filter`, `Szűrő törlése`)}
          </button>
        </div>
      )}

      {filters.wishlistId && (
        <div
          className="rounded-xl px-4 py-2.5 mb-6 border flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
        >
          <span className="text-xs sm:text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {wishlistFilter
              ? <>{t(`Showing only cards on the wishlist`, `Csak a kívánságlista kártyái:`)} "{wishlistFilter.name}"</>
              : wishlistsLoading
              ? t(`Loading that wishlist…`, `Kívánságlista betöltése…`)
              : t(`That wishlist is not available - it may belong to another account or game`, `Ez a kívánságlista nem érhető el – más fiókhoz vagy játékhoz tartozhat`)}
          </span>
          <button
            type="button"
            onClick={clearWishlistFilter}
            className="text-xs font-bold px-3 py-1 rounded-lg border transition cursor-pointer hover:brightness-110"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t(`Clear filter`, `Szűrő törlése`)}
          </button>
        </div>
      )}

      {/* Filters live in their own off-canvas panel (see FilterDrawer's own comment for why),
          triggered by the Filters button below, not pinned in the page layout. */}
      <div className="grid grid-cols-1">
        <main className="min-w-0">
          {/* Search, Sort & Grid Controls */}
          <div className="mb-5">
            {/* Row 1: Search & Filter Controls */}
            <div className="flex items-center gap-2 sm:gap-3 w-full">
              {/* Filters trigger - opens the off-canvas panel */}
              <button
                type="button"
                onClick={() => setShowFilters(true)}
                className="h-11 px-3 sm:px-3.5 flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl border text-xs font-bold transition cursor-pointer shrink-0 hover:brightness-110" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
              >
                <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                <span className="hidden sm:inline">{t('Filters', 'Szűrők')}</span>
                {activeFilterBadgeCount > 0 && (
                  <span className="w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center shrink-0" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}>
                    {activeFilterBadgeCount}
                  </span>
                )}
              </button>

              {/* Search Bar */}
              <div className="flex-1 relative min-w-[120px]">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={t('Search by card name, number, or artist…', 'Keresés kártyanév, szám vagy művész szerint…')}
                  value={searchQuery}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-11 rounded-xl pl-10 pr-4 text-xs sm:text-sm outline-none transition border" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                />
                <SearchCommandIntelliSense
                  inputRef={searchInputRef}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  isOpen={isSearchFocused}
                  onClose={() => setIsSearchFocused(false)}
                  lang={lang}
                />
              </div>

              {/* Seller Search */}
              <div className="relative w-32 sm:w-44 lg:w-52 shrink-0">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <input
                  type="text"
                  placeholder={t('Filter seller…', 'Szűrés eladó…')}
                  value={sellerSearch}
                  onChange={(e) => setSellerSearch(e.target.value)}
                  className="w-full h-11 rounded-xl pl-9 sm:pl-10 pr-3 sm:pr-4 text-xs sm:text-sm outline-none transition border" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            {/* Row 2: Sort & Grid Controls (left) + Action Buttons (right) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 mt-3">
              {/* Left: Sort & Grid Size Controls */}
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Sort Dropdown */}
                <div className="relative flex-1 sm:flex-none sm:w-48 lg:w-52 z-40" ref={sortRef}>
                  <button
                    type="button"
                    onClick={() => setSortOpen(prev => !prev)}
                    className="w-full h-11 px-3.5 flex items-center justify-between gap-1.5 rounded-xl border text-xs font-semibold transition shadow-sm cursor-pointer select-none hover:brightness-110" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
                  >
                    <span className="truncate">{getSortModeLabel(sortMode)}</span>
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${sortOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--text-tertiary)' }}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {sortOpen && (
                    <div className="absolute right-0 mt-1.5 w-full sm:w-56 rounded-xl border shadow-2xl z-50 overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
                      {SORT_MODE_GROUPS.map((group, groupIdx) => {
                        const isLighterGroup = groupIdx % 2 === 0;
                        const isLastGroup = groupIdx === SORT_MODE_GROUPS.length - 1;
                        return (
                          <div key={groupIdx} className={isLastGroup ? '' : 'border-b border-[var(--border-subtle)]'}>
                            {group.map((mode) => {
                              const isSelected = sortMode === mode;
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => { setSortMode(mode); setSortOpen(false); }}
                                  className={`w-full flex items-center justify-between px-3.5 py-2 text-xs font-semibold transition cursor-pointer text-left ${
                                    isSelected
                                      ? 'bg-[var(--accent-muted)] text-[var(--text-accent)] font-bold'
                                      : `${isLighterGroup ? 'bg-[var(--bg-surface-2)]' : 'bg-[var(--bg-input)]'} text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]`
                                  }`}
                                >
                                  <span>{getSortModeLabel(mode)}</span>
                                  {isSelected && (
                                    <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Grid Size Switcher */}
                <div className="grid grid-cols-3 sm:flex h-11 box-border gap-1 items-center border p-1 rounded-xl shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
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
                      {s === 'small' ? t('Small', 'Kicsi') : s === 'large' ? t('Large', 'Nagy') : t('Normal', 'Normál')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Right: The 3 Action Buttons */}
              <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto shrink-0">
                {/* 1. Quick Shop */}
                <button
                  type="button"
                  onClick={() => setIsQuickShopOpen(true)}
                  className="col-span-1 h-11 px-3 sm:px-4 rounded-xl font-bold text-xs transition cursor-pointer shadow-sm active:scale-95 flex items-center justify-center gap-1.5 border whitespace-nowrap"
                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
                  title={t('Paste a want-list and let us find the cards for you', 'Illessz be egy kívánságlistát, és megkeressük neked a kártyákat')}
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span className="btn-label-880">{t('Quick Shop', 'Gyors vásárlás')}</span>
                </button>

                {/* 2. Cart (Far right on desktop; right column on phone) */}
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent(CART_OPEN_EVENT))}
                  className="col-span-1 h-11 px-3 sm:px-3.5 rounded-xl font-bold text-xs transition cursor-pointer shadow-sm active:scale-95 flex items-center justify-center gap-1.5 border whitespace-nowrap sm:order-last"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  title={t('Open Marketplace Cart', 'Piactéri kosár megnyitása')}
                >
                  <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                  </svg>
                  <span className="btn-label-880">{t('Cart', 'Kosár')}</span>
                  <span className="text-[11px] font-bold opacity-90">({mktCartCount})</span>
                </button>

                {/* 3. Add New Listing (Full width on phone row 2; leftmost on desktop) */}
                <button
                  type="button"
                  onClick={() => openAddListing()}
                  className="col-span-2 sm:col-span-1 sm:order-first h-11 px-3 sm:px-4 rounded-xl font-black text-xs transition cursor-pointer shadow-md active:scale-95 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 hover:brightness-110 whitespace-nowrap"
                  title={t('Add a new card listing, bulk lot, or auction', 'Új kártyahirdetés, bulk tétel vagy aukció')}
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span className="btn-label-880">{t('Add New Listing', 'Új hirdetés')}</span>
                </button>
              </div>
            </div>

            {/* Row 3: View Selector Pills */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 mt-3">
              <span className="text-xs font-bold shrink-0" style={{ color: 'var(--text-tertiary)' }}>{t('View:', 'Nézet:')}</span>
              {([
                { id: 'cards', label: t('By card', 'Kártyánként') },
                { id: 'listings', label: t('All listings', 'Összes hirdetés') },
                { id: 'bulk', label: `Bulk (${sortedBulk.length})` },
                { id: 'auctions', label: lang === 'hu' ? `Aukciók (${sortedAuctions.length})` : `Auctions (${sortedAuctions.length})` },
                { id: 'likes', label: lang === 'hu' ? `Kedvelések (${likedTotalCount})` : `Likes (${likedTotalCount})` },
              ] as const).map(pill => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => selectViewTab(pill.id)}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer border flex items-center gap-1.5 ${
                    view === pill.id
                      ? 'bg-[var(--accent-muted)] text-[var(--text-accent)] border-[var(--accent-border)] shadow-sm'
                      : 'border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  }`}
                  style={view === pill.id ? undefined : { background: 'var(--bg-surface-2)' }}
                >
                  {pill.id === 'bulk' && (
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                  )}
                  {pill.id === 'auctions' && (
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  )}
                  {pill.id === 'likes' && (
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 ${likedTotalCount > 0 ? 'fill-rose-500 text-rose-500' : 'fill-none text-current'}`}
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={likedTotalCount > 0 ? 0 : 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  )}
                  <span>{pill.label}</span>
                </button>
              ))}
            </div>

            <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {view === 'cards'
                ? t(
                    `${groupedCards.length} ${groupedCards.length === 1 ? 'card' : 'cards'} for sale across ${sortedCards.length} ${sortedCards.length === 1 ? 'listing' : 'listings'}`,
                    `${groupedCards.length} kártya eladó · ${sortedCards.length} hirdetés`
                  )
                : view === 'bulk'
                ? t(`${sortedBulk.length} active bulk ${sortedBulk.length === 1 ? 'lot' : 'lots'} found`, `${sortedBulk.length} aktív bulk tétel`)
                : view === 'auctions'
                ? t(`${sortedAuctions.length} live ${sortedAuctions.length === 1 ? 'auction' : 'auctions'} found`, `${sortedAuctions.length} élő aukció`)
                : view === 'likes'
                ? t(`${likedTotalCount} liked ${likedTotalCount === 1 ? 'item' : 'items'} found`, `${likedTotalCount} kedvelt elem`)
                : t(`${sortedCards.length} marketplace ${sortedCards.length === 1 ? 'listing' : 'listings'} found`, `${sortedCards.length} hirdetés a piactéren`)}
            </p>
          </div>

          {/* Cards, Bulk & Auctions Grid */}
          {(loading || (view === 'bulk' && bulkLoading) || (view === 'auctions' && auctionsLoading)) ? (
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
                {t('Error loading marketplace listings', 'Hiba a piactér betöltésekor')}
              </h3>
              <p className="text-xs max-w-sm mx-auto mb-5" style={{ color: 'var(--text-tertiary)' }}>
                {fetchError}
              </p>
              <button
                type="button"
                onClick={() => fetchMarketplaceListings()}
                className="px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer hover:brightness-110 border" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
              >
                {t('Retry', 'Újrapróbálás')}
              </button>
            </div>
          ) : view === 'bulk' ? (
            sortedBulk.length === 0 ? (
              <div
                className="rounded-3xl p-12 text-center border shadow-sm"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="w-14 h-14 rounded-2xl border flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: '#6ee7b7' }}>
                  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </div>
                <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                  {t('No bulk lots listed yet', 'Nincs bulk tétel')}
                </h3>
                <p className="text-xs max-w-sm mx-auto mb-5" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Upload a photo of your bulk cards, enter an exact or approximate card count, and list them as a lot!', 'Tölts fel fotót a bulk kártyáidról, add meg a pontos vagy becsült darabszámot, és hirdesd meg tételként!')}
                </p>
                <button
                  type="button"
                  onClick={() => openAddListing('bulk')}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-md inline-flex items-center gap-2 hover:brightness-110 bg-emerald-500 text-zinc-950"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>{t('List a Bulk Lot Now', 'Bulk tétel hirdetése')}</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sortedBulk.slice(0, loadMoreState.shown).map((item) => (
                  <BulkCard
                    key={item.id}
                    bulk={item}
                    onClick={(b) => openBulk(b.id)}
                  />
                ))}
              </div>
            )
          ) : view === 'auctions' ? (
            sortedAuctions.length === 0 ? (
              <div
                className="rounded-3xl p-12 text-center border shadow-sm"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="w-14 h-14 rounded-2xl border flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: '#fcd34d' }}>
                  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                  {t('No live auctions found', 'Nincs élő aukció')}
                </h3>
                <p className="text-xs max-w-sm mx-auto mb-5" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Start an auction with a base price, bid steps, and automatic minute extension rules!', 'Indíts aukciót kikiáltási árral, licitlépcsővel és automatikus hosszabbítási szabályokkal!')}
                </p>
                <button
                  type="button"
                  onClick={() => openAddListing('auction')}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-md inline-flex items-center gap-2 hover:brightness-110 bg-amber-500 text-zinc-950"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>{t('Start an Auction Now', 'Aukció indítása')}</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {sortedAuctions.slice(0, loadMoreState.shown).map((auction) => (
                  <AuctionCard
                    key={auction.id}
                    auction={auction}
                    onClick={(a) => openAuction(a.id)}
                  />
                ))}
              </div>
            )
          ) : view === 'likes' ? (
            likedTotalCount === 0 ? (
              <div 
                className="rounded-3xl p-12 text-center border shadow-sm"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="w-14 h-14 rounded-2xl border flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}>
                  <svg className="w-7 h-7 fill-rose-500/20 text-rose-500" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                  {t('No liked listings yet', 'Még nincs kedvelt hirdetés')}
                </h3>
                <p className="text-xs max-w-sm mx-auto mb-5" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Click the heart icon on any card listing, bulk lot, or auction to like it and view it here later!', 'Kattints a szív ikonra bármelyik kártyahirdetésnél, bulk tételnél vagy aukciónál, hogy később itt tudd megnyitni.')}
                </p>
                <button
                  type="button"
                  onClick={() => selectViewTab('listings')}
                  className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer border"
                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
                >
                  {t('Browse All Listings', 'Összes hirdetés böngészése')}
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {likedCards.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                      <svg className="w-3.5 h-3.5 fill-rose-500 text-rose-500 shrink-0" viewBox="0 0 24 24">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      <span>{t('Liked Card Listings', 'Kedvelt kártyahirdetések')} ({likedCards.length})</span>
                    </h3>
                    <div className={`grid ${gridSizeClasses(gridSize)}`}>
                      {likedCards.map((card) => (
                        <CardItem key={card.inventory_id} card={card} onClick={openListing} gridSize={gridSize} />
                      ))}
                    </div>
                  </div>
                )}
                {likedBulk.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                      <svg className="w-3.5 h-3.5 fill-rose-500 text-rose-500 shrink-0" viewBox="0 0 24 24">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      <span>{t('Liked Bulk Lots', 'Kedvelt bulk tételek')} ({likedBulk.length})</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {likedBulk.map((bulk) => (
                        <BulkCard
                          key={bulk.id}
                          bulk={bulk}
                          onClick={(b) => openBulk(b.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {likedAuctions.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                      <svg className="w-3.5 h-3.5 fill-rose-500 text-rose-500 shrink-0" viewBox="0 0 24 24">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      <span>{t('Liked Auctions', 'Kedvelt aukciók')} ({likedAuctions.length})</span>
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {likedAuctions.map((auction) => (
                        <AuctionCard
                          key={auction.id}
                          auction={auction}
                          onClick={(a) => openAuction(a.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
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
                {t('No marketplace listings found', 'Nincs találat a piactéren')}
              </h3>
              <p className="text-xs max-w-sm mx-auto mb-5" style={{ color: 'var(--text-tertiary)' }}>
                {t('Try clearing filters or search term, or be the first to list a card by clicking "+ Add New Listing"!', 'Próbáld törölni a szűrőket vagy a keresést, vagy legyél te az első, aki kártyát hirdet az „Új hirdetés” gombbal!')}
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => openAddListing('single')}
                  className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-md"
                >
                  {t('List a Card Now', 'Kártya hirdetése')}
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
                  <span>{t('Browse Catalog', 'Katalógus böngészése')}</span>
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
            <LoadMoreFooter
              state={loadMoreState}
              total={shownTotal}
              noun={view === 'cards' ? 'cards' : view === 'bulk' ? 'bulk lots' : view === 'auctions' ? 'auctions' : 'listings'}
            />
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

      {/* Bulk Detail Modal */}
      <BulkDetailModal
        bulk={selectedBulk}
        onClose={closeBulk}
        onChanged={() => {
          fetchBulkListings();
        }}
      />

      {/* Auction Detail Modal */}
      <AuctionDetailModal
        auction={selectedAuction}
        onClose={closeAuction}
        onChanged={() => {
          fetchAuctions();
        }}
      />

      {/* Unified Add New Listing Modal (Single Card, Bulk Lot, Auction) */}
      <AddListingModal
        isOpen={isAddListingOpen}
        initialTab={addListingInitialTab}
        onClose={() => setIsAddListingOpen(false)}
        onSuccess={(type) => {
          fetchMarketplaceListings();
          fetchBulkListings();
          fetchAuctions();
          if (type === 'bulk') selectViewTab('bulk');
          else if (type === 'auction') selectViewTab('auctions');
          else if (type === 'single') selectViewTab('cards');
        }}
      />
    </div>
  );
}

