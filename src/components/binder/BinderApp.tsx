import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { CatalogCard, FilterState } from '../../types';
import { fetchCardsCatalog } from '../../lib/api';
import { cardThumbProps } from '../../lib/supabase';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { useUrlOverlay } from '../../lib/useUrlOverlay';
import {
  buildBinderPockets,
  paginate,
  pocketVariants,
  pocketMatchesSearch,
  pocketOwned,
  variantOwned,
  BINDER_GRID_OPTIONS,
  isBinderGap,
  type BinderGridSize,
  type BinderPocket,
} from '../../lib/binderLayout';
import { EVENTS, sortSetNames } from '../../lib/constants';
import { useCollectionsStore, activeNamedCollection } from '../../lib/collectionsStore';
import { getActiveGame } from '../../lib/theme';

const DEFAULT_FILTERS: FilterState = {
  category: 'singles',
  game: 'riftbound',
  sets: [],
  rarities: [],
  type: '',
  domains: [],
  tags: [],
  costMin: 1,
  costMax: 10,
};

/** Reads the tracked collection the same way the rest of the app does, and stays in
 * sync with it (other tabs, other pages, the "Add to Collection" buttons here). Follows the collection
 * that's active in the Catalog: Personal from this browser, or a named one. */
function useOwnedQtyMap(): Record<string, number> {
  const store = useCollectionsStore();
  const named = activeNamedCollection(store);
  const [qty, setQty] = useState<Record<string, number>>({});

  useEffect(() => {
    const toQtyMap = (raw: Record<string, number> | string[]): Record<string, number> => {
      if (Array.isArray(raw)) return Object.fromEntries(raw.map(id => [id, 1]));
      const out: Record<string, number> = {};
      Object.entries(raw).forEach(([id, count]) => { if (typeof count === 'number' && count > 0) out[id] = count; });
      return out;
    };
    const load = () => {
      try {
        const saved = localStorage.getItem('tcg_user_collection') || localStorage.getItem('tcg_collection');
        if (!saved) { setQty({}); return; }
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) setQty(toQtyMap(parsed));
        else setQty({});
      } catch {
        setQty({});
      }
    };
    load();
    window.addEventListener('tcg-collection-change', load);
    window.addEventListener('storage', load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener('tcg-collection-change', load);
      window.removeEventListener('storage', load);
      window.removeEventListener('focus', load);
    };
  }, []);

  return named ? named.cards : qty;
}

function BinderPocketTile({
  pocket,
  matchesSearch,
  searchActive,
  slotNumber,
  highlightOwned,
  ownedQty,
  onOpen,
}: {
  pocket: BinderPocket;
  matchesSearch: boolean;
  searchActive: boolean;
  slotNumber: number;
  highlightOwned: boolean;
  ownedQty: Record<string, number>;
  onOpen: (cardId: string) => void;
}) {
  const variants = pocketVariants(pocket);
  // Default to the highest tier print/finish folded into this pocket (foil, or alt art,
  // or foil alt art) - the whole point of turning variants on is to see the fancy one.
  const [shown, setShown] = useState(variants.length - 1);
  // Toggling "Show Alt Art / Foil" changes how many variants this same pocket (same key,
  // same card) has without remounting the tile, so the above initial value alone would
  // only ever apply once - re-snap to the new highest tier whenever the count changes.
  useEffect(() => {
    setShown(variants.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants.length]);
  const active = variants[Math.min(shown, variants.length - 1)];
  const isAltPrint = active.card.id !== pocket.primary.card.id;
  // With more than one variant to flip through, dimming has to track the one actually on
  // screen - otherwise owning just the normal print hides that its foil isn't owned. With
  // only one variant there is nothing more specific to ask than "is this pocket filled".
  const dimmed = highlightOwned && (variants.length > 1 ? !variantOwned(active, ownedQty) : !pocketOwned(pocket, ownedQty));

  // While a search is active, a non-matching pocket collapses to a plain numbered slot
  // so the matching card(s) stand out instead of getting lost in a full page of art.
  if (searchActive && !matchesSearch) {
    return (
      <div
        className="rounded-lg border border-dashed flex items-center justify-center"
        style={{ borderColor: 'var(--border-subtle)', aspectRatio: '2.5 / 3.5', color: 'var(--text-muted)' }}
      >
        <span className="text-xs font-bold">{slotNumber}</span>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-lg border flex flex-col overflow-hidden transition"
      style={{
        borderColor: matchesSearch && searchActive ? 'var(--accent)' : 'var(--border)',
        boxShadow: matchesSearch && searchActive ? '0 0 0 2px var(--accent-glow)' : 'none',
        background: 'var(--bg-input)',
        aspectRatio: '2.5 / 3.5',
        opacity: dimmed ? 0.35 : 1,
        filter: dimmed ? 'grayscale(0.6)' : 'none',
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(active.card.id)}
        className="flex-1 min-h-0 relative cursor-pointer"
        title={`${active.card.name}${active.isFoil ? ' (Foil)' : ''}`}
      >
        {active.card.image_path ? (
          <img {...cardThumbProps(active.card.image_path, 'grid')} alt={active.card.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] p-2 text-center" style={{ color: 'var(--text-muted)' }}>
            {active.card.name}
          </div>
        )}

        {active.isFoil && (
          <span
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, transparent 35%, rgba(255,255,255,0.12) 60%, transparent 100%)' }}
          />
        )}

        <div className="absolute top-1 left-1 flex flex-col gap-0.5 items-start">
          {active.isFoil && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-sky-500/90 text-white">Foil</span>
          )}
          {isAltPrint && !active.isFoil && (
            <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}>Alt</span>
          )}
        </div>

        <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-[9px] font-bold text-white text-center truncate" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)' }}>
          {active.card.card_number}
        </div>
      </button>

      {variants.length > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShown(s => (s + 1) % variants.length); }}
          title="Show the other print/finish in this pocket"
          className="shrink-0 flex items-center justify-center gap-1 py-1 text-[9px] font-bold cursor-pointer border-t"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }}
        >
          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 2.1l4 4-4 4M3 12.9V9a4 4 0 0 1 4-4h14M7 21.9l-4-4 4-4M21 11.1V15a4 4 0 0 1-4 4H3" />
          </svg>
          {shown + 1}/{variants.length}
        </button>
      )}
    </div>
  );
}

