import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogCard, FilterState } from '../../types';
import { fetchCardsCatalog } from '../../lib/api';
import { useCardValueData } from '../../lib/cardValues';
import { useCurrency } from '../../lib/currency';
import { deckValueHuf } from '../../lib/deckBoard';
import { cardThumbProps } from '../../lib/supabase';
import { browsePublicDecks, type PublicDeckSummary } from '../../lib/publicDecks';
import { useLanguage } from '../../lib/i18n';

const DOMAIN_OPTIONS: { id: string; label: string; color: string }[] = [
  { id: 'fury', label: 'Fury', color: '#ef4444' },
  { id: 'calm', label: 'Calm', color: '#22c55e' },
  { id: 'mind', label: 'Mind', color: '#3b82f6' },
  { id: 'body', label: 'Body', color: '#f97316' },
  { id: 'chaos', label: 'Chaos', color: '#a855f7' },
  { id: 'order', label: 'Order', color: '#eab308' },
];

const DEFAULT_CATALOG_FILTERS: FilterState = {
  sets: [],
  rarities: [],
  type: '',
  domains: [],
  tags: [],
  costMin: 1,
  costMax: 10,
  stockStatus: 'Any',
};

const PAGE_SIZE = 24;

type DeckSortMode = 'newest' | 'updated' | 'name' | 'price_asc' | 'price_desc';

