import { useEffect, useMemo, useState } from 'react';
import type { FilterState, StoreProduct } from '../../types';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { FilterDrawer } from '../FilterDrawer';
import { FilterSidebar } from '../FilterSidebar';
import { CatalogSearchBar } from '../catalog/CatalogSearchBar';
import { CatalogSortDropdown, type SortOption } from '../catalog/CatalogSortDropdown';
import { GridSizeSwitcher } from '../catalog/GridSizeSwitcher';
import { CARD_CONDITIONS, normalizeCardCondition } from '../../lib/collectionDefaults';
import { GAMES, sortSetNames } from '../../lib/constants';
import { hasFoilVariant, matchesCardVariants } from '../../lib/cardVariants';
import { gridSizeClasses, type GridSize } from '../../lib/gridSize';
import { useLanguage } from '../../lib/i18n';
import { getEurToHuf } from '../../lib/prices';
import { DEFAULT_EUR_TO_HUF } from '../../lib/priceSuggestion';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { IMPORT_BATCH_SIZE } from '../../lib/storeConstants';
import {
  computeBulkSinglePrice,
  loadBulkPricingSettings,
  saveBulkPricingSettings,
  type BulkPricingSettings,
  type CardCondition,
} from '../../lib/storeBulkPricing';
import { cardThumbProps, supabase } from '../../lib/supabase';
import { NumericInput } from './NumericInput';
import { storeApi } from './storeClient';
import StoreBulkPricingPanel from './StoreBulkPricingPanel';
import { StoreBulkCardTile, type StoreBulkCatalogCard } from './StoreBulkCardTile';

interface ExtendedBulkCard extends StoreBulkCatalogCard {
  cost?: number | null;
  ability?: string | null;
  text?: string | null;
  effect?: string | null;
  metadata?: Record<string, any> | null;
}

interface QueuedSingle {
  uid: string;
  card: ExtendedBulkCard;
  isFoil: boolean;
  condition: CardCondition;
  quantity: number;
  priceHuf: number;
  priceEdited: boolean;
}

interface Props {
  products: StoreProduct[];
  onClose: () => void;
  onDone: () => void;
}

type SourceTab = 'catalog' | 'paste';
type ViewMode = 'grid' | 'list';
type StockFilter = 'all' | 'missing' | 'in_stock';

const COND_SHORT: Record<CardCondition, string> = {
  'Pack Fresh': 'PF',
  'Near Mint': 'NM',
  'Excellent': 'EX',
  'Good': 'GD',
  'Played': 'PL',
  'Damaged': 'DM',
};

const COND_ALIAS: Record<string, CardCondition> = {
  pf: 'Pack Fresh',
  packfresh: 'Pack Fresh',
  'pack fresh': 'Pack Fresh',
  nm: 'Near Mint',
  nearmint: 'Near Mint',
  'near mint': 'Near Mint',
  ex: 'Excellent',
  excellent: 'Excellent',
  gd: 'Good',
  good: 'Good',
  pl: 'Played',
  played: 'Played',
  dm: 'Damaged',
  dmg: 'Damaged',
  damaged: 'Damaged',
};

const RARITY_RANK: Record<string, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Epic: 4,
  Showcase: 5,
  Mythic: 5,
  Legendary: 5,
  Enchanted: 6,
};

const BULK_SORT_OPTIONS: SortOption[] = [
  { mode: 'Card Number (Asc)', label: 'Card Number (Asc)', labelHu: 'Kártyaszám (Növekvő)' },
  { mode: 'Card Number (Desc)', label: 'Card Number (Desc)', labelHu: 'Kártyaszám (Csökkenő)' },
  { mode: 'Est. Value (High to Low)', label: 'Store Price (High to Low)', labelHu: 'Bolti ár (Csökkenő)' },
  { mode: 'Est. Value (Low to High)', label: 'Store Price (Low to High)', labelHu: 'Bolti ár (Növekvő)' },
  { mode: 'Rarity (High to Low)', label: 'Rarity (High to Low)', labelHu: 'Ritkaság (Csökkenő)' },
  { mode: 'Rarity (Low to High)', label: 'Rarity (Low to High)', labelHu: 'Ritkaság (Növekvő)' },
  { mode: 'Quantity (Low to High)', label: 'Store Stock (Low to High)', labelHu: 'Bolti készlet (Növekvő)' },
  { mode: 'Quantity (High to Low)', label: 'Store Stock (High to Low)', labelHu: 'Bolti készlet (Csökkenő)' },
  { mode: 'Name (A to Z)', label: 'Name (A to Z)', labelHu: 'Név (A - Z)' },
];

function createEmptyFilters(game: string): FilterState {
  return {
    category: 'singles',
    game,
    sets: [],
    rarities: [],
    type: '',
    domains: [],
    tags: [],
    keywords: [],
    keywordMode: 'and',
    sealedTypes: [],
    costMin: 1,
    costMax: 10,
    stockStatus: 'Any',
    foilFilter: false,
    signedFilter: 'all',
    altArtFilter: 'all',
    overnumberedFilter: 'all',
    spFilter: 'all',
    baseSetFilter: 'all',
  };
}

function unwrapSet(card: StoreBulkCatalogCard) {
  if (!card.sets) return null;
  return Array.isArray(card.sets) ? card.sets[0] ?? null : card.sets;
}

function normalizeCodeToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function getCardCodeBase(cardNumber: string | null | undefined): string {
  if (!cardNumber) return '';
  return cardNumber.trim().toUpperCase().split('/')[0];
}

function parseDomainsList(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,/&]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cardMatchesKeyword(card: ExtendedBulkCard, kw: string): boolean {
  const hay = [card.ability, card.text, card.effect].filter(Boolean).join(' ');
  if (!hay) return false;
  if (kw === 'XP') return hay.includes('XP');
  return hay.toLowerCase().includes(`[${kw.toLowerCase()}`);
}

