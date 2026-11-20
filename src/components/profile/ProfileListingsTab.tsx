import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countActiveFilters, defaultCostBounds } from '../../lib/activeFilterCount';
import { compareCardsByRarity, matchesCardVariants } from '../../lib/cardVariants';
import {
  DOMAINS,
  RARITIES,
  SETS,
  TAGS,
  TYPES,
  sortSetNames,
} from '../../lib/constants';
import { useCurrency } from '../../lib/currency';
import { gridSizeClasses, type GridSize } from '../../lib/gridSize';
import { useLanguage } from '../../lib/i18n';
import { cardMatchesKeywords } from '../../lib/keywordSearch';
import {
  createHoldRequest,
  fetchListings,
  loadP2PCart,
  p2pCartEntryToGeneric,
  saveP2PCart,
  startP2PConversation,
  toggleLike,
  type P2PCartEntry,
  type P2PListing,
} from '../../lib/p2pClient';
import { parseDomains } from '../../lib/domainColors';
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
import { CardGridSkeleton } from '../ui/CardGridSkeleton';
import { EditListingModal } from '../marketplace/EditListingModal';
import { HoldConfirmModal, type HoldTarget } from '../marketplace/HoldConfirmModal';
import { MarketplaceListingTile } from '../marketplace/MarketplaceCardTile';

const PAGE_SIZE = 48;

const DEFAULT_LISTING_FILTERS: FilterState = {
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
  promoFilter: 'all',
  signedFilter: 'all',
  overnumberedFilter: 'all',
  altArtFilter: 'all',
  spFilter: 'all',
  baseSetFilter: 'all',
};

const LISTING_SORT_OPTIONS: SortOption[] = [
  { mode: 'Price (Low to High)', label: 'Price (Low to High)', labelHu: 'Ár (Növekvő)' },
  { mode: 'Price (High to Low)', label: 'Price (High to Low)', labelHu: 'Ár (Csökkenő)' },
  { mode: 'Newest First', label: 'Newest First', labelHu: 'Legújabb elöl' },
  { mode: 'Card Number (Asc)', label: 'Card Number (Asc)', labelHu: 'Kártyaszám (Növekvő)' },
  { mode: 'Rarity (High to Low)', label: 'Rarity (High to Low)', labelHu: 'Ritkaság (Magas elöl)' },
  { mode: 'Name (A to Z)', label: 'Name (A to Z)', labelHu: 'Név (A-Z)' },
];