export function DeckBrowserApp() {
  const { t, lang } = useLanguage();
  const { formatPrice } = useCurrency();
  const values = useCardValueData();

  const [decks, setDecks] = useState<PublicDeckSummary[]>([]);
  const [count, setCount] = useState(0);
  const game = 'riftbound';

  const [search, setSearch] = useState('');
  const [legendId, setLegendId] = useState('');
  const [championId, setChampionId] = useState('');
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [containsCards, setContainsCards] = useState<CatalogCard[]>([]);
  const [cardQuery, setCardQuery] = useState('');
  const [cardDropdownOpen, setCardDropdownOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [minCost, setMinCost] = useState('');
  const [maxCost, setMaxCost] = useState('');
  const [sort, setSort] = useState<DeckSortMode>('newest');

  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deckArtView, setDeckArtView] = useState<Record<string, 'legend' | 'champion'>>({});
  const cardSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCardsCatalog({ ...DEFAULT_CATALOG_FILTERS, game }, '')
      .then((res) => {
        if (!cancelled) setCatalogCards(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [game]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (cardSearchRef.current && !cardSearchRef.current.contains(e.target as Node)) {
        setCardDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const legends = useMemo(() => {
    return catalogCards
      .filter((c) => (c.card_type || '').toLowerCase() === 'legend')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogCards]);

  const champions = useMemo(() => {
    const selectedLegend = legendId ? legends.find((l) => l.id === legendId) : null;
    const legendBaseName = selectedLegend?.name ? selectedLegend.name.split(/,| - /)[0].trim().toLowerCase() : '';
    return catalogCards
      .filter((c) => {
        if ((c.card_type || '').toLowerCase() !== 'unit') return false;
        if (legendBaseName) {
          const tags = (c.tags || []).map((tag) => tag.toLowerCase());
          return tags.includes(legendBaseName) || c.name.toLowerCase().startsWith(legendBaseName);
        }
        return c.name.includes(' - ') || c.name.includes(', ');
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogCards, legends, legendId]);

  const cardSuggestions = useMemo(() => {
    const q = cardQuery.trim().toLowerCase();
    if (!q) return [];
    const chosenIds = new Set(containsCards.map((c) => c.id));
    return catalogCards
      .filter(
        (c) =>
          !chosenIds.has(c.id) &&
          (c.name.toLowerCase().includes(q) || (c.card_number || '').toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [catalogCards, cardQuery, containsCards]);

  useEffect(() => {
    setHighlightIdx(0);
  }, [cardQuery, cardSuggestions.length]);

  const addContainsCard = (card: CatalogCard) => {
    setContainsCards((prev) => (prev.some((c) => c.id === card.id) ? prev : [...prev, card]));
    setCardQuery('');
    setHighlightIdx(0);
    setCardDropdownOpen(false);
  };

  const handleCardSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (cardSuggestions.length > 0) {
        e.preventDefault();
        setCardDropdownOpen(true);
        setHighlightIdx((i) => Math.min(cardSuggestions.length - 1, i + 1));
      }
    } else if (e.key === 'ArrowUp') {
      if (cardSuggestions.length > 0) {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(0, i - 1));
      }
    } else if (e.key === 'Enter') {
      if (cardSuggestions.length > 0) {
        e.preventDefault();
        const target = cardSuggestions[highlightIdx] || cardSuggestions[0];
        if (target) addContainsCard(target);
      }
    } else if (e.key === 'Escape') {
      setCardDropdownOpen(false);
    }
  };

  const containsKey = useMemo(() => containsCards.map((c) => c.id).join(','), [containsCards]);
  const domainsKey = useMemo(() => selectedDomains.join(','), [selectedDomains]);
  const clientCostActive = Boolean(
    minCost.trim() || maxCost.trim() || sort === 'price_asc' || sort === 'price_desc'
  );

  useEffect(() => {
    setPage(1);
  }, [search, legendId, championId, containsKey, domainsKey, minCost, maxCost, sort]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const apiSort: 'newest' | 'updated' | 'name' =
      sort === 'price_asc' || sort === 'price_desc' ? 'newest' : sort;
    const handle = setTimeout(async () => {
      const result = await browsePublicDecks({
        game,
        search,
        legend: legendId || undefined,
        champion: championId || undefined,
        contains: containsCards.map((c) => c.id),
        domains: selectedDomains,
        sort: apiSort,
        page: clientCostActive ? 1 : page,
        pageSize: clientCostActive ? 200 : PAGE_SIZE,
      });
      if (!cancelled) {
        setDecks((prev) => (clientCostActive || page === 1 ? result.data : [...prev, ...result.data]));
        setCount(result.count);
        setLoading(false);
      }
    }, search ? 280 : 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [game, search, legendId, championId, containsKey, domainsKey, sort, page, clientCostActive]);

  const deckCosts = useMemo(() => {
    const map = new Map<string, number>();
    if (catalogCards.length === 0) return map;
    for (const d of decks) {
      if (d.deck) {
        map.set(d.id, deckValueHuf(d.deck, catalogCards, values));
      }
    }
    return map;
  }, [decks, catalogCards, values]);

  const visibleDecks = useMemo(() => {
    const minVal = minCost.trim() ? Number(minCost) : null;
    const maxVal = maxCost.trim() ? Number(maxCost) : null;
    const hasMin = minVal !== null && Number.isFinite(minVal);
    const hasMax = maxVal !== null && Number.isFinite(maxVal);

    let list = decks;
    if ((hasMin || hasMax) && catalogCards.length > 0) {
      list = list.filter((d) => {
        const cost = deckCosts.get(d.id) ?? 0;
        if (hasMin && cost < minVal!) return false;
        if (hasMax && cost > maxVal!) return false;
        return true;
      });
    }

    if ((sort === 'price_asc' || sort === 'price_desc') && catalogCards.length > 0) {
      list = [...list].sort((a, b) => {
        const costA = deckCosts.get(a.id) ?? 0;
        const costB = deckCosts.get(b.id) ?? 0;
        return sort === 'price_asc' ? costA - costB : costB - costA;
      });
    }

    return list;
  }, [decks, minCost, maxCost, sort, deckCosts, catalogCards.length]);

  const displayCount = clientCostActive ? visibleDecks.length : count;
  const hasMore = !clientCostActive && decks.length < count;
  const hasActiveFilters = Boolean(
    search.trim() ||
      legendId ||
      championId ||
      selectedDomains.length > 0 ||
      containsCards.length > 0 ||
      minCost.trim() ||
      maxCost.trim() ||
      sort !== 'newest'
  );

  const clearFilters = () => {
    setSearch('');
    setLegendId('');
    setChampionId('');
    setSelectedDomains([]);
    setContainsCards([]);
    setCardQuery('');
    setMinCost('');
    setMaxCost('');
    setSort('newest');
  };

  const toggleDomain = (id: string) => {
    setSelectedDomains((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,3vw,32px)' }}>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>
            {t('Deck Browser', 'Pakliböngésző')}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {t(
              'Decks the community has published publicly from the Deck Builder.',
              'A közösség által közzétett paklik a Pakliépítőből.'
            )}
          </p>
        </div>
        <div className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
          {displayCount} {t(displayCount === 1 ? 'deck' : 'decks', 'pakli')}
        </div>
      </div>

      {/* Search & Filters */}
      <div
        className="rounded-2xl border p-3.5 sm:p-4 mb-6 space-y-3"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <svg
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-muted)' }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(
                'Search by deck name, creator, legend, champion or card...',
                'Keresés paklinév, készítő, legenda, bajnok vagy kártya alapján...'
              )}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl text-sm outline-none border"
              style={{
                background: 'var(--bg-input, var(--bg-surface-2))',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as DeckSortMode)}
            aria-label={t('Sort decks', 'Paklik rendezése')}
            className="px-3 py-2 rounded-xl text-xs font-bold border outline-none cursor-pointer"
            style={{
              background: 'var(--bg-input, var(--bg-surface-2))',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="newest">{t('Newest', 'Legújabb')}</option>
            <option value="updated">{t('Recently updated', 'Legutóbb frissített')}</option>
            <option value="name">{t('Name (A-Z)', 'Név (A-Z)')}</option>
            <option value="price_asc">{t('Deck Cost: Low to High', 'Pakliérték: Olcsóbb elöl')}</option>
            <option value="price_desc">{t('Deck Cost: High to Low', 'Pakliérték: Drágább elöl')}</option>
          </select>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer transition hover:border-[var(--border-hover)]"
              style={{
                background: 'var(--bg-surface-2)',
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              {t('Clear filters', 'Szűrők törlése')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <select
            value={legendId}
            onChange={(e) => {
              setLegendId(e.target.value);
              setChampionId('');
            }}
            aria-label={t('Filter by Legend', 'Szűrés Legendára')}
            className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none cursor-pointer"
            style={{
              background: 'var(--bg-input, var(--bg-surface-2))',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">{t('All Legends', 'Minden Legenda')}</option>
            {legends.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.card_number})
              </option>
            ))}
          </select>

          <select
            value={championId}
            onChange={(e) => setChampionId(e.target.value)}
            aria-label={t('Filter by Chosen Champion', 'Szűrés Bajnokra')}
            className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none cursor-pointer"
            style={{
              background: 'var(--bg-input, var(--bg-surface-2))',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">{t('All Chosen Champions', 'Minden Bajnok')}</option>
            {champions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.card_number})
              </option>
            ))}
          </select>

          <div ref={cardSearchRef} className="relative">
            <input
              type="text"
              value={cardQuery}
              onFocus={() => setCardDropdownOpen(true)}
              onChange={(e) => {
                setCardQuery(e.target.value);
                setCardDropdownOpen(true);
              }}
              onKeyDown={handleCardSearchKeyDown}
              placeholder={t('Must contain card(s)...', 'Tartalmazza a kártyát...')}
              className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none"
              style={{
                background: 'var(--bg-input, var(--bg-surface-2))',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            {cardDropdownOpen && cardQuery.trim().length > 0 && (
              <div
                className="absolute left-0 right-0 top-full mt-1 rounded-xl border shadow-xl z-30 max-h-60 overflow-y-auto custom-scrollbar"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                {cardSuggestions.length > 0 ? (
                  cardSuggestions.map((c, idx) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        addContainsCard(c);
                      }}
                      className="w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 cursor-pointer transition"
                      style={{
                        background: idx === highlightIdx ? 'var(--bg-surface-2)' : 'transparent',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span className="font-bold truncate">{c.name}</span>
                      <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {c.card_number}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {catalogCards.length === 0
                      ? t('Loading cards...', 'Kártyák betöltése...')
                      : t('No matching cards found.', 'Nem található ilyen kártya.')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={minCost}
              onChange={(e) => setMinCost(e.target.value)}
              placeholder={t('Min Ft', 'Min Ft')}
              aria-label={t('Minimum deck cost (HUF)', 'Minimum pakliérték (Ft)')}
              className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold border outline-none"
              style={{
                background: 'var(--bg-input, var(--bg-surface-2))',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <span className="text-xs font-bold shrink-0" style={{ color: 'var(--text-muted)' }}>-</span>
            <input
              type="number"
              min={0}
              value={maxCost}
              onChange={(e) => setMaxCost(e.target.value)}
              placeholder={t('Max Ft', 'Max Ft')}
              aria-label={t('Maximum deck cost (HUF)', 'Maximum pakliérték (Ft)')}
              className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold border outline-none"
              style={{
                background: 'var(--bg-input, var(--bg-surface-2))',
                borderColor: 'var(--border)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        {/* Domain pills + selected required cards */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold mr-1" style={{ color: 'var(--text-muted)' }}>
              {t('Domains:', 'Domének:')}
            </span>
            {DOMAIN_OPTIONS.map((dom) => {
              const active = selectedDomains.includes(dom.id);
              return (
                <button
                  key={dom.id}
                  type="button"
                  onClick={() => toggleDomain(dom.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer transition"
                  style={
                    active
                      ? { background: `${dom.color}26`, borderColor: dom.color, color: 'var(--text-primary)' }
                      : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                  }
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: dom.color }} />
                  <span>{dom.label}</span>
                </button>
              );
            })}
          </div>

          {containsCards.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                {t('Contains:', 'Tartalmazza:')}
              </span>
              {containsCards.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border"
                  style={{
                    background: 'var(--accent-muted)',
                    borderColor: 'var(--accent-border)',
                    color: 'var(--text-accent)',
                  }}
                >
                  <span>{c.name}</span>
                  <button
                    type="button"
                    onClick={() => setContainsCards((prev) => prev.filter((item) => item.id !== c.id))}
                    aria-label={t(`Remove ${c.name}`, `${c.name} eltávolítása`)}
                    className="hover:opacity-75 cursor-pointer"
                  >
                    <svg
                      className="w-3 h-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {visibleDecks.length === 0 && !loading ? (
        <div
          className="p-12 text-center rounded-2xl border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {t('No published decks match this search yet.', 'Nincs a keresésnek megfelelő közzétett pakli.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {visibleDecks.map((d) => {
            const isShowingChampion = deckArtView[d.id] === 'champion';
            const activeCard =
              isShowingChampion && d.champion_card?.image_path
                ? d.champion_card
                : d.legend_card || d.champion_card;
            const deckCost = deckCosts.get(d.id);

            return (
              <div
                key={d.id}
                className="rounded-xl border overflow-hidden transition hover:-translate-y-0.5 flex flex-col"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div
                  className="relative w-full overflow-hidden group"
                  style={{ aspectRatio: '3 / 4', background: '#09090b' }}
                >
                  <a href={`/decks/view?deck=${d.id}`} className="block w-full h-full">
                    {activeCard?.image_path && (
                      <img
                        {...cardThumbProps(activeCard.image_path, 'tile')}
                        alt={activeCard.name}
                        className="w-full h-full object-cover transition group-hover:scale-105 duration-200"
                      />
                    )}
                  </a>

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
                      className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded-lg text-[9px] font-black border flex items-center gap-1 shadow-md transition cursor-pointer backdrop-blur-md hover:scale-105"
                      style={{
                        background: 'rgba(9, 13, 22, 0.85)',
                        borderColor: isShowingChampion ? 'var(--accent)' : 'rgba(255, 255, 255, 0.25)',
                        color: isShowingChampion ? 'var(--text-accent)' : '#fff',
                      }}
                    >
                      <svg
                        className="w-2.5 h-2.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L13 16" />
                      </svg>
                      <span>{isShowingChampion ? t('Champion', 'Bajnok') : t('Legend', 'Legenda')}</span>
                    </button>
                  )}
                </div>
                <div className="p-2.5 flex flex-col flex-1 justify-between gap-1.5">
                  <div>
                    <div className="flex items-baseline justify-between gap-1.5">
                      <a
                        href={`/decks/view?deck=${d.id}`}
                        className="text-xs font-bold truncate block hover:underline min-w-0"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {d.name}
                      </a>
                      {deckCost !== undefined && deckCost > 0 && (
                        <span
                          className="shrink-0 text-[11px] font-black whitespace-nowrap"
                          style={{ color: 'var(--positive)' }}
                          title={t('Estimated deck value', 'Becsült pakliérték')}
                        >
                          {formatPrice(deckCost)}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {lang === 'hu' ? `Készítő: ${d.owner_name}` : `by ${d.owner_name}`}
                    </div>
                  </div>

                  <div className="space-y-1 pt-1.5 border-t text-[11px]" style={{ borderColor: 'var(--border-subtle)' }}>
                    {d.legend_card && (
                      <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="font-semibold">{t('Legend:', 'Legenda:')} </span>
                        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                          {d.legend_card.name}
                        </span>
                      </div>
                    )}
                    {d.champion_card && (
                      <div className="flex items-center gap-1 min-w-0" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="font-semibold shrink-0">{t('Champion:', 'Bajnok:')} </span>
                        <span className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                          {d.champion_card.name}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl font-black text-xs cursor-pointer disabled:opacity-50"
            style={{
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            {loading ? t('Loading…', 'Betöltés…') : t('Load More', 'Továbbiak betöltése')}
          </button>
        </div>
      )}
    </div>
  );
}
