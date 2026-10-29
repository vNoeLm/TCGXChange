import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { CatalogCard, FilterState, UserProfile } from "../types";
import { supabase } from "../lib/supabase";
import { isUnreleasedSet } from "../lib/cardPreview";
import { FilterSidebar } from "./FilterSidebar";
import { CardListItem } from "./CardListItem";
import { CollectionValueChip } from "./CollectionValueChip";
import { CardPreviewOverlay } from "./CardPreviewOverlay";
import { CollectionModal, ActionRow, Icon } from "./collection/CollectionModal";
import { CardScannerModal } from "./CardScannerModal";
import { fetchCardsCatalog } from "../lib/api";
import { gridSizeClasses } from "../lib/gridSize";
import { useWishlists, wishlistCardIds, createWishlist, MAX_WISHLIST_NAME } from "../lib/wishlists";
import { useLoadMore, LoadMoreFooter } from "./LoadMore";
import { useExitTransition } from "../lib/useExitTransition";
import {
  RARITIES, TYPES, SETS, DOMAINS, TAGS, GAMES, sortSetNames,
  MTG_RARITIES, MTG_TYPES,
  ONEPIECE_RARITIES, ONEPIECE_TYPES, ONEPIECE_COLORS,
  LORCANA_RARITIES, LORCANA_TYPES, LORCANA_INKS,
  STARWARS_RARITIES, STARWARS_TYPES, STARWARS_ASPECTS,
  FAB_RARITIES, FAB_TYPES, FAB_CLASSES,
} from "../lib/constants";
import { resolveCard } from "./deck-builder/deckSerializer";
import { buildCollectionBackup, importIntoCollection } from "../lib/collectionBackup";
import { t } from "../lib/labels";
import { useUrlOverlay } from "../lib/useUrlOverlay";
import {
  getCurrentUser,
  getCurrentProfile,
  onSignedInUserChange,
  saveCollectionToCloud,
  loadCollectionRecordFromCloud,
  saveCollectionBackupToCloud,
  loadCollectionBackupFromCloud,
} from "../lib/auth";
import {
  saveLocalCollection,
  getLocalCollectionStamp,
  getLocalCollectionOwner,
  setLocalCollectionOwner,
  readLocalCollection,
  COLLECTION_STAMP_KEY,
} from "../lib/collectionClient";
import { resolveCollectionSync, sameCollection } from "../lib/collectionSync";
import { useSiteTheme } from "../lib/theme";
import { useCardValueData, valueOfCard } from "../lib/cardValues";
import {
  hasFoilVariant as sharedHasFoilVariant,
  isOvernumbered,
  isSigned,
  isSp,
  isToken,
  isAltArt,
  isBaseSetCard,
  compareCardsByRarity,
} from "../lib/cardVariants";
import { FilterDrawer } from "./FilterDrawer";
import { countActiveFilters } from "../lib/activeFilterCount";
import { useCollectionsStore, activeNamedCollection, changeCollectionCard, setCollectionCards, onCollectionsMessage } from "../lib/collectionsStore";
import { listPriceForCard } from "../lib/collectionPricing";
import { parseCollectionKey } from "../lib/sellerNotes";
import type { ListDefaults, NamedCollection } from "../lib/collectionDefaults";
import { PERSONAL_COLLECTION_ID } from "../lib/collectionDefaults";
import { CollectionSwitcher } from "./collection/CollectionSwitcher";
import { ManageCollectionsModal } from "./collection/ManageCollectionsModal";
import { MoveCardsModal } from "./collection/MoveCardsModal";
import { MoveCardModal } from "./collection/MoveCardModal";

const DEFAULT_FILTERS: FilterState = {
  category: "singles",
  game: "riftbound",
  sets: [],
  rarities: [],
  type: "",
  domains: [],
  tags: [],
  keywords: [],
  costMin: 1,
  costMax: 10,
  page: 1,
  pageSize: 48,
  sort: "number_asc",
  foilFilter: false,
  signedFilter: 'all',
  overnumberedFilter: 'all',
  altArtFilter: 'all',
  spFilter: 'all',
  baseSetFilter: 'all',
};

const SORT_OPTIONS = [
  { mode: "Card Number (Asc)", labelKey: 'sort_number_asc' },
  { mode: "Card Number (Desc)", labelKey: 'sort_number_desc' },
  { mode: "Quantity (High to Low)", labelKey: 'sort_qty_high' },
  { mode: "Quantity (Low to High)", labelKey: 'sort_qty_low' },
  { mode: "Rarity (High to Low)", labelKey: 'sort_rarity_high' },
  { mode: "Rarity (Low to High)", labelKey: 'sort_rarity_low' },
  { mode: "Name (A to Z)", labelKey: 'sort_name_asc' },
  { mode: "Name (Z to A)", labelKey: 'sort_name_desc' },
  { mode: "Energy Cost (Low to High)", labelKey: 'sort_cost_low' },
  { mode: "Energy Cost (High to Low)", labelKey: 'sort_cost_high' },
  { mode: "Est. Value (High to Low)", labelKey: 'sort_value_high' },
  { mode: "Est. Value (Low to High)", labelKey: 'sort_value_low' },
] as const;

function getSortLabel(mode: string): string {
  const opt = SORT_OPTIONS.find(o => o.mode === mode);
  return opt ? t(opt.labelKey as any) : mode;
}

const BREAKPOINT = 1024;
const PAGE_SIZE = 48;