export interface ProfileListingsTabProps {
  sellerId: string;
  sellerDisplayName: string;
  isMe: boolean;
  viewerProfile: UserProfile | null;
  gridSize: GridSize;
  onGridSizeChange: (size: GridSize) => void;
  onOpenCardPreview: (cardId: string) => void;
  onCountChange?: (count: number) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export function ProfileListingsTab({
  sellerId,
  sellerDisplayName,
  isMe,
  viewerProfile,
  gridSize,
  onGridSizeChange,
  onOpenCardPreview,
  onCountChange,
  onToast,
}: ProfileListingsTabProps) {
  const { t, lang } = useLanguage();
  const { formatPrice } = useCurrency();

  const [listings, setListings] = useState<P2PListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_LISTING_FILTERS);
  const [sortMode, setSortMode] = useState('Price (Low to High)');
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);

  const [likeBusyIds, setLikeBusyIds] = useState<Set<string>>(new Set());
  const [holdTarget, setHoldTarget] = useState<HoldTarget | null>(null);
  const [editingListing, setEditingListing] = useState<P2PListing | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [cart, setCart] = useState<P2PCartEntry[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartSubmittingSellerId, setCartSubmittingSellerId] = useState<string | null>(null);

  const listTopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCart(loadP2PCart());
  }, []);

  const refreshListings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchListings({
        seller_id: sellerId,
        view: isMe ? 'mine' : 'all_listings',
        sort: 'newest',
      });
      const activeOnly = (res.listings || []).filter((l) =>
        isMe ? l.status !== 'Sold' : l.status === 'In Stock' && l.quantity > 0
      );
      setListings(activeOnly);
      onCountChange?.(activeOnly.filter((l) => l.status === 'In Stock' && l.quantity > 0).length);
    } catch {
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [sellerId, isMe, onCountChange]);

  useEffect(() => {
    refreshListings();
  }, [refreshListings]);

  const availableFilterOptions = useMemo(() => {
    const sets = new Set<string>();
    const rarities = new Set<string>();
    const types = new Set<string>();
    const domains = new Set<string>();
    const tags = new Set<string>();

    for (const l of listings) {
      const c = l.card;
      if (c.sets?.name) sets.add(c.sets.name);
      if (c.rarity) rarities.add(c.rarity);
      if (c.card_type) types.add(c.card_type);
      if (c.domain) {
        parseDomains(c.domain).forEach((d) => domains.add(d));
      }
      if (Array.isArray(c.tags)) {
        c.tags.forEach((tg) => {
          if (tg) tags.add(String(tg));
        });
      }
    }

    return {
      sets: sets.size > 0 ? sortSetNames(Array.from(sets)) : SETS,
      rarities: rarities.size > 0 ? RARITIES.filter((r) => rarities.has(r)).concat(Array.from(rarities).filter((r) => !RARITIES.includes(r))) : RARITIES,
      types: types.size > 0 ? Array.from(types).sort() : TYPES,
      domains: domains.size > 0 ? DOMAINS.filter((d) => domains.has(d)) : DOMAINS,
      tags: tags.size > 0 ? Array.from(tags).sort() : TAGS,
    };
  }, [listings]);

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const { costMin: defaultMinCost, costMax: defaultMaxCost } = defaultCostBounds(filters.game || 'riftbound');

    let list = listings.filter((l) => {
      const c = l.card;
      if (q) {
        const hay = `${c.name} ${c.card_number} ${c.sets?.name || ''} ${c.card_type || ''} ${c.rarity || ''} ${l.condition || ''} ${l.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (filters.sets.length > 0 && !filters.sets.includes(c.sets?.name || '')) return false;
      if (filters.rarities.length > 0 && !filters.rarities.includes(c.rarity || '')) return false;
      if (filters.type && (c.card_type || '').toLowerCase() !== filters.type.toLowerCase()) return false;

      if (filters.domains.length > 0) {
        const cardDomains = parseDomains(c.domain);
        const matchesDom = filters.domains.every((d) =>
          cardDomains.some((cd) => cd.toLowerCase() === d.toLowerCase())
        );
        if (!matchesDom) return false;
      }

      if (filters.foilFilter && !l.is_foil) return false;

      if (filters.keywords && filters.keywords.length > 0) {
        if (!cardMatchesKeywords(c as any, filters.keywords, filters.keywordMode || 'and')) return false;
      }

      const cardForVariantCheck = {
        ...c,
        is_foil: l.is_foil,
        set_name: c.sets?.name,
        set_code: c.sets?.code,
      };
      if (!matchesCardVariants(cardForVariantCheck, { ...filters, foilFilter: false })) return false;

      if (c.cost != null) {
        const num = Number(c.cost);
        if (!Number.isNaN(num)) {
          if (filters.costMin > defaultMinCost && num < filters.costMin) return false;
          if (filters.costMax < defaultMaxCost && num > filters.costMax) return false;
        }
      }

      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortMode === 'Price (Low to High)') return a.price_huf - b.price_huf;
      if (sortMode === 'Price (High to Low)') return b.price_huf - a.price_huf;
      if (sortMode === 'Newest First') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortMode === 'Rarity (High to Low)') return compareCardsByRarity(a.card, b.card, 'desc');
      if (sortMode === 'Name (A to Z)') return (a.card.name || '').localeCompare(b.card.name || '');
      return (a.card.card_number || '').localeCompare(b.card.card_number || '', undefined, { numeric: true });
    });

    return list;
  }, [listings, search, filters, sortMode]);

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const paginationResetKey = useMemo(
    () => `${sellerId}|${search}|${sortMode}|${JSON.stringify(filters)}`,
    [sellerId, search, sortMode, filters]
  );
  const pager = usePagination(filteredListings, PAGE_SIZE, paginationResetKey);

  const totalListedValueHuf = useMemo(
    () => filteredListings.reduce((sum, l) => sum + (Number(l.price_huf) || 0) * (Number(l.quantity) || 0), 0),
    [filteredListings]
  );
  const totalCopies = useMemo(
    () => filteredListings.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0),
    [filteredListings]
  );

  const requireSignedIn = (): boolean => {
    if (!viewerProfile) {
      setShowAuthModal(true);
      return false;
    }
    return true;
  };

  const handleToggleLike = async (listing: P2PListing) => {
    if (!requireSignedIn()) return;
    if (likeBusyIds.has(listing.id)) return;
    setLikeBusyIds((prev) => new Set(prev).add(listing.id));
    try {
      const res = await toggleLike('listing', listing.id);
      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id
            ? { ...item, liked_by_me: res.liked, likes_count: res.likes_count }
            : item
        )
      );
    } catch (e: any) {
      onToast(e?.message || t('Could not update like.', 'Nem sikerült a kedvelés frissítése.'), 'error');
    } finally {
      setLikeBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(listing.id);
        return next;
      });
    }
  };

  const handleAddToCart = (listing: P2PListing) => {
    if (!requireSignedIn()) return;
    if (viewerProfile && listing.seller_id === viewerProfile.id) {
      onToast(t('You cannot add your own listing to cart.', 'Saját hirdetést nem tehetsz a kosárba.'), 'error');
      return;
    }
    setCart((prev) => {
      const existing = prev.find((e) => e.listingId === listing.id);
      let next: P2PCartEntry[];
      if (existing) {
        const nextQty = Math.min(listing.quantity, existing.quantity + 1);
        next = prev.map((e) => (e.listingId === listing.id ? { ...e, quantity: nextQty, listing } : e));
      } else {
        next = [...prev, { listingId: listing.id, quantity: 1, listing }];
      }
      saveP2PCart(next);
      return next;
    });
    onToast(t(`Added ${listing.card.name} to cart.`, `${listing.card.name} a kosárba került.`), 'success');
  };

  const handleMessageSeller = async (listing: P2PListing) => {
    if (!requireSignedIn()) return;
    try {
      const msg =
        lang === 'hu'
          ? `Szia! Érdeklődnék a hirdetésed iránt: ${listing.card.name} (${listing.card.card_number}) — ${formatPrice(listing.price_huf)}`
          : `Hi! I'm interested in your listing: ${listing.card.name} (${listing.card.card_number}) — ${formatPrice(listing.price_huf)}`;
      const res = await startP2PConversation(listing.seller_id, msg);
      window.location.href = `/messages?conversation_id=${encodeURIComponent(res.conversation_id)}`;
    } catch (e: any) {
      onToast(e?.message || t('Failed to start conversation.', 'Nem sikerült megnyitni a beszélgetést.'), 'error');
    }
  };

  const cartSellerGroups: GenericCartSellerGroup[] = useMemo(() => {
    const bySeller = new Map<string, GenericCartSellerGroup>();
    for (const entry of cart) {
      const item = p2pCartEntryToGeneric(entry);
      const sid = entry.listing.seller_id;
      const existing = bySeller.get(sid);
      if (existing) {
        existing.items.push(item);
        existing.subtotal += item.priceHuf * item.quantity;
      } else {
        bySeller.set(sid, {
          sellerId: sid,
          sellerName: entry.listing.seller.display_name,
          subtotal: item.priceHuf * item.quantity,
          items: [item],
        });
      }
    }
    return Array.from(bySeller.values());
  }, [cart]);

  const totalCartItems = useMemo(() => cart.reduce((s, e) => s + e.quantity, 0), [cart]);
  const totalCartHuf = useMemo(() => cart.reduce((s, e) => s + e.listing.price_huf * e.quantity, 0), [cart]);

  const handleSubmitCartForSeller = async (group: GenericCartSellerGroup) => {
    if (!requireSignedIn()) return;
    setCartSubmittingSellerId(group.sellerId);
    try {
      const res = await createHoldRequest({
        mode: 'listings_batch',
        items: group.items.map((it) => ({ listing_id: it.id, quantity: it.quantity })),
      });
      setCart((prev) => {
        const next = prev.filter((e) => e.listing.seller_id !== group.sellerId);
        saveP2PCart(next);
        return next;
      });
      setCartOpen(false);
      onToast(t('Hold request sent to seller!', 'Félretételi kérelem elküldve az eladónak!'), 'success');
      if (res.conversation_id) {
        window.location.href = `/messages?conversation_id=${encodeURIComponent(res.conversation_id)}`;
      }
    } catch (e: any) {
      onToast(e?.message || t('Failed to submit hold request.', 'A félretételi kérelem küldése sikertelen.'), 'error');
    } finally {
      setCartSubmittingSellerId(null);
    }
  };

  return (
    <div className="mb-8 flex flex-col gap-4" ref={listTopRef}>
      {/* Controls Toolbar — matches the Collection panel without Collection Switcher */}
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
            {activeFilterCount > 0 && (
              <span
                className="px-1.5 py-0.2 rounded-full text-[10px] font-black"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>

          <CatalogSearchBar
            value={search}
            onChange={setSearch}
            placeholder={t('Search listed cards by name, ID, condition...', 'Keresés név, kód, állapot szerint...')}
          />

          <CatalogSortDropdown
            value={sortMode}
            onChange={setSortMode}
            options={LISTING_SORT_OPTIONS}
            className="w-full sm:w-56 shrink-0 z-40"
          />

          {(activeFilterCount > 0 || search) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setFilters(DEFAULT_LISTING_FILTERS);
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

        {/* Row 2: Listed Value, Counts, Cart / Manage action, Grid Size (NO Collection Switcher) */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5 pt-3.5 sm:pt-4 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
            <div
              className="h-10 sm:h-9 px-3 rounded-xl border inline-flex items-center gap-2 shrink-0 shadow-sm"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
              title={t('Total value of matching listings', 'Szűrt hirdetések összértéke')}
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
                <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
              </svg>
              <div className="flex flex-col leading-none">
                <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Listed Value', 'Hirdetések értéke')}
                </span>
                <span className="text-xs font-black font-mono text-emerald-400 mt-0.5">
                  {formatPrice(totalListedValueHuf)}
                </span>
              </div>
            </div>

            <div
              className="h-10 sm:h-9 px-3 rounded-xl border inline-flex items-center justify-center gap-2 text-xs font-mono font-medium shadow-sm shrink-0"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <span>
                {filteredListings.length} / {listings.length} {lang === 'hu' ? 'hirdetés' : 'listings'}
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded border"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {totalCopies} {lang === 'hu' ? 'db' : 'pcs'}
              </span>
            </div>

            {isMe ? (
              <a
                href="/marketplace"
                className="h-10 sm:h-9 px-3.5 rounded-xl text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer transition hover:brightness-110 shrink-0"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>{t('New Listing', 'Új hirdetés')}</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="h-10 sm:h-9 px-3.5 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition hover:bg-[var(--bg-raised)] shrink-0"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="9" cy="21" r="1" />
                  <circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
                <span>{t('Cart', 'Kosár')} ({totalCartItems})</span>
              </button>
            )}
          </div>

          <GridSizeSwitcher size={gridSize} onChange={onGridSizeChange} className="w-full sm:w-auto" />
        </div>
      </ToolbarContainer>

      <FilterDrawer
        open={showFilterDrawer}
        onClose={() => setShowFilterDrawer(false)}
        title={t('Filter Listed Cards', 'Eladó kártyák szűrése')}
        activeCount={activeFilterCount}
        applyLabel={
          lang === 'hu'
            ? `Alkalmazás & ${filteredListings.length} hirdetés megtekintése`
            : `Apply & View ${filteredListings.length} Listings`
        }
      >
        <FilterSidebar
          filters={filters}
          setFilters={setFilters}
          options={availableFilterOptions}
        />
      </FilterDrawer>

      {loading ? (
        <CardGridSkeleton gridSize={gridSize} count={12} />
      ) : listings.length === 0 ? (
        <div
          className="p-10 text-center rounded-2xl border flex flex-col items-center gap-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm font-semibold max-w-md" style={{ color: 'var(--text-secondary)' }}>
            {isMe
              ? t("You don't have any active card listings yet.", 'Még nincs aktív eladó kártyahirdetésed.')
              : lang === 'hu'
              ? `${sellerDisplayName} jelenleg nem hirdet kártyákat.`
              : `${sellerDisplayName} has no cards listed for sale right now.`}
          </p>
          {isMe && (
            <a
              href="/marketplace"
              className="h-9 px-4 rounded-xl text-xs font-black inline-flex items-center gap-2 transition hover:brightness-110"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            >
              <span>{t('Go to Marketplace', 'Ugrás a Piactérre')}</span>
            </a>
          )}
        </div>
      ) : filteredListings.length === 0 ? (
        <div
          className="p-10 text-center rounded-2xl border flex flex-col items-center gap-2"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {t('No listed cards match the selected filters.', 'Nincs a szűrésnek megfelelő hirdetés.')}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setFilters(DEFAULT_LISTING_FILTERS);
            }}
            className="mt-1 h-8 px-3 rounded-lg border text-xs font-bold cursor-pointer transition hover:bg-[var(--bg-raised)]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {t('Reset filters', 'Szűrők visszaállítása')}
          </button>
        </div>
      ) : (
        <>
          <div className={`grid ${gridSizeClasses(gridSize)}`}>
            {pager.pageItems.map((listing) => (
              <MarketplaceListingTile
                key={listing.id}
                listing={listing}
                gridSize={gridSize}
                isOwn={Boolean(viewerProfile && viewerProfile.id === listing.seller_id)}
                likeBusy={likeBusyIds.has(listing.id)}
                onOpenDetail={() => onOpenCardPreview(listing.card_id)}
                onToggleLike={() => handleToggleLike(listing)}
                onHold={() => {
                  if (!requireSignedIn()) return;
                  setHoldTarget({
                    mode: 'listing',
                    listingId: listing.id,
                    title: listing.card.name,
                    subtitle: `${listing.card.card_number}${listing.is_foil ? ' · Foil' : ''} · ${listing.condition}`,
                    sellerName: listing.seller.display_name,
                    priceHuf: listing.price_huf,
                    maxQuantity: listing.quantity,
                    imageUrl: listing.images?.[0] || null,
                  });
                }}
                onAddToCart={() => handleAddToCart(listing)}
                onMessage={() => handleMessageSeller(listing)}
                onEdit={() => setEditingListing(listing)}
              />
            ))}
          </div>
          <Pagination state={pager} noun={t('listings', 'hirdetés')} scrollTargetRef={listTopRef} />
        </>
      )}

      {holdTarget && (
        <HoldConfirmModal
          target={holdTarget}
          onClose={() => setHoldTarget(null)}
          onSuccess={(conversationId) => {
            setHoldTarget(null);
            onToast(t('Hold request sent!', 'Félretételi kérelem elküldve!'), 'success');
            if (conversationId) {
              window.location.href = `/messages?conversation_id=${encodeURIComponent(conversationId)}`;
            } else {
              refreshListings();
            }
          }}
        />
      )}

      {editingListing && (
        <EditListingModal
          listing={editingListing}
          onClose={() => setEditingListing(null)}
          onSaved={() => {
            setEditingListing(null);
            onToast(t('Listing updated.', 'Hirdetés frissítve.'), 'success');
            refreshListings();
          }}
          onDeleted={() => {
            setEditingListing(null);
            onToast(t('Listing removed.', 'Hirdetés törölve.'), 'success');
            refreshListings();
          }}
        />
      )}

      <GenericCartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title={t('Marketplace Cart', 'Piactér kosár')}
        totalCount={totalCartItems}
        subtotalHuf={totalCartHuf}
        groupBySeller
        sellerGroups={cartSellerGroups}
        onClear={() => {
          setCart([]);
          saveP2PCart([]);
        }}
        onUpdateQuantity={(id, nextQty) => {
          setCart((prev) => {
            const next = prev.map((e) => (e.listingId === id ? { ...e, quantity: Math.max(1, Math.min(e.listing.quantity, nextQty)) } : e));
            saveP2PCart(next);
            return next;
          });
        }}
        onRemoveItem={(id) => {
          setCart((prev) => {
            const next = prev.filter((e) => e.listingId !== id);
            saveP2PCart(next);
            return next;
          });
        }}
        renderSellerControls={(group) => (
          <button
            type="button"
            disabled={cartSubmittingSellerId === group.sellerId}
            onClick={() => handleSubmitCartForSeller(group)}
            className="w-full py-2 rounded-xl text-xs font-black cursor-pointer transition hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {cartSubmittingSellerId === group.sellerId
              ? t('Sending request...', 'Küldés...')
              : t(`Request Hold (${formatPrice(group.subtotal)})`, `Félretétel kérése (${formatPrice(group.subtotal)})`)}
          </button>
        )}
      />

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
