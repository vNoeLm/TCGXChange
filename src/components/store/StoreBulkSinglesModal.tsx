import { useEffect, useMemo, useState } from 'react';
import type { StoreProduct } from '../../types';
import { CARD_CONDITIONS, normalizeCardCondition, type CardConditionInfo } from '../../lib/collectionDefaults';
import { GAMES, sortSetNames } from '../../lib/constants';
import { useLanguage } from '../../lib/i18n';
import { getEurToHuf } from '../../lib/prices';
import { DEFAULT_EUR_TO_HUF, eurToHuf, roundHuf } from '../../lib/priceSuggestion';
import { IMPORT_BATCH_SIZE } from '../../lib/storeConstants';
import { cardThumbProps, supabase } from '../../lib/supabase';
import { storeApi } from './storeClient';

type CardCondition = CardConditionInfo['id'];

interface SetRow {
  id: string;
  name: string;
  code: string;
  game: string;
  release_date?: string | null;
}

interface CatalogCard {
  id: string;
  set_id: string;
  card_number: string | null;
  name: string;
  rarity: string | null;
  card_type: string | null;
  image_path: string | null;
  game: string;
  market_price_eur: number | null;
  market_price_foil_eur: number | null;
  sets?: { id: string; name: string; code: string; game: string } | { id: string; name: string; code: string; game: string }[] | null;
}