export function CardListApp() {
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>(() => ({ ...DEFAULT_FILTERS, game: 'riftbound' }));
  // Desktop puts Filters, search and sort on one row; mobile/tablet stacks them cleanly.
  const [isWide, setIsWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [gridSize, setGridSize] = useState<'small'|'normal'|'large'>('normal');
  
  // Local Collection State (Record mapping cardId / cardId_foil to quantity)
  // Personal - the original collection, kept in this browser and synced to the account below.
  const [personalCollection, setCollection] = useState<Record<string, number>>({});
  // Which collection the catalog shows and edits: Personal, or a named one (lib/collectionsStore).
  const collectionsStore = useCollectionsStore();
  const activeNamed = activeNamedCollection(collectionsStore);
  const collection = activeNamed ? activeNamed.cards : personalCollection;
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [showMoveCards, setShowMoveCards] = useState(false);
  const [moveSingle, setMoveSingle] = useState<{ card: CatalogCard; isFoil: boolean } | null>(null);
  const [collectionFilter, setCollectionFilter] = useState<"All" | "Owned" | "Playset" | "Missing">('All');
  const [sortMode, setSortMode] = useState<
    "Card Number (Asc)" | "Card Number (Desc)" |
    "Rarity (High to Low)" | "Rarity (Low to High)" |
    "Quantity (High to Low)" | "Quantity (Low to High)" |
    "Name (A to Z)" | "Name (Z to A)" |
    "Energy Cost (Low to High)" | "Energy Cost (High to Low)" |
    "Est. Value (High to Low)" | "Est. Value (Low to High)"
  >("Card Number (Asc)");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const sortAnim = useExitTransition(sortOpen, 200);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastLoggedSearchRef = useRef<string>('');

  const [isInitialized, setIsInitialized] = useState(false);
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

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    setCanScan(Boolean(navigator.mediaDevices?.getUserMedia) && touch);
  }, []);
  // The open card lives in the URL (?card=) - Back closes it, and the link can be shared.
  const [selectedCardId, openCard, closeCard] = useUrlOverlay('card');
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportTab, setExportTab] = useState<'owned' | 'missing'>('owned');
  const [missingWishlistName, setMissingWishlistName] = useState('');
  const [creatingWishlist, setCreatingWishlist] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resettingCollection, setResettingCollection] = useState(false);
  const [resetScope, setResetScope] = useState<'device' | 'both'>('device');
  const [showScanner, setShowScanner] = useState(false);
  // The scanner needs a camera, so it's only offered where one is plausible.
  const [canScan, setCanScan] = useState(false);
  const [importText, setImportText] = useState("");
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-hide nulls the message immediately, but the toast needs it for the length of its own
  // exit transition - freeze the last shown message/type instead of reading the live ones.
  const toastRef = useRef<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  if (toastMessage) toastRef.current = { message: toastMessage, type: toastType };
  const toastAnim = useExitTransition(!!toastMessage, 400);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);

  const [savingToCloud, setSavingToCloud] = useState(false);
  const [restoringFromCloud, setRestoringFromCloud] = useState(false);

  const [allCards, setAllCards] = useState<CatalogCard[]>([]);
  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    setToastType(type);
    // A plain info toast is brief; success and error get more time to actually be read.
    const duration = type === 'info' ? 3000 : 4500;
    toastTimerRef.current = setTimeout(() => setToastMessage(null), duration);
  };

  // Check auth on mount
  useEffect(() => {
    getCurrentUser().then(user => setCurrentUser(user));
    getCurrentProfile().then(prof => setCurrentUserProfile(prof));
    // Only a real change of who's signed in: the two calls above already cover the first session
    // report, and supabase-js repeats SIGNED_IN for the same user every time the tab is shown.
    return onSignedInUserChange((session) => {
      setCurrentUser(session?.user || null);
      if (session?.user) {
        getCurrentProfile().then(prof => setCurrentUserProfile(prof));
      } else {
        setCurrentUserProfile(null);
      }
    });
  }, []);

  // Lock background scroll when any modal or mobile drawer is open
  useEffect(() => {
    const isModalOpen = showExportModal || showImportModal || showResetConfirm || showMobileFilters || Boolean(selectedCardId);
    if (isModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showExportModal, showImportModal, showResetConfirm, showMobileFilters, selectedCardId]);

  useEffect(() => {
    setIsInitialized(true);

    const VALID_GAME_IDS = new Set(GAMES.filter(g => g.active !== false).map(g => g.id));
    const savedGameRaw = localStorage.getItem('tcg_active_game');
    const activeGame = (savedGameRaw && VALID_GAME_IDS.has(savedGameRaw)) ? savedGameRaw : 'riftbound';

    const savedSearch = sessionStorage.getItem('catalogSearchQuery');
    if (savedSearch) setSearchQuery(savedSearch);

    const savedGrid = sessionStorage.getItem('catalogGridSize');
    if (savedGrid === 'small' || savedGrid === 'normal' || savedGrid === 'large') {
      setGridSize(savedGrid);
    }

    const savedColFilter = sessionStorage.getItem('catalogCollectionFilter');
    if (savedColFilter) {
      const norm = savedColFilter === 'Have' ? 'Owned' : savedColFilter;
      if (norm === 'All' || norm === 'Owned' || norm === 'Playset' || norm === 'Missing') {
        setCollectionFilter(norm as any);
      }
    }

    const savedSort = sessionStorage.getItem('catalogSortMode');
    if (savedSort) {
      const norm = savedSort === 'Number (Asc)' ? 'Card Number (Asc)' : savedSort === 'Number (Desc)' ? 'Card Number (Desc)' : savedSort;
      setSortMode(norm as any);
    }

    const wishlistFromLink = new URLSearchParams(window.location.search).get('wishlist') || undefined;
    const savedFiltersRaw = sessionStorage.getItem(`catalogFilters_${activeGame}`) || sessionStorage.getItem('catalogFilters');
    let restoredFilters: FilterState = { ...DEFAULT_FILTERS, game: activeGame, wishlistId: wishlistFromLink };
    if (savedFiltersRaw) {
      try {
        const parsed = JSON.parse(savedFiltersRaw);
        if (!parsed.game || parsed.game === activeGame) {
          // Filters saved before sets became multi-select kept a single `set` string.
          const migratedSets = Array.isArray(parsed.sets) ? parsed.sets : (parsed.set ? [parsed.set] : []);
          delete parsed.set;
          restoredFilters = { ...DEFAULT_FILTERS, ...parsed, sets: migratedSets, game: activeGame, ...(wishlistFromLink ? { wishlistId: wishlistFromLink } : {}) };
        }
      } catch (e) {}
    }
    setFilters(restoredFilters);

    // Listen for game change events from top navbar
    const handleGameChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ game: string }>;
      const newGame = customEvent.detail?.game;
      if (newGame) {
        setAllCards([]);
        setSearchQuery('');
        setCollectionFilter("All");
        // Completely reset all game-specific filters to clean defaults for the new game
        const freshFilters: FilterState = {
          ...DEFAULT_FILTERS,
          game: newGame,
        };
        setFilters(freshFilters);
        try {
          sessionStorage.setItem('catalogFilters', JSON.stringify(freshFilters));
          sessionStorage.setItem(`catalogFilters_${newGame}`, JSON.stringify(freshFilters));
        } catch (err) {}
      }
    };
    window.addEventListener('tcg-game-change', handleGameChange);

    const handleClickOutside = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('tcg-game-change', handleGameChange);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Save filters to session storage
  useEffect(() => {
    if (isInitialized) {
      try {
        sessionStorage.setItem('catalogFilters', JSON.stringify(filters));
        if (filters.game) {
          sessionStorage.setItem(`catalogFilters_${filters.game}`, JSON.stringify(filters));
        }
      } catch (e) {}
    }
  }, [filters, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      sessionStorage.setItem('catalogSearchQuery', searchQuery);
    }
  }, [searchQuery, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      sessionStorage.setItem('catalogGridSize', gridSize);
    }
  }, [gridSize, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      sessionStorage.setItem('catalogCollectionFilter', collectionFilter);
    }
  }, [collectionFilter, isInitialized]);

  useEffect(() => {
    if (isInitialized) {
      sessionStorage.setItem('catalogSortMode', sortMode);
    }
  }, [sortMode, isInitialized]);

  // Load collection from localStorage & keep synchronized via tcg-collection-change events
  useEffect(() => {
    const saved = localStorage.getItem("tcg_user_collection") || localStorage.getItem("tcg_collection");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const dict: Record<string, number> = {};
          parsed.forEach((id: string) => {
            if (typeof id === 'string' && id.trim()) {
              dict[id.trim()] = 1;
            }
          });
          setCollection(dict);
        } else if (parsed && typeof parsed === 'object') {
          const dict: Record<string, number> = {};
          Object.entries(parsed).forEach(([k, v]) => {
            const count = typeof v === 'number' ? v : parseInt(String(v), 10);
            if (count > 0) dict[k] = count;
          });
          setCollection(dict);
        }
      } catch (e) {
        console.error("Failed to load collection", e);
      }
    }

    const handleColChange = (e: Event) => {
      const custom = e as CustomEvent<{ collection: Record<string, number>; external?: boolean }>;
      if (custom.detail?.collection) {
        // Changed in another tab: that tab saves it to the cloud, so this one counts it as synced
        // instead of sending it again.
        if (custom.detail.external) syncedStampRef.current = getLocalCollectionStamp();
        collectionRef.current = custom.detail.collection;
        setCollection(custom.detail.collection);
      }
    };
    window.addEventListener('tcg-collection-change', handleColChange);
    return () => {
      window.removeEventListener('tcg-collection-change', handleColChange);
    };
  }, []);

  // ── Keeping this browser's collection and the cloud copy in step ──
  // The browser's copy carries the time it was last changed (saveLocalCollection) and the cloud's
  // carries the time it was last saved. Whichever changed last wins (lib/collectionSync.ts), which is
  // what lets a reset or a lowered count stick instead of being undone by an older copy.
  const collectionRef = useRef(personalCollection);
  collectionRef.current = personalCollection;
  /** The time last known to be identical in the cloud, so data that has not changed is never re-saved. */
  const syncedStampRef = useRef<string | null>(null);
  /**
   * Nothing is saved to the cloud until the sign-in comparison below has run. Before that this
   * browser does not know what the cloud holds, and a fresh one could otherwise overwrite it.
   */
  const [cloudSyncReady, setCloudSyncReady] = useState(false);

  /**
   * Saves the collection to the cloud and records that this browser is now exactly in step with it.
   * What goes up is the browser's saved copy, not this tab's copy in memory: every change in any
   * tab is saved there first, so an older tab can never send an out-of-date collection.
   */
  const pushCollectionToCloud = async (): Promise<boolean> => {
    const collection = readLocalCollection() ?? collectionRef.current;
    const result = await saveCollectionToCloud(collection);
    if (result.error || !result.updatedAt) return false;
    saveLocalCollection(collection, result.updatedAt, false);
    syncedStampRef.current = result.updatedAt;
    return true;
  };

  useEffect(() => {
    if (!currentUser) {
      setCloudSyncReady(false);
      syncedStampRef.current = null;
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        // This browser's saved collection might still belong to whoever was last signed in here -
        // signing out never clears it, on purpose, so a returning user finds theirs again. But
        // weighed against a DIFFERENT account's cloud copy, that leftover data looks like an
        // ordinary, just-edited collection, and once it "wins" the newer-side comparison it
        // overwrites that account's real cloud collection with the previous one's. So on any
        // account switch it is dropped first here, exactly like a browser that has never held a
        // collection for this account at all.
        const localOwner = getLocalCollectionOwner();
        if (localOwner && localOwner !== currentUser.id) {
          collectionRef.current = {};
          setCollection({});
          try {
            localStorage.removeItem(COLLECTION_STAMP_KEY);
            localStorage.removeItem('tcg_user_collection');
            localStorage.removeItem('tcg_collection');
          } catch {
            // best-effort
          }
        }

        const record = await loadCollectionRecordFromCloud();
        if (!isMounted) return;
        // Not being able to read the cloud copy is not the same as it being empty: change nothing.
        if (record === null) return;

        // Compare the browser's saved copy (current across tabs), not this tab's copy in memory,
        // which can be older if another tab changed the collection since this one loaded.
        const local = readLocalCollection();
        if (local && !sameCollection(local, collectionRef.current)) {
          collectionRef.current = local;
          setCollection(local);
        }

        const decision = resolveCollectionSync({
          local: collectionRef.current,
          localStamp: getLocalCollectionStamp(),
          cloud: record.cards,
          cloudStamp: record.updatedAt,
        });

        if (decision.action === 'use-cloud') {
          saveLocalCollection(decision.collection, record.updatedAt ?? new Date().toISOString());
          syncedStampRef.current = record.updatedAt;
        } else if (decision.action === 'merge') {
          // Stamped now, so the auto-save below sends the combined collection up.
          saveLocalCollection(decision.collection);
        } else if (decision.action === 'push-local') {
          // A collection saved before timestamps existed gets its first one here, so it is picked up.
          if (!getLocalCollectionStamp()) saveLocalCollection(collectionRef.current);
        } else if (record.updatedAt) {
          // Already the same: line the browser's time up with the cloud's.
          saveLocalCollection(collectionRef.current, record.updatedAt, false);
          syncedStampRef.current = record.updatedAt;
        }
        setLocalCollectionOwner(currentUser.id);
        setCloudSyncReady(true);
      } catch (e) {
        console.warn('Auto cloud sync on auth:', e);
      }
    })();

    return () => {
      isMounted = false;
    };
    // Only a change of account re-runs this, not the token refresh that hands every open tab a new
    // user object about once an hour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Debounced auto-save: a change made in this browser goes up 1.5s after the last edit.
  const cloudDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentUser || !cloudSyncReady) return;
    // Only what was changed here is saved. An empty collection is a valid thing to save (that is
    // what a reset is); what must never happen is a browser that has changed nothing saving one.
    const stamp = getLocalCollectionStamp();
    if (!stamp || stamp === syncedStampRef.current) return;

    if (cloudDebounceTimer.current) clearTimeout(cloudDebounceTimer.current);
    cloudDebounceTimer.current = setTimeout(async () => {
      try {
        if (!(await pushCollectionToCloud())) console.warn('Could not save the collection to the cloud; it will be retried on the next change.');
      } catch (e) {
        console.warn('Debounced cloud save warning:', e);
      }
    }, 1500);

    return () => {
      if (cloudDebounceTimer.current) clearTimeout(cloudDebounceTimer.current);
    };
  }, [personalCollection, currentUser?.id, cloudSyncReady]);

  /** The price an always-list collection lists a card at (its defaults + the card's values). */
  const alwaysListPrice = (cardId: string, isFoil: boolean, defaults: ListDefaults) =>
    listPriceForCard(defaults, allCards.find(c => c.id === cardId) || cards.find(c => c.id === cardId), isFoil, cardValues);
  const alwaysListPrices = (coll: NamedCollection, defaults: ListDefaults, cardsMap: Record<string, number> = coll.cards) => {
    const prices: Record<string, number> = {};
    for (const key of Object.keys(cardsMap)) {
      const { cardId, isFoil } = parseCollectionKey(key);
      const p = alwaysListPrice(cardId, isFoil, defaults);
      prices[key] = p;
      if (!(cardId in prices) || !isFoil) prices[cardId] = p;
    }
    return prices;
  };

  /** Saves a whole new set of counts to the active collection (import). */
  const commitCollection = (next: Record<string, number>) => {
    if (activeNamed) {
      void setCollectionCards(activeNamed.id, next, activeNamed.always_list ? alwaysListPrices(activeNamed, activeNamed.list_defaults, next) : {});
      return;
    }
    setCollection(next);
    saveLocalCollection(next);
  };

  // A change the server couldn't make (or limited) for a named collection.
  useEffect(() => onCollectionsMessage((msg) => showToast(msg, 'error')), []);

  const updateCardCount = useCallback((cardId: string, isFoil: boolean, delta: number) => {
    const targetKey = isFoil ? `${cardId}_foil` : cardId;
    if (activeNamed) {
      const price = activeNamed.always_list && delta > 0 ? alwaysListPrice(cardId, isFoil, activeNamed.list_defaults) : null;
      changeCollectionCard(activeNamed.id, targetKey, delta, price);
      return;
    }
    setCollection(prev => {
      const next = { ...prev };
      const current = next[targetKey] || 0;
      const updated = current + delta;
      if (updated <= 0) {
        delete next[targetKey];
      } else {
        next[targetKey] = updated;
      }
      saveLocalCollection(next);

      return next;
    });
  }, [activeNamed]);

  // Bulk-entry shortcut: type a card number/name in the search box and press Enter
  // to add 1 copy instantly (Shift+Enter for foil), without ever reaching for the mouse.
  const handleQuickAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const query = searchQuery.trim();
    if (!query) return;
    e.preventDefault();

    const sourceCards = allCards.length ? allCards : cards;
    const matched = resolveCard(query, sourceCards);
    if (!matched) {
      showToast(`No card found for "${query}"`, 'error');
      return;
    }

    // Rare+ cards have no separate foil print - the catalog tile only ever shows one
    // "Add to Collection" control for them, keyed by the plain card id. Writing a `_foil` entry
    // here anyway would create a copy the UI has no control to ever remove.
    const isFoil = e.shiftKey && hasFoilVariant(matched);
    updateCardCount(matched.id, isFoil, 1);
    const foilRequestedButUnavailable = e.shiftKey && !isFoil;
    showToast(
      `+1 ${isFoil ? 'foil ' : ''}${matched.name}${matched.card_number ? ` (${matched.card_number})` : ''}` +
      (foilRequestedButUnavailable ? ' — no separate foil print, added as normal' : ''),
      'success'
    );
    setSearchQuery('');
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const toggleOwnership = useCallback((cardId: string, isFoil?: boolean) => {
    const targetKey = isFoil ? `${cardId}_foil` : cardId;
    if (activeNamed) {
      const current = activeNamed.cards[targetKey] || 0;
      updateCardCount(cardId, Boolean(isFoil), current > 0 ? -current : 1);
      return;
    }
    setCollection(prev => {
      const next = { ...prev };
      if (next[targetKey] && next[targetKey] > 0) {
        delete next[targetKey];
      } else {
        next[targetKey] = 1;
      }
      saveLocalCollection(next);

      return next;
    });
  }, [activeNamed, updateCardCount]);

  // Responsive breakpoint is managed via mediaQuery listener above

  // Fetch cards based on active filters and search query
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const timer = setTimeout(async () => {
      const trimmedQuery = searchQuery.trim();
      if (trimmedQuery.length >= 2 && trimmedQuery !== lastLoggedSearchRef.current) {
        lastLoggedSearchRef.current = trimmedQuery;
        fetch('/api/analytics/search-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmedQuery, game: filters.game, context: 'catalog' }),
        }).catch(() => {});
      }

      try {
        const { data } = await fetchCardsCatalog(filters, searchQuery);
        if (isMounted) {
          setCards(data || []);

          // Sync allCards for playset/collection calculations
          if (!searchQuery.trim() && (!filters.rarities || filters.rarities.length === 0) && !filters.type && (!filters.domains || filters.domains.length === 0) && (!filters.sets || filters.sets.length === 0)) {
            setAllCards(data || []);
          } else {
            setAllCards(prev => {
              const sameGame = prev.filter(c => (c.game || 'riftbound') === filters.game);
              const existingIds = new Set(sameGame.map(c => c.id));
              const newCards = (data || []).filter(c => !existingIds.has(c.id));
              return newCards.length > 0 ? [...sameGame, ...newCards] : (sameGame.length > 0 ? sameGame : (data || []));
            });
          }

          setLoading(false);
        }
      } catch (err) {
        console.error('Error fetching cards catalog:', err);
        if (isMounted) {
          setCards([]);
          setLoading(false);
        }
      }
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [filters, searchQuery]);

  const hasFoilVariant = (card: CatalogCard) => {
    return card.card_type !== 'Rune' && sharedHasFoilVariant(card);
  };

  const showFoilOnly = !!filters.foilFilter;
  const signedFilter = filters.signedFilter || 'all';
  const altArtFilter = filters.altArtFilter || 'all';
  const overnumberedFilter = filters.overnumberedFilter || 'all';
  const spFilter = filters.spFilter || 'all';
  const baseSetFilter = filters.baseSetFilter || 'all';

  const cardValues = useCardValueData();
  const { lists: allWishlists } = useWishlists();
  const wishlists = useMemo(() => allWishlists.filter(w => w.game === (filters.game || 'riftbound')), [allWishlists, filters.game]);

  const relevantCards = useMemo(() => {
    let filtered = cards;
    if (showFoilOnly) filtered = filtered.filter(hasFoilVariant);
    // A list that's gone (deleted, or signed out) just stops filtering.
    const wishlist = filters.wishlistId ? wishlists.find(w => w.id === filters.wishlistId) : undefined;
    if (wishlist) {
      const ids = wishlistCardIds(wishlist.items);
      filtered = filtered.filter(c => ids.has(c.id));
    }
    
    if (baseSetFilter === 'only') {
      filtered = filtered.filter(isBaseSetCard);
    } else {
      if (signedFilter === 'only') {
        filtered = filtered.filter(isSigned);
      } else if (signedFilter === 'none') {
        filtered = filtered.filter(c => !isSigned(c));
      }
      if (altArtFilter === 'only') {
        filtered = filtered.filter(isAltArt);
      } else if (altArtFilter === 'none') {
        filtered = filtered.filter(c => !isAltArt(c));
      }
      if (overnumberedFilter === 'only') {
        filtered = filtered.filter(isOvernumbered);
      } else if (overnumberedFilter === 'none') {
        filtered = filtered.filter(c => !isOvernumbered(c));
      }
      if (spFilter === 'only') {
        filtered = filtered.filter(isSp);
      } else if (spFilter === 'none') {
        filtered = filtered.filter(c => !isSp(c));
      }
    }
    
    // A card's value for sorting is its dearer finish; cards with no value yet go last either way.
    const sortValue = (card: CatalogCard): number | null => {
      const normal = valueOfCard(card, false, cardValues).valueHuf;
      const foil = hasFoilVariant(card) ? valueOfCard(card, true, cardValues).valueHuf : null;
      if (normal === null) return foil;
      return foil === null ? normal : Math.max(normal, foil);
    };

    filtered = [...filtered].sort((a, b) => {
      if (sortMode === 'Est. Value (High to Low)' || sortMode === 'Est. Value (Low to High)') {
        const vA = sortValue(a);
        const vB = sortValue(b);
        if (vA !== vB) {
          if (vA === null) return 1;
          if (vB === null) return -1;
          return sortMode === 'Est. Value (High to Low)' ? vB - vA : vA - vB;
        }
        return (a.card_number||'').localeCompare((b.card_number||''), undefined, { numeric: true });
      }
      if (sortMode === 'Quantity (High to Low)') {
        const qA = (collection[a.id] || 0) + (collection[`${a.id}_foil`] || 0);
        const qB = (collection[b.id] || 0) + (collection[`${b.id}_foil`] || 0);
        if (qA !== qB) return qB - qA;
        return (a.card_number||'').localeCompare((b.card_number||''), undefined, { numeric: true });
      }
      if (sortMode === 'Quantity (Low to High)') {
        const qA = (collection[a.id] || 0) + (collection[`${a.id}_foil`] || 0);
        const qB = (collection[b.id] || 0) + (collection[`${b.id}_foil`] || 0);
        if (qA !== qB) return qA - qB;
        return (a.card_number||'').localeCompare((b.card_number||''), undefined, { numeric: true });
      }
      if (sortMode === 'Energy Cost (Low to High)' || sortMode === 'Energy Cost (High to Low)') {
        const cA = typeof a.cost === 'number' ? a.cost : Number(a.energy) || 0;
        const cB = typeof b.cost === 'number' ? b.cost : Number(b.energy) || 0;
        if (cA !== cB) return sortMode === 'Energy Cost (Low to High)' ? cA - cB : cB - cA;
        return (a.card_number||'').localeCompare((b.card_number||''), undefined, { numeric: true });
      }
      if (sortMode === 'Name (A to Z)') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortMode === 'Name (Z to A)') {
        return (b.name || '').localeCompare(a.name || '');
      }
      if (sortMode === 'Card Number (Asc)' || (sortMode as any) === 'Number (Asc)') {
        return (a.card_number||'').localeCompare((b.card_number||''), undefined, { numeric: true });
      }
      if (sortMode === 'Card Number (Desc)' || (sortMode as any) === 'Number (Desc)') {
        return (b.card_number||'').localeCompare((a.card_number||''), undefined, { numeric: true });
      }
      if (sortMode === 'Rarity (High to Low)') {
        return compareCardsByRarity(a, b, 'desc');
      }
      if (sortMode === 'Rarity (Low to High)') {
        return compareCardsByRarity(a, b, 'asc');
      }
      return 0;
    });
    
    return filtered;
  }, [cards, showFoilOnly, signedFilter, altArtFilter, overnumberedFilter, spFilter, baseSetFilter, sortMode, collection, cardValues, filters.wishlistId, wishlists]);
  
  const relevantTotal = relevantCards.length;
  const uniqueOwnedKeys = Object.keys(collection).filter(k => (collection[k] || 0) > 0);
  const totalOwnedCopies = Object.values(collection).reduce((sum, val) => sum + (val || 0), 0);

  const ownedCount = useMemo(() => {
    return relevantCards.filter(c => {
      const regularQty = collection[c.id] || 0;
      const foilQty = collection[`${c.id}_foil`] || 0;
      if (showFoilOnly) return foilQty > 0;
      return regularQty > 0 || foilQty > 0;
    }).length;
  }, [relevantCards, collection, showFoilOnly]);

  const playsetCount = useMemo(() => {
    return relevantCards.filter(c => {
      const regularQty = collection[c.id] || 0;
      const foilQty = collection[`${c.id}_foil`] || 0;
      const totalQty = showFoilOnly ? foilQty : (regularQty + foilQty);
      return totalQty >= 3;
    }).length;
  }, [relevantCards, collection, showFoilOnly]);

  const missingCount = relevantTotal - ownedCount;

  const activeFilterBadgeCount = useMemo(() => countActiveFilters(filters), [filters]);

  const displayedCards = useMemo(() => {
    return relevantCards.filter(card => {
      const regularQty = collection[card.id] || 0;
      const foilQty = collection[`${card.id}_foil`] || 0;
      const totalQty = showFoilOnly ? foilQty : (regularQty + foilQty);
      const isOwned = totalQty > 0;
      const isPlayset = totalQty >= 3;

      if (collectionFilter === "Owned") return isOwned;
      if (collectionFilter === "Playset") return isPlayset;
      if (collectionFilter === "Missing") return !isOwned;
      return true;
    });
  }, [relevantCards, collectionFilter, collection, showFoilOnly]);

  // One batch first, then a "Load more" button, then loading on scroll - so the footer can be
  // reached. Only the rendering is batched: the tab counts and the collection value above all use
  // the full filtered list. Starts over whenever the list itself changes.
  const loadMoreState = useLoadMore(
    displayedCards.length,
    PAGE_SIZE,
    JSON.stringify([filters, searchQuery, collectionFilter, sortMode, showFoilOnly])
  );
  const paginatedCards = displayedCards.slice(0, loadMoreState.shown);

  // Helper to format collection into grouped text list with set names and card numbers
  const exportCollectionToText = () => {
    if (uniqueOwnedKeys.length === 0) return 'No cards in collection.';
    const sourceCards = allCards.length ? allCards : cards;
    const cardMap = new Map<string, CatalogCard>();
    sourceCards.forEach(c => {
      cardMap.set(c.id, c);
      cardMap.set(c.id.toLowerCase(), c);
      if (c.card_number) {
        cardMap.set(c.card_number.toLowerCase(), c);
        const baseNum = c.card_number.split('/')[0].trim().toLowerCase();
        if (baseNum) cardMap.set(baseNum, c);
      }
      cardMap.set(c.name.toLowerCase(), c);
    });

    const validEntries: { card: CatalogCard; isFoil: boolean; qty: number }[] = [];
    Object.entries(collection).forEach(([key, qty]) => {
      if (qty <= 0) return;
      const isFoil = key.endsWith('_foil');
      const baseId = isFoil ? key.replace(/_foil$/, '') : key;
      let card = cardMap.get(baseId) || cardMap.get(baseId.toLowerCase()) || null;
      if (!card) {
        card = resolveCard(baseId, sourceCards);
      }
      if (card) {
        validEntries.push({ card, isFoil, qty });
      }
    });

    if (validEntries.length === 0) return 'No cards in collection.';

    const bySet: Record<string, typeof validEntries> = {};
    validEntries.forEach(entry => {
      const setName = entry.card.sets?.name || entry.card.set_name || 'Other / Promos';
      if (!bySet[setName]) bySet[setName] = [];
      bySet[setName].push(entry);
    });

    const totalCopies = validEntries.reduce((sum, e) => sum + e.qty, 0);
    const lines: string[] = [
      `// TCG XChange - My Owned Cards (${totalCopies} total copies, ${validEntries.length} unique cards)`,
      `// Exported: ${new Date().toLocaleDateString()}`,
      '',
    ];

    Object.keys(bySet).sort().forEach(setName => {
      const items = bySet[setName];
      lines.push(`// === ${setName} (${items.length}) ===`);
      items.sort((a, b) => {
        const numA = a.card.card_number || '';
        const numB = b.card.card_number || '';
        if (numA && numB) return numA.localeCompare(numB, undefined, { numeric: true });
        return (a.card.name || '').localeCompare(b.card.name || '');
      });

      items.forEach(({ card, isFoil, qty }) => {
        const code = card.sets?.code || card.set_code || '';
        const num = card.card_number || '';
        let idTag = '';
        if (num) {
          if (code && !num.toLowerCase().startsWith(code.toLowerCase())) {
            idTag = ` (${code}-${num})`;
          } else {
            idTag = ` (${num})`;
          }
        }
        const foilTag = isFoil ? ' [Foil]' : '';
        const qtyPrefix = `${qty || 1}x `;
        lines.push(`${qtyPrefix}${card.name}${idTag}${foilTag}`);
      });
      lines.push('');
    });

    return lines.join('\n').trim();
  };

  // Helper to format collection into simple card names list
  const exportCollectionToSimpleText = () => {
    if (uniqueOwnedKeys.length === 0) return 'No cards in collection.';
    const sourceCards = allCards.length ? allCards : cards;
    const cardMap = new Map<string, CatalogCard>();
    sourceCards.forEach(c => {
      cardMap.set(c.id, c);
      cardMap.set(c.id.toLowerCase(), c);
      if (c.card_number) {
        cardMap.set(c.card_number.toLowerCase(), c);
        const baseNum = c.card_number.split('/')[0].trim().toLowerCase();
        if (baseNum) cardMap.set(baseNum, c);
      }
      cardMap.set(c.name.toLowerCase(), c);
    });

    const lines: string[] = [];
    Object.entries(collection).forEach(([key, qty]) => {
      if (qty <= 0) return;
      const isFoil = key.endsWith('_foil');
      const baseId = isFoil ? key.replace(/_foil$/, '') : key;
      let card = cardMap.get(baseId) || cardMap.get(baseId.toLowerCase()) || null;
      if (!card) {
        card = resolveCard(baseId, sourceCards);
      }
      if (card) {
        const qtyPrefix = `${qty || 1}x `;
        lines.push(`${qtyPrefix}${card.name}${isFoil ? ' [Foil]' : ''}`);
      }
    });
    if (lines.length === 0) return 'No cards in collection.';
    return lines.sort((a, b) => a.localeCompare(b)).join('\n');
  };

  const handleCopyCollectionText = () => {
    if (uniqueOwnedKeys.length === 0) {
      showToast('Collection is empty.', 'error');
      return;
    }
    const text = exportCollectionToText();
    navigator.clipboard.writeText(text);
    showToast(`Copied ${totalOwnedCopies} owned cards to clipboard!`, 'success');
    setShowExportModal(false);
  };

  const buildCollectionBackupObject = () =>
    buildCollectionBackup(collection, allCards.length ? allCards : cards, filters.game || 'riftbound');

  const handleDownloadJson = () => {
    if (uniqueOwnedKeys.length === 0) {
      showToast('Collection is empty.', 'error');
      return;
    }
    const data = JSON.stringify(buildCollectionBackupObject(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-collection-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Collection JSON backup downloaded!', 'success');
    setShowExportModal(false);
  };

  // Writes a separate, deliberate backup (user_collections.backup_cards), distinct from the
  // collection that syncs automatically. Nothing else - not the automatic sync, not another
  // device, not Reset - ever touches this backup, so it survives exactly what a normal export
  // should survive: whatever the user does to their live collection afterward.
  const handleSaveToCloud = async () => {
    if (!currentUser) {
      showToast('Please sign in to save your collection to cloud.', 'error');
      return;
    }
    if (activeNamed) {
      showToast(`"${activeNamed.name}" is already stored in your account. Cloud backups are for Personal.`, 'info');
      return;
    }
    setSavingToCloud(true);
    try {
      const result = await saveCollectionBackupToCloud(collection);
      if (!result.success) throw new Error(result.error?.message || 'the cloud did not accept it');

      showToast(`${"Collection successfully saved to your cloud account!"} (${totalOwnedCopies} cards)`, 'success');
    } catch (e: any) {
      showToast(`Failed to save to cloud: ${e.message || 'Unknown error'}`, 'error');
    } finally {
      setSavingToCloud(false);
    }
  };

  // ── Missing Cards Export Helpers (Respects currently selected filters) ──
  const getMissingCards = () => {
    return relevantCards.filter(card => {
      const regularQty = collection[card.id] || 0;
      const foilQty = collection[`${card.id}_foil`] || 0;
      return showFoilOnly ? foilQty === 0 : (regularQty === 0 && foilQty === 0);
    });
  };

  const getActiveFilterDescription = () => {
    const parts: string[] = [];
    if (filters.sets && filters.sets.length > 0) parts.push(filters.sets.join(', '));
    if (baseSetFilter === 'only') parts.push('Base Set Only');
    if (showFoilOnly) parts.push('Foil Only');
    if (filters.rarities && filters.rarities.length > 0) parts.push(filters.rarities.join(', '));
    if (filters.type) parts.push(filters.type);
    if (filters.domains && filters.domains.length > 0) parts.push(filters.domains.join(', '));
    if (filters.tags && filters.tags.length > 0) parts.push(filters.tags.join(', '));
    if (filters.keywords && filters.keywords.length > 0) parts.push(filters.keywords.join(', '));
    if (signedFilter && signedFilter !== 'all') parts.push(signedFilter === 'only' ? 'Signed' : 'Non-signed');
    if (altArtFilter && altArtFilter !== 'all') parts.push(altArtFilter === 'only' ? 'Alt Art' : 'Standard Art');
    if (overnumberedFilter && overnumberedFilter !== 'all') parts.push(overnumberedFilter === 'only' ? 'Overnumbered' : 'Standard Num');
    if (spFilter && spFilter !== 'all') parts.push(spFilter === 'only' ? 'SP' : 'Non-SP');
    if (searchQuery.trim()) parts.push(`"${searchQuery.trim()}"`);
    return parts.length > 0 ? parts.join(' • ') : ('All Cards');
  };

  const exportMissingCardsToText = () => {
    const missing = getMissingCards();
    if (missing.length === 0) {
      return 'No missing cards for the selected filters!';
    }

    const bySet: Record<string, CatalogCard[]> = {};
    missing.forEach(c => {
      const sName = c.sets?.name || c.set_name || 'Other / Promos';
      if (!bySet[sName]) bySet[sName] = [];
      bySet[sName].push(c);
    });

    const filterDesc = getActiveFilterDescription();
    const lines: string[] = [
      `// TCG XChange - ${'Missing Cards / Want List'} (${missing.length} ${'cards'})`,
      `// ${'Filters'}: ${filterDesc}`,
      `// ${'Exported'}: ${new Date().toLocaleDateString()}`,
      '',
    ];

    Object.keys(bySet).sort().forEach(setName => {
      const items = bySet[setName];
      lines.push(`// === ${setName} (${items.length} ${'missing'}) ===`);
      items.sort((a, b) => {
        const numA = a.card_number || '';
        const numB = b.card_number || '';
        if (numA && numB) return numA.localeCompare(numB, undefined, { numeric: true });
        return (a.name || '').localeCompare(b.name || '');
      });

      items.forEach(c => {
        const code = c.sets?.code || c.set_code || '';
        const num = c.card_number || '';
        let idTag = '';
        if (num) {
          if (code && !num.toLowerCase().startsWith(code.toLowerCase())) {
            idTag = ` (${code}-${num})`;
          } else {
            idTag = ` (${num})`;
          }
        }
        const rarityTag = c.rarity ? ` - ${c.rarity}` : '';
        lines.push(`1x ${c.name}${idTag}${rarityTag}`);
      });
      lines.push('');
    });

    return lines.join('\n').trim();
  };

  const exportMissingCardsToSimpleText = () => {
    const missing = getMissingCards();
    if (missing.length === 0) {
      return 'No missing cards for the selected filters!';
    }
    const sorted = [...missing].sort((a, b) => {
      const numA = a.card_number || '';
      const numB = b.card_number || '';
      if (numA && numB) return numA.localeCompare(numB, undefined, { numeric: true });
      return (a.name || '').localeCompare(b.name || '');
    });
    return sorted.map(c => `1x ${c.name}${c.card_number ? ` (${c.card_number})` : ''}`).join('\n');
  };

  const handleCopyMissingText = () => {
    const missing = getMissingCards();
    if (missing.length === 0) {
      showToast('No missing cards with current filters.', 'error');
      return;
    }
    const text = exportMissingCardsToText();
    navigator.clipboard.writeText(text);
    showToast(`Copied ${missing.length} missing cards to clipboard!`, 'success');
    setShowExportModal(false);
  };

  // A ready-made name for "Create as wishlist", from the filters in use when Export opens.
  useEffect(() => {
    if (showExportModal) setMissingWishlistName(`Want list - ${getActiveFilterDescription()}`.slice(0, MAX_WISHLIST_NAME));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExportModal]);

  /** Saves the missing cards (as filtered right now) as a new wishlist and opens it. */
  const handleCreateWishlistFromMissing = async () => {
    const missing = getMissingCards();
    const name = missingWishlistName.trim();
    if (missing.length === 0 || !name || creatingWishlist) return;
    const items: Record<string, number> = {};
    // With "Foil only" on, what's missing is the foil, so that's what the list asks for.
    missing.forEach(c => { items[showFoilOnly ? `${c.id}_foil` : c.id] = 1; });
    setCreatingWishlist(true);
    try {
      const list = await createWishlist(name, filters.game || 'riftbound', items);
      window.location.href = `/wishlists?list=${list.id}`;
    } catch (e: any) {
      showToast(e?.message || 'Could not create the wishlist.', 'error');
      setCreatingWishlist(false);
    }
  };

  const handleQuickShopMissing = () => {
    if (getMissingCards().length === 0) {
      showToast('No missing cards with current filters.', 'error');
      return;
    }
    try {
      sessionStorage.setItem('tcg_quickshop_prefill', exportMissingCardsToSimpleText());
    } catch (e) {}
    window.location.href = '/marketplace';
  };

  const handleDownloadMissingJson = () => {
    const missing = getMissingCards();
    if (missing.length === 0) {
      showToast('No missing cards with current filters.', 'error');
      return;
    }
    const dataObj = {
      title: 'TCG XChange - Missing Cards',
      game: filters.game || 'riftbound',
      filter: getActiveFilterDescription(),
      exportedAt: new Date().toISOString(),
      missingCount: missing.length,
      cards: missing.map(c => ({
        id: c.id,
        name: c.name,
        cardNumber: c.card_number,
        rarity: c.rarity,
        setName: c.sets?.name || c.set_name || null,
        setCode: c.sets?.code || c.set_code || null,
      })),
    };
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeSet = (filters.sets?.join('_') || filters.game || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    link.download = `tcg_xchange_missing_${safeSet}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${missing.length} missing cards (.json)`, 'success');
    setShowExportModal(false);
  };

  // Reads the separate, deliberate backup (see handleSaveToCloud), not the collection that syncs
  // automatically - so it still has whatever was last explicitly saved, however many resets or
  // other changes have happened to the live collection since.
  const handleRestoreFromCloud = async () => {
    if (!currentUser) return;
    if (activeNamed) {
      showToast('Cloud backups are for your Personal collection - switch to Personal to restore one.', 'error');
      return;
    }
    setRestoringFromCloud(true);
    try {
      const record = await loadCollectionBackupFromCloud();
      if (!record || Object.keys(record.cards).length === 0) {
        showToast('No saved backup found in your cloud account.', 'error');
        return;
      }
      const backupData = record.cards;
      setCollection(backupData);
      // Stamped as a fresh local change, not with the backup's own time, so the usual auto-sync
      // picks it up and pushes it to the live, cross-device collection too.
      saveLocalCollection(backupData);
      showToast("Collection restored from your cloud backup.", 'success');
      setShowImportModal(false);
      setShowExportModal(false);
    } catch (e: any) {
      showToast(`Failed to restore from cloud: ${e.message || 'Unknown error'}`, 'error');
    } finally {
      setRestoringFromCloud(false);
    }
  };

  const handleImportCollection = (rawContent?: string) => {
    const content = rawContent ?? importText;
    if (!content.trim()) return;

    // Matching a card by id, number or name needs the catalog loaded; importing against an empty
    // one would silently match nothing while still claiming success.
    if (allCards.length === 0 && cards.length === 0) {
      showToast('The card catalog is still loading — wait a moment and try again.', 'error');
      return;
    }

    const result = importIntoCollection(content, collection, allCards.length ? allCards : cards);
    if (!result.ok) {
      if (result.unrecognized) alert(result.error);
      else showToast(result.error, 'error');
      return;
    }
    commitCollection(result.next);
    setShowImportModal(false);
    setImportText("");
    const from = { backup: 'cards from backup file', 'json-list': 'entries from JSON', 'json-map': 'cards from JSON', text: 'cards from text list' }[result.source];
    showToast(`Successfully imported ${result.added} ${from}!`, 'success');
  };

  const handleImportFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) handleImportCollection(content);
      if (importFileInputRef.current) importFileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  // Opens the themed confirmation below rather than the browser's own confirm() - a native dialog
  // can't be styled or colored, and reads as a plain, uncolored wall of text for something this
  // consequential.
  const handleResetCollection = () => {
    if (uniqueOwnedKeys.length === 0) return;
    setResetScope('device');
    setShowResetConfirm(true);
  };

  const performResetCollection = async () => {
    setResettingCollection(true);
    try {
      if (activeNamed) {
        await setCollectionCards(activeNamed.id, {});
        showToast(`Cleared "${activeNamed.name}".`, 'success');
        return;
      }
      // Signed in, every local change is auto-saved to the cloud, so "this device only" has to
      // leave sync out of it: the browser's copy AND its change-time are removed instead of being
      // saved as an empty collection. With no time of its own, this browser then looks like a fresh
      // one, and the next sign-in loads the untouched cloud copy back.
      if (currentUser && resetScope === 'device') {
        setCollection({});
        collectionRef.current = {};
        try {
          localStorage.removeItem('tcg_user_collection');
          localStorage.removeItem('tcg_collection');
          localStorage.removeItem(COLLECTION_STAMP_KEY);
        } catch {
          // best-effort
        }
        showToast('Cleared on this device. Your cloud copy is untouched.', 'success');
        return;
      }

      setCollection({});
      collectionRef.current = {};
      saveLocalCollection({});

      if (!currentUser) {
        showToast('Collection reset.', 'success');
        return;
      }
      // Saved straight away rather than after the usual delay: moving to another page within that
      // delay would cancel it, and the next visit would find the old cloud copy still there.
      const cleared = await pushCollectionToCloud();
      showToast(cleared ? 'Cleared on this device and in the cloud.' : 'Cleared here, but the cloud copy could not be cleared. Try again.', cleared ? 'success' : 'error');
    } finally {
      setResettingCollection(false);
      setShowResetConfirm(false);
    }
  };

  const { isDark } = useSiteTheme(filters.game);
  const isRiftbound = !filters.game || filters.game === 'riftbound';
  const isOnePiece = filters.game === 'onepiece';

  const catalogTheme = {
    containerClass: "bg-[var(--bg-surface)]/95 border border-[var(--border)] shadow-[var(--shadow-card)]",
    inputClass: "bg-[var(--bg-input)] border border-[var(--border)] hover:border-[var(--border-hover)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
    sortBtnClass: "bg-[var(--bg-input)] hover:bg-[var(--bg-raised)] border border-[var(--border)] hover:border-[var(--border-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
    sortMenuClass: "bg-[var(--bg-surface)] border border-[var(--border)] shadow-2xl",
    sortSelectedIcon: "text-[var(--accent)]",
    mobileFilterBtn: "bg-[var(--accent-muted)] hover:bg-[var(--accent-strong)]/20 border border-[var(--accent-border)] text-[var(--text-accent)]",
    mobileFilterIcon: "text-[var(--text-accent)]",
    mobileFilterBadge: "bg-[var(--accent-strong)] text-[var(--text-on-accent)]",
    deckBuilderBtn: "bg-[var(--accent-strong)] hover:brightness-110 text-[var(--text-on-accent)] font-black shadow-lg shadow-[var(--accent-glow)]",
    cloudSyncCard: "bg-[var(--bg-input)] hover:bg-[var(--bg-raised)] border border-[var(--border)] hover:border-[var(--accent)] shadow-lg shadow-black/40",
    cloudSyncIconBg: "bg-[var(--accent-muted)] border border-[var(--accent-border)] text-[var(--text-accent)]",
    cloudSyncBadge: "bg-[var(--accent-muted)] text-[var(--text-accent)] border border-[var(--accent-border)]",
    cloudSyncText: "text-[var(--text-accent)]",
    activePlaysetClass: "text-[var(--text-on-accent)] font-black bg-[var(--accent-strong)] border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]",
  };

  const availableSets = useMemo(() => {
    const setNames = new Set(allSetsForGame.length > 0 ? allSetsForGame : (isRiftbound ? SETS : []));
    cards.forEach(c => {
      if (c.set_name) setNames.add(c.set_name);
    });
    return isRiftbound ? sortSetNames(Array.from(setNames)) : Array.from(setNames);
  }, [cards, allSetsForGame, isRiftbound]);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "clamp(16px,3vw,32px) clamp(16px,3vw,24px)" }}>
      
      {/* Filters live in their own off-canvas panel (see FilterDrawer below), not pinned in this
          layout - a sidebar taller than the screen has no good way to coexist with page scroll. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr" }}>

        {/* Content Area */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          
          {/* Controls Bar (Search, Sort, Grid Size, Tabs & Collection Actions) */}
          <div className={`flex flex-col gap-3 ${catalogTheme.containerClass} rounded-2xl p-3.5 sm:p-4 backdrop-blur-md relative z-30`}>
            
            {isWide ? (
              /* Desktop Layout: Filters + Search Bar + Sort Dropdown in a single row */
              <div className="flex items-center gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setShowMobileFilters(true)}
                  className={`h-10 px-3.5 flex items-center gap-2 rounded-xl ${catalogTheme.mobileFilterBtn} text-xs font-bold transition cursor-pointer shadow-sm active:scale-95 shrink-0`}
                >
                  <svg className={`w-4 h-4 ${catalogTheme.mobileFilterIcon} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  <span>Filters</span>
                  {activeFilterBadgeCount > 0 && (
                    <span className={`w-5 h-5 rounded-full ${catalogTheme.mobileFilterBadge} text-[11px] font-black flex items-center justify-center shrink-0`}>
                      {activeFilterBadgeCount}
                    </span>
                  )}
                </button>

                <div className="flex-1 relative min-w-0">
                  <svg
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={"Search cards by name, number, or artist..."}
                    title={"Press Enter to add 1 copy of the matched card instantly (Shift+Enter for foil)"}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleQuickAddKeyDown}
                    className={`w-full h-10 ${catalogTheme.inputClass} rounded-xl pl-10 pr-3 text-xs font-medium outline-none transition shadow-inner`}
                  />
                </div>

                {/* Sort Dropdown on Desktop */}
                <div className="relative w-56 shrink-0 z-40" ref={sortRef}>
                  <button
                    type="button"
                    onClick={() => setSortOpen(prev => !prev)}
                    className={`w-full h-10 px-3.5 flex items-center justify-between gap-1.5 rounded-xl ${catalogTheme.sortBtnClass} text-xs font-semibold transition shadow-sm cursor-pointer select-none`}
                  >
                    <span className="truncate">
                      {getSortLabel(sortMode)}
                    </span>
                    <svg
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${sortOpen ? 'rotate-180' : ''}`}
                      style={{ color: 'var(--text-muted)' }}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {sortAnim.rendered && (
                    <div data-state={sortAnim.state} className={`tv-popover tv-origin-top-right absolute right-0 mt-1.5 w-56 rounded-xl ${catalogTheme.sortMenuClass} backdrop-blur-md z-50 overflow-hidden max-h-80 overflow-y-auto`}>
                      {SORT_OPTIONS.map(({ mode, labelKey }, idx) => {
                        const isSelected = sortMode === mode;
                        const isLighterPair = Math.floor(idx / 2) % 2 === 0;
                        const isPairEnd = idx % 2 === 1 && idx < SORT_OPTIONS.length - 1;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => { setSortMode(mode as any); setSortOpen(false); }}
                            className={`w-full flex items-center justify-between px-3.5 py-2 text-xs font-semibold transition cursor-pointer text-left ${
                              isPairEnd ? 'border-b border-[var(--border-subtle)]' : ''
                            } ${
                              isSelected
                                ? 'bg-[var(--accent-muted)] text-[var(--text-accent)] font-bold'
                                : `${isLighterPair ? 'bg-[var(--bg-surface-2)]' : 'bg-[var(--bg-input)]'} text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]`
                            }`}
                          >
                            <span>{t(labelKey as any)}</span>
                            {isSelected && (
                              <svg className={`w-3.5 h-3.5 ${catalogTheme.sortSelectedIcon} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Mobile Layout: Row 1 = Search (100%), Row 2 = Filters (50%) + Sort (50%) */
              <>
                {/* Row 1: Full-Width Search Bar */}
                <div className="w-full relative">
                  <svg
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={"Search cards by name, number, or artist..."}
                    title={"Press Enter to add 1 copy of the matched card instantly (Shift+Enter for foil)"}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleQuickAddKeyDown}
                    className={`w-full h-10 ${catalogTheme.inputClass} rounded-xl pl-10 pr-3 text-xs font-medium outline-none transition shadow-inner`}
                  />
                </div>

                {/* Row 2: Mobile Filters Button + Sort Dropdown (50/50) */}
                <div className="flex items-center gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => setShowMobileFilters(true)}
                    className={`flex-1 h-10 px-3 flex items-center justify-center gap-2 rounded-xl ${catalogTheme.mobileFilterBtn} text-xs font-bold transition cursor-pointer shadow-sm active:scale-95 min-w-0`}
                  >
                    <svg className={`w-4 h-4 ${catalogTheme.mobileFilterIcon} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    <span className="truncate">Filters</span>
                    {activeFilterBadgeCount > 0 && (
                      <span className={`w-5 h-5 rounded-full ${catalogTheme.mobileFilterBadge} text-[11px] font-black flex items-center justify-center shrink-0`}>
                        {activeFilterBadgeCount}
                      </span>
                    )}
                  </button>

                  <div className="flex-1 min-w-0 relative z-40" ref={sortRef}>
                    <button
                      type="button"
                      onClick={() => setSortOpen(prev => !prev)}
                      className={`w-full h-10 px-3.5 flex items-center justify-between gap-1.5 rounded-xl ${catalogTheme.sortBtnClass} text-xs font-semibold transition shadow-sm cursor-pointer select-none`}
                    >
                      <span className="truncate">
                        {getSortLabel(sortMode)}
                      </span>
                      <svg
                        className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${sortOpen ? 'rotate-180' : ''}`}
                        style={{ color: 'var(--text-muted)' }}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {sortAnim.rendered && (
                      <div data-state={sortAnim.state} className={`tv-popover tv-origin-top-right absolute right-0 mt-1.5 w-full rounded-xl ${catalogTheme.sortMenuClass} backdrop-blur-md z-50 overflow-hidden max-h-80 overflow-y-auto`}>
                        {SORT_OPTIONS.map(({ mode, labelKey }, idx) => {
                          const isSelected = sortMode === mode;
                          const isLighterPair = Math.floor(idx / 2) % 2 === 0;
                          const isPairEnd = idx % 2 === 1 && idx < SORT_OPTIONS.length - 1;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => { setSortMode(mode as any); setSortOpen(false); }}
                              className={`w-full flex items-center justify-between px-3.5 py-2 text-xs font-semibold transition cursor-pointer text-left ${
                                isPairEnd ? 'border-b border-[var(--border-subtle)]' : ''
                              } ${
                                isSelected
                                  ? 'bg-[var(--accent-muted)] text-[var(--text-accent)] font-bold'
                                  : `${isLighterPair ? 'bg-[var(--bg-surface-2)]' : 'bg-[var(--bg-input)]'} text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]`
                              }`}
                            >
                              <span>{t(labelKey as any)}</span>
                              {isSelected && (
                                <svg className={`w-3.5 h-3.5 ${catalogTheme.sortSelectedIcon} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {searchQuery.trim() !== '' && (
              <p className="text-[11px] -mt-1.5 px-0.5" style={{ color: 'var(--text-muted)' }}>
                Press <span className="font-bold" style={{ color: 'var(--text-tertiary)' }}>Enter</span> to add 1 copy instantly · hold <span className="font-bold" style={{ color: 'var(--text-tertiary)' }}>Shift</span> for foil
              </p>
            )}

            {/* Row 3: Dedicated Full-Width Collection Status Tabs (All, Owned, Playset, Missing) */}
            <div className="w-full">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-[var(--bg-input)] p-1.5 rounded-xl border border-[var(--border)] w-full">
                {(["All", "Owned", "Playset", "Missing"] as const).map(f => {
                  const active = collectionFilter === f;
                  let label = `${"All"} (${relevantTotal})`;
                  // Text stays the theme's own high-contrast primary color regardless of which tab is
                  // active - a literal white reads fine on the dark themes but disappears on light
                  // (Ivory Parchment); the color wash is carried by the border/background/glow instead.
                  let activeClass = 'font-bold bg-[var(--bg-raised)] border-[var(--border-hover)] shadow-md';
                  const activeStyle = { color: 'var(--text-primary)' };

                  if (f === "Owned") {
                    label = `${"Owned"} (${ownedCount} / ${relevantTotal})`;
                    activeClass = 'font-bold bg-emerald-500/20 border-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.25)]';
                  } else if (f === "Playset") {
                    label = `${"Playset"} (${playsetCount} / ${relevantTotal})`;
                    activeClass = catalogTheme.activePlaysetClass;
                  } else if (f === "Missing") {
                    label = `${"Missing"} (${missingCount} / ${relevantTotal})`;
                    activeClass = 'font-bold bg-rose-500/20 border-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.25)]';
                  }

                  return (
                    <button
                      key={f}
                      onClick={() => setCollectionFilter(f)}
                      style={active ? activeStyle : undefined}
                      className={`py-2 px-2.5 text-xs rounded-lg transition border cursor-pointer font-semibold text-center justify-center flex items-center min-w-0 ${
                        active
                          ? activeClass
                          : 'bg-transparent border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]'
                      }`}
                    >
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Row 4: Grid Size Switcher (100% on mobile) + Collection Actions (100% on mobile).
                pt matches the container's own p-3.5/p-4, so the gap above the divider line
                (down to these buttons) matches the gap below them (down to the box's edge). */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5 pt-3.5 sm:pt-4 border-t border-[var(--border-subtle)]">
              {/* Grid Size Switcher - 100% full-width on mobile */}
              <div className="grid grid-cols-3 sm:flex items-center bg-[var(--bg-input)] border border-[var(--border)] rounded-xl p-1 h-10 sm:h-9 shrink-0 gap-1 w-full sm:w-auto">
                {(["small", "normal", "large"] as const).map(size => {
                  const active = gridSize === size;
                  return (
                    <button
                      key={size}
                      onClick={() => setGridSize(size)}
                      title={`Card display size: ${size}`}
                      className={`flex items-center justify-center px-3 py-1.5 sm:py-1 text-xs rounded-lg transition cursor-pointer capitalize font-semibold ${
                        active
                          ? 'text-[var(--text-primary)] bg-[var(--bg-raised)] border border-[var(--border-hover)] shadow-sm'
                          : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] border border-transparent'
                      }`}
                    >
                      {t(size as any)}
                    </button>
                  );
                })}
              </div>

              {/* What the collection is worth, between the size switcher and the actions - scoped to
                  whatever's currently filtered/on screen, so it updates live as filters change. */}
              <CollectionSwitcher
                personalCount={Object.values(personalCollection).reduce((sum, n) => sum + (n || 0), 0)}
                onManage={() => setShowManageCollections(true)}
                onMove={() => setShowMoveCards(true)}
              />


              <CollectionValueChip
                collection={collection}
                cards={relevantCards}
                mode={collectionFilter}
                foilOnly={showFoilOnly}
              />

              {/* Collection actions, by width:
                  - under 768px: rows of related buttons - build (Deck Builder + Quick List), views
                    (Decks + Binder + Scan, which share a color), data (Import + Export) - each row
                    full width;
                  - 768-1280px: one full-width row of their own, every button sharing it equally
                    (they used to wrap into a half-filled row that crept right until Reset dropped
                    to yet another line);
                  - 1280px+: their natural width, on the same row as the size switcher and value.
                  From 768px each group is `display: contents`, so the buttons line up in one row
                  in their original order. */}
              <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center w-full xl:w-auto">
                {isRiftbound && (
                  <a
                    href="/deck-builder"
                    title="Open Deck Builder"
                    className={`sm:order-1 flex-1 sm:flex-none flex items-center justify-center px-3 py-2 sm:py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer shadow-sm whitespace-nowrap ${catalogTheme.deckBuilderBtn}`}
                  >
                    Deck Builder
                  </a>
                )}

                {/* Decks, Binder, Wishlists, Scan */}
                <div className={`grid ${canScan ? (isRiftbound ? 'grid-cols-2' : 'grid-cols-2') : (isRiftbound ? 'grid-cols-3' : 'grid-cols-2')} gap-1.5 sm:contents`}>
                  {isRiftbound && (
                    <a href="/decks" title="Browse saved decks" className={`sm:order-2 flex-1 sm:flex-none ${viewBtnClass}`}>
                      Decks
                    </a>
                  )}
                  <a href="/binder" title="Open Binder Map" className={`sm:order-3 flex-1 sm:flex-none ${viewBtnClass}`}>
                    Binder
                  </a>
                  <a href="/wishlists" title="Your wishlists" className={`sm:order-3 flex-1 sm:flex-none ${viewBtnClass}`}>
                    Wishlists
                  </a>
                  {canScan && (
                    <button onClick={() => setShowScanner(true)} title="Scan cards with your camera" className={`sm:order-4 flex-1 sm:flex-none gap-1.5 ${viewBtnClass}`}>
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9V7a2 2 0 0 1 2-2h2M17 5h2a2 2 0 0 1 2 2v2M21 15v2a2 2 0 0 1-2 2h-2M7 19H5a2 2 0 0 1-2-2v-2" />
                        <line x1="3" y1="12" x2="21" y2="12" />
                      </svg>
                      Scan
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1.5 sm:contents">
                  <button onClick={() => setShowImportModal(true)} title="Import collection from text list or JSON file" className={`sm:order-7 flex-1 sm:flex-none ${dataBtnClass}`}>
                    Import
                  </button>
                  <button
                    onClick={() => {
                      setExportTab(collectionFilter === 'Missing' ? 'missing' : 'owned');
                      setShowExportModal(true);
                    }}
                    title={'Export collection or missing cards'}
                    className={`sm:order-6 flex-1 sm:flex-none ${dataBtnClass}`}
                  >
                    Export
                  </button>
                </div>

                {uniqueOwnedKeys.length > 0 && (
                  <button
                    onClick={handleResetCollection}
                    title="Clear tracked collection"
                    className="tv-btn-danger sm:order-8 flex-1 sm:flex-none flex items-center justify-center text-xs px-3 py-2 sm:py-1.5 rounded-lg font-semibold transition cursor-pointer whitespace-nowrap"
                  >
                    Reset ({totalOwnedCopies})
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Cards Grid */}
          <div style={{ minHeight: "40vh" }} aria-busy={loading} aria-live="polite">
            {loading ? (
              <div className={`grid ${gridSizeClasses(gridSize)}`}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} style={{ borderRadius: 14, background: "var(--bg-surface-2)", height: 320, animation: "pulse 1.5s ease-in-out infinite" }} />
                ))}
              </div>
            ) : paginatedCards.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 24px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 18 }}>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)", margin: "0 0 6px" }}>No cards found</h3>
                <p style={{ fontSize: 14, color: "var(--text-muted)", margin: 0 }}>Try clearing filters or search term to discover cards.</p>
              </div>
            ) : (
              <div className={`grid ${gridSizeClasses(gridSize)}`}>
                {paginatedCards.map((card, i) => (
                  <CardListItem
                    key={card.id}
                    card={card}
                    count={collection[card.id] || 0}
                    foilCount={collection[`${card.id}_foil`] || 0}
                    isOwned={(collection[card.id] || 0) > 0}
                    isFoilOwned={(collection[`${card.id}_foil`] || 0) > 0}
                    onUpdateCount={updateCardCount}
                    onToggle={toggleOwnership}
                    onMove={collectionsStore.collections.length > 0 ? (c, f) => setMoveSingle({ card: c, isFoil: f }) : undefined}
                    onClick={openCard}
                    gridSize={gridSize}
                    priority={i < 4}
                  />
                ))}
              </div>
            )}
          </div>

          {!loading && <LoadMoreFooter state={loadMoreState} total={displayedCards.length} noun="cards" />}

        </div>
      </div>

      {/* Mobile Filter Fullscreen / Full-Width Menu */}
      {/* Filters panel - see the comment on FilterDrawer for why this replaced the pinned sidebar. */}
      <FilterDrawer
        open={showMobileFilters}
        onClose={() => setShowMobileFilters(false)}
        title="Filter Catalog"
        activeCount={activeFilterBadgeCount}
        applyLabel={`Apply & View ${relevantTotal} Cards`}
      >
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
      </FilterDrawer>

      {/* Export Collection Modal */}
      <CollectionModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        icon="export"
        title={exportTab === 'owned' ? 'Export collection' : 'Export missing cards'}
        subtitle={
          exportTab === 'owned'
            ? `${totalOwnedCopies} owned cards (${uniqueOwnedKeys.length} unique)`
            : 'The missing cards that match your current filters'
        }
      >
        <div className="flex rounded-xl p-1 border mb-5" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }} role="tablist">
          {([
            { id: 'owned', label: 'Owned', count: totalOwnedCopies },
            { id: 'missing', label: 'Missing (want-list)', count: getMissingCards().length },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={exportTab === tab.id}
              onClick={() => setExportTab(tab.id)}
              className="flex-1 h-9 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer border"
              style={
                exportTab === tab.id
                  ? { background: 'var(--bg-raised)', borderColor: 'var(--border-hover)', color: 'var(--text-primary)' }
                  : { background: 'transparent', borderColor: 'transparent', color: 'var(--text-tertiary)' }
              }
            >
              <span>{tab.label}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-black" style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)' }}>{tab.count}</span>
            </button>
          ))}
        </div>

        {exportTab === 'owned' && (
          <div className="flex flex-col gap-5">
            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Back up</h4>
              {currentUser ? (
                <ActionRow
                  tone="accent"
                  icon="cloud-up"
                  title="Save to cloud database"
                  description={`Back up your ${totalOwnedCopies} cards. Kept separately, so a later reset can't remove it.`}
                  actionLabel={savingToCloud ? 'Saving…' : 'Save'}
                  actionIcon="cloud-up"
                  onClick={handleSaveToCloud}
                  disabled={savingToCloud}
                />
              ) : (
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 rounded-xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                  <span className="w-9 h-9 rounded-lg border flex items-center justify-center" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }} aria-hidden="true">
                    <Icon name="user" className="w-[18px] h-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>Sign in to back up</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Sync and back up your collection to your account</span>
                  </span>
                  <a
                    href="/login"
                    className="inline-flex items-center justify-center h-8 min-w-[7.5rem] px-3 rounded-lg border text-xs font-bold"
                    style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    Sign in
                  </a>
                </div>
              )}
            </section>

            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Copy or download</h4>
              <div className="flex flex-col gap-2">
                <ActionRow index={0} icon="list" title="Detailed card list" description="Grouped by set, with quantities, numbers and foil tags" actionLabel="Copy" actionIcon="copy" onClick={handleCopyCollectionText} />
                <ActionRow index={1} icon="code" title="JSON file (.json)" description="A full backup to keep, or to import in another browser" actionLabel="Download" actionIcon="download" onClick={handleDownloadJson} />
              </div>
            </section>
          </div>
        )}

        {exportTab === 'missing' && (
          <div className="flex flex-col gap-5">
            <div className="p-3 rounded-xl border flex items-center gap-2 flex-wrap text-xs" style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)' }}>
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-accent)' }}>Filters</span>
              <span className="px-2 py-0.5 rounded-md border font-semibold" style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)', borderColor: 'var(--accent-border)' }}>
                {getActiveFilterDescription()}
              </span>
              <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                {`${getMissingCards().length} missing (of ${relevantTotal})`}
              </span>
            </div>

            {getMissingCards().length === 0 ? (
              <div className="py-8 px-4 text-center rounded-xl border" style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)' }}>
                <span className="w-10 h-10 rounded-full border flex items-center justify-center mx-auto mb-2" style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}>
                  <Icon name="check" className="w-5 h-5" />
                </span>
                <div className="text-sm font-bold" style={{ color: 'var(--positive)' }}>No missing cards</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>You already own every card that matches your current filters.</div>
              </div>
            ) : (
              <>
                <section>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Marketplace</h4>
                  <ActionRow
                    tone="accent"
                    icon="cart"
                    title="Quick shop this list"
                    description="Find these on the marketplace, cheapest or fewest sellers, and add them to your cart"
                    actionLabel="Shop"
                    actionIcon="cart"
                    onClick={handleQuickShopMissing}
                  />
                </section>
                <section>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Wishlist</h4>
                  {currentUser ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); handleCreateWishlistFromMissing(); }}
                      className="flex flex-col sm:flex-row gap-2 p-3 rounded-xl border"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                    >
                      <span className="flex items-center gap-2 min-w-0 flex-1">
                        <Icon name="heart" className="w-4 h-4 shrink-0" />
                        <input
                          type="text"
                          value={missingWishlistName}
                          maxLength={MAX_WISHLIST_NAME}
                          onChange={(e) => setMissingWishlistName(e.target.value)}
                          aria-label="Name of the new wishlist"
                          placeholder="Wishlist name"
                          className="flex-1 min-w-0 h-8 rounded-lg px-2.5 text-xs font-semibold border outline-none focus:border-[var(--accent)]"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        />
                      </span>
                      <button
                        type="submit"
                        disabled={creatingWishlist || !missingWishlistName.trim()}
                        className="h-8 px-3 rounded-lg text-xs font-black cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {creatingWishlist ? 'Creating…' : 'Create as wishlist'}
                      </button>
                    </form>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Sign in to save this list as a wishlist.</p>
                  )}
                </section>
                <section>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Copy or download</h4>
                  <div className="flex flex-col gap-2">
                    <ActionRow index={0} icon="list" title="Detailed want-list" description="Grouped by set, with numbers, names and rarities" actionLabel="Copy" actionIcon="copy" onClick={handleCopyMissingText} />
                    <ActionRow index={1} icon="code" title="JSON file (.json)" description="Structured data with card ids, numbers, sets and rarities" actionLabel="Download" actionIcon="download" onClick={handleDownloadMissingJson} />
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end mt-6">
          <button
            type="button"
            onClick={() => setShowExportModal(false)}
            className="px-4 h-9 rounded-lg text-xs font-bold cursor-pointer transition"
            style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
          >
            Close
          </button>
        </div>
      </CollectionModal>

      {/* Import Modal */}
      <CardScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        cards={allCards.length ? allCards : cards}
        game={filters.game || 'riftbound'}
        onChangeCount={(card, isFoil, delta) => updateCardCount(card.id, isFoil, delta)}
      />

      <MoveCardsModal
        open={showMoveCards}
        onClose={() => setShowMoveCards(false)}
        personalCards={personalCollection}
        applyPersonal={(next) => { setCollection(next); saveLocalCollection(next); }}
        pricesFor={(coll, defaults, cardsMap) => alwaysListPrices(coll, defaults, cardsMap)}
        cardLabel={(key) => {
          const id = key.replace(/_foil$/, '');
          const card = allCards.find(c => c.id === id) || cards.find(c => c.id === id);
          return card ? card.name : null;
        }}
        onToast={(msg, type) => showToast(msg, type || 'info')}
      />

      <MoveCardModal
        open={moveSingle !== null}
        onClose={() => setMoveSingle(null)}
        card={moveSingle ? { id: moveSingle.card.id, name: moveSingle.card.name } : null}
        hasFoil={moveSingle ? hasFoilVariant(moveSingle.card) : false}
        initialFoil={moveSingle?.isFoil ?? false}
        sourceId={activeNamed ? activeNamed.id : PERSONAL_COLLECTION_ID}
        personalCards={personalCollection}
        applyPersonal={(next) => { setCollection(next); saveLocalCollection(next); }}
        pricesFor={(coll, defaults, cardsMap) => alwaysListPrices(coll, defaults, cardsMap)}
        onToast={(msg, type) => showToast(msg, type || 'info')}
      />

      <ManageCollectionsModal
        open={showManageCollections}
        onClose={() => setShowManageCollections(false)}
        pricesFor={(coll, defaults) => alwaysListPrices(coll, defaults)}
        onToast={(msg, type) => showToast(msg, type || 'info')}
      />

      {/* Import Collection Modal */}
      <CollectionModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        icon="import"
        title="Import collection"
        subtitle="Add cards from a backup, a file or a pasted list"
      >
        <input
          ref={importFileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImportFileUpload}
          className="hidden"
        />

        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Sources</h4>
          <div className="flex flex-col gap-2">
            {currentUser && (
              <ActionRow
                index={0}
                tone="accent"
                icon="cloud-down"
                title="Cloud backup"
                description="Bring back what you last saved with Save to cloud database"
                actionLabel={restoringFromCloud ? 'Restoring…' : 'Restore'}
                actionIcon="cloud-down"
                onClick={handleRestoreFromCloud}
                disabled={restoringFromCloud}
              />
            )}
            <ActionRow
              index={currentUser ? 1 : 0}
              icon="file"
              title="From a file"
              description="A collection backup (.json) from Export"
              actionLabel="Choose file"
              actionIcon="upload"
              onClick={() => importFileInputRef.current?.click()}
            />
          </div>
        </section>

        <section className="mt-5">
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Or paste a list</h4>
          <textarea
            rows={7}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            aria-label="Paste a card list or JSON"
            placeholder={`Card names and numbers, or JSON.\n\n1x Akali, Deadly Weapon (VEN-021a/166)\n1x Renekton, Rage Fueled [Foil]\n\n["card-id-1", "card-id-2_foil"]`}
            className="w-full p-3 rounded-xl border text-xs font-mono outline-none transition resize-y focus:border-[var(--accent)]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </section>

        <div className="flex gap-2 justify-end mt-5">
          <button
            type="button"
            onClick={() => setShowImportModal(false)}
            className="px-4 h-9 rounded-lg text-xs font-bold cursor-pointer transition border"
            style={{ background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleImportCollection()}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-black cursor-pointer transition"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
          >
            <Icon name="import" className="w-3.5 h-3.5" />
            Import cards
          </button>
        </div>
      </CollectionModal>

      {/* Floating Toast Notification */}
      {toastAnim.rendered && toastRef.current && (
        <div
          role="status"
          data-state={toastAnim.state}
          className={`tv-toast fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 border text-xs font-bold rounded-xl shadow-2xl ${
            toastRef.current.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-600/50 text-emerald-200'
              : toastRef.current.type === 'error'
              ? 'bg-rose-950/95 border-rose-600/50 text-rose-200'
              : 'bg-[var(--bg-raised)] border-[var(--border-hover)] text-[var(--text-primary)]'
          }`}
        >
          {toastRef.current.type === 'success' && (
            <svg className="w-4 h-4 shrink-0 text-[var(--positive)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {toastRef.current.type === 'error' && (
            <svg className="w-4 h-4 shrink-0 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12.5" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <span>{toastRef.current.message}</span>
        </div>
      )}

      {/* Reset Confirmation */}
      <CollectionModal
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        closeDisabled={resettingCollection}
        tone="danger"
        icon="trash"
        maxWidth="max-w-md"
        title={activeNamed ? `Clear "${activeNamed.name}"?` : "Clear your collection?"}
        subtitle={`${totalOwnedCopies} saved cards will be removed.`}
      >
        {activeNamed ? (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Removes every card from this collection{activeNamed.always_list ? ' and takes its listings off the marketplace (copies buyers are holding stay until those holds are done)' : ''}. Your other collections aren't touched.
          </p>
        ) : currentUser ? (
          <div role="radiogroup" aria-label="What to clear" className="flex flex-col gap-2">
            {([
              {
                id: 'device' as const,
                icon: 'device' as const,
                title: 'This device only',
                text: "Removes the cards from this browser. Your account keeps them.",
              },
              {
                id: 'both' as const,
                icon: 'cloud-up' as const,
                title: 'This device and your account',
                text: "Removes the cards from this browser and from your account, on every device.",
              },
            ]).map((opt) => {
              const selected = resetScope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={resettingCollection}
                  onClick={() => setResetScope(opt.id)}
                  className="w-full grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 rounded-xl border text-left cursor-pointer transition disabled:cursor-default"
                  style={
                    selected
                      ? { background: opt.id === 'both' ? 'var(--negative-muted)' : 'var(--accent-muted)', borderColor: opt.id === 'both' ? 'var(--negative-border)' : 'var(--accent-border)' }
                      : { background: 'var(--bg-input)', borderColor: 'var(--border)' }
                  }
                >
                  <span className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }} aria-hidden="true">
                    <Icon name={opt.icon} className="w-[18px] h-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{opt.title}</span>
                    <span className="block text-xs mt-0.5 leading-snug" style={{ color: 'var(--text-tertiary)' }}>{opt.text}</span>
                  </span>
                  <span
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                    style={{ borderColor: selected ? (opt.id === 'both' ? 'var(--negative)' : 'var(--accent)') : 'var(--border-hover)' }}
                    aria-hidden="true"
                  >
                    {selected && <span className="w-2 h-2 rounded-full" style={{ background: opt.id === 'both' ? 'var(--negative)' : 'var(--accent)' }} />}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>This removes them from this browser.</p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={() => setShowResetConfirm(false)}
            disabled={resettingCollection}
            className="px-4 h-9 rounded-xl text-xs font-bold cursor-pointer transition border disabled:opacity-50 disabled:cursor-default"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-hover)', color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={performResetCollection}
            disabled={resettingCollection}
            className="px-4 h-9 rounded-xl text-xs font-bold cursor-pointer transition text-white bg-rose-600 hover:bg-rose-500 shadow-md disabled:opacity-60 disabled:cursor-default"
          >
            {resettingCollection ? 'Clearing…' : activeNamed ? 'Clear collection' : currentUser && resetScope === 'both' ? 'Clear everywhere' : currentUser ? 'Clear this device' : 'Clear collection'}
          </button>
        </div>
      </CollectionModal>

      {/* Card Detail Modal */}
      <CardPreviewOverlay cardId={selectedCardId} onClose={closeCard} zIndex={100} />
    </div>
  );
}

const viewBtnClass = "flex items-center justify-center px-3 py-2.5 md:py-1.5 text-xs font-bold rounded-lg transition cursor-pointer shadow-sm whitespace-nowrap bg-[var(--accent-muted)] hover:bg-[var(--accent-strong)]/20 border border-[var(--accent-border)] text-[var(--text-accent)]";
const dataBtnClass = "flex items-center justify-center px-3 py-2.5 md:py-1.5 text-xs font-semibold rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-input)] hover:bg-[var(--bg-raised)] border border-[var(--border)] hover:border-[var(--border-hover)] transition cursor-pointer whitespace-nowrap";
