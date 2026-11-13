import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogCard } from '../../types';
import { fetchCardsCatalog } from '../../lib/api';
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

const PAGE_SIZE = 24;

export function DeckBrowserApp() {
  const { t, lang } = useLanguage();
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
  const [sort, setSort] = useState<'newest' | 'updated' | 'name'>('newest');
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deckArtView, setDeckArtView] = useState<Record<string, 'legend' | 'champion'>>({});
  const cardSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCardsCatalog(game).then((cards) => {
      if (!cancelled) setCatalogCards(cards || []);
    }).catch(() => {});
    return () => { cancelled = true; };
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
      .filter((c) => !chosenIds.has(c.id) && (c.name.toLowerCase().includes(q) || (c.card_number || '').toLowerCase().includes(q)))
      .slice(0, 12);
  }, [catalogCards, cardQuery, containsCards]);

  const containsKey = useMemo(() => containsCards.map((c) => c.id).join(','), [containsCards]);
  const domainsKey = useMemo(() => selectedDomains.join(','), [selectedDomains]);

  useEffect(() => {
    setPage(1);
  }, [search, legendId, championId, containsKey, domainsKey, sort]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      const result = await browsePublicDecks({
        game,
        search,
        legend: legendId || undefined,
        champion: championId || undefined,
        contains: containsCards.map((c) => c.id),
        domains: selectedDomains,
        sort,
        page,
        pageSize: PAGE_SIZE,
      });
      if (!cancelled) {
        setDecks(prev => page === 1 ? result.data : [...prev, ...result.data]);
        setCount(result.count);
        setLoading(false);
      }
    }, search ? 280 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [game, search, legendId, championId, containsKey, domainsKey, sort, page]);

  const hasMore = decks.length < count;
  const hasActiveFilters = Boolean(
    search.trim() || legendId || championId || selectedDomains.length > 0 || containsCards.length > 0 || sort !== 'newest'
  );

  const clearFilters = () => {
    setSearch('');
    setLegendId('');
    setChampionId('');
    setSelectedDomains([]);
    setContainsCards([]);
    setCardQuery('');
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
            {t('Decks the community has published publicly from the Deck Builder.', 'A közösség által közzétett paklik a Pakliépítőből.')}
          </p>
        </div>
        <div className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
          {count} {t(count === 1 ? 'deck' : 'decks', 'pakli')}
        </div>
      </div>

      {/* Search & Filters */}
      <div className="rounded-2xl border p-3.5 sm:p-4 mb-6 space-y-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('Search by deck name, creator, legend, champion or card...', 'Keresés paklinév, készítő, legenda, bajnok vagy kártya alapján...')}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl text-sm outline-none border"
              style={{ background: 'var(--bg-input, var(--bg-surface-2))', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'newest' | 'updated' | 'name')}
            aria-label={t('Sort decks', 'Paklik rendezése')}
            className="px-3 py-2 rounded-xl text-xs font-bold border outline-none cursor-pointer"
            style={{ background: 'var(--bg-input, var(--bg-surface-2))', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="newest">{t('Newest', 'Legújabb')}</option>
            <option value="updated">{t('Recently updated', 'Legutóbb frissített')}</option>
            <option value="name">{t('Name (A-Z)', 'Név (A-Z)')}</option>
          </select>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer transition hover:border-[var(--border-hover)]"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              {t('Clear filters', 'Szűrők törlése')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          <select
            value={legendId}
            onChange={(e) => {
              setLegendId(e.target.value);
              setChampionId('');
            }}
            aria-label={t('Filter by Legend', 'Szűrés Legendára')}
            className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none cursor-pointer"
            style={{ background: 'var(--bg-input, var(--bg-surface-2))', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
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
            style={{ background: 'var(--bg-input, var(--bg-surface-2))', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
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
              placeholder={t('Must contain card(s)...', 'Tartalmazza a kártyát...')}
              className="w-full px-3 py-2 rounded-xl text-xs font-semibold border outline-none"
              style={{ background: 'var(--bg-input, var(--bg-surface-2))', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            {cardDropdownOpen && cardSuggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full mt-1 rounded-xl border shadow-xl z-30 max-h-60 overflow-y-auto custom-scrollbar"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                {cardSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setContainsCards((prev) => [...prev, c]);
                      setCardQuery('');
                      setCardDropdownOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 hover:bg-[var(--bg-surface-2)] cursor-pointer transition"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <span className="font-bold truncate">{c.name}</span>
                    <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {c.card_number}
                    </span>
                  </button>
                ))}
              </div>
            )}
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
                  style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                >
                  <span>{c.name}</span>
                  <button
                    type="button"
                    onClick={() => setContainsCards((prev) => prev.filter((item) => item.id !== c.id))}
                    aria-label={t(`Remove ${c.name}`, `${c.name} eltávolítása`)}
                    className="hover:opacity-75 cursor-pointer"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
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

      {decks.length === 0 && !loading ? (
        <div className="p-12 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {t('No published decks match this search yet.', 'Nincs a keresésnek megfelelő közzétett pakli.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {decks.map(d => {
            const isShowingChampion = deckArtView[d.id] === 'champion';
            const activeCard = (isShowingChampion && d.champion_card?.image_path) ? d.champion_card : (d.legend_card || d.champion_card);

            return (
              <div
                key={d.id}
                className="rounded-xl border overflow-hidden transition hover:-translate-y-0.5 flex flex-col"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="relative w-full overflow-hidden group" style={{ aspectRatio: '3 / 4', background: '#09090b' }}>
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
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L13 16" />
                      </svg>
                      <span>{isShowingChampion ? t('Champion', 'Bajnok') : t('Legend', 'Legenda')}</span>
                    </button>
                  )}
                </div>
                <div className="p-2.5 flex flex-col flex-1 justify-between gap-1.5">
                  <div>
                    <a href={`/decks/view?deck=${d.id}`} className="text-xs font-bold truncate block hover:underline" style={{ color: 'var(--text-primary)' }}>
                      {d.name}
                    </a>
                    <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {lang === 'hu' ? `Készítő: ${d.owner_name}` : `by ${d.owner_name}`}
                    </div>
                  </div>

                  <div className="space-y-1 pt-1.5 border-t text-[11px]" style={{ borderColor: 'var(--border-subtle)' }}>
                    {d.legend_card && (
                      <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="font-semibold">{t('Legend:', 'Legenda:')} </span>
                        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{d.legend_card.name}</span>
                      </div>
                    )}
                    {d.champion_card && (
                      <div className="flex items-center gap-1 min-w-0" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="font-semibold shrink-0">{t('Champion:', 'Bajnok:')} </span>
                        <span className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>{d.champion_card.name}</span>
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
            onClick={() => setPage(p => p + 1)}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl font-black text-xs cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            {loading ? t('Loading…', 'Betöltés…') : t('Load More', 'Továbbiak betöltése')}
          </button>
        </div>
      )}
    </div>
  );
}