interface QueuedSingle {
  uid: string;
  card: CatalogCard;
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

type PriceMode = 'market' | 'fixed';
type SourceTab = 'catalog' | 'paste';

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

function unwrapSet(card: CatalogCard): { id: string; name: string; code: string; game: string } | null {
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

export default function StoreBulkSinglesModal({ products, onClose, onDone }: Props) {
  const { t } = useLanguage();

  // Global defaults
  const [defaultCondition, setDefaultCondition] = useState<CardCondition>('Pack Fresh');
  const [priceMode, setPriceMode] = useState<PriceMode>('market');
  const [marketPercent, setMarketPercent] = useState<number>(0);
  const [minPriceHuf, setMinPriceHuf] = useState<number>(20);
  const [fixedPriceHuf, setFixedPriceHuf] = useState<number>(50);
  const [mergeExisting, setMergeExisting] = useState<boolean>(true);
  const [updateExistingPrice, setUpdateExistingPrice] = useState<boolean>(false);
  const [targetStatus, setTargetStatus] = useState<'active' | 'draft'>('active');
  const [eurRate, setEurRate] = useState<number>(DEFAULT_EUR_TO_HUF);

  // Source panel state
  const [sourceTab, setSourceTab] = useState<SourceTab>('catalog');
  const [sets, setSets] = useState<SetRow[]>([]);
  const [selectedGame, setSelectedGame] = useState<string>('riftbound');
  const [selectedSetId, setSelectedSetId] = useState<string>('');
  const [rarityFilter, setRarityFilter] = useState<string>('all');
  const [searchText, setSearchText] = useState<string>('');
  const [onlyUnlisted, setOnlyUnlisted] = useState<boolean>(false);

  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [loadingSets, setLoadingSets] = useState<boolean>(true);
  const [loadingCards, setLoadingCards] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Paste list state
  const [pasteText, setPasteText] = useState<string>('');
  const [parsingPaste, setParsingPaste] = useState<boolean>(false);
  const [pasteReport, setPasteReport] = useState<{ added: number; unmatched: string[] } | null>(null);

  // Staging queue & save state
  const [queue, setQueue] = useState<QueuedSingle[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [saveSummary, setSaveSummary] = useState<{ created: number; updated: number; errors: number; firstError?: string } | null>(null);

  useEffect(() => {
    getEurToHuf().then((rate) => {
      if (Number.isFinite(rate) && rate > 0) setEurRate(rate);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Load sets once
  useEffect(() => {
    let cancelled = false;
    setLoadingSets(true);
    supabase
      .from('sets')
      .select('id, name, code, game, release_date')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setCatalogError(error.message);
          setLoadingSets(false);
          return;
        }
        const rows = (data || []) as SetRow[];
        setSets(rows);
        setLoadingSets(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sets filtered by chosen game, sorted canonically
  const gameSets = useMemo(() => {
    const filtered = sets.filter((s) => !selectedGame || s.game === selectedGame);
    const orderedNames = sortSetNames(filtered.map((s) => s.name));
    const rank = new Map(orderedNames.map((n, i) => [n, i]));
    return [...filtered].sort((a, b) => (rank.get(a.name) ?? 999) - (rank.get(b.name) ?? 999));
  }, [sets, selectedGame]);

  // Ensure a default set is picked when game changes (unless user typed a search query)
  useEffect(() => {
    if (gameSets.length === 0) {
      setSelectedSetId('');
      return;
    }
    if (!selectedSetId || !gameSets.some((s) => s.id === selectedSetId)) {
      if (!searchText.trim()) {
        setSelectedSetId(gameSets[gameSets.length - 1].id);
      } else {
        setSelectedSetId('all');
      }
    }
  }, [gameSets, selectedSetId, searchText]);

  // Index existing Store single listings by (card_id, is_foil, condition) and total per card
  const storeStockIndex = useMemo(() => {
    const exact = new Map<string, StoreProduct>();
    const byCard = new Map<string, { normal: number; foil: number }>();

    for (const p of products) {
      if (p.category !== 'singles' || p.status === 'archived') continue;
      const attrs = p.attributes && typeof p.attributes === 'object' ? p.attributes : {};
      const cardId = typeof attrs.card_id === 'string' ? attrs.card_id : '';
      if (!cardId) continue;
      const foil = Boolean(attrs.is_foil);
      const cond = normalizeCardCondition(attrs.condition || 'Pack Fresh') as CardCondition;
      const key = `${cardId}::${foil ? '1' : '0'}::${cond}`;
      if (!exact.has(key)) exact.set(key, p);

      const summary = byCard.get(cardId) || { normal: 0, foil: 0 };
      if (foil) summary.foil += p.stock_quantity || 0;
      else summary.normal += p.stock_quantity || 0;
      byCard.set(cardId, summary);
    }
    return { exact, byCard };
  }, [products]);

  // Fetch catalog cards when game/set/search changes
  useEffect(() => {
    if (sourceTab !== 'catalog') return;
    const trimmedSearch = searchText.trim();
    if (!selectedSetId && !trimmedSearch) return;
    if (selectedSetId === 'all' && !trimmedSearch) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingCards(true);
      setCatalogError(null);
      try {
        let query = supabase
          .from('cards')
          .select('id, set_id, card_number, name, rarity, card_type, image_path, game, market_price_eur, market_price_foil_eur, sets(id, name, code, game)')
          .is('deleted_at', null);

        if (selectedGame) query = query.eq('game', selectedGame);
        if (selectedSetId && selectedSetId !== 'all') {
          query = query.eq('set_id', selectedSetId);
        }
        if (trimmedSearch) {
          const esc = trimmedSearch.replace(/[,%()]/g, ' ').trim();
          if (esc) {
            query = query.or(`name.ilike.%${esc}%,card_number.ilike.%${esc}%`);
          }
        }
        query = query.order('card_number', { ascending: true }).limit(trimmedSearch && selectedSetId === 'all' ? 200 : 1000);

        const { data, error } = await query;
        if (cancelled) return;
        if (error) {
          setCatalogError(error.message);
          setCatalogCards([]);
        } else {
          setCatalogCards((data || []) as CatalogCard[]);
        }
      } finally {
        if (!cancelled) setLoadingCards(false);
      }
    }, trimmedSearch ? 220 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sourceTab, selectedGame, selectedSetId, searchText]);

  const computeSuggestedPrice = (card: CatalogCard, isFoil: boolean, mode = priceMode, pct = marketPercent, minHuf = minPriceHuf, fixedHuf = fixedPriceHuf): number => {
    if (mode === 'fixed') {
      return Math.max(10, Math.round(fixedHuf || 10));
    }
    const rawEur = isFoil ? (card.market_price_foil_eur ?? card.market_price_eur) : card.market_price_eur;
    const eur = Number(rawEur);
    if (!Number.isFinite(eur) || eur <= 0) {
      return Math.max(10, Math.round(minHuf || 20));
    }
    const scaled = eurToHuf(eur, eurRate) * (1 + (pct || 0) / 100);
    return Math.max(Math.max(10, Math.round(minHuf || 10)), roundHuf(scaled));
  };

  const getMarketHint = (card: CatalogCard, isFoil: boolean): number | null => {
    const rawEur = isFoil ? (card.market_price_foil_eur ?? card.market_price_eur) : card.market_price_eur;
    const eur = Number(rawEur);
    if (!Number.isFinite(eur) || eur <= 0) return null;
    return roundHuf(eurToHuf(eur, eurRate));
  };

  const raritiesInLoaded = useMemo(() => {
    const set = new Set<string>();
    for (const c of catalogCards) {
      if (c.rarity) set.add(c.rarity);
    }
    return [...set];
  }, [catalogCards]);

  const visibleCatalogCards = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return catalogCards.filter((c) => {
      if (rarityFilter !== 'all' && (c.rarity || '') !== rarityFilter) return false;
      if (onlyUnlisted) {
        const stock = storeStockIndex.byCard.get(c.id);
        if (stock && (stock.normal > 0 || stock.foil > 0)) return false;
      }
      if (q && selectedSetId !== 'all') {
        const nameMatch = c.name.toLowerCase().includes(q);
        const numMatch = (c.card_number || '').toLowerCase().includes(q);
        if (!nameMatch && !numMatch) return false;
      }
      return true;
    });
  }, [catalogCards, rarityFilter, onlyUnlisted, storeStockIndex, searchText, selectedSetId]);

  // Quick lookup of queued count per card+finish
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

  const addCardsToQueue = (entries: { card: CatalogCard; isFoil: boolean; condition?: CardCondition; quantity: number }[]) => {
    if (entries.length === 0) return;
    setSaveSummary(null);
    setQueue((prev) => {
      const next = [...prev];
      const addedNew: QueuedSingle[] = [];

      for (const entry of entries) {
        const cond = entry.condition || defaultCondition;
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
            addedNew.unshift({
              uid,
              card: entry.card,
              isFoil: entry.isFoil,
              condition: cond,
              quantity: qty,
              priceHuf: computeSuggestedPrice(entry.card, entry.isFoil),
              priceEdited: false,
            });
          }
        }
      }
      return [...addedNew, ...next];
    });
  };

  const handleAddVisible = (isFoil: boolean) => {
    if (visibleCatalogCards.length === 0) return;
    addCardsToQueue(
      visibleCatalogCards.map((card) => ({
        card,
        isFoil,
        condition: defaultCondition,
        quantity: 1,
      }))
    );
  };

  const applyDefaultsToQueue = () => {
    setQueue((prev) => {
      const merged = new Map<string, QueuedSingle>();
      for (const row of prev) {
        const nextUid = `${row.card.id}::${row.isFoil ? '1' : '0'}::${defaultCondition}`;
        const nextPrice = computeSuggestedPrice(row.card, row.isFoil);
        const existing = merged.get(nextUid);
        if (existing) {
          existing.quantity += row.quantity;
        } else {
          merged.set(nextUid, {
            ...row,
            uid: nextUid,
            condition: defaultCondition,
            priceHuf: nextPrice,
            priceEdited: false,
          });
        }
      }
      return [...merged.values()];
    });
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
            ? computeSuggestedPrice(cur.card, nextFoil)
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

      // If changing foil or condition collides with another row in the queue, merge quantities cleanly.
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

  // Parse pasted text lines like "3 RAD-047", "4x OGN-104 foil NM", "Fanfare x2"
  const handleParsePaste = async () => {
    const rawLines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (rawLines.length === 0) return;

    setParsingPaste(true);
    setPasteReport(null);
    try {
      // Load all cards for the selected game (or all games if selectedGame empty)
      let allGameCards: CatalogCard[] = [];
      for (let from = 0; from < 5000; from += 1000) {
        let q = supabase
          .from('cards')
          .select('id, set_id, card_number, name, rarity, card_type, image_path, game, market_price_eur, market_price_foil_eur, sets(id, name, code, game)')
          .is('deleted_at', null)
          .range(from, from + 999);
        if (selectedGame) q = q.eq('game', selectedGame);
        const { data, error } = await q;
        if (error) throw error;
        const batch = (data || []) as CatalogCard[];
        allGameCards.push(...batch);
        if (batch.length < 1000) break;
      }

      const byExactNum = new Map<string, CatalogCard>();
      const byBaseNum = new Map<string, CatalogCard>();
      const byName = new Map<string, CatalogCard>();

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

      const toAdd: { card: CatalogCard; isFoil: boolean; condition: CardCondition; quantity: number }[] = [];
      const unmatched: string[] = [];

      for (const line of rawLines) {
        let work = line.replace(/[;\t]+/g, ' ').trim();
        let qty = 1;

        // Leading quantity: "4x ...", "4 ..."
        const leadMatch = work.match(/^(\d+)\s*[xX*]?\s+(.+)$/);
        if (leadMatch) {
          qty = Math.max(1, parseInt(leadMatch[1], 10));
          work = leadMatch[2].trim();
        } else {
          // Trailing quantity: "... x4" or "... 4x"
          const trailMatch = work.match(/^(.+?)\s+[xX*](\d+)$/) || work.match(/^(.+?)\s+(\d+)[xX*]$/);
          if (trailMatch) {
            qty = Math.max(1, parseInt(trailMatch[2], 10));
            work = trailMatch[1].trim();
          }
        }

        // Extract foil keyword
        let isFoil = false;
        if (/\b(foil|fólia|folia)\b/i.test(work)) {
          isFoil = true;
          work = work.replace(/\b(foil|fólia|folia)\b/gi, ' ').trim();
        }

        // Extract optional condition keyword
        let cond: CardCondition = defaultCondition;
        const condMatch = work.match(/\b(PF|NM|EX|GD|PL|DM|DMG|Pack Fresh|Near Mint|Excellent|Good|Played|Damaged)\b/i);
        if (condMatch) {
          const aliasKey = condMatch[1].toLowerCase().replace(/\s+/g, '');
          cond = COND_ALIAS[aliasKey] || defaultCondition;
          work = work.replace(condMatch[0], ' ').trim();
        }

        work = work.replace(/^[,;\-|]+|[,;\-|]+$/g, '').replace(/\s+/g, ' ').trim();

        const codeNorm = normalizeCodeToken(work);
        const codeBase = codeNorm.split('/')[0];
        let matched =
          byExactNum.get(codeNorm) ||
          byBaseNum.get(codeBase) ||
          byName.get(work.toLowerCase());

        if (!matched) {
          // Check if the line starts with a card code like "RAD-047 Fanfare"
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
        addCardsToQueue(toAdd);
      }
      setPasteReport({ added: toAdd.length, unmatched });
      if (toAdd.length > 0 && unmatched.length === 0) {
        setPasteText('');
      }
    } catch (err: any) {
      setPasteReport({ added: 0, unmatched: [err?.message || 'Search failed'] });
    } finally {
      setParsingPaste(false);
    }
  };

  // Totals & preview metrics
  const queueStats = useMemo(() => {
    let totalCopies = 0;
    let totalValueHuf = 0;
    let newCount = 0;
    let mergeCount = 0;

    for (const row of queue) {
      totalCopies += row.quantity;
      totalValueHuf += row.quantity * row.priceHuf;
      if (mergeExisting && storeStockIndex.exact.has(row.uid)) {
        mergeCount += 1;
      } else {
        newCount += 1;
      }
    }
    return { totalCopies, totalValueHuf, newCount, mergeCount };
  }, [queue, mergeExisting, storeStockIndex]);

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
          mergeExisting,
          updateExistingPrice,
          status: targetStatus,
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

  const inputClass = 'px-2.5 py-1.5 rounded-lg border text-xs font-medium outline-none focus:ring-2 focus:ring-[var(--accent)]/40';
  const inputStyle = { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

  return (
    <div className="fixed inset-0 z-[120] flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-xs" onClick={() => !saving && onClose()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Bulk Add Single Cards', 'Kártyák tömeges hozzáadása')}
        className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden z-10 my-2"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>
                {t('Bulk Add Single Cards', 'Kártyák hozzáadása a Boltba')}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: 'rgba(139,92,246,0.16)', color: 'var(--text-accent)' }}>
                Singles
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {t(
                'Browse sets or paste a card list, auto-price from Cardmarket FX rates, and create or top up Store listings in one batch.',
                'Böngéssz szettekben vagy illessz be egy listát, árazz automatikusan Cardmarket árfolyam alapján, és mentsd el egyszerre a Boltba.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={t('Close', 'Bezárás')}
            className="p-1.5 rounded-lg border cursor-pointer hover:bg-[var(--bg-raised)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Global Defaults Strip */}
        <div className="px-5 py-3 border-b shrink-0 space-y-2.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {t('Condition', 'Állapot')}
              </label>
              <select
                value={defaultCondition}
                onChange={(e) => setDefaultCondition(e.target.value as CardCondition)}
                className={`${inputClass} cursor-pointer`}
                style={inputStyle}
              >
                {CARD_CONDITIONS.map((c) => (
                  <option key={c.id} value={c.id}>{t(c.labelEn, c.labelHu)}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {t('Pricing', 'Árazás')}
              </label>
              <select
                value={priceMode}
                onChange={(e) => setPriceMode(e.target.value as PriceMode)}
                className={`${inputClass} cursor-pointer`}
                style={inputStyle}
              >
                <option value="market">{t('Cardmarket Market Price', 'Cardmarket piaci ár')} ({Math.round(eurRate)} Ft/€)</option>
                <option value="fixed">{t('Fixed Bulk Price', 'Fix darabár')}</option>
              </select>
            </div>

            {priceMode === 'market' ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>%</span>
                  <input
                    type="number"
                    value={marketPercent}
                    onChange={(e) => setMarketPercent(Number(e.target.value) || 0)}
                    className={`${inputClass} w-16 text-center`}
                    style={inputStyle}
                    title={t('Percentage adjustment over Cardmarket price', 'Százalékos módosítás a piaci árhoz képest')}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Min Ft</span>
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={minPriceHuf}
                    onChange={(e) => setMinPriceHuf(Math.max(10, Number(e.target.value) || 10))}
                    className={`${inputClass} w-16 text-center`}
                    style={inputStyle}
                  />
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={10}
                  step={5}
                  value={fixedPriceHuf}
                  onChange={(e) => setFixedPriceHuf(Math.max(10, Number(e.target.value) || 10))}
                  className={`${inputClass} w-20 text-center`}
                  style={inputStyle}
                />
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Ft</span>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {t('Status', 'Státusz')}
              </label>
              <select
                value={targetStatus}
                onChange={(e) => setTargetStatus(e.target.value as 'active' | 'draft')}
                className={`${inputClass} cursor-pointer`}
                style={inputStyle}
              >
                <option value="active">{t('Active in Store', 'Aktív a boltban')}</option>
                <option value="draft">{t('Draft', 'Vázlat')}</option>
              </select>
            </div>

            {queue.length > 0 && (
              <button
                type="button"
                onClick={applyDefaultsToQueue}
                className="ml-auto px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-accent)', background: 'var(--bg-surface)' }}
              >
                {t('Apply to queued rows', 'Alkalmaz a várólistára')}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs">
            <label className="inline-flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={mergeExisting}
                onChange={(e) => setMergeExisting(e.target.checked)}
                className="rounded accent-[var(--accent)]"
              />
              <span>
                {t('Merge matching Store stock (same card, finish & condition adds quantity)', 'Meglévő bolti készlet növelése (azonos kártya, fólia és állapot esetén)')}
              </span>
            </label>
            {mergeExisting && (
              <label className="inline-flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  checked={updateExistingPrice}
                  onChange={(e) => setUpdateExistingPrice(e.target.checked)}
                  className="rounded accent-[var(--accent)]"
                />
                <span>{t('Also overwrite price on existing listings', 'Meglévő termékek árát is írja felül')}</span>
              </label>
            )}
          </div>
        </div>

        {/* Two-panel Body */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] divide-y lg:divide-y-0 lg:divide-x overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
          {/* Left Panel: Catalog or Paste */}
          <div className="flex flex-col min-h-0 overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
            {/* Source Tabs */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setSourceTab('catalog')}
                className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                style={
                  sourceTab === 'catalog'
                    ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                    : { color: 'var(--text-secondary)', background: 'var(--bg-surface-2)' }
                }
              >
                {t('Catalog Browser', 'Katalógus kereső')}
              </button>
              <button
                type="button"
                onClick={() => setSourceTab('paste')}
                className="px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors"
                style={
                  sourceTab === 'paste'
                    ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                    : { color: 'var(--text-secondary)', background: 'var(--bg-surface-2)' }
                }
              >
                {t('Paste Card List', 'Lista beillesztése')}
              </button>
            </div>

            {sourceTab === 'catalog' ? (
              <>
                {/* Catalog Filter Bar */}
                <div className="px-4 py-2.5 border-b space-y-2 shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      value={selectedGame}
                      onChange={(e) => {
                        setSelectedGame(e.target.value);
                        setSelectedSetId('');
                        setRarityFilter('all');
                      }}
                      className={`${inputClass} cursor-pointer`}
                      style={inputStyle}
                    >
                      {GAMES.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>

                    <select
                      value={selectedSetId}
                      onChange={(e) => {
                        setSelectedSetId(e.target.value);
                        setRarityFilter('all');
                      }}
                      disabled={loadingSets}
                      className={`${inputClass} cursor-pointer`}
                      style={inputStyle}
                    >
                      <option value="all">{t('All sets (search)', 'Összes szett (keresés)')}</option>
                      {gameSets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.code})
                        </option>
                      ))}
                    </select>

                    <select
                      value={rarityFilter}
                      onChange={(e) => setRarityFilter(e.target.value)}
                      className={`${inputClass} cursor-pointer`}
                      style={inputStyle}
                    >
                      <option value="all">{t('All rarities', 'Minden ritkaság')}</option>
                      {raritiesInLoaded.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[160px]">
                      <input
                        type="search"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder={t('Search name or number (e.g. RAD-047)...', 'Név vagy kártyaszám (pl. RAD-047)...')}
                        className={`${inputClass} w-full pl-8`}
                        style={inputStyle}
                      />
                      <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx="11" cy="11" r="7" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </div>

                    <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={onlyUnlisted}
                        onChange={(e) => setOnlyUnlisted(e.target.checked)}
                        className="rounded accent-[var(--accent)]"
                      />
                      <span>{t('Not in store', 'Csak hiányzók')}</span>
                    </label>
                  </div>

                  {/* Bulk Filtered Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {loadingCards
                        ? t('Loading cards...', 'Kártyák betöltése...')
                        : t(`${visibleCatalogCards.length} cards shown`, `${visibleCatalogCards.length} kártya látható`)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={loadingCards || visibleCatalogCards.length === 0}
                        onClick={() => handleAddVisible(false)}
                        className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-40 hover:bg-[var(--bg-raised)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-surface-2)' }}
                      >
                        {t('+1 Normal (All)', '+1 Normál (Összes)')}
                      </button>
                      <button
                        type="button"
                        disabled={loadingCards || visibleCatalogCards.length === 0}
                        onClick={() => handleAddVisible(true)}
                        className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer disabled:opacity-40 hover:bg-[var(--bg-raised)]"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-accent)', background: 'var(--bg-surface-2)' }}
                      >
                        {t('+1 Foil (All)', '+1 Fólia (Összes)')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Catalog Cards List */}
                <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-[260px]">
                  {catalogError && (
                    <div className="p-3 rounded-xl border text-xs" style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--negative)', background: 'rgba(239,68,68,0.08)' }}>
                      {catalogError}
                    </div>
                  )}

                  {selectedSetId === 'all' && !searchText.trim() && (
                    <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t('Choose a set or type a card name / number to search across all sets.', 'Válassz egy szettet vagy írj be nevet / kártyaszámot a kereséshez.')}
                    </div>
                  )}

                  {!loadingCards && visibleCatalogCards.length === 0 && (selectedSetId !== 'all' || searchText.trim()) && (
                    <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t('No matching cards found.', 'Nincs találat a szűrőkre.')}
                    </div>
                  )}

                  {visibleCatalogCards.map((card) => {
                    const setObj = unwrapSet(card);
                    const stock = storeStockIndex.byCard.get(card.id);
                    const queued = queuedCountByCard.get(card.id);
                    const normalSuggested = computeSuggestedPrice(card, false);
                    const foilSuggested = computeSuggestedPrice(card, true);

                    return (
                      <div
                        key={card.id}
                        className="flex items-center justify-between gap-2.5 p-2 rounded-xl border transition-colors hover:bg-[var(--bg-surface-2)]"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-12 rounded-md overflow-hidden shrink-0 border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-raised)' }}>
                            {card.image_path && (
                              <img
                                {...cardThumbProps(card.image_path, 'avatar')}
                                alt={card.name}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                                {card.name}
                              </span>
                              {card.card_number && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)' }}>
                                  {card.card_number}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                              <span>{setObj?.code || setObj?.name || ''}</span>
                              {card.rarity && <span>· {card.rarity}</span>}
                              {stock && (stock.normal > 0 || stock.foil > 0) && (
                                <span className="font-semibold" style={{ color: 'var(--positive)' }}>
                                  · {t('In store:', 'Raktár:')} {stock.normal > 0 ? `${stock.normal}N` : ''}{stock.normal > 0 && stock.foil > 0 ? ' / ' : ''}{stock.foil > 0 ? `${stock.foil}F` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => addCardsToQueue([{ card, isFoil: false, condition: defaultCondition, quantity: 1 }])}
                            className="px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer active:scale-95 transition-transform"
                            style={
                              queued && queued.normal > 0
                                ? { borderColor: 'var(--accent)', background: 'rgba(139,92,246,0.16)', color: 'var(--text-accent)' }
                                : { borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-primary)' }
                            }
                            title={t(`Add 1 Normal (~${normalSuggested} Ft)`, `1 Normál hozzáadása (~${normalSuggested} Ft)`)}
                          >
                            +1 N {queued?.normal ? `(${queued.normal})` : `· ${normalSuggested}Ft`}
                          </button>
                          <button
                            type="button"
                            onClick={() => addCardsToQueue([{ card, isFoil: true, condition: defaultCondition, quantity: 1 }])}
                            className="px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer active:scale-95 transition-transform"
                            style={
                              queued && queued.foil > 0
                                ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.16)', color: '#fbbf24' }
                                : { borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }
                            }
                            title={t(`Add 1 Foil (~${foilSuggested} Ft)`, `1 Fólia hozzáadása (~${foilSuggested} Ft)`)}
                          >
                            +1 F {queued?.foil ? `(${queued.foil})` : `· ${foilSuggested}Ft`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* Paste List Tab */
              <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto">
                <div className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                  <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    {t('Supported formats (one card per line):', 'Támogatott formátumok (soronként egy kártya):')}
                  </p>
                  <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    3 RAD-047 | 4x OGN-104 foil | Fanfare x2 NM | 2x RAD-128 foil PF
                  </p>
                </div>

                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={11}
                  placeholder={'3 RAD-047\n4x OGN-104 foil\n2x Fanfare NM\nRAD-001'}
                  className={`${inputClass} w-full font-mono flex-1 min-h-[200px] resize-y`}
                  style={inputStyle}
                />

                <div className="flex items-center justify-between gap-2">
                  <select
                    value={selectedGame}
                    onChange={(e) => setSelectedGame(e.target.value)}
                    className={`${inputClass} cursor-pointer`}
                    style={inputStyle}
                  >
                    {GAMES.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={parsingPaste || !pasteText.trim()}
                    onClick={handleParsePaste}
                    className="px-4 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-40"
                    style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                  >
                    {parsingPaste ? t('Matching cards...', 'Kártyák keresése...') : t('Match & Add to Queue', 'Feldolgozás és hozzáadás')}
                  </button>
                </div>

                {pasteReport && (
                  <div className="p-3 rounded-xl border text-xs space-y-1" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                    <p className="font-bold" style={{ color: 'var(--positive)' }}>
                      {t(`Matched & queued ${pasteReport.added} line(s).`, `${pasteReport.added} sor felismerve és hozzáadva.`)}
                    </p>
                    {pasteReport.unmatched.length > 0 && (
                      <div>
                        <p className="font-semibold" style={{ color: 'var(--negative)' }}>
                          {t(`Unmatched (${pasteReport.unmatched.length}):`, `Nem található (${pasteReport.unmatched.length}):`)}
                        </p>
                        <ul className="list-disc pl-4 mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {pasteReport.unmatched.slice(0, 12).map((u, idx) => (
                            <li key={idx}>{u}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Panel: Staging Queue */}
          <div className="flex flex-col min-h-0 overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide" style={{ color: 'var(--text-primary)' }}>
                  {t('Staging Queue', 'Hozzáadásra váró kártyák')} ({queue.length})
                </h3>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    `${queueStats.totalCopies} copies · ${queueStats.newCount} new · ${queueStats.mergeCount} top-up`,
                    `${queueStats.totalCopies} db összesen · ${queueStats.newCount} új · ${queueStats.mergeCount} készlet növelés`
                  )}
                </p>
              </div>
              {queue.length > 0 && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setQueue([])}
                  className="text-[11px] font-bold underline cursor-pointer disabled:opacity-40"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('Clear queue', 'Lista ürítése')}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[240px]">
              {queue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <svg className="w-8 h-8 mb-2 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                    <rect x="3" y="4" width="13" height="17" rx="2" />
                    <path d="M8 2h11a2 2 0 0 1 2 2v15" />
                    <line x1="9.5" y1="10" x2="9.5" y2="15" />
                    <line x1="7" y1="12.5" x2="12" y2="12.5" />
                  </svg>
                  <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {t('Your staging queue is empty', 'A várólista üres')}
                  </p>
                  <p className="mt-1">
                    {t('Click +1 N or +1 F on any card on the left, or paste a list.', 'Kattints bal oldalon bármelyik kártyán a +1 N vagy +1 F gombra, vagy illessz be egy listát.')}
                  </p>
                </div>
              ) : (
                queue.map((row) => {
                  const existingMatch = mergeExisting ? storeStockIndex.exact.get(row.uid) : undefined;
                  const marketHint = getMarketHint(row.card, row.isFoil);
                  const setObj = unwrapSet(row.card);

                  return (
                    <div
                      key={row.uid}
                      className="p-2.5 rounded-xl border space-y-2"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-11 rounded overflow-hidden shrink-0 border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-raised)' }}>
                            {row.card.image_path && (
                              <img
                                {...cardThumbProps(row.card.image_path, 'avatar')}
                                alt={row.card.name}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                                {row.card.name}
                              </span>
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
                                  {t('New listing', 'Új termék')}
                                </span>
                              )}
                              {marketHint !== null && (
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                  {t('Market:', 'Piaci:')} ~{marketHint} Ft
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
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Normal / Foil toggle */}
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

                        {/* Condition select */}
                        <select
                          value={row.condition}
                          disabled={saving}
                          onChange={(e) => updateRow(row.uid, { condition: e.target.value as CardCondition })}
                          className="px-2 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer"
                          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          {CARD_CONDITIONS.map((c) => (
                            <option key={c.id} value={c.id}>{COND_SHORT[c.id]} · {t(c.labelEn, c.labelHu)}</option>
                          ))}
                        </select>

                        {/* Qty Stepper */}
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
                          <input
                            type="number"
                            min={1}
                            disabled={saving}
                            value={row.quantity}
                            onChange={(e) => updateRow(row.uid, { quantity: Math.max(1, parseInt(e.target.value || '1', 10)) })}
                            className="w-11 text-center text-xs font-bold bg-transparent outline-none"
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

                        {/* Price HUF */}
                        <div className="ml-auto inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={10}
                            step={5}
                            disabled={saving || (Boolean(existingMatch) && !updateExistingPrice)}
                            value={existingMatch && !updateExistingPrice ? existingMatch.price_huf : row.priceHuf}
                            onChange={(e) => updateRow(row.uid, { priceHuf: Number(e.target.value) || 0 })}
                            className="w-20 px-2 py-1 rounded-lg border text-right text-xs font-bold outline-none disabled:opacity-55"
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
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t shrink-0 space-y-2.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
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
              className="p-2.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2"
              style={{
                borderColor: saveSummary.errors > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)',
                background: saveSummary.errors > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
              }}
            >
              <span className="font-bold" style={{ color: saveSummary.errors > 0 ? 'var(--negative)' : 'var(--positive)' }}>
                {t(
                  `Done: ${saveSummary.created} created, ${saveSummary.updated} stock updated${saveSummary.errors ? `, ${saveSummary.errors} failed` : ''}.`,
                  `Kész: ${saveSummary.created} új termék létrehozva, ${saveSummary.updated} készlet növelve${saveSummary.errors ? `, ${saveSummary.errors} sikertelen` : ''}.`
                )}
              </span>
              {saveSummary.firstError && (
                <span className="text-[11px]" style={{ color: 'var(--negative)' }}>{saveSummary.firstError}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {queue.length > 0 && (
                <span>
                  {t('Estimated inventory value:', 'Becsült készletérték:')}{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {queueStats.totalValueHuf.toLocaleString('en-US')} Ft
                  </strong>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {t('Close', 'Bezárás')}
              </button>
              <button
                type="button"
                disabled={saving || queue.length === 0}
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shadow-sm cursor-pointer disabled:opacity-40 active:scale-95"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t(`Save to Store (${queueStats.totalCopies})`, `Mentés a Boltba (${queueStats.totalCopies} db)`)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