export function BinderApp() {
  const [activeGame, setActiveGame] = useState<string>(() => getActiveGame());
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [availableSets, setAvailableSets] = useState<string[]>([]);
  const [selectedSet, setSelectedSet] = useState<string>('');
  const [search, setSearch] = useState('');
  const [gridSize, setGridSize] = useState<BinderGridSize>('3x3');
  const [includeVariants, setIncludeVariants] = useState(false);
  const [highlightOwned, setHighlightOwned] = useState(false);
  const [page, setPage] = useState(0);
  // In the URL (?card=), so Back closes the preview and it can be shared.
  const [previewCardId, openPreview, closePreview] = useUrlOverlay('card');

  const ownedQty = useOwnedQtyMap();

  useEffect(() => {
    const handleGameChange = (e: Event) => {
      const detail = (e as CustomEvent<{ game: string }>).detail;
      if (detail?.game) {
        setActiveGame(detail.game);
        setSelectedSet('');
        setAvailableSets([]);
      }
    };
    window.addEventListener(EVENTS.GAME_CHANGE, handleGameChange);
    return () => window.removeEventListener(EVENTS.GAME_CHANGE, handleGameChange);
  }, []);

  // Load every set once per game, so the picker doesn't depend on whichever page happens
  // to be selected.
  useEffect(() => {
    let cancelled = false;
    fetchCardsCatalog({ ...DEFAULT_FILTERS, game: activeGame }, '').then(({ data }) => {
      if (cancelled) return;
      // Oldest set first (and the default pick), extras last.
      const sets = sortSetNames(Array.from(new Set(data.map(c => c.set_name).filter(Boolean))) as string[]);
      setAvailableSets(sets);
      setSelectedSet(prev => prev || sets[0] || '');
    });
    return () => { cancelled = true; };
  }, [activeGame]);

  useEffect(() => {
    setPage(0);
  }, [selectedSet, gridSize, includeVariants]);

  // The card list is fetched purely from the set (never the search box) - binder position
  // has to stay the same no matter what you've typed, or "page 4 slot 2" would be a lie.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCardsCatalog({ ...DEFAULT_FILTERS, game: activeGame, sets: selectedSet ? [selectedSet] : [] }, '').then(({ data }) => {
      if (cancelled) return;
      setCards(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeGame, selectedSet]);

  const pockets = useMemo(
    () => buildBinderPockets(cards, { includeVariants }),
    [cards, includeVariants]
  );

  const { cols, rows } = BINDER_GRID_OPTIONS[gridSize];
  const pageSize = cols * rows;
  const pages = useMemo(() => paginate(pockets, pageSize), [pockets, pageSize]);
  const currentPage = pages[Math.min(page, pages.length - 1)] || [];
  const emptySlots = Math.max(0, pageSize - currentPage.length);

  const searchActive = search.trim() !== '';
  const searchMatches = useMemo(() => {
    if (!searchActive) return [];
    return pockets.flatMap((pocket, idx) =>
      !isBinderGap(pocket) && pocketMatchesSearch(pocket, search) ? [{ pocket, idx }] : []
    );
  }, [pockets, search, searchActive]);

  // Jump to the first match's page once typing settles, so results don't jerk the page
  // around on every keystroke.
  const jumpedForRef = useRef<string>('');
  useEffect(() => {
    if (!searchActive || searchMatches.length === 0) return;
    const handle = setTimeout(() => {
      const firstPageIdx = Math.floor(searchMatches[0].idx / pageSize);
      if (jumpedForRef.current !== search) {
        jumpedForRef.current = search;
        setPage(firstPageIdx);
      }
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, searchMatches, pageSize]);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'clamp(16px,3vw,24px)' }}>
      <h1 className="text-xl sm:text-2xl font-black mb-1" style={{ color: 'var(--text-primary)' }}>Binder Map</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
        See exactly which page and pocket a card belongs in, matching a physical binder page-by-page,
        so you don't have to recount slots by hand.
      </p>

      {/* Controls */}
      <div className="rounded-2xl border p-4 mb-5 flex flex-col gap-3" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap gap-2.5 items-center">
          <select
            value={selectedSet}
            onChange={e => setSelectedSet(e.target.value)}
            className="h-9 px-3 rounded-lg text-xs font-semibold border outline-none cursor-pointer"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            {availableSets.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Find a card's page/slot by name or number…"
            className="h-9 px-3 rounded-lg text-xs outline-none border flex-1 min-w-[160px]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />

          <div className="flex items-center h-9 border rounded-lg p-0.5 gap-0.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
            {(Object.keys(BINDER_GRID_OPTIONS) as BinderGridSize[]).map(size => (
              <button
                key={size}
                type="button"
                onClick={() => setGridSize(size)}
                className="px-2.5 h-full rounded-md text-[11px] font-bold cursor-pointer transition"
                style={{
                  background: gridSize === size ? 'var(--bg-raised)' : 'transparent',
                  color: gridSize === size ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={includeVariants}
              onChange={e => setIncludeVariants(e.target.checked)}
              className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
            />
            Show Alt Art / Foil versions
          </label>

          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={highlightOwned}
              onChange={e => setHighlightOwned(e.target.checked)}
              className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
            />
            Highlight Owned Only
          </label>
        </div>

        {searchActive && (
          <div className="pt-2 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
            {searchMatches.length === 0 ? (
              <span style={{ color: 'var(--text-muted)' }}>No card in this set matches "{search}".</span>
            ) : (
              <div className="flex flex-wrap gap-2 items-center">
                <span style={{ color: 'var(--text-tertiary)' }}>Found:</span>
                {searchMatches.map(({ pocket, idx }) => {
                  const pageNum = Math.floor(idx / pageSize) + 1;
                  const slotNum = (idx % pageSize) + 1;
                  return (
                    <button
                      key={pocket.key}
                      type="button"
                      onClick={() => setPage(pageNum - 1)}
                      className="px-2.5 py-1 rounded-lg font-bold cursor-pointer border"
                      style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }}
                    >
                      {pocket.primary.card.name} — Page {pageNum}, Slot {slotNum}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Binder Page */}
      {loading ? (
        <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: pageSize }).map((_, i) => (
            <div key={i} style={{ aspectRatio: '2.5 / 3.5', borderRadius: 8, background: 'var(--bg-surface-2)', animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : pockets.length === 0 ? (
        <div className="rounded-2xl border p-12 text-center" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No cards in this set.</p>
        </div>
      ) : (
        <>
          <div
            className="rounded-2xl border p-3 sm:p-4 grid gap-2.5"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {currentPage.map((pocket, i) => isBinderGap(pocket) ? (
              <div
                key={pocket.key}
                className="rounded-lg border border-dashed flex flex-col items-center justify-center gap-1 text-center px-1"
                style={{ borderColor: 'var(--border-subtle)', aspectRatio: '2.5 / 3.5', color: 'var(--text-muted)' }}
                title={`${pocket.label} isn't in the catalog yet - its pocket is kept free`}
              >
                <span className="text-[11px] font-bold">{pocket.label}</span>
                {!searchActive && <span className="text-[10px]">Not revealed yet</span>}
              </div>
            ) : (
              <BinderPocketTile
                key={pocket.key}
                pocket={pocket}
                matchesSearch={!searchActive || pocketMatchesSearch(pocket, search)}
                searchActive={searchActive}
                slotNumber={i + 1}
                highlightOwned={highlightOwned}
                ownedQty={ownedQty}
                onOpen={openPreview}
              />
            ))}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="rounded-lg border border-dashed flex items-center justify-center"
                style={{ borderColor: 'var(--border-subtle)', aspectRatio: '2.5 / 3.5', color: 'var(--text-muted)' }}
              >
                <span className="text-xs font-bold">{currentPage.length + i + 1}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-4">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 rounded-lg text-xs font-bold border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              ← Prev Page
            </button>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              Page {Math.min(page, pages.length - 1) + 1} of {pages.length} · {pockets.length} pockets
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}
              disabled={page >= pages.length - 1}
              className="px-4 py-2 rounded-lg text-xs font-bold border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              Next Page →
            </button>
          </div>
        </>
      )}

      <CardPreviewOverlay cardId={previewCardId} onClose={closePreview} />
    </div>
  );
}
