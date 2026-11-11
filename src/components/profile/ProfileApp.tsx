import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase, cardThumbProps, getCardImageUrl } from '../../lib/supabase';
import { useExitTransition } from '../../lib/useExitTransition';
import { backdropCloseProps } from '../../lib/modalBackdrop';
import {
  getCurrentProfile,
  getCurrentUser,
  signOut,
  fetchUserOrders,
  onSignedInUserChange,
  isProfileAdmin,
} from '../../lib/auth';
import { cancelOrder, deleteOrder, deleteOrders, purgeAllOrders } from '../../lib/orders';
import { fetchReviewsWrittenBy, fetchReputation, fetchSellerRatingSummary } from '../../lib/reviews';
import { RateTradeModal } from '../reviews/RateTradeModal';
import { BuyerHolds } from './BuyerHolds';
import { AvatarBannerModal, BannerContainerBackground, resolveAvatarImageStyle } from './AvatarBannerModal';
import { DeleteAccountCard } from './DeleteAccountCard';
import { ProfileQrModal } from './ProfileQrModal';
import { Stars, ReputationBreakdown, ReviewCard } from '../reviews/ReviewParts';
import type { UserProfile, Order, TradeReview, UserSocialProfiles, SellerProfileSummary, UserReputation, FilterState } from '../../types';
import { AuthModal } from '../auth/AuthModal';
import {
  useSiteTheme,
  getCustomTheme,
  saveCustomTheme,
  CUSTOM_PRESETS,
  DEFAULT_CUSTOM_THEME,
  type ThemeMode,
  type CustomThemeConfig,
} from '../../lib/theme';
import { getSellerTier, BadgeIconSvg, SiteOwnerTag } from '../../lib/badges';
import { SocialProfileButtons } from './SocialProfileButtons';
import { GAMES, RARITIES, TYPES, DOMAINS, TAGS, SETS } from '../../lib/constants';
import { getCountry } from '../../lib/countries';
import {
  getProfileUrl,
  getShortId,
  getProfileSlug,
  parseProfileLocation,
  VALID_PROFILE_TABS,
  type ProfileTab,
} from '../../lib/profileUrl';
import { CountryFlag } from '../CountryFlag';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import {
  fetchMyDecks,
  fetchPublicDecksForUser,
  setDeckVisibility,
  deletePublishedDeck,
  type PublicDeckSummary,
} from '../../lib/publicDecks';
import { ReportModal } from '../common/ReportModal';
import { ToolbarContainer } from '../common/ToolbarContainer';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { CardListItem } from '../CardListItem';
import { addToCart, cartQuantityFor } from '../../lib/marketplaceCart';
import { useCart } from '../../lib/useCart';
import { ListingLikeButton } from '../marketplace/ListingLikeButton';
import { ManageCollectionsModal } from '../collection/ManageCollectionsModal';
import { CatalogSearchBar } from '../catalog/CatalogSearchBar';
import { CatalogSortDropdown } from '../catalog/CatalogSortDropdown';
import { GridSizeSwitcher } from '../catalog/GridSizeSwitcher';
import { CollectionSwitcher } from '../collection/CollectionSwitcher';
import { CollectionValueChip } from '../CollectionValueChip';
import { FilterDrawer } from '../FilterDrawer';
import { FilterSidebar } from '../FilterSidebar';
import { countActiveFilters } from '../../lib/activeFilterCount';
import { gridSizeClasses, type GridSize } from '../../lib/gridSize';
import { matchesCardVariants, compareCardsByRarity, hasFoilVariant } from '../../lib/cardVariants';
import { useCardValueData, valueOfCard } from '../../lib/cardValues';
import { changeCollectionCard } from '../../lib/collectionsStore';
import { PERSONAL_COLLECTION_ID } from '../../lib/collectionDefaults';

const DEFAULT_COLL_FILTERS: FilterState = {
  sets: [],
  rarities: [],
  type: '',
  domains: [],
  tags: [],
  costMin: 1,
  costMax: 10,
  foilFilter: false,
  signedFilter: 'all',
  altArtFilter: 'all',
  overnumberedFilter: 'all',
  spFilter: 'all',
  baseSetFilter: 'all',
};

const DOMAIN_COLORS: Record<string, string> = {
  fury: '#ef4444',
  calm: '#22c55e',
  mind: '#3b82f6',
  body: '#f97316',
  chaos: '#a855f7',
  order: '#eab308',
  colorless: '#94a3b8',
};

const THEME_SWATCHES: { mode: ThemeMode; name: string; hex: string[] }[] = [
  { mode: 'auto', name: 'Auto (System)', hex: ['#3b82f6', '#fb7185'] },
  { mode: 'dark', name: 'Midnight Slate', hex: ['#3b82f6'] },
  { mode: 'light', name: 'Ivory Parchment', hex: ['#f3ede2', '#fb7185'] },
  { mode: 'custom', name: 'Custom Studio', hex: ['#a855f7', '#06b6d4'] },
];

const ORDER_STATUS_CONFIG: Record<string, { bg: string; color: string; border: string }> = {
  Pending: { bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: 'rgba(234, 179, 8, 0.35)' },
  Processing: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.35)' },
  Shipped: { bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', border: 'rgba(168, 85, 247, 0.35)' },
  Delivered: { bg: 'var(--positive-muted)', color: 'var(--positive)', border: 'var(--positive-border)' },
  Cancelled: { bg: 'var(--negative-muted)', color: 'var(--negative)', border: 'var(--negative-border)' },
};

function getProfileOrderStatusLabel(status: string, lang = 'en'): string {
  if (lang === 'hu') {
    switch (status) {
      case 'Pending': return 'Függőben';
      case 'Processing': return 'Feldolgozás alatt';
      case 'Shipped': return 'Feladva';
      case 'Delivered': return 'Kézbesítve';
      case 'Cancelled': return 'Törölve';
      default: return status;
    }
  }
  return status;
}

export type { ProfileTab } from '../../lib/profileUrl';