export default function StoreBulkSinglesModal({ products, onClose, onDone }: Props) {
  const { t } = useLanguage();
  useBodyScrollLock(true);

  // Persisted Pricing & Floor Rules
  const [settings, setSettings] = useState<BulkPricingSettings>(() => loadBulkPricingSettings());
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [eurRate, setEurRate] = useState<number>(DEFAULT_EUR_TO_HUF);

  const updateSettings = (next: BulkPricingSettings) => {
    setSettings(next);
    saveBulkPricingSettings(next);
  };

  // Workspace UI panes & modes
  const [sourceTab, setSourceTab] = useState<SourceTab>('catalog');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [gridSize, setGridSize] = useState<GridSize>('normal');
  const [clickStepMode, setClickStepMode] = useState<'one' | 'custom'>('one');
  const [customClickStep, setCustomClickStep] = useState<number>(3);
  const clickStep = clickStepMode === 'one' ? 1 : Math.max(1, customClickStep);
  const [showFilters, setShowFilters] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState<boolean>(false);
  const [showQueue, setShowQueue] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);

  // Shared Catalog FilterState
  const [selectedGame, setSelectedGame] = useState<string>('riftbound');
  const [catalogFilters, setCatalogFilters] = useState<FilterState>(() => createEmptyFilters('riftbound'));
  const [allGameCards, setAllGameCards] = useState<ExtendedBulkCard[]>([]);
  const [loadingCards, setLoadingCards] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [onlyPriced, setOnlyPriced] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>('');
  const [sortMode, setSortMode] = useState<string>('Card Number (Asc)');
  const [visibleLimit, setVisibleLimit] = useState<number>(60);

  // Paste list state
  const [pasteText, setPasteText] = useState<string>('');
  const [pasteReport, setPasteReport] = useState<{ added: number; unmatched: string[] } | null>(null);

  // Staging queue & save state
  const [queue, setQueue] = useState<QueuedSingle[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [saveSummary, setSaveSummary] = useState<{ created: number; updated: number; errors: number; firstError?: string } | null>(null);
  const [helperNotice, setHelperNotice] = useState<string | null>(null);

  useEffect(() => {
    getEurToHuf().then((rate) => {
      if (Number.isFinite(rate) && rate > 0) setEurRate(rate);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !previewCardId && !showSettings && !mobileFiltersOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving, previewCardId, showSettings, mobileFiltersOpen]);

  // Load cards for chosen game cleanly
  useEffect(() => {
    let cancelled = false;
    setLoadingCards(true);
    setCatalogError(null);
    setCatalogFilters(createEmptyFilters(selectedGame));
    setVisibleLimit(60);

    (async () => {
      try {
        const collected: ExtendedBulkCard[] = [];
        const CHUNK = 1000;
        for (let from = 0; from < 5000; from += CHUNK) {
          let q = supabase
            .from('cards')
            .select(
              'id, set_id, card_number, name, rarity, card_type, subtype, domain, energy, cost, might, tags, ability, text, effect, artist, image_path, game, market_price_eur, market_price_foil_eur, sets(id, name, code, game, release_date)'
            )
            .is('deleted_at', null)
            .order('card_number', { ascending: true })
            .range(from, from + CHUNK - 1);

          if (selectedGame) q = q.eq('game', selectedGame);
          const { data, error } = await q;
          if (cancelled) return;
          if (error) throw error;
          const batch = (data || []).map((row: any) => {
            const setObj = Array.isArray(row.sets) ? row.sets[0] : row.sets;
            return {
              ...row,
              cost: row.cost ?? (row.energy != null ? parseInt(row.energy, 10) : 0),
              set_name: setObj?.name || '',
              set_code: setObj?.code || '',
            } as ExtendedBulkCard;
          });
          collected.push(...batch);
          if (batch.length < CHUNK) break;
        }
        if (!cancelled) {
          setAllGameCards(collected);
        }
      } catch (err: any) {
        if (!cancelled) {
          setCatalogError(err?.message || 'Failed to load catalog cards');
          setAllGameCards([]);
        }
      } finally {
        if (!cancelled) setLoadingCards(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedGame]);

  // Index existing Store singles
  const storeStockIndex = useMemo(() => {
    const exact = new Map<string, StoreProduct>();
    const byCard = new Map<string, { normal: number; foil: number; total: number }>();

    for (const p of products) {
      if (p.category !== 'singles' || p.status === 'archived') continue;
      const attrs = p.attributes && typeof p.attributes === 'object' ? p.attributes : {};
      const cardId = typeof attrs.card_id === 'string' ? attrs.card_id : '';
      if (!cardId) continue;
      const foil = Boolean(attrs.is_foil);
      const cond = normalizeCardCondition(attrs.condition || 'Pack Fresh') as CardCondition;
      const key = `${cardId}::${foil ? '1' : '0'}::${cond}`;
      if (!exact.has(key)) exact.set(key, p);

      const summary = byCard.get(cardId) || { normal: 0, foil: 0, total: 0 };
      const qty = Number(p.stock_quantity || 0);
      if (foil) summary.foil += qty;
      else summary.normal += qty;
      summary.total += qty;
      byCard.set(cardId, summary);
    }
    return { exact, byCard };
  }, [products]);

  // Build exact FilterSidebar options from loaded game cards
  const filterOptions = useMemo(() => {
    const setSet = new Set<string>();
    const raritySet = new Set<string>();
    const typeSet = new Set<string>();
    const domainSet = new Set<string>();
    const tagSet = new Set<string>();

    for (const c of allGameCards) {
      if (c.set_name) setSet.add(c.set_name);
      if (c.rarity) raritySet.add(c.rarity);
      if (c.card_type) typeSet.add(c.card_type);
      if ((c.subtype || '').toLowerCase() === 'champion') typeSet.add('Champion');
      for (const d of parseDomainsList(c.domain)) domainSet.add(d);
      if (Array.isArray(c.tags)) {
        for (const tg of c.tags) {
          if (tg) tagSet.add(String(tg));
        }
      }
    }

    return {
      sets: sortSetNames([...setSet]),
      rarities: [...raritySet].sort((a, b) => (RARITY_RANK[a] ?? 99) - (RARITY_RANK[b] ?? 99)),
      types: [...typeSet].sort((a, b) => a.localeCompare(b)),
      domains: [...domainSet].sort((a, b) => a.localeCompare(b)),
      tags: [...tagSet].sort((a, b) => a.localeCompare(b)),
    };
  }, [allGameCards]);

  // Filter + Sort visible cards using FilterState (FilterSidebar) + search + store filters
  const filteredCards = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const f = catalogFilters;

    const list = allGameCards.filter((c) => {
      if (f.sets.length > 0 && !f.sets.includes(c.set_name || '')) return false;
      if (f.rarities.length > 0 && !f.rarities.includes(c.rarity || '')) return false;

      if (f.type) {
        if (f.type.toLowerCase() === 'champion') {
          if ((c.subtype || '').toLowerCase() !== 'champion') return false;
        } else if ((c.card_type || '') !== f.type) {
          return false;
        }
      }

      if (f.domains.length > 0) {
        const doms = parseDomainsList(c.domain).map((d) => d.toLowerCase());
        if (!f.domains.some((d) => doms.includes(d.toLowerCase()))) return false;
      }

      if (f.keywords && f.keywords.length > 0) {
        const mode = f.keywordMode || 'and';
        const matched =
          mode === 'and'
            ? f.keywords.every((kw) => cardMatchesKeyword(c, kw))
            : f.keywords.some((kw) => cardMatchesKeyword(c, kw));
        if (!matched) return false;
      }

      if (!matchesCardVariants(c, f)) return false;

      if (stockFilter !== 'all') {
        const st = storeStockIndex.byCard.get(c.id)?.total || 0;
        if (stockFilter === 'missing' && st > 0) return false;
        if (stockFilter === 'in_stock' && st <= 0) return false;
      }

      if (onlyPriced) {
        const hasEur = Number(c.market_price_eur) > 0 || Number(c.market_price_foil_eur) > 0;
        if (!hasEur) return false;
      }

      if (q) {
        const hay = [
          c.name,
          c.card_number,
          c.set_name,
          c.set_code,
          c.artist,
          c.rarity,
          c.card_type,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortMode === 'Card Number (Desc)') {
        return (b.card_number || '').localeCompare(a.card_number || '', undefined, { numeric: true });
      }
      if (sortMode === 'Name (A to Z)') {
        return a.name.localeCompare(b.name);
      }
      if (sortMode === 'Rarity (High to Low)') {
        return (RARITY_RANK[b.rarity || ''] ?? 0) - (RARITY_RANK[a.rarity || ''] ?? 0) || a.name.localeCompare(b.name);
      }
      if (sortMode === 'Rarity (Low to High)') {
        return (RARITY_RANK[a.rarity || ''] ?? 0) - (RARITY_RANK[b.rarity || ''] ?? 0) || a.name.localeCompare(b.name);
      }
      if (sortMode === 'Est. Value (High to Low)') {
        const pa = computeBulkSinglePrice(a, false, settings, eurRate).priceHuf;
        const pb = computeBulkSinglePrice(b, false, settings, eurRate).priceHuf;
        return pb - pa || a.name.localeCompare(b.name);
      }
      if (sortMode === 'Est. Value (Low to High)') {
        const pa = computeBulkSinglePrice(a, false, settings, eurRate).priceHuf;
        const pb = computeBulkSinglePrice(b, false, settings, eurRate).priceHuf;
        return pa - pb || a.name.localeCompare(b.name);
      }
      if (sortMode === 'Quantity (High to Low)') {
        const sa = storeStockIndex.byCard.get(a.id)?.total || 0;
        const sb = storeStockIndex.byCard.get(b.id)?.total || 0;
        return sb - sa || a.name.localeCompare(b.name);
      }
      if (sortMode === 'Quantity (Low to High)') {
        const sa = storeStockIndex.byCard.get(a.id)?.total || 0;
        const sb = storeStockIndex.byCard.get(b.id)?.total || 0;
        return sa - sb || a.name.localeCompare(b.name);
      }
      return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
    });

    return sorted;
  }, [
    allGameCards,
    catalogFilters,
    stockFilter,
    onlyPriced,
    searchText,
    sortMode,
    storeStockIndex,
    settings,
    eurRate,
  ]);

  const displayedCards = useMemo(() => filteredCards.slice(0, visibleLimit), [filteredCards, visibleLimit]);

  useEffect(() => {
    setVisibleLimit(60);
  }, [catalogFilters, stockFilter, onlyPriced, searchText, sortMode]);

  const queuedCountByCard = useMemo(() => {
    const map = new Map<string, { normal: number; foil: number }>();
    for (const item of queue) {
      const entry = map.get(item.card.id) || { normal: 0, foil: 0 };
      if (item.isFoil) entry.foil += item.quantity;
      else entry.normal += item.quantity;
      map.set(item.card.id, entry);
    }
    return map;
  }, [queue]);

  const activeFilterCount =
    catalogFilters.sets.length +
    catalogFilters.rarities.length +
    catalogFilters.domains.length +
    catalogFilters.tags.length +
    (catalogFilters.keywords?.length || 0) +
    (catalogFilters.type ? 1 : 0) +
    (catalogFilters.foilFilter ? 1 : 0) +
    (catalogFilters.signedFilter && catalogFilters.signedFilter !== 'all' ? 1 : 0) +
    (catalogFilters.altArtFilter && catalogFilters.altArtFilter !== 'all' ? 1 : 0) +
    (catalogFilters.overnumberedFilter && catalogFilters.overnumberedFilter !== 'all' ? 1 : 0) +
    (catalogFilters.spFilter && catalogFilters.spFilter !== 'all' ? 1 : 0) +
    (catalogFilters.baseSetFilter === 'only' ? 1 : 0) +
    (catalogFilters.costMin > 1 || catalogFilters.costMax < 10 ? 1 : 0) +
    (stockFilter !== 'all' ? 1 : 0) +
    (onlyPriced ? 1 : 0);

  const updateCardQueue = (card: ExtendedBulkCard, isFoil: boolean, delta: number, explicitCond?: CardCondition) => {
    setSaveSummary(null);
    setHelperNotice(null);
    const cond = explicitCond || settings.defaultCondition;
    const uid = `${card.id}::${isFoil ? '1' : '0'}::${cond}`;

    setQueue((prev) => {
      const idx = prev.findIndex((x) => x.uid === uid);
      if (idx >= 0) {
        const nextQty = prev[idx].quantity + delta;
        if (nextQty <= 0) {
          return prev.filter((_, i) => i !== idx);
        }
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: nextQty };
        return copy;
      }

      if (delta <= 0) return prev;
      const computed = computeBulkSinglePrice(card, isFoil, settings, eurRate);
      return [
        {
          uid,
          card,
          isFoil,
          condition: cond,
          quantity: delta,
          priceHuf: computed.priceHuf,
          priceEdited: false,
        },
        ...prev,
      ];
    });
  };

  const addBatchToQueue = (entries: { card: ExtendedBulkCard; isFoil: boolean; condition?: CardCondition; quantity: number }[]) => {
    if (entries.length === 0) return;
    setSaveSummary(null);
    setQueue((prev) => {
      const next = [...prev];
      const addedNew: QueuedSingle[] = [];

      for (const entry of entries) {
        const cond = entry.condition || settings.defaultCondition;
        const qty = Math.max(1, Math.round(entry.quantity || 1));
        const uid = `${entry.card.id}::${entry.isFoil ? '1' : '0'}::${cond}`;
        const existingIdx = next.findIndex((x) => x.uid === uid);
        if (existingIdx >= 0) {
          next[existingIdx] = { ...next[existingIdx], quantity: next[existingIdx].quantity + qty };
        } else {
          const pendingIdx = addedNew.findIndex((x) => x.uid === uid);
          if (pendingIdx >= 0) {
            addedNew[pendingIdx] = { ...addedNew[pendingIdx], quantity: addedNew[pendingIdx].quantity + qty };
          } else {
            const computed = computeBulkSinglePrice(entry.card, entry.isFoil, settings, eurRate);
            addedNew.unshift({
              uid,
              card: entry.card,
              isFoil: entry.isFoil,
              condition: cond,
              quantity: qty,
              priceHuf: computed.priceHuf,
              priceEdited: false,
            });
          }
        }
      }
      return [...addedNew, ...next];
    });
  };

  const applyDefaultsToQueue = () => {
    setQueue((prev) => {
      const merged = new Map<string, QueuedSingle>();
      for (const row of prev) {
        const nextUid = `${row.card.id}::${row.isFoil ? '1' : '0'}::${settings.defaultCondition}`;
        const computed = computeBulkSinglePrice(row.card, row.isFoil, settings, eurRate);
        const existing = merged.get(nextUid);
        if (existing) {
          existing.quantity += row.quantity;
        } else {
          merged.set(nextUid, {
            ...row,
            uid: nextUid,
            condition: settings.defaultCondition,
            priceHuf: computed.priceHuf,
            priceEdited: false,
          });
        }
      }
      return [...merged.values()];
    });
    setHelperNotice(t('Recalculated prices and conditions across queue.', 'Árak és állapotok újraszámolva a várólistán.'));
  };

  const setAllQuantities = (mode: 'set1' | 'set3' | 'plus1') => {
    setQueue((prev) =>
      prev.map((row) => ({
        ...row,
        quantity: mode === 'set1' ? 1 : mode === 'set3' ? 3 : row.quantity + 1,
      }))
    );
  };

  const updateRow = (uid: string, patch: { isFoil?: boolean; condition?: CardCondition; quantity?: number; priceHuf?: number }) => {
    setQueue((prev) => {
      const idx = prev.findIndex((x) => x.uid === uid);
      if (idx < 0) return prev;
      const cur = prev[idx];
      const nextFoil = patch.isFoil ?? cur.isFoil;
      const nextCond = patch.condition ?? cur.condition;
      const nextQty = patch.quantity !== undefined ? Math.max(1, Math.round(patch.quantity)) : cur.quantity;
      const nextPrice =
        patch.priceHuf !== undefined
          ? Math.max(0, Math.round(patch.priceHuf))
          : patch.isFoil !== undefined && !cur.priceEdited
            ? computeBulkSinglePrice(cur.card, nextFoil, settings, eurRate).priceHuf
            : cur.priceHuf;
      const nextEdited = patch.priceHuf !== undefined ? true : cur.priceEdited;
      const nextUid = `${cur.card.id}::${nextFoil ? '1' : '0'}::${nextCond}`;

      const updatedRow: QueuedSingle = {
        ...cur,
        uid: nextUid,
        isFoil: nextFoil,
        condition: nextCond,
        quantity: nextQty,
        priceHuf: nextPrice,
        priceEdited: nextEdited,
      };

      const collisionIdx = prev.findIndex((x, i) => i !== idx && x.uid === nextUid);
      if (collisionIdx >= 0) {
        const copy = [...prev];
        copy[collisionIdx] = { ...copy[collisionIdx], quantity: copy[collisionIdx].quantity + nextQty };
        copy.splice(idx, 1);
        return copy;
      }

      const copy = [...prev];
      copy[idx] = updatedRow;
      return copy;
    });
  };

  const removeRow = (uid: string) => {
    setQueue((prev) => prev.filter((x) => x.uid !== uid));
  };

  const handleParsePaste = () => {
    const rawLines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (rawLines.length === 0) return;

    const byExactNum = new Map<string, ExtendedBulkCard>();
    const byBaseNum = new Map<string, ExtendedBulkCard>();
    const byName = new Map<string, ExtendedBulkCard>();

    for (const c of allGameCards) {
      if (c.card_number) {
        const exactKey = normalizeCodeToken(c.card_number);
        const baseKey = getCardCodeBase(c.card_number);
        if (!byExactNum.has(exactKey)) byExactNum.set(exactKey, c);
        if (baseKey && !byBaseNum.has(baseKey)) byBaseNum.set(baseKey, c);
      }
      const nameKey = c.name.trim().toLowerCase();
      if (!byName.has(nameKey)) byName.set(nameKey, c);
    }

    const toAdd: { card: ExtendedBulkCard; isFoil: boolean; condition: CardCondition; quantity: number }[] = [];
    const unmatched: string[] = [];

    for (const line of rawLines) {
      let work = line.replace(/[;\t]+/g, ' ').trim();
      let qty = 1;

      const leadMatch = work.match(/^(\d+)\s*[xX*]?\s+(.+)$/);
      if (leadMatch) {
        qty = Math.max(1, parseInt(leadMatch[1], 10));
        work = leadMatch[2].trim();
      } else {
        const trailMatch = work.match(/^(.+?)\s+[xX*](\d+)$/) || work.match(/^(.+?)\s+(\d+)[xX*]$/);
        if (trailMatch) {
          qty = Math.max(1, parseInt(trailMatch[2], 10));
          work = trailMatch[1].trim();
        }
      }

      let isFoil = false;
      if (/\b(foil|fólia|folia)\b/i.test(work)) {
        isFoil = true;
        work = work.replace(/\b(foil|fólia|folia)\b/gi, ' ').trim();
      }

      let cond: CardCondition = settings.defaultCondition;
      const condMatch = work.match(/\b(PF|NM|EX|GD|PL|DM|DMG|Pack Fresh|Near Mint|Excellent|Good|Played|Damaged)\b/i);
      if (condMatch) {
        const aliasKey = condMatch[1].toLowerCase().replace(/\s+/g, '');
        cond = COND_ALIAS[aliasKey] || settings.defaultCondition;
        work = work.replace(condMatch[0], ' ').trim();
      }

      work = work.replace(/^[,;\-|]+|[,;\-|]+$/g, '').replace(/\s+/g, ' ').trim();

      const codeNorm = normalizeCodeToken(work);
      const codeBase = codeNorm.split('/')[0];
      let matched = byExactNum.get(codeNorm) || byBaseNum.get(codeBase) || byName.get(work.toLowerCase());

      if (!matched) {
        const firstToken = work.split(/\s+/)[0] || '';
        const tokNorm = normalizeCodeToken(firstToken).split('/')[0];
        matched = byExactNum.get(normalizeCodeToken(firstToken)) || byBaseNum.get(tokNorm);
      }

      if (matched) {
        toAdd.push({ card: matched, isFoil, condition: cond, quantity: qty });
      } else {
        unmatched.push(line);
      }
    }

    if (toAdd.length > 0) {
      addBatchToQueue(toAdd);
    }
    setPasteReport({ added: toAdd.length, unmatched });
    if (toAdd.length > 0 && unmatched.length === 0) {
      setPasteText('');
    }
  };

  const queueStats = useMemo(() => {
    let totalCopies = 0;
    let totalValueHuf = 0;
    let newCount = 0;
    let mergeCount = 0;

    for (const row of queue) {
      totalCopies += row.quantity;
      const existing = settings.mergeExisting ? storeStockIndex.exact.get(row.uid) : undefined;
      const effPrice = existing && !settings.updateExistingPrice ? existing.price_huf : row.priceHuf;
      totalValueHuf += row.quantity * effPrice;
      if (existing) mergeCount += 1;
      else newCount += 1;
    }
    return { totalCopies, totalValueHuf, newCount, mergeCount };
  }, [queue, settings.mergeExisting, settings.updateExistingPrice, storeStockIndex]);

  const handleSave = async () => {
    if (queue.length === 0 || saving) return;
    setSaving(true);
    setSaveSummary(null);
    setSaveProgress({ done: 0, total: queue.length });

    let created = 0;
    let updated = 0;
    let errors = 0;
    let firstError: string | undefined;
    const failedRows: QueuedSingle[] = [];

    for (let i = 0; i < queue.length; i += IMPORT_BATCH_SIZE) {
      const slice = queue.slice(i, i + IMPORT_BATCH_SIZE);
      const res = await storeApi<{
        created?: number;
        updated?: number;
        errors?: number;
        items?: { card_id: string; is_foil: boolean; condition: string; action: 'created' | 'updated' | 'error'; error?: string }[];
        error?: string;
      }>('/api/store/bulk-singles', {
        method: 'POST',
        body: JSON.stringify({
          mergeExisting: settings.mergeExisting,
          updateExistingPrice: settings.updateExistingPrice,
          status: settings.targetStatus,
          items: slice.map((row) => ({
            card_id: row.card.id,
            is_foil: row.isFoil,
            condition: row.condition,
            quantity: row.quantity,
            price_huf: row.priceHuf,
          })),
        }),
      });

      if (!res.ok || !res.data) {
        errors += slice.length;
        if (!firstError) firstError = res.data?.error || t('Request failed', 'Sikertelen kérés');
        failedRows.push(...slice);
      } else {
        created += res.data.created ?? 0;
        updated += res.data.updated ?? 0;
        errors += res.data.errors ?? 0;
        const errItems = (res.data.items || []).filter((it) => it.action === 'error');
        for (const errItem of errItems) {
          if (!firstError && errItem.error) firstError = errItem.error;
          const matchRow = slice.find(
            (r) => r.card.id === errItem.card_id && r.isFoil === errItem.is_foil && r.condition === errItem.condition
          );
          if (matchRow) failedRows.push(matchRow);
        }
      }

      setSaveProgress({ done: Math.min(queue.length, i + slice.length), total: queue.length });
    }

    setSaveSummary({ created, updated, errors, firstError });
    setQueue(failedRows);
    setSaving(false);

    if (created > 0 || updated > 0) {
      onDone();
    }
  };

  const renderFilterSidebarContent = () => (
    <div className="space-y-3">
      {/* Game + Store Stock Quick Controls */}
      <div
        className="rounded-xl p-3 space-y-2.5 border"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="space-y-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('TCG Game', 'Játék')}
          </label>
          <select
            value={selectedGame}
            onChange={(e) => setSelectedGame(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer outline-none"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {GAMES.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('Store Stock', 'Bolti készlet')}
          </span>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
            {([
              ['all', t('All', 'Mind')],
              ['missing', t('Missing', 'Hiányzó')],
              ['in_stock', t('In Store', 'Raktáron')],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStockFilter(key)}
                className="py-1 px-1 rounded text-[11px] font-bold cursor-pointer transition-colors"
                style={
                  stockFilter === key
                    ? { background: 'var(--bg-raised)', color: 'var(--text-primary)' }
                    : { color: 'var(--text-muted)' }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={onlyPriced}
            onChange={(e) => setOnlyPriced(e.target.checked)}
            className="rounded accent-[var(--accent)]"
          />
          <span>{t('Only with Cardmarket price', 'Csak ha van piaci ára')}</span>
        </label>
      </div>

      {/* Exact Shared Catalog FilterSidebar Component */}
      <FilterSidebar
        filters={catalogFilters}
        setFilters={setCatalogFilters}
        options={filterOptions}
      />
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('Bulk Add Single Cards', 'Kártyák hozzáadása a Boltba')}
      className="fixed inset-0 z-[120] w-screen h-dvh flex flex-col overflow-hidden"
      style={{ background: 'var(--bg-page)' }}
    >
      {/* Top Full-Screen Workspace Header */}
      <header
        className="px-4 sm:px-6 py-2.5 border-b shrink-0 flex flex-wrap items-center justify-between gap-2.5"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-surface-2)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {t('Store Admin', 'Vissza')}
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm sm:text-base font-black truncate" style={{ color: 'var(--text-primary)' }}>
              {t('Bulk Singles Catalog Adder', 'Kártyák tömeges hozzáadása')}
            </h1>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: 'var(--accent-muted)', color: 'var(--text-accent)' }}>
              Singles
            </span>
          </div>

          <div className="flex items-center rounded-xl p-0.5 border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => setSourceTab('catalog')}
              className="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors"
              style={
                sourceTab === 'catalog'
                  ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              {t('Visual Catalog', 'Katalógus')}
            </button>
            <button
              type="button"
              onClick={() => setSourceTab('paste')}
              className="px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors"
              style={
                sourceTab === 'paste'
                  ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              {t('Paste List', 'Lista beillesztése')}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {/* Opens Pricing & Floor Rules Popup Modal */}
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
            <span>{t('Pricing & Floor Rules', 'Floor árak & beállítások')}</span>
          </button>

          {sourceTab === 'catalog' && (
            <>
              {/* Desktop toggle */}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                <span>{t('Filters', 'Szűrők')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
              </button>
              {/* Mobile/Tablet FilterDrawer toggle */}
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="inline-flex lg:hidden items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                <span>{t('Filters', 'Szűrők')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setShowQueue((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
            style={
              queue.length > 0
                ? { borderColor: 'var(--positive-border)', background: 'var(--positive-muted)', color: 'var(--positive)' }
                : { borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }
            }
          >
            <span>{t('Queue', 'Várólista')}: {queue.length}</span>
            {queue.length > 0 && <span className="font-mono text-[11px]">({queueStats.totalCopies} db)</span>}
          </button>

          <button
            type="button"
            disabled={saving || queue.length === 0}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black shadow-sm cursor-pointer disabled:opacity-40 active:scale-95"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {t(`Save (${queueStats.totalCopies})`, `Mentés (${queueStats.totalCopies} db)`)}
          </button>
        </div>
      </header>

      {/* Main Full-Screen 3-Pane Body (Opaque solid --bg-page backdrop) */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative" style={{ background: 'var(--bg-page)' }}>
        {/* Left Filter Rail using shared FilterSidebar (Desktop) */}
        {sourceTab === 'catalog' && showFilters && (
          <aside
            className="w-72 xl:w-[295px] shrink-0 border-r overflow-y-auto p-3 custom-scrollbar hidden lg:block"
            style={{ background: 'var(--bg-page)', borderColor: 'var(--border-subtle)' }}
          >
            {renderFilterSidebarContent()}
          </aside>
        )}

        {/* Center Catalog Grid / List or Paste Panel */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ background: 'var(--bg-page)' }}>
          {sourceTab === 'catalog' ? (
            <>
              {/* Catalog Search, Sort & Grid Controls */}
              <div className="px-4 py-2.5 border-b shrink-0 space-y-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <CatalogSearchBar
                    value={searchText}
                    onChange={setSearchText}
                    placeholder={t('Search card name, number (RAD-047), artist...', 'Keresés kártyanév, szám (pl. RAD-047), művész...')}
                    className="min-w-[200px]"
                  />

                  <CatalogSortDropdown value={sortMode} onChange={setSortMode} options={BULK_SORT_OPTIONS} className="w-52 shrink-0 z-30" />

                  {viewMode === 'grid' && <GridSizeSwitcher size={gridSize} onChange={setGridSize} />}

                  <div className="flex items-center p-1 rounded-xl border h-10 sm:h-9 shrink-0" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      title={t('Visual Grid View', 'Katalógus rács nézet')}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer"
                      style={viewMode === 'grid' ? { background: 'var(--bg-raised)', color: 'var(--text-primary)' } : { color: 'var(--text-muted)' }}
                    >
                      {t('Grid', 'Rács')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      title={t('Compact List View', 'Kompakt lista nézet')}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer"
                      style={viewMode === 'list' ? { background: 'var(--bg-raised)', color: 'var(--text-primary)' } : { color: 'var(--text-muted)' }}
                    >
                      {t('List', 'Lista')}
                    </button>
                  </div>
                </div>

                {/* Quick Step Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-2.5 flex-wrap text-xs">
                    <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>
                      {loadingCards
                        ? t('Loading catalog...', 'Katalógus betöltése...')
                        : t(`${filteredCards.length} cards`, `${filteredCards.length} találat`)}
                    </span>

                    <div className="inline-flex items-center rounded-lg border p-0.5 gap-0.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
                      <span className="px-2 text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
                        {t('Click:', 'Kattintás:')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setClickStepMode('one')}
                        className="px-2 py-0.5 rounded text-[11px] font-black cursor-pointer"
                        style={clickStepMode === 'one' ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' } : { color: 'var(--text-secondary)' }}
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() => setClickStepMode('custom')}
                        className="px-2 py-0.5 rounded text-[11px] font-black cursor-pointer"
                        style={clickStepMode === 'custom' ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' } : { color: 'var(--text-secondary)' }}
                      >
                        +Custom
                      </button>
                      {clickStepMode === 'custom' && (
                        <NumericInput
                          value={customClickStep}
                          min={1}
                          max={999}
                          onChangeValue={(v) => setCustomClickStep(v)}
                          ariaLabel={t('Custom click quantity', 'Egyedi darabszám')}
                          className="w-12 px-1.5 py-0.5 rounded border text-center text-[11px] font-black outline-none"
                          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        />
                      )}
                    </div>

                    {helperNotice && (
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--positive)' }}>
                        {helperNotice}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Scrollable Card Grid or List */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-5 custom-scrollbar" style={{ background: 'var(--bg-page)' }}>
                {catalogError && (
                  <div className="p-4 rounded-xl border text-xs mb-4" style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--negative)', background: 'rgba(239,68,68,0.08)' }}>
                    {catalogError}
                  </div>
                )}

                {loadingCards ? (
                  <div className={`grid ${gridSizeClasses(gridSize)}`}>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="rounded-2xl animate-pulse h-72" style={{ background: 'var(--bg-surface-2)' }} />
                    ))}
                  </div>
                ) : filteredCards.length === 0 ? (
                  <div className="p-12 text-center space-y-2">
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                      {t('No cards match your filters', 'Nincs találat a megadott szűrőkre')}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setCatalogFilters(createEmptyFilters(selectedGame));
                        setStockFilter('all');
                        setOnlyPriced(false);
                        setSearchText('');
                      }}
                      className="px-3.5 py-1.5 rounded-xl border text-xs font-bold cursor-pointer"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-accent)', background: 'var(--bg-surface-2)' }}
                    >
                      {t('Clear filters', 'Szűrők törlése')}
                    </button>
                  </div>
                ) : viewMode === 'grid' ? (
                  <>
                    <div className={`grid ${gridSizeClasses(gridSize)}`}>
                      {displayedCards.map((card, i) => {
                        const normalPrice = computeBulkSinglePrice(card, false, settings, eurRate);
                        const foilPrice = computeBulkSinglePrice(card, true, settings, eurRate);
                        const queued = queuedCountByCard.get(card.id);
                        return (
                          <StoreBulkCardTile
                            key={card.id}
                            card={card}
                            storeStock={storeStockIndex.byCard.get(card.id)}
                            queuedNormal={queued?.normal || 0}
                            queuedFoil={queued?.foil || 0}
                            normalPrice={normalPrice}
                            foilPrice={foilPrice}
                            clickStep={clickStep}
                            gridSize={gridSize}
                            priority={i < 10}
                            onUpdateQueue={(c, foil, delta) => updateCardQueue(c, foil, delta)}
                            onPreview={(id) => setPreviewCardId(id)}
                          />
                        );
                      })}
                    </div>

                    {filteredCards.length > visibleLimit && (
                      <div className="flex justify-center mt-6">
                        <button
                          type="button"
                          onClick={() => setVisibleLimit((n) => n + 60)}
                          className="px-5 py-2.5 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)' }}
                        >
                          {t(
                            `Load more (${filteredCards.length - visibleLimit} remaining)`,
                            `További kártyák betöltése (${filteredCards.length - visibleLimit} hátralévő)`
                          )}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  /* Compact List Mode */
                  <div className="space-y-1.5">
                    {displayedCards.map((card) => {
                      const setObj = unwrapSet(card);
                      const stock = storeStockIndex.byCard.get(card.id);
                      const queued = queuedCountByCard.get(card.id);
                      const normalPrice = computeBulkSinglePrice(card, false, settings, eurRate);
                      const foilPrice = computeBulkSinglePrice(card, true, settings, eurRate);
                      const showFoilToggle = card.card_type !== 'Rune' && hasFoilVariant(card);

                      return (
                        <div
                          key={card.id}
                          className="flex items-center justify-between gap-3 p-2 rounded-xl border hover:bg-[var(--bg-surface-2)] transition-colors"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <button
                              type="button"
                              onClick={() => setPreviewCardId(card.id)}
                              className="w-10 h-14 rounded-md overflow-hidden shrink-0 border cursor-pointer hover:opacity-90"
                              style={{ borderColor: 'var(--border)', background: 'var(--bg-raised)' }}
                            >
                              {card.image_path && (
                                <img
                                  {...cardThumbProps(card.image_path, 'avatar')}
                                  alt={card.name}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </button>
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => setPreviewCardId(card.id)}
                                className="text-xs font-black hover:underline text-left truncate block cursor-pointer"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {card.name}
                              </button>
                              <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                <span className="font-mono">{card.card_number || ''}</span>
                                <span>{card.set_name || setObj?.name || ''}</span>
                                <span>· {card.rarity}</span>
                                {stock && stock.total > 0 && (
                                  <span className="font-bold" style={{ color: 'var(--positive)' }}>
                                    · {t('Store:', 'Bolt:')} {stock.normal}N{stock.foil > 0 ? ` / ${stock.foil}F` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="hidden sm:block text-right text-[11px] mr-1">
                              <div className="font-black font-mono" style={{ color: 'var(--positive)' }}>
                                {normalPrice.priceHuf} Ft{showFoilToggle ? ` / ${foilPrice.priceHuf} Ft` : ''}
                              </div>
                              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                {normalPrice.hitFloor ? t('Floor applied', 'Min. ár') : normalPrice.rawMarketHuf ? `Piaci: ~${normalPrice.rawMarketHuf} Ft` : t('Manual', 'Alapár')}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => updateCardQueue(card, false, clickStep)}
                              className="px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer"
                              style={
                                queued?.normal
                                  ? { borderColor: 'var(--positive-border)', background: 'var(--positive-muted)', color: 'var(--positive)' }
                                  : { borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)' }
                              }
                            >
                              +{clickStep} {queued?.normal ? `(${queued.normal})` : 'N'}
                            </button>

                            {showFoilToggle && (
                              <button
                                type="button"
                                onClick={() => updateCardQueue(card, true, clickStep)}
                                className="px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer"
                                style={
                                  queued?.foil
                                    ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.16)', color: '#fbbf24' }
                                    : { borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }
                                }
                              >
                                +{clickStep} {queued?.foil ? `(${queued.foil}F)` : 'F'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {filteredCards.length > visibleLimit && (
                      <div className="flex justify-center pt-4">
                        <button
                          type="button"
                          onClick={() => setVisibleLimit((n) => n + 60)}
                          className="px-5 py-2.5 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)' }}
                        >
                          {t(
                            `Load more (${filteredCards.length - visibleLimit} remaining)`,
                            `További kártyák betöltése (${filteredCards.length - visibleLimit} hátralévő)`
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Paste List Panel */
            <div className="flex-1 flex flex-col p-4 sm:p-6 gap-4 overflow-y-auto max-w-3xl w-full mx-auto">
              <div className="space-y-1">
                <h2 className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
                  {t('Paste Card List (Bulk Import)', 'Kártyalista beillesztése')}
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('Supported formats (one per line):', 'Támogatott formátumok (soronként egy):')}{' '}
                  <span className="font-mono">3 RAD-047 | 4x OGN-104 foil | Fanfare x2 NM | 2x RAD-128 foil PF</span>
                </p>
              </div>

              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={14}
                placeholder={'3 RAD-047\n4x OGN-104 foil\n2x Fanfare NM\nRAD-001'}
                className="w-full p-3.5 rounded-xl border text-xs font-mono outline-none focus:ring-2 focus:ring-[var(--accent)]/40 resize-y min-h-[260px]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />

              <div className="flex items-center justify-between gap-3">
                <select
                  value={selectedGame}
                  onChange={(e) => setSelectedGame(e.target.value)}
                  className="px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  {GAMES.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={loadingCards || !pasteText.trim()}
                  onClick={handleParsePaste}
                  className="px-5 py-2.5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-40"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {t('Match & Add to Queue', 'Feldolgozás és hozzáadás')}
                </button>
              </div>

              {pasteReport && (
                <div className="p-3.5 rounded-xl border text-xs space-y-1.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                  <p className="font-bold" style={{ color: 'var(--positive)' }}>
                    {t(`Matched & queued ${pasteReport.added} line(s).`, `${pasteReport.added} sor felismerve és várólistára téve.`)}
                  </p>
                  {pasteReport.unmatched.length > 0 && (
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--negative)' }}>
                        {t(`Unmatched (${pasteReport.unmatched.length}):`, `Nem található (${pasteReport.unmatched.length}):`)}
                      </p>
                      <ul className="list-disc pl-4 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {pasteReport.unmatched.slice(0, 15).map((u, idx) => (
                          <li key={idx}>{u}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Right Staging Queue Sidebar */}
        {showQueue && (
          <aside
            className="w-full sm:w-[390px] xl:w-[430px] shrink-0 border-l flex flex-col overflow-hidden absolute inset-0 sm:static z-20"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
          >
            <div className="px-4 py-3 border-b shrink-0 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
                    {t('Staging Queue', 'Hozzáadásra váró kártyák')} ({queue.length})
                  </h2>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {t(
                      `${queueStats.totalCopies} copies · ${queueStats.newCount} new · ${queueStats.mergeCount} top-up`,
                      `${queueStats.totalCopies} db · ${queueStats.newCount} új · ${queueStats.mergeCount} készlet növelés`
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {queue.length > 0 && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setQueue([])}
                      className="text-[11px] font-bold underline cursor-pointer disabled:opacity-40"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {t('Clear', 'Ürítés')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowQueue(false)}
                    className="sm:hidden p-1 rounded border"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>

              {queue.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={applyDefaultsToQueue}
                    className="px-2 py-1 rounded-md border text-[10px] font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-accent)', background: 'var(--bg-surface-2)' }}
                  >
                    {t('Recalc prices', 'Árak újraszámolása')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllQuantities('plus1')}
                    className="px-2 py-1 rounded-md border text-[10px] font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-surface-2)' }}
                  >
                    {t('All +1', 'Mind +1')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllQuantities('set3')}
                    className="px-2 py-1 rounded-md border text-[10px] font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-surface-2)' }}
                  >
                    {t('All = 3x', 'Mind 3x')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllQuantities('set1')}
                    className="px-2 py-1 rounded-md border text-[10px] font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-surface-2)' }}
                  >
                    {t('All = 1x', 'Mind 1x')}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {queue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <svg className="w-9 h-9 mb-2 opacity-35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <rect x="3" y="4" width="13" height="17" rx="2" />
                    <path d="M8 2h11a2 2 0 0 1 2 2v15" />
                    <line x1="9.5" y1="10" x2="9.5" y2="15" />
                    <line x1="7" y1="12.5" x2="12" y2="12.5" />
                  </svg>
                  <p className="font-bold" style={{ color: 'var(--text-secondary)' }}>
                    {t('Staging queue is empty', 'A várólista még üres')}
                  </p>
                  <p className="mt-1">
                    {t('Use +1 / +3 Playset on cards in the catalog or paste a card list.', 'Kattints a katalógus kártyáin a +1 / +3 gombokra, vagy illessz be egy listát.')}
                  </p>
                </div>
              ) : (
                queue.map((row) => {
                  const existingMatch = settings.mergeExisting ? storeStockIndex.exact.get(row.uid) : undefined;
                  const computed = computeBulkSinglePrice(row.card, row.isFoil, settings, eurRate);
                  const setObj = unwrapSet(row.card);

                  return (
                    <div
                      key={row.uid}
                      className="p-2.5 rounded-xl border space-y-2"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <button
                            type="button"
                            onClick={() => setPreviewCardId(row.card.id)}
                            className="w-9 h-12 rounded overflow-hidden shrink-0 border cursor-pointer hover:opacity-90"
                            style={{ borderColor: 'var(--border)', background: 'var(--bg-raised)' }}
                            title={t('Open card preview', 'Kártya előnézet')}
                          >
                            {row.card.image_path && (
                              <img
                                {...cardThumbProps(row.card.image_path, 'avatar')}
                                alt={row.card.name}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setPreviewCardId(row.card.id)}
                                className="text-xs font-black truncate hover:underline cursor-pointer text-left"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {row.card.name}
                              </button>
                              <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                                {row.card.card_number || setObj?.code || ''}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                              {existingMatch ? (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.14)', color: 'var(--positive)' }}>
                                  +{row.quantity} {t('Top-up', 'Növelés')} ({existingMatch.stock_quantity} {'->'} {existingMatch.stock_quantity + row.quantity})
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.16)', color: 'var(--text-accent)' }}>
                                  {t('New', 'Új')}
                                </span>
                              )}
                              {computed.rawMarketHuf !== null && (
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                  {t('Market:', 'Piaci:')} ~{computed.rawMarketHuf} Ft
                                </span>
                              )}
                              {computed.hitFloor && !existingMatch && (
                                <span className="text-[10px] font-bold" style={{ color: '#fbbf24' }}>
                                  Floor: {computed.floorApplied} Ft
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeRow(row.uid)}
                          disabled={saving}
                          aria-label={t('Remove', 'Eltávolítás')}
                          className="p-1 rounded hover:bg-[var(--bg-raised)] cursor-pointer shrink-0"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => updateRow(row.uid, { isFoil: !row.isFoil })}
                          className="px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer"
                          style={
                            row.isFoil
                              ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.16)', color: '#fbbf24' }
                              : { borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }
                          }
                        >
                          {row.isFoil ? t('Foil', 'Fóliás') : t('Normal', 'Normál')}
                        </button>

                        <select
                          value={row.condition}
                          disabled={saving}
                          onChange={(e) => updateRow(row.uid, { condition: e.target.value as CardCondition })}
                          className="px-2 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer"
                          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          {CARD_CONDITIONS.map((c) => (
                            <option key={c.id} value={c.id}>
                              {COND_SHORT[c.id]} · {t(c.labelEn, c.labelHu)}
                            </option>
                          ))}
                        </select>

                        <div className="inline-flex items-center rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
                          <button
                            type="button"
                            disabled={saving || row.quantity <= 1}
                            onClick={() => updateRow(row.uid, { quantity: row.quantity - 1 })}
                            className="px-2 py-1 text-xs font-bold cursor-pointer disabled:opacity-40 hover:bg-[var(--bg-raised)]"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            -
                          </button>
                          <NumericInput
                            value={row.quantity}
                            min={1}
                            max={9999}
                            disabled={saving}
                            onChangeValue={(v) => updateRow(row.uid, { quantity: v })}
                            className="w-10 text-center text-xs font-bold bg-transparent outline-none"
                            style={{ color: 'var(--text-primary)' }}
                          />
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => updateRow(row.uid, { quantity: row.quantity + 1 })}
                            className="px-2 py-1 text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            +
                          </button>
                        </div>

                        <div className="ml-auto inline-flex items-center gap-1">
                          <NumericInput
                            value={existingMatch && !settings.updateExistingPrice ? existingMatch.price_huf : row.priceHuf}
                            min={10}
                            disabled={saving || (Boolean(existingMatch) && !settings.updateExistingPrice)}
                            onChangeValue={(v) => updateRow(row.uid, { priceHuf: v })}
                            className="w-20 px-2 py-1 rounded-lg border text-right text-xs font-bold outline-none disabled:opacity-55 focus:ring-2 focus:ring-[var(--accent)]/40"
                            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                          />
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Ft</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sticky Queue Save Footer */}
            <div className="p-3.5 border-t shrink-0 space-y-2.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
              {saving && (
                <div className="space-y-1" role="status" aria-live="polite">
                  <div className="flex justify-between text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    <span>{t('Saving cards to Store...', 'Kártyák mentése a Boltba...')}</span>
                    <span>{saveProgress.done} / {saveProgress.total}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${saveProgress.total ? Math.round((saveProgress.done / saveProgress.total) * 100) : 0}%`,
                        background: 'var(--accent-strong)',
                      }}
                    />
                  </div>
                </div>
              )}

              {saveSummary && (
                <div
                  className="p-2.5 rounded-xl border text-xs space-y-0.5"
                  style={{
                    borderColor: saveSummary.errors > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)',
                    background: saveSummary.errors > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                  }}
                >
                  <p className="font-bold" style={{ color: saveSummary.errors > 0 ? 'var(--negative)' : 'var(--positive)' }}>
                    {t(
                      `Done: ${saveSummary.created} created, ${saveSummary.updated} updated${saveSummary.errors ? `, ${saveSummary.errors} failed` : ''}.`,
                      `Kész: ${saveSummary.created} új, ${saveSummary.updated} frissítve${saveSummary.errors ? `, ${saveSummary.errors} hiba` : ''}.`
                    )}
                  </p>
                  {saveSummary.firstError && (
                    <p className="text-[11px]" style={{ color: 'var(--negative)' }}>{saveSummary.firstError}</p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--text-muted)' }}>{t('Total batch value:', 'Összesített érték:')}</span>
                <strong className="font-mono" style={{ color: 'var(--text-primary)' }}>
                  {queueStats.totalValueHuf.toLocaleString('en-US')} Ft
                </strong>
              </div>

              <button
                type="button"
                disabled={saving || queue.length === 0}
                onClick={handleSave}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black shadow-sm cursor-pointer disabled:opacity-40 active:scale-[0.99]"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t(`Save to Store (${queueStats.totalCopies} copies)`, `Mentés a Boltba (${queueStats.totalCopies} db)`)}
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Shared Catalog FilterDrawer for mobile & tablet */}
      <FilterDrawer
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        title={t('Filters', 'Szűrők')}
        activeCount={activeFilterCount}
        applyLabel={t(`Apply & View ${filteredCards.length} Cards`, `Alkalmazás (${filteredCards.length} kártya)`)}
        zIndex={140}
      >
        {renderFilterSidebarContent()}
      </FilterDrawer>

      {/* Standalone Popup Modal for Pricing & Rarity Floor Rules */}
      <StoreBulkPricingPanel
        settings={settings}
        eurRate={eurRate}
        open={showSettings}
        queueCount={queue.length}
        onChange={updateSettings}
        onApplyToQueue={applyDefaultsToQueue}
        onClose={() => setShowSettings(false)}
      />

      {/* Real Catalog Card Detail & High-Res Preview Modal */}
      <CardPreviewOverlay
        cardId={previewCardId}
        onClose={() => setPreviewCardId(null)}
        zIndex={10000}
      />
    </div>
  );
}