export function ProfileApp({ initialId, initialTab }: { initialId?: string; initialTab?: ProfileTab } = {}) {
  const { theme: effectiveTheme, themeMode, setThemeMode } = useSiteTheme();
  const { t, lang } = useLanguage();
  const { currency, setCurrency, formatPrice } = useCurrency();

  const initialLoc = typeof window !== 'undefined'
    ? parseProfileLocation(window.location.pathname, window.location.search, window.location.hash)
    : { userId: null, tab: null };

  // URL State
  const [urlUserId, setUrlUserId] = useState<string | null>(() => {
    return initialId || initialLoc.userId || null;
  });

  // Current Viewer State
  const [viewerProfile, setViewerProfile] = useState<UserProfile | null>(null);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);

  // Target User Profile State (either viewer or someone else)
  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(null);
  const [summary, setSummary] = useState<SellerProfileSummary | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [socialProfiles, setSocialProfiles] = useState<UserSocialProfiles | null>(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAppearanceModal, setShowAppearanceModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showManageCollectionsModal, setShowManageCollectionsModal] = useState(false);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [previewInventoryId, setPreviewInventoryId] = useState<string | null>(null);
  const cart = useCart();
  const [showGoogleReviewModal, setShowGoogleReviewModal] = useState(false);
  const [ratingModalOrder, setRatingModalOrder] = useState<Order | null>(null);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastMessageRef = useRef<string | null>(null);
  if (toastMessage) toastMessageRef.current = toastMessage;
  const toastAnim = useExitTransition(!!toastMessage, 400);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Determine whether viewing own profile
  const isMe = useMemo(() => {
    if (!viewerProfile) return false;
    if (!urlUserId) return true;
    if (targetProfile) return viewerProfile.id === targetProfile.id;
    const cleanUrl = urlUserId.toLowerCase();
    return (
      viewerProfile.id.toLowerCase() === cleanUrl ||
      getShortId(viewerProfile.id) === cleanUrl ||
      getProfileSlug(viewerProfile).toLowerCase() === cleanUrl
    );
  }, [urlUserId, viewerProfile, targetProfile]);

  const targetUserId = useMemo(() => {
    return targetProfile?.id || (viewerProfile && isMe ? viewerProfile.id : null) || urlUserId || null;
  }, [targetProfile, viewerProfile, isMe, urlUserId]);

  // Tab State
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => {
    return initialTab || initialLoc.tab || 'sale';
  });

  const handleTabChange = (tab: ProfileTab, pushToHistory = true) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const activeUser = targetProfile || (isMe ? viewerProfile : null);
      const slug = activeUser ? getProfileSlug(activeUser) : (urlUserId || '');
      const newPath = slug
        ? (tab === 'sale' ? `/profile/${slug}` : `/profile/${slug}/${tab}`)
        : (tab === 'sale' ? '/profile' : `/profile/${tab}`);

      if (pushToHistory) {
        window.history.pushState({ tab, profileSlug: slug }, '', newPath);
      } else {
        window.history.replaceState({ tab, profileSlug: slug }, '', newPath);
      }
    }
  };

  // Browser back / forward buttons (popstate)
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state && typeof e.state.tab === 'string' && (VALID_PROFILE_TABS as readonly string[]).includes(e.state.tab)) {
        setActiveTab(e.state.tab as ProfileTab);
      } else {
        const parsed = parseProfileLocation(window.location.pathname, window.location.search, window.location.hash);
        setActiveTab(parsed.tab || 'sale');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Custom Theme Studio State
  const [customConfig, setCustomConfig] = useState<CustomThemeConfig>(() => getCustomTheme());
  const [themeExpanded, setThemeExpanded] = useState(false);
  const [showThemeJsonBox, setShowThemeJsonBox] = useState(false);
  const [themeJsonInput, setThemeJsonInput] = useState('');

  useEffect(() => {
    const handleCustomChange = (e: Event) => {
      const custom = e as CustomEvent<CustomThemeConfig>;
      if (custom.detail) {
        setCustomConfig(custom.detail);
      }
    };
    window.addEventListener('tcg-custom-theme-change', handleCustomChange);
    return () => window.removeEventListener('tcg-custom-theme-change', handleCustomChange);
  }, []);

  // Collections State (Riftbound-style collection tab)
  const [publicCollections, setPublicCollections] = useState<Array<{ id: string; name: string; count: number; uniqueCount: number; isPersonal: boolean }>>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionCardsMap, setCollectionCardsMap] = useState<Record<string, number>>({});
  const [collectionCardDetails, setCollectionCardDetails] = useState<any[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);

  // Collection Filters & Controls
  const cardValues = useCardValueData();
  const [collSearch, setCollSearch] = useState('');
  const [collFilters, setCollFilters] = useState<FilterState>(DEFAULT_COLL_FILTERS);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [gridSize, setGridSize] = useState<GridSize>('normal');
  const [collSort, setCollSort] = useState<string>('Card Number (Asc)');
  const [copiedLink, setCopiedLink] = useState(false);

  const loadCollectionsData = async (uid: string, selectId?: string) => {
    setCollectionLoading(true);
    try {
      const url = selectId
        ? `/api/profile/collections?user_id=${encodeURIComponent(uid)}&collection_id=${encodeURIComponent(selectId)}`
        : `/api/profile/collections?user_id=${encodeURIComponent(uid)}`;
      const res = await fetch(url).then(r => r.json());
      if (res?.success) {
        setPublicCollections(res.collections || []);
        setActiveCollectionId(res.activeCollectionId || null);
        setCollectionCardsMap(res.cardsMap || {});
        setCollectionCardDetails(res.cardDetails || []);
      }
    } catch (e) {
      console.warn('Failed to load collections:', e);
    } finally {
      setCollectionLoading(false);
    }
  };

  const handleSelectCollection = async (collectionId: string) => {
    if (!targetUserId || collectionId === activeCollectionId) return;
    await loadCollectionsData(targetUserId, collectionId);
  };

  const handleUpdateCardCount = (cardId: string, isFoil: boolean, delta: number) => {
    const key = isFoil ? `${cardId}_foil` : cardId;
    const current = collectionCardsMap[key] || 0;
    const next = Math.max(0, current + delta);

    setCollectionCardsMap((prev) => {
      const copy = { ...prev };
      if (next === 0) delete copy[key];
      else copy[key] = next;
      return copy;
    });

    setPublicCollections((prev) =>
      prev.map((c) => {
        if (c.id === (activeCollectionId || prev[0]?.id)) {
          const diff = next - current;
          return { ...c, count: Math.max(0, (c.count || 0) + diff) };
        }
        return c;
      })
    );

    const targetCollId = activeCollection?.isPersonal ? PERSONAL_COLLECTION_ID : (activeCollectionId || PERSONAL_COLLECTION_ID);
    changeCollectionCard(targetCollId, key, delta);
  };

  const totalPublicCopies = useMemo(() => {
    return publicCollections.reduce((sum, c) => sum + (c.count || 0), 0);
  }, [publicCollections]);

  const activeCollection = useMemo(() => {
    return publicCollections.find((c) => c.id === activeCollectionId) || publicCollections[0] || null;
  }, [publicCollections, activeCollectionId]);

  const availableSets = useMemo(() => {
    const setSet = new Set<string>();
    collectionCardDetails.forEach((c) => {
      if (c.set_name) setSet.add(c.set_name);
      else if (c.set_code) setSet.add(c.set_code);
    });
    return setSet.size > 0 ? Array.from(setSet) : SETS;
  }, [collectionCardDetails]);

  const availableFilterOptions = useMemo(() => {
    return {
      sets: availableSets,
      rarities: RARITIES,
      types: TYPES,
      domains: DOMAINS,
      tags: TAGS,
    };
  }, [availableSets]);

  const activeCollFilterCount = useMemo(() => {
    return countActiveFilters(collFilters);
  }, [collFilters]);

  const cardsInActiveCollection = useMemo(() => {
    return collectionCardDetails.map((c) => {
      const normalCount = Number(collectionCardsMap[c.id]) || 0;
      const foilCount = Number(collectionCardsMap[`${c.id}_foil`]) || 0;
      const totalCopies = normalCount + foilCount;
      return {
        ...c,
        normalCount,
        foilCount,
        totalCopies,
      };
    }).filter((c) => c.totalCopies > 0);
  }, [collectionCardDetails, collectionCardsMap]);

  const filteredCards = useMemo(() => {
    let list = cardsInActiveCollection;

    if (collSearch.trim()) {
      const q = collSearch.trim().toLowerCase();
      list = list.filter((c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.card_number && c.card_number.toLowerCase().includes(q)) ||
        (c.set_code && c.set_code.toLowerCase().includes(q)) ||
        (c.set_name && c.set_name.toLowerCase().includes(q)) ||
        (c.card_type && c.card_type.toLowerCase().includes(q)) ||
        (c.artist && c.artist.toLowerCase().includes(q))
      );
    }

    if (collFilters.sets && collFilters.sets.length > 0) {
      const sLower = collFilters.sets.map((s) => s.toLowerCase());
      list = list.filter((c) => {
        const cSet = (c.set_name || c.set_code || '').toLowerCase();
        return sLower.includes(cSet);
      });
    }

    if (collFilters.rarities && collFilters.rarities.length > 0) {
      const rLower = collFilters.rarities.map((r) => r.toLowerCase());
      list = list.filter((c) => c.rarity && rLower.includes(c.rarity.toLowerCase()));
    }

    if (collFilters.type) {
      list = list.filter((c) => c.card_type && c.card_type.toLowerCase() === collFilters.type.toLowerCase());
    }

    if (collFilters.domains && collFilters.domains.length > 0) {
      const dLower = collFilters.domains.map((d) => d.toLowerCase());
      list = list.filter((c) => {
        if (!c.domain) return false;
        const doms = c.domain.toLowerCase().split(',').map((x: string) => x.trim());
        return doms.some((d: string) => dLower.includes(d));
      });
    }

    if (collFilters.foilFilter) {
      list = list.filter((c) => c.foilCount > 0);
    }

    list = list.filter((c) => matchesCardVariants(c, collFilters));

    const sortValue = (card: any): number | null => {
      const normal = valueOfCard(card, false, cardValues).valueHuf;
      const foil = hasFoilVariant(card) ? valueOfCard(card, true, cardValues).valueHuf : null;
      if (normal === null) return foil;
      return foil === null ? normal : Math.max(normal, foil);
    };

    list = [...list].sort((a, b) => {
      if (collSort === 'Est. Value (High to Low)' || collSort === 'Est. Value (Low to High)') {
        const vA = sortValue(a);
        const vB = sortValue(b);
        if (vA !== vB) {
          if (vA === null) return 1;
          if (vB === null) return -1;
          return collSort === 'Est. Value (High to Low)' ? vB - vA : vA - vB;
        }
        return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
      }
      if (collSort === 'Quantity (High to Low)') {
        if (a.totalCopies !== b.totalCopies) return b.totalCopies - a.totalCopies;
        return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
      }
      if (collSort === 'Quantity (Low to High)') {
        if (a.totalCopies !== b.totalCopies) return a.totalCopies - b.totalCopies;
        return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
      }
      if (collSort === 'Energy Cost (Low to High)' || collSort === 'Energy Cost (High to Low)') {
        const cA = typeof a.cost === 'number' ? a.cost : Number(a.energy) || 0;
        const cB = typeof b.cost === 'number' ? b.cost : Number(b.energy) || 0;
        if (cA !== cB) return collSort === 'Energy Cost (Low to High)' ? cA - cB : cB - cA;
        return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
      }
      if (collSort === 'Name (A to Z)') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (collSort === 'Name (Z to A)') {
        return (b.name || '').localeCompare(a.name || '');
      }
      if (collSort === 'Rarity (High to Low)') {
        return compareCardsByRarity(a, b, 'desc');
      }
      if (collSort === 'Rarity (Low to High)') {
        return compareCardsByRarity(a, b, 'asc');
      }
      if (collSort === 'Card Number (Desc)') {
        return (b.card_number || '').localeCompare(a.card_number || '', undefined, { numeric: true });
      }
      // Default: Card Number (Asc)
      const setA = a.set_code || '';
      const setB = b.set_code || '';
      if (setA !== setB) return setA.localeCompare(setB);
      return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
    });

    return list;
  }, [cardsInActiveCollection, collSearch, collFilters, collSort, cardValues]);

  // Listings State
  const [listings, setListings] = useState<any[]>([]);

  // Decks State
  const [decks, setDecks] = useState<PublicDeckSummary[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(true);
  const [deckArtView, setDeckArtView] = useState<Record<string, 'legend' | 'champion'>>({});

  // Reputation & Reviews State
  const [reputation, setReputation] = useState<UserReputation | null>(null);
  const [reviewTab, setReviewTab] = useState<'buyer_to_seller' | 'seller_to_buyer'>('buyer_to_seller');
  const [reviewsByOrder, setReviewsByOrder] = useState<Record<string, TradeReview>>({});

  // Orders State (Owner Only)
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [orderStatusFilter, setOrderStatusFilter] = useState('All');
  const [orderDateFilter, setOrderDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [cancellingOrderNumber, setCancellingOrderNumber] = useState<string | null>(null);
  const [deletingOrderNumber, setDeletingOrderNumber] = useState<string | null>(null);
  const [cleaningOrders, setCleaningOrders] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [highlightedOrderKey, setHighlightedOrderKey] = useState<string | null>(null);
  const deepLinkOrderHandledRef = useRef(false);
  const [chattingOrderId, setChattingOrderId] = useState<string | null>(null);
  const [copiedOrderNumber, setCopiedOrderNumber] = useState<string | null>(null);

  // Deep Link Order Handling
  useEffect(() => {
    if (loadingOrders || orders.length === 0 || deepLinkOrderHandledRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get('order') || params.get('order_number');
    const holdParam = params.get('hold') || params.get('hold_request_id');
    if (!orderParam && !holdParam) return;

    const matched = orders.find((o) => {
      if (orderParam && (o.order_number === orderParam || o.id === orderParam)) return true;
      if (holdParam && ((o as any).hold_request_id === holdParam || o.id === holdParam)) return true;
      return false;
    });

    if (matched) {
      deepLinkOrderHandledRef.current = true;
      const targetKey = matched.order_number || matched.id;
      handleTabChange('orders', false);
      setOrderStatusFilter('All');
      setOrderDateFilter('all');
      setExpandedOrders((prev) => ({ ...prev, [targetKey]: true }));
      setHighlightedOrderKey(targetKey);
      setTimeout(() => {
        const el = document.getElementById(`order-card-${targetKey}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
    }
  }, [loadingOrders, orders]);

  // Main Data Loader
  useEffect(() => {
    let isCancelled = false;

    async function init() {
      setLoading(true);
      const viewer = await getCurrentProfile().catch(() => null);
      if (isCancelled) return;
      setViewerProfile(viewer);
      setViewerIsAdmin(isProfileAdmin(viewer));

      const parsedLoc = typeof window !== 'undefined'
        ? parseProfileLocation(window.location.pathname, window.location.search, window.location.hash)
        : { userId: null, tab: null };
      const paramId = initialId || parsedLoc.userId;
      setUrlUserId(paramId);

      const requestedTab = initialTab || parsedLoc.tab;
      if (requestedTab) {
        setActiveTab(requestedTab);
      }

      const effectiveTargetId = paramId || viewer?.id || null;

      if (!effectiveTargetId) {
        setLoading(false);
        return;
      }

      const getJson = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

      try {
        const profileJson = await getJson(`/api/profile?id=${encodeURIComponent(effectiveTargetId)}`);
        if (isCancelled) return;

        const profileObj = (profileJson?.success ? (profileJson.profile || (profileJson.id ? profileJson : null)) : null);
        const resolvedTargetId = profileObj?.id || (paramId ? null : viewer?.id) || null;
        if (!resolvedTargetId) {
          setLoading(false);
          return;
        }

        const isCurrentTargetMe = Boolean(viewer && viewer.id === resolvedTargetId);
        const resolvedProf = profileObj || (isCurrentTargetMe ? viewer : null);

        if (resolvedProf) {
          setTargetProfile(resolvedProf);

          // Canonicalize browser URL to /profile/<slug>/<tab>
          if (typeof window !== 'undefined') {
            const slug = getProfileSlug(resolvedProf);
            const currentTab = requestedTab || activeTab || 'sale';
            const canonicalPath = currentTab === 'sale' ? `/profile/${slug}` : `/profile/${slug}/${currentTab}`;
            if (!window.location.pathname.startsWith(`/profile/${slug}`)) {
              window.history.replaceState({ tab: currentTab, profileSlug: slug }, '', canonicalPath);
            }
          }
        }

        if (profileJson?.banner_url) setBannerUrl(profileJson.banner_url);
        if (profileJson?.social_profiles) setSocialProfiles(profileJson.social_profiles);

        // 1. Primary data needed for profile header & landing view ('sale' tab)
        const repPromise = fetchReputation(resolvedTargetId)
          .then((revs) => {
            if (isCancelled) return null;
            setReputation(revs);
            if (revs?.as_seller?.count === 0 && revs?.as_buyer?.count > 0) {
              setReviewTab('seller_to_buyer');
            }
            if (resolvedProf) {
              setSummary({
                id: resolvedProf.id,
                display_name: resolvedProf.display_name || 'Seller',
                avatar_url: resolvedProf.avatar_url || null,
                role: (resolvedProf.role as any) || 'user',
                rating_avg: revs?.as_seller?.avg ?? 0,
                rating_count: revs?.as_seller?.count ?? 0,
                rating_categories: revs?.as_seller?.categories,
                sales_count: revs?.stats?.salesCount ?? 0,
                items_sold: revs?.stats?.itemsSold ?? 0,
                buyer_rating_avg: revs?.as_buyer?.avg ?? 0,
                buyer_rating_count: revs?.as_buyer?.count ?? 0,
                purchases_count: revs?.stats?.purchasesCount ?? 0,
                items_bought: revs?.stats?.itemsBought ?? 0,
                is_owner: (resolvedProf.role as any) === 'owner',
                created_at: (resolvedProf as any).created_at || null,
              });
            }
            return revs;
          })
          .catch(() => null);

        const listingsPromise = getJson(`/api/marketplace/listings?seller_id=${encodeURIComponent(resolvedTargetId)}`)
          .then((listingsJson) => {
            if (isCancelled) return null;
            if (listingsJson?.data) {
              setListings(listingsJson.data.filter((l: any) => l.status !== 'Sold'));
            }
            return listingsJson;
          })
          .catch(() => null);

        // 2. Secondary tabs data loaded concurrently in the background without blocking the landing view
        const collsPromise = getJson(`/api/profile/collections?user_id=${encodeURIComponent(resolvedTargetId)}`)
          .then((collsJson) => {
            if (isCancelled) return;
            if (collsJson?.success) {
              setPublicCollections(collsJson.collections || []);
              setActiveCollectionId(collsJson.activeCollectionId || null);
              setCollectionCardsMap(collsJson.cardsMap || {});
              setCollectionCardDetails(collsJson.cardDetails || []);
            }
          })
          .catch(() => {});

        const decksPromise = (isCurrentTargetMe ? fetchMyDecks() : fetchPublicDecksForUser(resolvedTargetId))
          .then((decksData) => {
            if (isCancelled) return;
            setDecks(decksData || []);
            setLoadingDecks(false);
          })
          .catch(() => {
            if (!isCancelled) setLoadingDecks(false);
          });

        const ordersPromise = isCurrentTargetMe
          ? fetchUserOrders()
              .then((userOrders) => {
                if (isCancelled) return;
                setOrders((userOrders as Order[]) || []);
                setLoadingOrders(false);
              })
              .catch(() => {
                if (!isCancelled) setLoadingOrders(false);
              })
          : Promise.resolve();

        const reviewsWrittenPromise = isCurrentTargetMe
          ? fetchReviewsWrittenBy(resolvedTargetId)
              .then((reviewsWritten) => {
                if (isCancelled) return;
                if (reviewsWritten) {
                  const map: Record<string, TradeReview> = {};
                  (reviewsWritten as TradeReview[]).forEach((r) => {
                    map[r.order_number] = r;
                  });
                  setReviewsByOrder(map);
                }
              })
              .catch(() => {})
          : Promise.resolve();

        // Release the main loading screen as soon as header + active tab data arrives
        const initialPromises: Promise<any>[] = [repPromise];
        if (!requestedTab || requestedTab === 'sale') {
          initialPromises.push(listingsPromise);
        } else if (requestedTab === 'collection') {
          initialPromises.push(collsPromise);
        } else if (requestedTab === 'decks') {
          initialPromises.push(decksPromise);
        } else if (requestedTab === 'orders') {
          initialPromises.push(ordersPromise);
        }

        await Promise.all(initialPromises);

        // Default to 'sale' (Cards for sale, the primary profile tab) only if no explicit tab was requested
        if (!requestedTab && !window.location.hash) {
          setActiveTab('sale');
        }
      } catch (err) {
        console.warn('Failed to load profile data:', err);
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    init();

    const unsubscribeAuth = onSignedInUserChange((session) => {
      if (session) {
        getCurrentProfile().then(p => {
          setViewerProfile(p);
          setViewerIsAdmin(isProfileAdmin(p));
        });
      } else {
        setViewerProfile(null);
        setViewerIsAdmin(false);
      }
    });

    return () => {
      isCancelled = true;
      unsubscribeAuth();
    };
  }, []);

  const isLightTheme = effectiveTheme === 'light';
  const isOwner = Boolean(
    targetProfile?.role === 'owner' ||
    targetProfile?.email === 'vnoel05@gmail.com' ||
    targetProfile?.email === 'support@tcgxchange.net' ||
    summary?.is_owner
  );

  const sellerTier = useMemo(() => {
    return getSellerTier(
      summary?.sales_count || 0,
      reputation?.as_seller?.avg ?? summary?.rating_avg ?? null,
      isOwner,
      isLightTheme
    );
  }, [summary, reputation, isOwner, isLightTheme]);

  const displayName = targetProfile?.display_name || summary?.display_name || (isMe ? viewerProfile?.email?.split('@')[0] : t('Collector', 'Gyűjtő')) || t('Collector', 'Gyűjtő');
  const memberSince = (targetProfile?.created_at || summary?.created_at)
    ? new Date(targetProfile?.created_at || summary?.created_at || '').toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-US', { year: 'numeric', month: 'long' })
    : null;

  // Deck Refresh Handler
  const refreshDecks = async () => {
    if (!targetUserId) return;
    setLoadingDecks(true);
    try {
      const data = isMe ? await fetchMyDecks() : await fetchPublicDecksForUser(targetUserId);
      setDecks(data);
    } finally {
      setLoadingDecks(false);
    }
  };

  // Sign out handler
  const handleSignOut = async () => {
    await signOut();
    window.location.href = '/';
  };

  // Orders Actions (Owner Only)
  const isOrderExpanded = (order: Order): boolean => {
    const key = order.order_number || order.id;
    return Boolean(expandedOrders[key]);
  };
  const toggleOrderExpand = (order: Order) => {
    const key = order.order_number || order.id;
    setExpandedOrders(prev => ({ ...prev, [key]: !isOrderExpanded(order) }));
  };
  const expandAllOrders = () => {
    const allOpen: Record<string, boolean> = {};
    orders.forEach((o) => {
      const key = o.order_number || o.id;
      if (key) allOpen[key] = true;
    });
    setExpandedOrders(allOpen);
  };
  const collapseAllOrders = () => setExpandedOrders({});

  const handleStartOrderChat = async (order: Order) => {
    const orderKey = order.order_number || order.id;
    setChattingOrderId(orderKey);
    try {
      if ((order as any).conversation_id) {
        window.location.href = `/messages?conversation_id=${(order as any).conversation_id}`;
        return;
      }
      if (order.seller_id) {
        window.location.href = `/messages?user_id=${order.seller_id}&order_number=${encodeURIComponent(orderKey)}`;
        return;
      }
      const res = await fetch('/api/store/order-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_number: orderKey }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.conversation_id) {
        window.location.href = `/messages?conversation_id=${data.conversation_id}&order_number=${encodeURIComponent(orderKey)}`;
        return;
      }
      window.location.href = `/messages?order_number=${encodeURIComponent(orderKey)}`;
    } catch {
      window.location.href = `/messages?order_number=${encodeURIComponent(orderKey)}`;
    } finally {
      setChattingOrderId(null);
    }
  };

  const handleCancelOrder = async (orderNumber: string) => {
    const confirmMsg = lang === 'hu'
      ? `Biztosan lemondod a(z) #${orderNumber} rendelést? A tételek visszakerülnek az elérhető készletbe.`
      : `Are you sure you want to cancel order #${orderNumber}? The items will return to available stock.`;

    if (!window.confirm(confirmMsg)) return;

    setCancellingOrderNumber(orderNumber);
    try {
      const res = await cancelOrder(orderNumber);
      if (res.success) {
        setOrders(prev => prev.map(o => o.order_number === orderNumber ? { ...o, status: 'Cancelled' } : o));
        showToast(lang === 'hu' ? 'Rendelés lemondva, a tételek visszakerültek a készletbe!' : 'Order cancelled, items returned to stock!');
      } else {
        alert(res.error || (lang === 'hu' ? 'A rendelés lemondása nem sikerült.' : 'Failed to cancel order.'));
      }
    } catch (err: any) {
      alert(err?.message || (lang === 'hu' ? 'Hiba történt a rendelés lemondásakor.' : 'Error cancelling order.'));
    } finally {
      setCancellingOrderNumber(null);
    }
  };

  const handleDeleteOrder = async (orderNumber: string) => {
    const confirmMsg = lang === 'hu'
      ? `Biztosan eltávolítod a(z) #${orderNumber} rendelést a rendelési előzményeidből? (A rendelési adatok a rendszerben megmaradnak)`
      : `Are you sure you want to remove order #${orderNumber} from your history? (Order data remains in the system)`;
    if (!window.confirm(confirmMsg)) return;
    setDeletingOrderNumber(orderNumber);
    try {
      const res = await deleteOrder(orderNumber);
      if (res.success) {
        setOrders(prev => prev.filter(o => o.order_number !== orderNumber && o.id !== orderNumber));
        showToast(lang === 'hu' ? `Rendelés (#${orderNumber}) eltávolítva az előzményekből.` : `Order (#${orderNumber}) removed from history.`);
      } else {
        showToast(res.error || (lang === 'hu' ? 'Nem sikerült eltávolítani a rendelést.' : 'Failed to remove order.'));
      }
    } catch (err: any) {
      showToast(err?.message || (lang === 'hu' ? 'Hiba történt az eltávolítás során.' : 'Error removing order.'));
    } finally {
      setDeletingOrderNumber(null);
    }
  };

  const handleCleanOrders = async (mode: 'cancelled' | 'all_mine') => {
    const targets = mode === 'all_mine'
      ? orders.map(o => o.order_number || o.id).filter(Boolean)
      : orders
          .filter(o => o.status === 'Cancelled')
          .map(o => o.order_number || o.id)
          .filter(Boolean);

    if (targets.length === 0) {
      showToast(lang === 'hu' ? 'Nincsenek törölhető lemondott rendelések.' : 'No cancelled orders to remove.');
      return;
    }

    const msg = mode === 'all_mine'
      ? (lang === 'hu' ? `Biztosan törölni szeretnéd mind a(z) ${targets.length} rendelést a személyes előzményeidből?` : `Are you sure you want to remove all ${targets.length} orders from your personal history?`)
      : (lang === 'hu' ? `Biztosan eltávolítod a(z) ${targets.length} lemondott rendelést a személyes előzményeidből? (A rendelési adatok a rendszerben megmaradnak)` : `Are you sure you want to remove ${targets.length} cancelled order(s) from your personal history? (Order data remains in the system)`);
    if (!window.confirm(msg)) return;

    setCleaningOrders(true);
    try {
      if (mode === 'all_mine') {
        await purgeAllOrders('mine');
        setOrders([]);
        showToast(lang === 'hu' ? 'Rendelési előzmények kiürítve.' : 'Order history cleared.');
      } else {
        const res = await deleteOrders(targets);
        if (res.success) {
          const targetSet = new Set(targets);
          setOrders(prev => prev.filter(o => !targetSet.has(o.order_number) && !targetSet.has(o.id)));
          showToast(lang === 'hu' ? `Sikeresen eltávolítva: ${targets.length} lemondott rendelés.` : `Successfully removed ${targets.length} cancelled order(s).`);
        } else {
          showToast(res.error || (lang === 'hu' ? 'A rendelések eltávolítása nem sikerült.' : 'Failed to remove orders.'));
        }
      }
    } finally {
      setCleaningOrders(false);
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (viewerProfile && o.seller_id === viewerProfile.id) return false;
      if (orderStatusFilter !== 'All' && o.status !== orderStatusFilter) return false;
      if (orderDateFilter !== 'all') {
        const d = new Date(o.created_at);
        const now = new Date();
        if (orderDateFilter === 'today') {
          if (d.toDateString() !== now.toDateString()) return false;
        } else if (orderDateFilter === 'week') {
          const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 7);
          if (d < cutoff) return false;
        } else if (orderDateFilter === 'month') {
          const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - 1);
          if (d < cutoff) return false;
        }
      }
      return true;
    });
  }, [orders, viewerProfile, orderStatusFilter, orderDateFilter]);

  // Loading State
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-bold text-base animate-pulse" style={{ color: 'var(--text-accent)' }}>
          {lang === 'hu' ? 'Profil betöltése…' : 'Loading profile…'}
        </span>
      </div>
    );
  }

  // Guest view: visiting `/profile` without logging in and without `?id`
  if (!targetUserId) {
    return (
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: 'clamp(16px,3vw,32px) clamp(16px,3vw,24px)' }}>
        <div 
          className="max-w-md mx-auto my-12 p-8 text-center rounded-2xl shadow-xl border"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <div 
            className="w-14 h-14 rounded-2xl inline-flex items-center justify-center mb-4 border"
            style={{
              background: 'var(--bg-surface-2)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--accent)'
            }}
          >
            <svg className="w-7 h-7" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h2 className="text-2xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>{t("User Account", "Felhasználói fiók")}</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
            {t('Sign in or create an account to view your order history and manage your profile.', 'Jelentkezz be vagy hozz létre egy fiókot a rendelési előzmények megtekintéséhez és a profilod kezeléséhez.')}
          </p>
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-6 py-3 font-black rounded-xl text-sm transition shadow-md cursor-pointer"
            style={{
              background: 'var(--accent-strong)',
              color: 'var(--text-on-accent, #000)',
              boxShadow: '0 0 16px var(--accent-glow)'
            }}
          >
            {t('Sign In / Register', 'Bejelentkezés / Regisztráció')}
          </button>
          {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
        </div>
      </div>
    );
  }

  // Not Found State (User ID was supplied in URL but does not exist)
  if (!targetProfile && !summary) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,3vw,32px)' }}>
        <div
          className="max-w-md mx-auto my-12 p-8 text-center rounded-2xl border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
            {t('Collector not found', 'Gyűjtő nem található')}
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
            {t("This profile doesn't exist or is no longer available.", 'Ez a profil nem létezik vagy már nem elérhető.')}
          </p>
          <a
            href="/marketplace"
            className="inline-block px-5 py-2.5 rounded-xl font-black text-xs cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {t('Browse Marketplace', 'Böngéssz a Piactéren')}
          </a>
        </div>
      </div>
    );
  }

  const activeSwatch = THEME_SWATCHES.find((opt) => opt.mode === themeMode) || THEME_SWATCHES[0];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: 'clamp(16px,3vw,32px) clamp(16px,3vw,24px)' }}>
      {/* Account Info Header */}
      <div
        className="relative rounded-2xl mb-6 shadow-sm border overflow-hidden"
        style={{
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <BannerContainerBackground bannerUrl={bannerUrl} isLightTheme={isLightTheme} />

        <div className="relative z-10 p-3.5 sm:p-7">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-5">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 sm:gap-x-5 gap-y-1 sm:gap-y-2 text-left min-w-0 flex-1">
              {/* Avatar */}
              <div className="col-start-1 row-start-1 sm:row-span-2 shrink-0 sm:self-center">
                {isMe ? (
                  <button
                    type="button"
                    onClick={() => setShowAppearanceModal(true)}
                    title={t("Customize Profile Picture & Banner", "Profilkép és borítókép testreszabása")}
                    className="group relative rounded-full shrink-0 cursor-pointer block"
                  >
                    {targetProfile?.avatar_url ? (
                      <div
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden shrink-0 bg-zinc-950 shadow-md relative"
                        style={{ border: `2px solid ${sellerTier.color || 'var(--border)'}` }}
                      >
                        <img
                          src={targetProfile.avatar_url}
                          alt={displayName}
                          className="w-full h-full object-cover"
                          style={resolveAvatarImageStyle(targetProfile.avatar_url)}
                        />
                      </div>
                    ) : (
                      <div
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-2xl sm:text-3xl font-black border shrink-0"
                        style={{
                          background: 'var(--bg-surface-2)',
                          borderColor: sellerTier.color || 'var(--border)',
                          color: 'var(--accent)',
                        }}
                      >
                        {displayName[0].toUpperCase()}
                      </div>
                    )}
                    <span
                      className="absolute bottom-0 right-0 w-7 h-7 rounded-full border flex items-center justify-center shadow-md transition group-hover:scale-110"
                      style={{ background: 'var(--accent-strong)', borderColor: 'var(--bg-surface)', color: 'var(--text-on-accent, #000)' }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </span>
                  </button>
                ) : (
                  <div className="relative rounded-full shrink-0">
                    {targetProfile?.avatar_url || summary?.avatar_url ? (
                      <div
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden shrink-0 bg-zinc-950 shadow-md relative"
                        style={{ border: `2px solid ${sellerTier.color || 'var(--border)'}` }}
                      >
                        <img
                          src={(targetProfile?.avatar_url || summary?.avatar_url) ?? undefined}
                          alt={displayName}
                          className="w-full h-full object-cover"
                          style={resolveAvatarImageStyle(targetProfile?.avatar_url || summary?.avatar_url)}
                        />
                      </div>
                    ) : (
                      <div
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-2xl sm:text-3xl font-black border shrink-0"
                        style={{
                          background: 'var(--bg-surface-2)',
                          borderColor: sellerTier.color || 'var(--border)',
                          color: 'var(--accent)',
                        }}
                      >
                        {displayName[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Name & Identity */}
              <div className="col-start-2 row-start-1 min-w-0 self-center">
                <div className="flex items-center gap-2.5 min-w-0 flex-wrap justify-start">
                  <h1 className="text-xl sm:text-2xl font-black break-words min-w-0" style={{ color: 'var(--text-primary)' }}>
                    {displayName}
                  </h1>

                  {/* Copy Full Profile Link Button */}
                  <button
                    type="button"
                    onClick={() => {
                      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://tcgxchange.net';
                      const fullUrl = `${origin}${getProfileUrl({ id: targetProfile?.id || targetUserId, display_name: displayName })}`;
                      navigator.clipboard.writeText(fullUrl);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition cursor-pointer backdrop-blur-md hover:bg-[var(--bg-raised)] active:scale-95 group/link"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    title={lang === 'hu' ? 'Profil link másolása vágólapra' : 'Copy profile link to clipboard'}
                  >
                    {copiedLink ? (
                      <>
                        <svg className="w-3.5 h-3.5 text-[var(--positive)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="text-[11px] font-bold text-[var(--positive)]">
                          {lang === 'hu' ? 'Link másolva!' : 'Link copied!'}
                        </span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5 text-[var(--text-tertiary)] group-hover/link:text-[var(--accent)] transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                        <span className="text-[11px] font-medium text-[var(--text-tertiary)] group-hover/link:text-[var(--text-secondary)]">
                          {lang === 'hu' ? 'Link másolása' : 'Copy link'}
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {/* Owner, Admin & Seller Tier Badges (Cleanly separated from stats) */}
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] mr-1">
                    <CountryFlag countryCode={targetProfile?.country || 'HU'} className="w-3.5 h-2.5 rounded-[2px]" />
                    <span>{getCountry(targetProfile?.country || 'HU').name}</span>
                  </div>

                  {isProfileAdmin(targetProfile) && !isOwner && (
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-0.5 rounded-md border shadow-sm backdrop-blur-md"
                      style={{
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent-border)',
                        color: 'var(--text-accent)',
                      }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <span>Admin</span>
                    </span>
                  )}

                  {isOwner && <SiteOwnerTag className="!text-[11px] !px-2.5 backdrop-blur-md" />}

                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-md border shadow-sm backdrop-blur-md select-none"
                    style={sellerTier.badgeStyle}
                    title={sellerTier.nameEn}
                  >
                    <BadgeIconSvg iconType={sellerTier.iconType} className="w-3 h-3" />
                    <span>{sellerTier.nameEn}</span>
                  </span>
                </div>
              </div>

              {/* Activity Stats & Community Chips */}
              <div className="col-span-2 sm:col-start-2 sm:row-start-2 w-full flex items-center justify-start gap-1.5 sm:gap-2 flex-wrap pt-0.5">
                {/* Seller Rating Chip */}
                {summary && summary.rating_count > 0 && summary.rating_avg !== null ? (
                  <button
                    type="button"
                    onClick={() => handleTabChange('reviews')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border backdrop-blur-md cursor-pointer transition hover:border-amber-400/50 hover:bg-zinc-800/80 active:scale-95"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    title={lang === 'hu' ? 'Ugrás az értékelésekhez' : 'Jump to reviews'}
                  >
                    <Stars value={summary.rating_avg} size={11} />
                    <span style={{ color: 'var(--text-primary)' }}>{summary.rating_avg.toFixed(1)}</span>
                    <span>{lang === 'hu' ? `eladóként (${summary.rating_count})` : `as seller (${summary.rating_count})`}</span>
                  </button>
                ) : null}

                {/* Buyer Rating Chip */}
                {summary && summary.buyer_rating_count && summary.buyer_rating_avg != null ? (
                  <button
                    type="button"
                    onClick={() => handleTabChange('reviews')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border backdrop-blur-md cursor-pointer transition hover:border-amber-400/50 hover:bg-zinc-800/80 active:scale-95"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    title={lang === 'hu' ? 'Ugrás az értékelésekhez' : 'Jump to reviews'}
                  >
                    <Stars value={summary.buyer_rating_avg} size={11} />
                    <span style={{ color: 'var(--text-primary)' }}>{summary.buyer_rating_avg.toFixed(1)}</span>
                    <span>{lang === 'hu' ? `vevőként (${summary.buyer_rating_count})` : `as buyer (${summary.buyer_rating_count})`}</span>
                  </button>
                ) : null}

                {/* Sales Count Chip */}
                {summary && summary.sales_count ? (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border text-[var(--positive)] backdrop-blur-md"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                  >
                    {lang === 'hu' ? `${summary.items_sold || 0} eladott kártya (${summary.sales_count || 0} eladás)` : `Sold ${summary.items_sold || 0} card${summary.items_sold === 1 ? '' : 's'} (${summary.sales_count || 0} sale${summary.sales_count === 1 ? '' : 's'})`}
                  </span>
                ) : null}

                {/* Purchases Count Chip */}
                {summary && summary.purchases_count ? (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border backdrop-blur-md"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  >
                    {lang === 'hu' ? `${summary.items_bought || 0} vásárolt kártya (${summary.purchases_count || 0} vásárlás)` : `Bought ${summary.items_bought || 0} card${summary.items_bought === 1 ? '' : 's'} (${summary.purchases_count || 0} purchase${summary.purchases_count === 1 ? '' : 's'})`}
                  </span>
                ) : null}

                {/* Active Listings Chip */}
                {listings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleTabChange('sale')}
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border text-indigo-300 backdrop-blur-md cursor-pointer transition hover:border-indigo-400/50 hover:bg-zinc-800/80 active:scale-95"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                    title={lang === 'hu' ? 'Ugrás az eladó kártyákhoz' : 'Jump to cards for sale'}
                  >
                    {lang === 'hu' ? `${listings.length} aktív hirdetés` : `${listings.length} listed now`}
                  </button>
                )}

                {/* Member Since Chip */}
                {memberSince && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border backdrop-blur-md"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                  >
                    {lang === 'hu' ? `Tag ${memberSince} óta` : `Member since ${memberSince}`}
                  </span>
                )}

                {/* Social Links */}
                <SocialProfileButtons socialProfiles={socialProfiles} size="sm" />
              </div>
            </div>

            {/* Actions Column (Clean vertical column layout on the right) */}
            <div className="flex flex-col items-stretch sm:items-end gap-2 w-full lg:w-auto shrink-0 justify-center">
              {isMe ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowQrModal(true)}
                    className="w-full sm:w-44 px-3.5 py-2 rounded-xl text-xs font-bold transition inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm border backdrop-blur-md hover:brightness-110 active:scale-95"
                    style={{
                      background: 'var(--bg-surface-2)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)',
                    }}
                    title={t("Show QR code for in-person trade binder sharing", "QR-kód megjelenítése személyes cseréhez")}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
                    </svg>
                    <span>{t("Share QR", "QR megosztása")}</span>
                  </button>

                  {isProfileAdmin(targetProfile) && (
                    <a
                      href="/admin"
                      className="w-full sm:w-44 px-3.5 py-2 rounded-xl text-xs font-black transition inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm border backdrop-blur-md hover:brightness-110 active:scale-95"
                      style={{
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent-border)',
                        color: 'var(--text-accent)',
                      }}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <span>{t("Admin Console", "Admin konzol")}</span>
                    </a>
                  )}

                  <button
                    onClick={handleSignOut}
                    className="w-full sm:w-44 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer border inline-flex items-center justify-center gap-2 backdrop-blur-md hover:brightness-110 active:scale-95"
                    style={{
                      background: 'var(--negative-muted)',
                      borderColor: 'var(--negative-border)',
                      color: 'var(--negative)',
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span>{t("Sign Out", "Kijelentkezés")}</span>
                  </button>
                </>
              ) : (
                <>
                  <a
                    href={`/messages?user_id=${targetUserId}`}
                    className="w-full sm:w-44 px-3.5 py-2 rounded-xl text-xs font-bold transition inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm border backdrop-blur-md hover:brightness-110 active:scale-95"
                    style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span>{t("Message", "Üzenet")}</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => setShowQrModal(true)}
                    className="w-full sm:w-44 px-3.5 py-2 rounded-xl text-xs font-bold transition inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm border backdrop-blur-md hover:brightness-110 active:scale-95"
                    style={{
                      background: 'var(--bg-surface-2)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)',
                    }}
                    title={t("Show QR code for in-person trade binder sharing", "QR-kód megjelenítése személyes cseréhez")}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
                    </svg>
                    <span>{t("Share QR", "QR megosztása")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowReportModal(true)}
                    className="w-full sm:w-44 px-3.5 py-2 rounded-xl text-xs font-semibold border inline-flex items-center justify-center gap-2 cursor-pointer transition hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                    title={t('Report this collector to moderators', 'Felhasználó jelentése a moderátoroknak')}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                      <line x1="4" y1="22" x2="4" y2="15" />
                    </svg>
                    <span>{t("Report", "Jelentés")}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Unified Tab Bar */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto border-b pt-1 pb-3 px-1 -mx-1 mb-6 scrollbar-none"
        style={{ borderColor: 'var(--border-subtle)' }}
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sale'}
          onClick={() => handleTabChange('sale')}
          className={`h-9 px-4 rounded-xl text-xs font-black border cursor-pointer transition inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
            activeTab === 'sale'
              ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-sm'
              : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21h18M3 10h18M5 10V21M19 10V21M9 21v-4a2 2 0 012-2h2a2 2 0 012 2v4M3 10l2-6h14l2 6" />
          </svg>
          <span>{t('Cards for sale', 'Eladó kártyák')}</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
            {listings.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'collection'}
          onClick={() => handleTabChange('collection')}
          className={`h-9 px-4 rounded-xl text-xs font-black border cursor-pointer transition inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
            activeTab === 'collection'
              ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-sm'
              : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          <span>{t('Collection', 'Gyűjtemény')}</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
            {totalPublicCopies}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'decks'}
          onClick={() => handleTabChange('decks')}
          className={`h-9 px-4 rounded-xl text-xs font-black border cursor-pointer transition inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
            activeTab === 'decks'
              ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-sm'
              : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M7 8h10M7 12h10M7 16h6" />
          </svg>
          <span>{t('Decks', 'Paklik')}</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
            {decks.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'reviews'}
          onClick={() => handleTabChange('reviews')}
          className={`h-9 px-4 rounded-xl text-xs font-black border cursor-pointer transition inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
            activeTab === 'reviews'
              ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-sm'
              : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span>{t('Reviews', 'Értékelések')}</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
            {(reputation?.as_seller.count || 0) + (reputation?.as_buyer.count || 0)}
          </span>
        </button>

        {isMe && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'orders'}
              onClick={() => handleTabChange('orders')}
              className={`h-9 px-4 rounded-xl text-xs font-black border cursor-pointer transition inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
                activeTab === 'orders'
                  ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-sm'
                  : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <span>{t('Orders & Holds', 'Rendelések & Foglalások')}</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                {orders.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'settings'}
              onClick={() => handleTabChange('settings')}
              className={`h-9 px-4 rounded-xl text-xs font-black border cursor-pointer transition inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
                activeTab === 'settings'
                  ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-sm'
                  : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)] hover:text-[var(--text-primary)]'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>{t('Settings & Theme', 'Beállítások & Téma')}</span>
            </button>
          </>
        )}
      </div>

      {/* TAB 1: Collection */}
      {activeTab === 'collection' && (
        <div className="mb-8">
          {publicCollections.length === 0 ? (
            <div
              className="p-10 text-center rounded-2xl border flex flex-col items-center gap-3"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/50 flex items-center justify-center text-zinc-500">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p className="text-sm font-semibold max-w-md" style={{ color: 'var(--text-secondary)' }}>
                {isMe
                  ? (lang === 'hu'
                    ? 'Még nem osztottál meg nyilvános gyűjteményt. A Gyűjtemények kezelése gombra kattintva bármelyik gyűjteményedet nyilvánossá teheted.'
                    : "You haven't shared any public collections yet. Click Manage Collections to make any collection public.")
                  : (lang === 'hu'
                    ? `${displayName} még nem tett közzé nyilvános gyűjteményt.`
                    : `${displayName} hasn't made any collections public yet.`)}
              </p>
              {isMe && (
                <div className="flex items-center gap-2.5 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowManageCollectionsModal(true)}
                    className="h-9 px-4 rounded-xl text-xs font-black inline-flex items-center gap-2 cursor-pointer transition shadow-md"
                    style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span>{t('Manage Collections', 'Gyűjtemények kezelése')}</span>
                  </button>
                  <a
                    href="/"
                    className="h-9 px-4 rounded-xl text-xs font-bold border inline-flex items-center gap-2 cursor-pointer transition hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <span>{t('Open Catalog', 'Katalógus megnyitása')}</span>
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Collection Controls Toolbar */}
              <ToolbarContainer>
                {/* Row 1: Filters trigger, Search bar, Sort dropdown, Reset button */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setShowFilterDrawer(true)}
                    className="h-10 px-3.5 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-primary)] text-xs font-semibold cursor-pointer transition hover:bg-[var(--bg-raised)] shrink-0"
                    title={t('Open filters', 'Szűrők megnyitása')}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="4" y1="21" x2="4" y2="14" />
                      <line x1="4" y1="10" x2="4" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12" y2="3" />
                      <line x1="20" y1="21" x2="20" y2="16" />
                      <line x1="20" y1="12" x2="20" y2="3" />
                      <line x1="1" y1="14" x2="7" y2="14" />
                      <line x1="9" y1="8" x2="15" y2="8" />
                      <line x1="17" y1="16" x2="23" y2="16" />
                    </svg>
                    <span>{t('Filters', 'Szűrők')}</span>
                    {activeCollFilterCount > 0 && (
                      <span
                        className="px-1.5 py-0.2 rounded-full text-[10px] font-black"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {activeCollFilterCount}
                      </span>
                    )}
                  </button>

                  <CatalogSearchBar
                    value={collSearch}
                    onChange={setCollSearch}
                    placeholder={t('Search cards by name, ID, type...', 'Keresés név, kód, típus szerint...')}
                  />

                  <CatalogSortDropdown
                    value={collSort}
                    onChange={setCollSort}
                    className="w-full sm:w-56 shrink-0 z-40"
                  />

                  {(activeCollFilterCount > 0 || collSearch) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCollSearch('');
                        setCollFilters(DEFAULT_COLL_FILTERS);
                      }}
                      className="h-10 px-3 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition hover:bg-[var(--bg-raised)] shrink-0"
                      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                      title={t('Reset filters', 'Szűrők visszaállítása')}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                        <path d="M21 3v5h-5" />
                        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                        <path d="M8 16H3v5" />
                      </svg>
                      <span className="hidden sm:inline">{t('Reset', 'Alaphelyzet')}</span>
                    </button>
                  )}
                </div>

                {/* Row 2: Collection Switcher, Collection Value, Counts, Grid Size */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5 pt-3.5 sm:pt-4 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
                    <CollectionSwitcher
                      className="w-full sm:w-auto"
                      customCollections={publicCollections.map((c) => ({
                        id: c.id,
                        name: c.name,
                        count: c.count,
                        isPublic: true,
                      }))}
                      activeId={activeCollectionId || publicCollections[0]?.id}
                      onSelect={(id) => handleSelectCollection(id)}
                      onManage={isMe ? () => setShowManageCollectionsModal(true) : undefined}
                    />

                    <CollectionValueChip
                      collection={collectionCardsMap}
                      cards={collectionCardDetails}
                      mode="Owned"
                      foilOnly={collFilters.foilFilter}
                    />

                    <div
                      className="h-10 sm:h-9 px-3 rounded-xl border inline-flex items-center justify-center gap-2 text-xs font-mono font-medium shadow-sm shrink-0"
                      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      title={lang === 'hu' ? 'Szűrt lapok és összes példány száma' : 'Filtered cards and total copies count'}
                    >
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="9" y1="21" x2="9" y2="9" />
                      </svg>
                      <span>
                        {filteredCards.length} / {cardsInActiveCollection.length} {lang === 'hu' ? 'lap' : 'cards'}
                      </span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                      >
                        {filteredCards.reduce((s, c) => s + c.totalCopies, 0)} {lang === 'hu' ? 'db' : 'copies'}
                      </span>
                    </div>
                  </div>

                  <GridSizeSwitcher size={gridSize} onChange={setGridSize} className="w-full sm:w-auto" />
                </div>
              </ToolbarContainer>

              {/* Filter Drawer */}
              <FilterDrawer
                open={showFilterDrawer}
                onClose={() => setShowFilterDrawer(false)}
                title={t('Filter Cards', 'Kártyák szűrése')}
                activeCount={activeCollFilterCount}
                applyLabel={
                  lang === 'hu'
                    ? `Alkalmazás & ${filteredCards.length} lap megtekintése`
                    : `Apply & View ${filteredCards.length} Cards`
                }
              >
                <FilterSidebar
                  filters={collFilters}
                  setFilters={setCollFilters}
                  options={availableFilterOptions}
                />
              </FilterDrawer>

              {/* Grid of Cards */}
              {collectionLoading ? (
                <div className="flex items-center justify-center p-16">
                  <span className="text-xs font-bold animate-pulse" style={{ color: 'var(--text-accent)' }}>
                    {t('Loading collection…', 'Gyűjtemény betöltése…')}
                  </span>
                </div>
              ) : filteredCards.length === 0 ? (
                <div
                  className="p-10 text-center rounded-2xl border flex flex-col items-center gap-2"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                >
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {t('No cards match the selected filters.', 'Nincs a szűrésnek megfelelő kártya.')}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setCollSearch('');
                      setCollFilters(DEFAULT_COLL_FILTERS);
                    }}
                    className="mt-1 h-8 px-3 rounded-lg border text-xs font-bold cursor-pointer transition hover:bg-[var(--bg-raised)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    {t('Reset filters', 'Szűrők visszaállítása')}
                  </button>
                </div>
              ) : (
                <div className={`grid ${gridSizeClasses(gridSize)}`}>
                  {filteredCards.map((card, i) => (
                    <CardListItem
                      key={card.id}
                      card={card}
                      count={card.normalCount}
                      foilCount={card.foilCount}
                      isOwned={card.normalCount > 0}
                      isFoilOwned={card.foilCount > 0}
                      onClick={setPreviewCardId}
                      gridSize={gridSize}
                      priority={i < 4}
                      readOnly={!isMe}
                      onUpdateCount={isMe ? handleUpdateCardCount : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Cards For Sale */}
      {activeTab === 'sale' && (
        <div className="mb-8 space-y-4">
          {listings.length === 0 ? (
            <div
              className="p-10 text-center rounded-2xl border flex flex-col items-center gap-3"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/50 flex items-center justify-center text-zinc-500">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M3 21h18M3 10h18M5 10V21M19 10V21M9 21v-4a2 2 0 012-2h2a2 2 0 012 2v4M3 10l2-6h14l2 6" />
                </svg>
              </div>
              <p className="text-sm font-semibold max-w-md" style={{ color: 'var(--text-secondary)' }}>
                {isMe
                  ? (lang === 'hu'
                    ? 'Jelenleg nincsenek aktív hirdetéseid. Hozz létre új hirdetést az Eladói felületen!'
                    : "You don't have any cards listed for sale right now. List cards in your Seller Dashboard!")
                  : (lang === 'hu'
                    ? `${displayName} jelenleg nem hirdet kártyát.`
                    : `${displayName} has no cards listed right now.`)}
              </p>
              {isMe && (
                <a
                  href="/seller"
                  className="h-9 px-4 rounded-xl text-xs font-black inline-flex items-center gap-2 cursor-pointer transition shadow-md"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>{t('Go to Seller Hub', 'Ugrás az Eladói felületre')}</span>
                </a>
              )}
            </div>
          ) : (
            <>
              {/* Marketplace Link Banner */}
              <div
                className="rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex -space-x-5 shrink-0">
                    {listings.slice(0, 3).map((l, i) => (
                      <div
                        key={l.inventory_id || i}
                        className="w-12 h-16 rounded-lg overflow-hidden border-2 bg-zinc-950 flex items-center justify-center shrink-0 shadow-md"
                        style={{ borderColor: 'var(--bg-surface)', zIndex: 3 - i }}
                      >
                        {l.image_path ? (
                          <img {...cardThumbProps(l.image_path, 'avatar')} alt={l.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[9px] font-mono text-zinc-500">TCG</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-black truncate" style={{ color: 'var(--text-primary)' }}>
                      {lang === 'hu' ? `${listings.length} eladó kártya` : `${listings.length} card${listings.length === 1 ? '' : 's'} for sale`}
                    </div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {lang === 'hu' ? `Böngéssz ${displayName} hirdetései között a Piactéren` : `Browse ${displayName}'s listings in the Marketplace`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0">
                  <a
                    href={`/marketplace?seller_id=${targetUserId}`}
                    className="flex-1 sm:flex-none h-9 px-4 rounded-xl text-xs font-black inline-flex items-center justify-center gap-1.5 transition shadow-sm border hover:brightness-110"
                    style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                  >
                    <span>{t('View in Marketplace', 'Megtekintés a Piactéren')}</span>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </a>
                  {isMe && (
                    <a
                      href="/seller"
                      className="flex-1 sm:flex-none h-9 px-4 rounded-xl text-xs font-bold border inline-flex items-center justify-center gap-1.5 transition hover:bg-[var(--bg-raised)]"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                      <span>{t('Seller Hub', 'Eladói felület')}</span>
                    </a>
                  )}
                </div>
              </div>

              {/* Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                {listings.map((l) => (
                  <ProfileListingCard
                    key={l.inventory_id}
                    listing={l}
                    isMe={isMe}
                    cart={cart}
                    onPreview={(invId) => setPreviewInventoryId(invId)}
                    t={t}
                    formatPrice={formatPrice}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: Decks */}
      {activeTab === 'decks' && (
        <div className="mb-8 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {isMe ? (
                lang === 'hu' ? (
                  <>A Paklikészítőből közzétett paklik. A nyilvános paklik megjelennek a <a href="/decks" className="underline">Pakli böngészőben</a> és a profilodon.</>
                ) : (
                  <>Decks published from the Deck Builder. Public decks show up in the <a href="/decks" className="underline">Deck Browser</a> and on your profile.</>
                )
              ) : (
                lang === 'hu' ? `${displayName} által közzétett paklik.` : `Decks published by ${displayName}.`
              )}
            </p>
            {isMe && (
              <a
                href="/deck-builder"
                className="px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 self-start sm:self-auto transition hover:brightness-110 shadow-sm"
                style={{ background: 'var(--accent-muted)', border: '1px solid var(--accent-border)', color: 'var(--text-accent)' }}
              >
                {t('Open Deck Builder', 'Paklikészítő megnyitása')}
              </a>
            )}
          </div>

          {loadingDecks ? (
            <div className="text-center py-10 text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {lang === 'hu' ? 'Paklik betöltése…' : 'Loading decks…'}
            </div>
          ) : decks.length === 0 ? (
            <div
              className="p-10 text-center rounded-2xl border"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {isMe
                  ? t("You haven't published any decks yet. Build one and hit \"Publish\" in the Deck Builder!", 'Még nem tettél közzé paklit. Hozz létre egyet a Paklikészítőben!')
                  : (lang === 'hu' ? `${displayName} még nem tett közzé paklit.` : `${displayName} hasn't published any decks yet.`)}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {decks.map((d) => {
                const isShowingChampion = deckArtView[d.id] === 'champion' && Boolean(d.champion_card?.image_path);
                const activeCard = isShowingChampion ? d.champion_card : (d.legend_card || d.champion_card);
                const championDomains = d.champion_card?.domain
                  ? d.champion_card.domain.split(',').map((x: string) => x.trim().toLowerCase())
                  : [];
                return (
                  <div
                    key={d.id}
                    className="rounded-2xl border overflow-hidden flex flex-col transition hover:-translate-y-0.5 hover:shadow-lg"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                  >
                    <a href={`/decks/view?deck=${d.id}`} className="block relative aspect-[3/4] bg-zinc-950 overflow-hidden group">
                      {activeCard?.image_path && (
                        <img
                          {...cardThumbProps(activeCard.image_path, 'tile')}
                          alt={activeCard.name}
                          className="w-full h-full object-cover transition group-hover:scale-105 duration-200"
                        />
                      )}

                      {/* Switcher in top right corner to toggle between Legend and Champion */}
                      {d.champion_card?.image_path && d.legend_card?.image_path && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeckArtView((prev) => ({
                              ...prev,
                              [d.id]: prev[d.id] === 'champion' ? 'legend' : 'champion',
                            }));
                          }}
                          title={isShowingChampion ? t('Show Legend', 'Legenda mutatása') : t('Show Champion', 'Bajnok mutatása')}
                          className="absolute top-2 right-2 z-10 px-2 py-1 rounded-lg text-[10px] font-black border flex items-center gap-1.5 shadow-md transition cursor-pointer backdrop-blur-md hover:scale-105"
                          style={{
                            background: 'rgba(9, 13, 22, 0.85)',
                            borderColor: isShowingChampion ? 'var(--accent)' : 'rgba(255, 255, 255, 0.25)',
                            color: isShowingChampion ? 'var(--text-accent)' : '#fff',
                          }}
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" />
                          </svg>
                          <span>{isShowingChampion ? t('Champion', 'Bajnok') : t('Legend', 'Legenda')}</span>
                        </button>
                      )}
                    </a>

                    <div className="p-3 flex flex-col flex-1 justify-between gap-2.5">
                      <div>
                        <a href={`/decks/view?deck=${d.id}`} className="text-sm font-black hover:underline truncate block" style={{ color: 'var(--text-primary)' }}>
                          {d.name}
                        </a>
                        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          {d.is_public ? t('Public', 'Nyilvános') : t('Unlisted', 'Nem listázott')}
                        </div>

                        {/* Legend & Chosen Champion info */}
                        <div className="mt-2.5 pt-2 border-t space-y-1.5 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                          {d.legend_card && (
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="font-semibold text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                {t('Legend:', 'Legenda:')}
                              </span>
                              <span className="font-bold truncate text-[11px]" style={{ color: 'var(--text-primary)' }}>
                                {d.legend_card.name}
                              </span>
                            </div>
                          )}

                          {d.champion_card && (
                            <div className="flex items-start gap-1.5 min-w-0">
                              <span className="font-semibold text-[11px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                                {t('Chosen Champion:', 'Választott bajnok:')}
                              </span>
                              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                <span className="font-bold truncate text-[11px]" style={{ color: 'var(--text-primary)' }}>
                                  {d.champion_card.name}
                                </span>
                                {championDomains.map((dom) => (
                                  <span
                                    key={dom}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black text-white uppercase tracking-wider shrink-0 shadow-sm"
                                    style={{ background: DOMAIN_COLORS[dom] || '#94a3b8' }}
                                    title={dom}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-white/90" />
                                    <span>{dom}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {isMe ? (
                        <div className="flex gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await setDeckVisibility(d.id, !d.is_public);
                              if (ok) refreshDecks();
                            }}
                            className="flex-1 px-2.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border text-center"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                          >
                            {d.is_public ? t('Unlist', 'Elrejtés') : t('Make Public', 'Közzététel')}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const confirmMsg = lang === 'hu'
                                ? `Biztosan eltávolítod a(z) "${d.name}" paklit a közzétett paklijaid közül?`
                                : `Remove "${d.name}" from your published decks?`;
                              if (!confirm(confirmMsg)) return;
                              const ok = await deletePublishedDeck(d.id);
                              if (ok) refreshDecks();
                            }}
                            className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition cursor-pointer"
                          >
                            {t('Remove', 'Eltávolítás')}
                          </button>
                        </div>
                      ) : (
                        <a
                          href={`/decks/view?deck=${d.id}`}
                          className="w-full text-center px-3 py-1.5 rounded-xl text-xs font-bold border transition hover:bg-[var(--bg-raised)]"
                          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          {t('View Deck', 'Pakli megtekintése')}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Reviews & Reputation */}
      {activeTab === 'reviews' && (
        <div className="mb-8 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-2">
            {([
              ['buyer_to_seller', t('As a seller', 'Eladóként'), reputation?.as_seller, t('No ratings as a seller yet.', 'Még nincs eladói értékelés.')],
              ['seller_to_buyer', t('As a buyer', 'Vevőként'), reputation?.as_buyer, t('No ratings as a buyer yet.', 'Még nincs vevői értékelés.')],
            ] as const).map(([direction, title, rep, empty]) => (
              <div key={direction} className="rounded-2xl p-4 sm:p-5 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                <div className="text-xs font-black uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-secondary)' }}>{title}</div>
                {rep ? <ReputationBreakdown direction={direction} rep={rep} emptyText={empty} /> : null}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5 pt-2" role="tablist" aria-label="Review tabs">
            {([
              ['buyer_to_seller', t('From buyers', 'Vevőktől'), reputation?.as_seller.count || 0],
              ['seller_to_buyer', t('From sellers', 'Eladóktól'), reputation?.as_buyer.count || 0],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={reviewTab === key}
                onClick={() => setReviewTab(key)}
                className={`h-8 px-3.5 rounded-xl text-xs font-bold border cursor-pointer transition inline-flex items-center gap-1.5 ${
                  reviewTab === key
                    ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)]'
                    : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-2)]'
                }`}
              >
                <span>{label}</span>
                <span className="font-mono text-[10px]">({count})</span>
              </button>
            ))}
          </div>

          {(() => {
            const list = (reputation?.reviews || []).filter(r => r.direction === reviewTab);
            if (list.length === 0) {
              return (
                <div className="p-10 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{t('No reviews yet.', 'Még nincsenek értékelések.')}</p>
                </div>
              );
            }
            const handleDeleteReview = viewerIsAdmin
              ? async (reviewId: string) => {
                  if (!window.confirm(lang === 'hu' ? 'Biztosan véglegesen törlöd ezt az értékelést?' : 'Delete this review permanently?')) return;
                  try {
                    const token = (await supabase.auth.getSession()).data.session?.access_token;
                    const res = await fetch(`/api/reviews?id=${encodeURIComponent(reviewId)}`, {
                      method: 'DELETE',
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    });
                    if (res.ok && targetUserId) {
                      const [sum, revs] = await Promise.all([
                        fetchSellerRatingSummary(targetUserId),
                        fetchReputation(targetUserId, true),
                      ]);
                      if (sum) setSummary(sum);
                      setReputation(revs);
                    }
                  } catch {}
                }
              : undefined;
            return <div className="space-y-3">{list.map(rev => <ReviewCard key={rev.id} review={rev} onDelete={handleDeleteReview} />)}</div>;
          })()}
        </div>
      )}

      {/* TAB 5: Orders & Holds (Owner Only) */}
      {isMe && activeTab === 'orders' && (
        <div className="mb-8 space-y-8">
          {/* Buyer Holds */}
          {targetProfile && <BuyerHolds userId={targetProfile.id} />}

          {/* Orders Section */}
          <div id="order-history" className="scroll-mt-24">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-lg sm:text-xl font-black flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <span>{t("Order History", "Rendelési előzmények")}</span>
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold border" style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}>
                    {orders.length}
                  </span>
                  {orders.some(o => o.status === 'Cancelled') && (
                    <button
                      type="button"
                      onClick={() => handleCleanOrders('cancelled')}
                      disabled={cleaningOrders}
                      className="text-[11px] font-semibold transition cursor-pointer hover:underline disabled:opacity-50"
                      style={{ color: 'var(--text-tertiary)' }}
                      title={t("Remove cancelled orders from list", "Lemondott rendelések eltávolítása a listából")}
                    >
                      {cleaningOrders ? t('Cleaning…', 'Tisztítás…') : t('Remove cancelled orders', 'Lemondott rendelések eltávolítása')}
                    </button>
                  )}
                </div>
                <p className="text-xs sm:text-sm mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  {t("Track the fulfillment and shipping status of your orders", "Kövesd nyomon a rendeléseid teljesítését és szállítási állapotát")}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={expandAllOrders}
                  className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title={t("Expand all orders", "Összes kibontása")}
                >
                  {t("Expand All", "Összes kibontása")}
                </button>
                <button
                  type="button"
                  onClick={collapseAllOrders}
                  className="px-2.5 py-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  title={t("Collapse all orders", "Összes összecsukása")}
                >
                  {t("Collapse All", "Összes összecsukása")}
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center min-w-0 mb-4">
              <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5">
                {[
                  { key: 'All', label: t('All', 'Mind') },
                  { key: 'Pending', label: t('Pending', 'Függőben') },
                  { key: 'Processing', label: t('Processing', 'Feldolgozás alatt') },
                  { key: 'Shipped', label: t('Shipped', 'Feladva') },
                  { key: 'Delivered', label: t('Delivered', 'Kézbesítve') },
                  { key: 'Cancelled', label: t('Cancelled', 'Törölve') },
                ].map(st => (
                  <button
                    key={st.key}
                    onClick={() => setOrderStatusFilter(st.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer border shrink-0 whitespace-nowrap ${
                      orderStatusFilter === st.key
                        ? 'bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-accent)] font-bold shadow-[0_0_10px_var(--accent-glow)]'
                        : 'bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--accent-muted)]/40 hover:text-[var(--text-primary)] hover:border-[var(--accent-border)]'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5">
                {([
                  { key: 'all' as const, label: t('All Time', 'Mind') },
                  { key: 'today' as const, label: t('Today', 'Ma') },
                  { key: 'week' as const, label: t('This Week', 'Ezen a héten') },
                  { key: 'month' as const, label: t('This Month', 'Ebben a hónapban') },
                ]).map(dt => (
                  <button
                    key={dt.key}
                    onClick={() => setOrderDateFilter(dt.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer border shrink-0 whitespace-nowrap ${
                      orderDateFilter === dt.key
                        ? 'bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-accent)] font-bold shadow-[0_0_10px_var(--accent-glow)]'
                        : 'bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--accent-muted)]/40 hover:text-[var(--text-primary)] hover:border-[var(--accent-border)]'
                    }`}
                  >
                    {dt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Orders List */}
            {loadingOrders ? (
              <div className="text-center py-14 text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                {lang === 'hu' ? 'Rendelések betöltése…' : 'Loading your orders…'}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div 
                className="rounded-2xl p-10 text-center border"
                style={{
                  background: 'var(--bg-surface)',
                  borderColor: 'var(--border)'
                }}
              >
                <div 
                  className="w-12 h-12 rounded-full inline-flex items-center justify-center text-sm mb-3 border"
                  style={{
                    background: 'var(--bg-surface-2)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--accent)'
                  }}
                >
                  <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                  {t('No orders yet.', 'Még nincsenek rendeléseid.')}
                </h3>
                <p className="text-xs sm:text-sm mb-5 max-w-sm mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                  {orderStatusFilter === 'All'
                    ? t("You have not placed any orders yet. Browse our marketplace or official store to find rare cards and accessories.", "Még nem adtál le egyetlen rendelést sem. Böngéssz a piactéren vagy a hivatalos webáruházban!")
                    : t("No orders found matching this status filter.", "Nincs a szűrőnek megfelelő rendelés.")}
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <a
                    href="/marketplace"
                    className="inline-block px-5 py-2.5 font-black rounded-xl text-xs transition shadow-md"
                    style={{
                      background: 'var(--accent-strong)',
                      color: 'var(--text-on-accent, #000)',
                      boxShadow: '0 0 16px var(--accent-glow)'
                    }}
                  >
                    {t('Browse Marketplace', 'Piactér böngészése')}
                  </a>
                  <a
                    href="/store"
                    className="inline-block px-5 py-2.5 font-bold rounded-xl text-xs transition border"
                    style={{
                      background: 'var(--bg-input)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    {t('Browse Store', 'Bolt böngészése')}
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map(order => {
                  const orderKey = order.order_number || order.id;
                  const isExpanded = isOrderExpanded(order);
                  const items = order.items || [];
                  const itemCount = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
                  const totalHuf = order.total_price_huf ?? order.total_huf ?? 0;
                  const isDelivered = order.status === 'Delivered';
                  const isShipped = order.status === 'Shipped';
                  const isCancelled = order.status === 'Cancelled';
                  const stStyle = ORDER_STATUS_CONFIG[order.status] || {
                    bg: 'rgba(234, 179, 8, 0.15)',
                    color: '#eab308',
                    border: 'rgba(234, 179, 8, 0.35)',
                  };

                  const customerName = order.customer_info?.name || order.shipping_name || targetProfile?.display_name || 'Customer';
                  const customerEmail = order.customer_info?.email || targetProfile?.email || (typeof order.notes === 'string' ? order.notes.match(/Email:\s*([^\s|]+)/i)?.[1] : null);
                  const customerPhone = order.customer_info?.phone || (typeof order.notes === 'string' ? order.notes.match(/Phone:\s*([^\s|]+)/i)?.[1] : null);
                  const customerNotes = order.customer_info?.user_notes || (typeof order.notes === 'string' ? (order.notes.match(/Notes:\s*(.*)/i)?.[1] || (!order.notes.includes('|') ? order.notes : null)) : null);

                  const shipPostalCode = order.customer_info?.shipping_postal_code || order.customer_info?.postal_code;
                  const shipCity = order.customer_info?.shipping_city || order.customer_info?.city;
                  const shipStreet = order.customer_info?.shipping_street || order.customer_info?.address;
                  const shipMode = order.customer_info?.shipping_mode || (order as any).courier_name || order.shipping_method || 'Standard Delivery';
                  const shipLockerCode = order.customer_info?.shipping_locker_code;

                  const billName = order.customer_info?.billing_name || customerName;
                  const billTaxNumber = order.customer_info?.billing_tax_number;
                  const billPostalCode = order.customer_info?.billing_postal_code || order.customer_info?.postal_code;
                  const billCity = order.customer_info?.billing_city || order.customer_info?.city;
                  const billStreet = order.customer_info?.billing_street || order.customer_info?.address;
                  const billCountry = order.customer_info?.billing_country || (lang === 'hu' ? 'Magyarország' : 'Hungary');

                  const isChatting = chattingOrderId === orderKey;
                  const isHighlighted = highlightedOrderKey === orderKey;

                  return (
                    <div
                      key={orderKey}
                      id={`order-card-${orderKey}`}
                      className={`rounded-2xl border overflow-hidden transition shadow-xs hover:border-[var(--border-hover)] scroll-mt-24 ${isHighlighted ? 'ring-2 ring-[var(--accent)]' : ''}`}
                      style={{
                        background: 'var(--bg-surface)',
                        borderColor: isHighlighted ? 'var(--accent)' : isCancelled ? 'rgba(239, 68, 68, 0.3)' : 'var(--border)',
                        opacity: isCancelled ? 0.85 : 1,
                      }}
                    >
                      <div
                        className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none transition hover:bg-[var(--bg-raised)]"
                        style={{ background: isExpanded ? 'var(--bg-surface-2)' : 'var(--bg-surface)' }}
                        onClick={() => toggleOrderExpand(order)}
                      >
                        <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
                          <button
                            type="button"
                            className="p-1.5 rounded-lg border text-xs shrink-0 cursor-pointer"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                            title={isExpanded ? t('Collapse order', 'Rendelés összecsukása') : t('Expand order', 'Rendelés kibontása')}
                          >
                            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>

                          <div
                            className="flex items-center gap-1.5 select-text shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-xs sm:text-sm font-mono font-black select-text cursor-text" style={{ color: 'var(--text-primary)' }}>
                              #{order.order_number}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(order.order_number);
                                setCopiedOrderNumber(order.order_number);
                                showToast(lang === 'hu' ? `Rendelésszám másolva: #${order.order_number}` : `Order number copied: #${order.order_number}`);
                                setTimeout(() => setCopiedOrderNumber(null), 2000);
                              }}
                              className="p-1 rounded-md border text-[11px] transition cursor-pointer hover:bg-[var(--bg-raised)] active:scale-95 shrink-0"
                              style={{
                                background: 'var(--bg-input)',
                                borderColor: copiedOrderNumber === order.order_number ? 'var(--positive-border)' : 'var(--border)',
                                color: copiedOrderNumber === order.order_number ? 'var(--positive)' : 'var(--text-tertiary)',
                              }}
                              title={t("Copy order number", "Rendelésszám másolása")}
                            >
                              {copiedOrderNumber === order.order_number ? (
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          </div>

                          <span className="text-xs sm:text-sm font-bold truncate max-w-[180px]" style={{ color: 'var(--text-primary)' }}>
                            {customerName}
                          </span>

                          <span className="text-[11px] font-medium hidden md:inline shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                            {new Date(order.created_at).toLocaleString(lang === 'hu' ? 'hu-HU' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>

                          {order.seller_name && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border hidden sm:inline shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                              {lang === 'hu' ? 'Eladó' : 'Seller'}: {order.seller_name}
                            </span>
                          )}

                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border hidden sm:inline shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                            {itemCount} {lang === 'hu' ? 'termék' : (itemCount === 1 ? 'item' : 'items')}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap shrink-0" onClick={(e) => e.stopPropagation()}>
                          <span
                            className="px-2.5 py-1 rounded-full text-xs font-bold border shrink-0"
                            style={{ background: stStyle.bg, color: stStyle.color, borderColor: stStyle.border }}
                          >
                            {getProfileOrderStatusLabel(order.status, lang)}
                          </span>

                          <span className="text-xs sm:text-sm font-black px-2.5 py-1 rounded-xl border shrink-0 font-mono" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                            {formatPrice(totalHuf)}
                          </span>

                          <button
                            type="button"
                            disabled={isChatting}
                            onClick={() => handleStartOrderChat(order)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition disabled:opacity-50 hover:border-[var(--accent)] shrink-0"
                            style={{
                              background: 'var(--accent-muted)',
                              borderColor: 'var(--accent-border, var(--border))',
                              color: 'var(--text-accent, var(--text-primary))',
                            }}
                            title={t("Open two-way chat about this order", "Beszélgetés megnyitása a rendelésről")}
                          >
                            <svg className={`w-3.5 h-3.5 ${isChatting ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            <span>{isChatting ? (lang === 'hu' ? 'Megnyitás...' : 'Opening...') : (order.seller_id ? t('Message Seller', 'Üzenet az eladónak') : t('Message Store', 'Üzenet a boltnak'))}</span>
                          </button>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="p-4 sm:p-6 border-t space-y-6" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Customer Details */}
                            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                    {t('Customer Details', 'Vásárló adatai')}
                                  </p>
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                                    {t('Buyer', 'Vevő')}
                                  </span>
                                </div>

                                <div className="p-2 rounded-lg border flex items-center justify-between gap-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                      {t('Order Number', 'Rendelésszám')}
                                    </p>
                                    <p className="text-xs font-mono font-black select-text cursor-text truncate" style={{ color: 'var(--text-primary)' }}>
                                      #{order.order_number}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(order.order_number);
                                      setCopiedOrderNumber(order.order_number);
                                      showToast(lang === 'hu' ? `Rendelésszám kimásolva: #${order.order_number}` : `Order number copied: #${order.order_number}`);
                                      setTimeout(() => setCopiedOrderNumber(null), 2000);
                                    }}
                                    className="px-2 py-1 rounded-md border text-[11px] font-bold cursor-pointer transition hover:bg-[var(--bg-raised)] active:scale-95 inline-flex items-center gap-1 shrink-0"
                                    style={{
                                      background: 'var(--bg-input)',
                                      borderColor: copiedOrderNumber === order.order_number ? 'var(--positive-border)' : 'var(--border)',
                                      color: copiedOrderNumber === order.order_number ? 'var(--positive)' : 'var(--text-primary)',
                                    }}
                                    title={t("Copy order number", "Rendelésszám másolása")}
                                  >
                                    {copiedOrderNumber === order.order_number ? (
                                      <>
                                        <svg className="w-3.5 h-3.5 text-[var(--positive)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        <span>{t('Copied', 'Másolva')}</span>
                                      </>
                                    ) : (
                                      <>
                                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                        <span>{t('Copy', 'Másolás')}</span>
                                      </>
                                    )}
                                  </button>
                                </div>

                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Full Name', 'Teljes név')}</p>
                                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{customerName}</p>
                                </div>

                                {customerEmail && (
                                  <div>
                                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Email Address', 'E-mail cím')}</p>
                                    <a href={`mailto:${customerEmail}`} className="text-xs font-medium hover:underline break-all" style={{ color: 'var(--text-accent)' }}>
                                      {customerEmail}
                                    </a>
                                  </div>
                                )}

                                {customerPhone && (
                                  <div>
                                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Phone Number', 'Telefonszám')}</p>
                                    <a href={`tel:${customerPhone}`} className="text-xs font-mono font-medium hover:underline" style={{ color: 'var(--text-primary)' }}>
                                      {customerPhone}
                                    </a>
                                  </div>
                                )}
                              </div>

                              {customerNotes && (
                                <div className="mt-3 pt-2.5 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('Note', 'Megjegyzés')}</p>
                                  <p className="italic leading-relaxed p-2 rounded-lg border text-[11px]" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                                    &ldquo;{customerNotes}&rdquo;
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Shipping Details */}
                            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                    {t('Shipping Address', 'Szállítási cím')}
                                  </p>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-accent)' }}>
                                    {shipMode}
                                  </span>
                                </div>

                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Recipient', 'Címzett')}</p>
                                  <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{order.shipping_name || customerName}</p>
                                </div>

                                {(shipPostalCode || shipCity) ? (
                                  <div className="space-y-1">
                                    <div>
                                      <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Postal Code & City', 'Irányítószám & Település')}</p>
                                      <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                                        {shipPostalCode} {shipCity}
                                      </p>
                                    </div>
                                    {shipStreet && (
                                      <div>
                                        <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Street, House No. / Location', 'Utca, házszám / Helyszín')}</p>
                                        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                          {shipStreet}
                                        </p>
                                      </div>
                                    )}
                                    {shipLockerCode && (
                                      <div>
                                        <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Locker ID', 'Automata azonosító')}</p>
                                        <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border inline-block" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}>
                                          {shipLockerCode}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div>
                                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Address Details', 'Cím adatok')}</p>
                                    <p className="text-xs font-medium leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }}>
                                      {order.shipping_address || t('Not specified', 'Nincs megadva')}
                                    </p>
                                  </div>
                                )}
                              </div>

                              {order.tracking_number ? (
                                <div
                                  className="mt-3 p-2.5 rounded-xl border flex items-center justify-between gap-2"
                                  style={{
                                    background: 'var(--accent-muted)',
                                    borderColor: 'var(--accent-border)',
                                  }}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                      <line x1="12" y1="22.08" x2="12" y2="12" />
                                    </svg>
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-accent)' }}>
                                        {order.courier_name ? `${order.courier_name} ${t('Tracking', 'Követés')}` : t('Tracking Number', 'Csomagkövetési szám')}
                                      </p>
                                      <p className="font-mono text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>
                                        {order.tracking_number}
                                      </p>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(order.tracking_number || '');
                                      showToast(lang === 'hu' ? 'Csomagkövetési szám kimásolva!' : 'Tracking number copied!');
                                    }}
                                    className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition hover:bg-white/10 shrink-0"
                                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                                    title={t("Copy tracking number", "Csomagszám másolása")}
                                  >
                                    {t('Copy', 'Másolás')}
                                  </button>
                                </div>
                              ) : (
                                <div className="mt-3 pt-2.5 border-t text-[11px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                                  {isDelivered
                                    ? t('Package successfully delivered.', 'Csomag sikeresen kézbesítve.')
                                    : isShipped
                                    ? t('Package shipped, in transit.', 'Csomag feladva, szállítás alatt.')
                                    : t('Tracking number will appear here once shipped.', 'A feladás után itt jelenik meg a csomagkövetési szám.')}
                                </div>
                              )}
                            </div>

                            {/* Billing Details */}
                            <div className="p-4 rounded-xl border flex flex-col justify-between" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <p className="font-bold text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                                    {t('Billing Address', 'Számlázási cím')}
                                  </p>
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                                    {t('Invoice', 'Számla')}
                                  </span>
                                </div>

                                <div>
                                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Billing Name', 'Számlázási név')}</p>
                                  <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{billName}</p>
                                </div>

                                {billTaxNumber && (
                                  <div>
                                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Tax Number (Company)', 'Adószám (Céges)')}</p>
                                    <p className="text-xs font-mono font-bold" style={{ color: 'var(--text-accent)' }}>{billTaxNumber}</p>
                                  </div>
                                )}

                                {(billPostalCode || billCity) ? (
                                  <div className="space-y-1">
                                    <div>
                                      <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Postal Code & City', 'Irányítószám & Település')}</p>
                                      <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                                        {billPostalCode} {billCity}
                                      </p>
                                    </div>
                                    {billStreet && (
                                      <div>
                                        <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Street, House No.', 'Utca, házszám')}</p>
                                        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                          {billStreet}
                                        </p>
                                      </div>
                                    )}
                                    <div>
                                      <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Country', 'Ország')}</p>
                                      <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                        {billCountry}
                                      </p>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>{t('Address Details', 'Cím adatok')}</p>
                                    <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                      {order.shipping_address ? t('Same as shipping address', 'Megegyezik a szállítási címmel') : t('Individual billing address', 'Magánszemély számlázási cím')}
                                    </p>
                                  </div>
                                )}
                              </div>

                              <div className="mt-3 pt-2.5 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{t('Payment', 'Fizetés')}</p>
                                <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {t('Method', 'Mód')}: <span className="font-bold">{order.payment_method === 'stripe' ? t('Credit Card (Stripe)', 'Bankkártya (Stripe)') : (order.payment_method === 'bank_transfer' ? t('Bank Transfer', 'Banki átutalás') : (order.payment_method === 'cash_or_transfer' ? t('Personal / Transfer', 'Személyes átvétel / Utalás') : (order.payment_method || t('Bank Transfer', 'Banki átutalás'))))}</span>
                                </p>
                                <p className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                  {t('Status', 'Állapot')}: <span className="font-bold">
                                    {(order.payment_status === 'paid' || String(order.payment_status) === 'completed') ? t('Paid', 'Fizetve') : t('Pending payment', 'Fizetésre vár')}
                                  </span>
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Ordered Items Table */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                                {t('Ordered Items', 'Rendelt termékek')} ({itemCount})
                              </p>
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                                {order.seller_name ? `${lang === 'hu' ? 'Eladó' : 'Seller'}: ${order.seller_name}` : t('From Official Store inventory', 'Hivatalos Store készletből')}
                              </span>
                            </div>

                            <div className="border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                              <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                                {items.map((item, idx) => {
                                  const imgUrl = item.image_path ? (item.image_path.startsWith('http') || item.image_path.startsWith('/') ? item.image_path : getCardImageUrl(item.image_path)) : null;
                                  return (
                                    <div key={idx} className="p-3.5 flex items-center justify-between gap-4 text-xs" style={{ background: 'var(--bg-surface)' }}>
                                      <div className="flex items-center gap-3.5 min-w-0">
                                        {imgUrl ? (
                                          <img
                                            src={imgUrl}
                                            alt={item.card_name}
                                            className="w-12 h-12 object-contain rounded-xl border shrink-0 p-0.5"
                                            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                                          />
                                        ) : (
                                          <div
                                            className="w-12 h-12 rounded-xl border flex items-center justify-center shrink-0"
                                            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}
                                          >
                                            <svg className="w-5 h-5 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                                              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                            </svg>
                                          </div>
                                        )}
                                        <div className="min-w-0">
                                          <p className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{item.card_name}</p>
                                          <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                                            {item.card_number && <span>SKU: {item.card_number}</span>}
                                            {item.set_name && <span>· {item.set_name}</span>}
                                            {item.condition && <span className="px-1.5 py-0.2 rounded border text-[10px]">{item.condition}</span>}
                                            {item.is_foil && <span className="px-1.5 py-0.2 rounded border text-[10px] text-amber-400 border-amber-400/30">Foil</span>}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="text-right shrink-0">
                                        <p className="font-bold text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
                                          {formatPrice((item.price_huf || 0) * (item.quantity || 1))}
                                        </p>
                                        <p className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
                                          {item.quantity || 1} × {formatPrice(item.price_huf || 0)}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="p-3.5 border-t flex flex-col items-end gap-1 text-xs" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
                                <div className="flex justify-between w-48 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                  <span>{t('Subtotal', 'Részösszeg')}:</span>
                                  <span className="font-semibold text-right" style={{ color: 'var(--text-secondary)' }}>
                                    {formatPrice(items.reduce((sum, i) => sum + (i.price_huf || 0) * (i.quantity || 1), 0))}
                                  </span>
                                </div>
                                <div className="flex justify-between w-48 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                  <span>{t('Shipping', 'Szállítás')}:</span>
                                  <span className="font-semibold text-right" style={{ color: 'var(--text-secondary)' }}>
                                    {order.shipping_huf !== undefined ? (order.shipping_huf === 0 ? t('Free', 'Ingyenes') : formatPrice(order.shipping_huf)) : t('Included', 'Belefoglalva')}
                                  </span>
                                </div>
                                <div className="flex justify-between w-48 text-sm font-black pt-1 border-t" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
                                  <span>{t('Total', 'Végösszeg')}:</span>
                                  <span className="text-[var(--positive)] font-mono">{formatPrice(totalHuf)}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center justify-between pt-4 border-t text-xs flex-wrap gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={isChatting}
                                onClick={() => handleStartOrderChat(order)}
                                className="px-3.5 py-2 rounded-xl font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs hover:border-[var(--accent)]"
                                style={{
                                  background: 'var(--accent-muted)',
                                  borderColor: 'var(--accent-border)',
                                  color: 'var(--text-accent)',
                                }}
                              >
                                <svg className={`w-3.5 h-3.5 ${isChatting ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                <span>{isChatting ? (lang === 'hu' ? 'Megnyitás...' : 'Opening Chat...') : (order.seller_id ? t('Message Seller', 'Üzenet az eladónak') : t('Message Store', 'Üzenet a boltnak'))}</span>
                              </button>
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              {!isShipped && !isDelivered && !isCancelled && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelOrder(order.order_number)}
                                  disabled={cancellingOrderNumber === order.order_number}
                                  className="px-3 py-1.5 rounded-lg font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                                >
                                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                  </svg>
                                  <span>
                                    {cancellingOrderNumber === order.order_number ? t('Cancelling…', 'Lemondás…') : t('Cancel Order', 'Rendelés lemondása')}
                                  </span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteOrder(order.order_number || order.id)}
                                disabled={deletingOrderNumber === (order.order_number || order.id)}
                                className="px-3 py-1.5 rounded-lg font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                                <span>
                                  {deletingOrderNumber === (order.order_number || order.id) ? t('Deleting…', 'Törlés…') : t('Delete from list', 'Törlés a listából')}
                                </span>
                              </button>
                            </div>
                          </div>

                          {/* Post-Delivery Rating */}
                          {isDelivered && targetProfile && (order.user_id === targetProfile.id || order.seller_id === targetProfile.id) && (() => {
                            const asBuyer = order.user_id === targetProfile.id;
                            const isStoreOrder = !order.seller_id || order.seller_id === 'platform-owner' || String(order.order_number || '').startsWith('ORD-');
                            const mine = reviewsByOrder[order.order_number];

                            if (isStoreOrder) {
                              if (!asBuyer) return null;
                              return (
                                <div className="pt-3 mt-3 border-t flex items-center justify-between flex-wrap gap-2 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                                  <span style={{ color: 'var(--text-secondary)' }}>
                                    <span className="font-bold text-[var(--positive)]">{t('Delivered.', 'Kézbesítve.')}</span>{' '}
                                    {t('Satisfied with your order? Rate our store on Google!', 'Elégedett vagy a rendeléssel? Értékeld áruházunkat a Google-ön!')}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setShowGoogleReviewModal(true)}
                                    className="px-3.5 py-1.5 rounded-lg font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs bg-white/5 hover:bg-white/10"
                                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                                  >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
                                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                                    </svg>
                                    <span>{t('Google Review', 'Google Értékelés')}</span>
                                  </button>
                                </div>
                              );
                            }

                            return (
                              <div className="pt-3 mt-3 border-t flex items-center justify-between flex-wrap gap-2 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                                {mine ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Stars value={mine.rating} size={14} />
                                    <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>
                                      {t('Your rating:', 'Értékelésed:')} {mine.rating.toFixed(1)}
                                    </span>
                                    {mine.comment && (
                                      <span className="italic" style={{ color: 'var(--text-tertiary)' }}>&ldquo;{mine.comment}&rdquo;</span>
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    <span style={{ color: 'var(--text-secondary)' }}>
                                      <span className="font-bold text-[var(--positive)]">{t('Delivered.', 'Kézbesítve.')}</span>{' '}
                                      {lang === 'hu' ? `Hogy tetszett a ${asBuyer ? 'vásárlás' : 'vevő'}?` : `How was your experience with ${asBuyer ? 'the purchase' : 'the buyer'}?`}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setRatingModalOrder(order)}
                                      className="px-3.5 py-1.5 rounded-lg font-bold transition cursor-pointer border flex items-center gap-1.5 text-xs"
                                      style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                                    >
                                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                      </svg>
                                      <span>{lang === 'hu' ? `Értékelés (${asBuyer ? 'Eladó' : 'Vevő'})` : `Rate (${asBuyer ? 'Seller' : 'Buyer'})`}</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: Settings & Theme (Owner Only) */}
      {isMe && activeTab === 'settings' && (
        <div className="mb-8 space-y-6">
          {/* Profile Appearance & Details Card */}
          <div
            className="rounded-2xl p-5 border flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div>
              <h3 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
                <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <span>{t('Profile Information & Appearance', 'Profil adatok és megjelenés')}</span>
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                {t('Change your display name, country, avatar picture, banner cover, and social profile links.', 'Változtasd meg a megjelenített nevedet, országodat, profilképedet, borítóképedet és közösségi linkjeidet.')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAppearanceModal(true)}
              className="px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm border cursor-pointer hover:brightness-110 self-start sm:self-auto shrink-0"
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
            >
              {t('Edit Profile Settings', 'Profilbeállítások szerkesztése')}
            </button>
          </div>

          {/* Theme & Palette Container */}
          <div
            className="rounded-2xl p-5 border space-y-5"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
                  <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 2a4.5 4.5 0 0 0 0 9 4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0-9 4.5 4.5 0 0 1 0-9" />
                  </svg>
                  <span>{t('Theme & Appearance', 'Téma és Megjelenés')}</span>
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {t('Choose a preset site theme, custom colors, or system preference.', 'Válassz egy előre beállított témát vagy szabd testre a színeket.')}
                </p>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)', background: 'var(--bg-surface-2)' }}>
                {activeSwatch.name}
              </span>
            </div>

            {/* Theme Swatches */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {THEME_SWATCHES.map((opt) => {
                const active = themeMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => {
                      setThemeMode(opt.mode);
                      showToast(lang === 'hu' ? `Téma: ${opt.name}` : `Theme: ${opt.name}`);
                    }}
                    title={opt.hex.join(' / ')}
                    className={`px-3.5 py-3 rounded-xl text-left transition cursor-pointer border flex items-center gap-3 ${
                      active
                        ? 'bg-[var(--accent-muted)] border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]'
                        : 'bg-[var(--bg-input)] border-[var(--border)] hover:bg-[var(--bg-raised)] hover:border-[var(--border-hover)]'
                    }`}
                  >
                    {opt.hex.length > 1 ? (
                      <span className="flex -space-x-1 shrink-0">
                        {opt.hex.map((h) => (
                          <span
                            key={h}
                            className="w-3.5 h-3.5 rounded-full border"
                            style={{ background: h, borderColor: 'var(--border-hover)' }}
                          />
                        ))}
                      </span>
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: opt.hex[0], boxShadow: `0 0 6px ${opt.hex[0]}99` }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate" style={{ color: active ? 'var(--text-accent)' : 'var(--text-primary)' }}>
                        {opt.name}
                      </div>
                      <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                        {opt.hex.join(' / ')}
                      </div>
                    </div>
                    {active && (
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2.5}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Currency Preference */}
            <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('Display Currency', 'Megjelenített pénznem')}</h4>
                <p className="text-xs text-[var(--text-secondary)]">{t('Show marketplace listings and cart prices in Hungarian Forints or Euros.', 'A piactéri hirdetések és a kosár árainak megjelenítése forintban vagy euróban.')}</p>
              </div>
              <div className="inline-flex rounded-xl p-1 border gap-1 self-start sm:self-auto" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  onClick={() => { setCurrency('HUF'); showToast(lang === 'hu' ? 'Pénznem beállítva: HUF (Ft)' : 'Display currency set to HUF (Ft)'); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${currency === 'HUF' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  HUF (Ft)
                </button>
                <button
                  type="button"
                  onClick={() => { setCurrency('EUR'); showToast(lang === 'hu' ? 'Pénznem beállítva: EUR (€)' : 'Display currency set to EUR (€)'); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${currency === 'EUR' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  EUR (€)
                </button>
              </div>
            </div>

            {/* Custom Theme Studio */}
            {themeMode === 'custom' && (
              <div className="pt-5 border-t border-[var(--border-subtle)] space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-black text-[var(--text-primary)] flex items-center gap-2">
                      <span>{t('Custom Palette Studio', 'Egyéni Paletta Stúdió')}</span>
                    </h4>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {t('Customize your colors, border geometry, glow highlights, and typography.', 'Szabd testre a színeket, lekerekítéseket, ragyogásokat és fényeket.')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          navigator.clipboard.writeText(JSON.stringify(customConfig, null, 2));
                          showToast(lang === 'hu' ? 'Téma JSON a vágólapra másolva' : 'Theme JSON copied to clipboard');
                        } catch {
                          showToast(lang === 'hu' ? 'A másolás nem sikerült' : 'Unable to copy to clipboard');
                        }
                      }}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      <span>{t("Export JSON", "JSON exportálás")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowThemeJsonBox(!showThemeJsonBox)}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      <span>{t("Import JSON", "JSON importálás")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const def = DEFAULT_CUSTOM_THEME;
                        setCustomConfig(def);
                        saveCustomTheme(def);
                        showToast(lang === 'hu' ? 'Egyéni paletta visszaállítva az alapértékekre' : 'Reset custom palette to defaults');
                      }}
                      className="text-xs font-bold px-3 py-1.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
                    >
                      {t('Reset', 'Alaphelyzet')}
                    </button>
                  </div>
                </div>

                {showThemeJsonBox && (
                  <div className="p-3.5 rounded-xl border border-[var(--accent-border)] bg-[var(--bg-input)] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--text-primary)]">{t('Paste Theme JSON', 'Téma JSON beillesztése')}</span>
                      <button
                        type="button"
                        onClick={() => setShowThemeJsonBox(false)}
                        className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        {t('Close', 'Bezárás')}
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={themeJsonInput}
                      onChange={(e) => setThemeJsonInput(e.target.value)}
                      placeholder='{"bgPage": "#080811", "accent": "#06b6d4", ...}'
                      className="w-full p-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-y"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const parsed = JSON.parse(themeJsonInput.trim());
                            if (parsed && typeof parsed === 'object') {
                              const updated = { ...DEFAULT_CUSTOM_THEME, ...parsed };
                              setCustomConfig(updated);
                              saveCustomTheme(updated);
                              setShowThemeJsonBox(false);
                              setThemeJsonInput('');
                              showToast(lang === 'hu' ? 'Egyéni téma sikeresen importálva' : 'Custom theme imported successfully');
                            } else {
                              showToast(lang === 'hu' ? 'Érvénytelen JSON formátum' : 'Invalid JSON structure');
                            }
                          } catch {
                            showToast(lang === 'hu' ? 'A JSON szöveg beolvasása sikertelen' : 'Failed to parse JSON string');
                          }
                        }}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:brightness-110 cursor-pointer"
                      >
                        {t('Apply Theme', 'Téma alkalmazása')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Sliders */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-[var(--text-primary)]">{t('Border Radius Geometry', 'Lekerekítés mértéke')}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{t('Controls corner roundness across the UI', 'A felület sarkainak lekerekítését szabályozza')}</div>
                      </div>
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--accent)]">
                        {customConfig.borderRadius ?? 12}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={24}
                      step={1}
                      value={customConfig.borderRadius ?? 12}
                      onChange={(e) => {
                        const next = { ...customConfig, borderRadius: Number(e.target.value) };
                        setCustomConfig(next);
                        saveCustomTheme(next);
                      }}
                      className="w-full h-1.5 bg-[var(--bg-surface-2)] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                    />
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-[var(--text-primary)]">{t('Glow & Shadow Intensity', 'Ragyogás és Árnyék Intenzitás')}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{t('Backdrop radial glow, card halos, and button shines', 'Háttérfények, kártya kiemelések és gomb ragyogások')}</div>
                      </div>
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--accent)]">
                        {customConfig.glowIntensity ?? 50}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={customConfig.glowIntensity ?? 50}
                      onChange={(e) => {
                        const next = { ...customConfig, glowIntensity: Number(e.target.value) };
                        setCustomConfig(next);
                        saveCustomTheme(next);
                      }}
                      className="w-full h-1.5 bg-[var(--bg-surface-2)] rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
                    />
                  </div>
                </div>

                {/* Color Pickers Grid */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">{t('Palette Colors', 'Paletta színei')}</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { key: 'bgPage' as const, label: t('Page Background', 'Oldal háttér'), desc: t('Main canvas & page backdrop', 'Fő oldalháttér') },
                      { key: 'bgSurface' as const, label: t('Surface Container', 'Felület tároló'), desc: t('Cards, panels, and modals', 'Kártyák, panelek és modális ablakok') },
                      { key: 'bgSurface2' as const, label: t('Secondary Surface', 'Másodlagos felület'), desc: t('Nested cards & chips', 'Beágyazott kártyák és elemek') },
                      { key: 'border' as const, label: t('Border Highlight', 'Szegély kiemelés'), desc: t('Card outlines & dividers', 'Kártyaszegélyek és elválasztók') },
                      { key: 'accent' as const, label: t('Primary Accent', 'Elsődleges hangsúly'), desc: t('Buttons, badges, and glows', 'Gombok, kitűzők és ragyogások') },
                      { key: 'accentSecondary' as const, label: t('Secondary Accent', 'Másodlagos hangsúly'), desc: t('Dual-tone gradients & tags', 'Kéttónusú átmenetek és címkék') },
                      { key: 'textPrimary' as const, label: t('Primary Text', 'Főszöveg'), desc: t('Headings and main body text', 'Címsorok és főbb szövegek') },
                      { key: 'textMuted' as const, label: t('Muted Text', 'Halvány szöveg'), desc: t('Subtitles and secondary copy', 'Alcímek és másodlagos szövegek') },
                    ].map((field) => {
                      const rawVal = customConfig[field.key];
                      const val = (rawVal && typeof rawVal === 'string') ? rawVal : (field.key === 'accentSecondary' ? '#06b6d4' : field.key === 'textMuted' ? '#94a3b8' : field.key === 'border' ? 'rgba(168, 85, 247, 0.3)' : '#a855f7');
                      const colorPickerVal = val.startsWith('#') && (val.length === 7 || val.length === 4) ? val : '#a855f7';

                      return (
                        <div
                          key={field.key}
                          className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] flex items-center gap-3"
                        >
                          <label className="relative w-9 h-9 rounded-lg border border-[var(--border-hover)] shadow-sm shrink-0 cursor-pointer overflow-hidden block">
                            <span className="absolute inset-0" style={{ background: val }} />
                            <input
                              type="color"
                              value={colorPickerVal}
                              onChange={(e) => {
                                const next = { ...customConfig, [field.key]: e.target.value };
                                setCustomConfig(next);
                                saveCustomTheme(next);
                              }}
                              className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                            />
                          </label>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-[var(--text-primary)] truncate">{field.label}</div>
                            <div className="text-[10px] text-[var(--text-muted)] truncate">{field.desc}</div>
                          </div>
                          <input
                            type="text"
                            value={typeof rawVal === 'string' ? rawVal : ''}
                            placeholder={field.key === 'border' ? 'rgba(...)' : '#hex'}
                            onChange={(e) => {
                              const next = { ...customConfig, [field.key]: e.target.value };
                              setCustomConfig(next);
                              saveCustomTheme(next);
                            }}
                            className="w-20 px-2 py-1 text-[11px] font-mono rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-center focus:outline-none focus:border-[var(--accent)]"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Danger Zone */}
          {!targetProfile?.is_owner && targetProfile?.email && <DeleteAccountCard email={targetProfile.email} />}
        </div>
      )}

      {/* Profile Settings Modal */}
      {isMe && targetProfile && (
        <AvatarBannerModal
          open={showAppearanceModal}
          onClose={() => setShowAppearanceModal(false)}
          currentAvatarUrl={targetProfile.avatar_url}
          currentBannerUrl={bannerUrl}
          displayName={targetProfile.display_name || targetProfile.email || 'Collector'}
          email={targetProfile.email}
          currentCountry={targetProfile.country || 'HU'}
          initialSocialProfiles={socialProfiles}
          onDeleteAccount={targetProfile.is_owner ? undefined : () => {
            setShowAppearanceModal(false);
            handleTabChange('settings');
            window.setTimeout(() => document.getElementById('danger-zone')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
          }}
          onSaved={({ display_name, country, avatar_url, banner_url, social_profiles }) => {
            setTargetProfile(prev => (prev ? { ...prev, display_name, country, avatar_url, banner_url, social_profiles } : prev));
            setBannerUrl(banner_url);
            if (social_profiles) setSocialProfiles(social_profiles);
            showToast(t('Profile settings saved successfully!', 'Profilbeállítások sikeresen mentve!'));
          }}
        />
      )}

      {/* Manage Collections Modal */}
      {isMe && targetUserId && (
        <ManageCollectionsModal
          open={showManageCollectionsModal}
          onClose={() => {
            setShowManageCollectionsModal(false);
            loadCollectionsData(targetUserId);
          }}
          personalCards={undefined}
          pricesFor={async () => ({})}
          onToast={(msg) => showToast(msg)}
        />
      )}

      {/* QR Modal */}
      {showQrModal && targetUserId && (
        <ProfileQrModal
          userId={targetUserId}
          displayName={displayName}
          onClose={() => setShowQrModal(false)}
        />
      )}

      {/* Report Modal */}
      {!isMe && targetUserId && (
        <ReportModal
          open={showReportModal}
          onClose={() => setShowReportModal(false)}
          type="profile"
          targetId={targetUserId}
          targetName={displayName}
          targetLink={typeof window !== 'undefined' ? window.location.href : getProfileUrl({ id: targetUserId, display_name: displayName })}
        />
      )}

      {/* Card Preview Overlay */}
      <CardPreviewOverlay
        cardId={previewCardId}
        inventoryId={previewInventoryId}
        onClose={() => {
          setPreviewCardId(null);
          setPreviewInventoryId(null);
        }}
        zIndex={100}
      />

      {/* Rate Trade Modal */}
      <RateTradeModal
        open={Boolean(ratingModalOrder)}
        onClose={() => setRatingModalOrder(null)}
        orderNumber={ratingModalOrder?.order_number || ''}
        direction={ratingModalOrder && targetProfile && ratingModalOrder.user_id !== targetProfile.id ? 'seller_to_buyer' : 'buyer_to_seller'}
        counterpartName={ratingModalOrder && targetProfile && ratingModalOrder.user_id !== targetProfile.id ? ratingModalOrder.customer_info?.name : ratingModalOrder?.seller_name}
        onDone={(review) => {
          setReviewsByOrder(prev => ({ ...prev, [review.order_number]: review }));
          showToast(t('Thanks for the rating!', 'Köszönjük az értékelést!'));
        }}
      />

      {/* Google Review Modal */}
      {showGoogleReviewModal && (
        <div {...backdropCloseProps(() => setShowGoogleReviewModal(false))} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div
            className="relative w-full max-w-md rounded-2xl p-6 border shadow-2xl space-y-4"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-base text-[var(--text-primary)]">{t('Google Review', 'Google Értékelés')}</h3>
                  <p className="text-xs text-[var(--text-tertiary)]">{t('TCGXchange Official Webshop', 'TCGXchange hivatalos webáruház')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGoogleReviewModal(false)}
                className="p-1 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition cursor-pointer"
                aria-label={t('Close', 'Bezárás')}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 rounded-xl border bg-amber-500/10 border-amber-500/20 text-xs text-amber-200/90 leading-relaxed space-y-2">
              <p className="font-bold text-amber-100 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {t('Company registration and Google Business Profile in progress', 'Cégbejegyzés és Google Cégem profil folyamatban')}
              </p>
              <p>
                {t('Our official Google Business Profile will be available soon! Once the company registration is complete, customers will be able to review our webshop and services directly on Google.', 'Hamarosan elérhető lesz a hivatalos Google Cégem oldalunk! A cégbejegyzés lezárulása után a vásárlók közvetlenül a Google-ön értékelhetik a webáruházat és a szolgáltatásainkat.')}
              </p>
            </div>

            <div className="text-xs text-[var(--text-secondary)] space-y-2">
              <p>
                {t('In the meantime, if you have any questions, feedback, or need help with your order, contact us directly:', 'Addig is, ha észrevételed, visszajelzésed vagy segítségre van szükséged a rendeléssel kapcsolatban, fordulj hozzánk közvetlenül:')}
              </p>
              <a href="mailto:support@tcgxchange.net" className="inline-flex items-center gap-1.5 font-semibold text-[var(--accent-strong)] hover:underline">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                support@tcgxchange.net
              </a>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGoogleReviewModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
                style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
              >
                {t('Got it, thank you', 'Rendben, köszönöm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastAnim.rendered && toastMessageRef.current && (
        <div
          data-state={toastAnim.state}
          className="tv-toast fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2.5 border"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)'
          }}
        >
          <span className="w-2 h-2 rounded-full shadow-[0_0_8px_var(--accent)]" style={{ background: 'var(--accent-strong)' }} />
          <span>{toastMessageRef.current}</span>
        </div>
      )}
    </div>
  );
}


function ProfileListingCard({
  listing,
  isMe,
  cart,
  onPreview,
  t,
  formatPrice,
}: {
  listing: any;
  isMe: boolean;
  cart: any[];
  onPreview: (inventoryId: string) => void;
  t: (en: string, hu: string) => string;
  formatPrice: (huf: number) => string;
}) {
  const inCart = listing.inventory_id ? cartQuantityFor(cart, listing.inventory_id) : 0;
  const left = Math.max(0, (Number(listing.quantity) || 1) - inCart);
  const [justAdded, setJustAdded] = useState(false);
  const isLocked = listing.status === 'On Hold' || listing.status === 'Reserved' || listing.status === 'Sold';

  const handleAddToCart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || isMe || left <= 0 || !listing.inventory_id) return;
    addToCart({
      inventoryId: listing.inventory_id,
      sellerId: listing.seller_id || '',
      sellerName: listing.seller_name || 'Community Seller',
      cardName: listing.name,
      cardNumber: listing.card_number,
      imagePath: listing.image_path || undefined,
      priceHuf: listing.price_huf || 0,
      quantity: 1,
      maxQuantity: Math.max(1, Number(listing.quantity) || 1),
      isFoil: Boolean(listing.is_foil),
      condition: listing.condition || 'Near Mint',
      handoverMethods: listing.handover_methods,
      sellerCountry: listing.seller_country || 'HU',
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
  };

  return (
    <div
      className="rounded-2xl border flex flex-col overflow-hidden transition hover:-translate-y-1 hover:shadow-xl group"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div
        className="relative aspect-[2.5/3.5] bg-zinc-950 overflow-hidden cursor-pointer"
        onClick={() => onPreview(listing.inventory_id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPreview(listing.inventory_id);
          }
        }}
      >
        {listing.image_path ? (
          <img
            {...cardThumbProps(listing.image_path, 'gridLarge')}
            alt={listing.name}
            className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center">
            <span className="text-xs font-black tracking-widest text-zinc-600">TCG</span>
            <span className="text-[10px] text-zinc-500 mt-1 line-clamp-2">{listing.name}</span>
          </div>
        )}

        {/* Condition in top left */}
        {listing.condition && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-black bg-zinc-950/85 text-white border border-white/20 backdrop-blur-sm shadow-md z-10 tracking-wide">
            {listing.condition}
          </span>
        )}

        {/* Top right badges: Like button, FOIL, Photos */}
        <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1 z-10" onClick={(e) => e.stopPropagation()}>
          {listing.inventory_id && (
            <ListingLikeButton id={listing.inventory_id} type="listing" initialCount={listing.likes_count} alwaysShowCount size="sm" />
          )}
          {listing.is_foil && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-500 text-black shadow-md">
              FOIL
            </span>
          )}
          {listing.inventory_images && listing.inventory_images.length > 0 && (
            <span
              className="px-1.5 py-0.5 text-[9px] font-black rounded uppercase tracking-wider bg-amber-400 text-zinc-950 border border-amber-200 shadow-md flex items-center gap-1"
              title="Photos attached"
            >
              <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span>{listing.inventory_images.length}</span>
            </span>
          )}
        </div>

        {/* On Hold banner */}
        {isLocked && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 py-1 px-2 bg-black/90 border-y border-amber-500/70 shadow-[0_0_20px_rgba(245,158,11,0.5)] flex items-center justify-center gap-1.5 z-20">
            <svg className="w-3 h-3 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-[10px] font-black tracking-widest uppercase" style={{ color: 'var(--text-accent)' }}>
              {listing.status === 'Sold' ? t('SOLD', 'ELADVA') : t('ON HOLD', 'JEGELVE')}
            </span>
          </div>
        )}
      </div>

      <div className="p-2.5 flex flex-col flex-1 justify-between gap-2">
        <div>
          <button
            type="button"
            onClick={() => onPreview(listing.inventory_id)}
            className="text-xs sm:text-sm font-black truncate text-left w-full hover:underline cursor-pointer"
            style={{ color: 'var(--text-primary)' }}
            title={listing.name}
          >
            {listing.name}
          </button>
          <div className="text-[11px] font-mono mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>
            {listing.set_code ? `${listing.set_code} · ${listing.card_number || '000'}` : (listing.card_number || '—')}
          </div>
        </div>

        <div>
          {/* Price & Stock Amount */}
          <div className="flex items-center justify-between pt-1 border-t pb-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-xs sm:text-sm font-black font-mono text-[var(--positive)]">
              {formatPrice(listing.price_huf || 0)}
            </span>
            <span className="text-[10px] font-bold text-[var(--positive)]">
              {listing.status === 'In Stock'
                ? `${listing.quantity || 1} ${t('In Stock', 'készleten')}`
                : isLocked
                ? (listing.status === 'Sold' ? t('Sold', 'Eladva') : t('On Hold', 'Jegelve'))
                : `${listing.quantity || 1} ${t('In Stock', 'készleten')}`}
            </span>
          </div>

          {/* Action button */}
          {isMe ? (
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => onPreview(listing.inventory_id)}
                className="flex-1 py-1 text-[11px] font-semibold rounded-lg border cursor-pointer transition hover:bg-[var(--bg-surface-2)] text-center"
                style={{ background: 'var(--bg-surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
              >
                {t('Preview', 'Megtekintés')}
              </button>
              <a
                href="/seller"
                className="px-2.5 py-1 text-[11px] font-bold rounded-lg border transition hover:brightness-110 text-center"
                style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                title={t('Edit in Seller Hub', 'Szerkesztés az Eladói felületen')}
              >
                {t('Edit', 'Szerkesztés')}
              </a>
            </div>
          ) : isLocked ? (
            <div
              className="w-full py-1 text-[10px] font-bold rounded-lg border flex items-center justify-center gap-1 select-none uppercase tracking-wider"
              style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}
            >
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>{t('On Hold', 'Jegelve')}</span>
            </div>
          ) : left > 0 ? (
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={handleAddToCart}
                className="flex-1 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition shadow-xs hover:brightness-110 active:scale-95 flex items-center justify-center gap-1.5"
                style={{
                  background: justAdded ? 'var(--positive)' : 'var(--accent-strong)',
                  color: 'var(--text-on-accent, #000)',
                }}
                title={t('Add to cart', 'Kosárba teszem')}
              >
                {justAdded ? (
                  <>
                    <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{t('Added', 'Hozzáadva')}</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                      <circle cx="9" cy="21" r="1" />
                      <circle cx="20" cy="21" r="1" />
                      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                    </svg>
                    <span>{t('Add to cart', 'Kosárba')}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onPreview(listing.inventory_id)}
                className="px-2 py-1 text-[11px] font-medium rounded-lg border transition hover:bg-[var(--bg-surface-2)] cursor-pointer"
                style={{ background: 'var(--bg-surface-2)', color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}
                title={t('Preview card details', 'Kártya részletei')}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          ) : inCart > 0 ? (
            <div className="flex items-center gap-1.5 pt-0.5">
              <div
                className="flex-1 py-1 text-[10px] font-bold rounded-lg border flex items-center justify-center gap-1 select-none"
                style={{
                  background: 'var(--positive-muted)',
                  color: 'var(--positive)',
                  borderColor: 'var(--positive-border)',
                }}
              >
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{t('In Cart', 'Kosárban')} ({inCart})</span>
              </div>
              <button
                type="button"
                onClick={() => onPreview(listing.inventory_id)}
                className="px-2 py-1 text-[11px] font-medium rounded-lg border transition hover:bg-[var(--bg-surface-2)] cursor-pointer"
                style={{ background: 'var(--bg-surface-2)', color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}
                title={t('Preview card details', 'Kártya részletei')}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onPreview(listing.inventory_id)}
              className="w-full py-1 text-[11px] font-semibold rounded-lg border cursor-pointer transition hover:bg-[var(--bg-surface-2)] text-center"
              style={{ background: 'var(--bg-surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
            >
              {t('Preview', 'Megtekintés')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
