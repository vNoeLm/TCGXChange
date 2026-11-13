import { useCurrency } from '../../lib/currency';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { parseWantList } from '../../lib/wantList';
import { Pagination, usePagination } from '../Pagination';
import type { CatalogCard, FilterState } from '../../types';
import { cardThumbProps } from '../../lib/supabase';
import { getCurrentProfile, onSignedInUserChange } from '../../lib/auth';
import { fetchCardsCatalog } from '../../lib/api';
import { compareCardsByRarity, getCardRarityRank, hasFoilVariant } from '../../lib/cardVariants';
import { useCardValueData, valueOfCard } from '../../lib/cardValues';
import { STORAGE_KEYS, EVENTS, GAMES } from '../../lib/constants';
import {
  useWishlists,
  createWishlist,
  renameWishlist,
  deleteWishlist,
  setWishlistQuantity,
  addWishlistItems,
  fetchWishlistCards,
  wishlistCopies,
  orderWishlists,
  moveWishlist,
  MAX_WISHLIST_NAME,
  type Wishlist,
  type WishlistCard,
} from '../../lib/wishlists';
import { AuthModal } from '../auth/AuthModal';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { useLanguage } from '../../lib/i18n';
import type { UserProfile } from '../../types';

const SEARCH_FILTERS: FilterState = {
  category: 'singles', game: 'riftbound', sets: [], rarities: [], type: '', domains: [], tags: [], costMin: 1, costMax: 10,
};

/** Cards shown per page of a list. */
const WISHLIST_PAGE_SIZE = 25;

type WishlistSort = 'number' | 'name' | 'rarity' | 'price' | 'count';
type WishlistGroup = 'none' | 'rarity';

const inputCls = 'w-full rounded-xl px-3 py-2.5 text-sm outline-none transition border focus:border-[var(--accent)]';
const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

function useActiveGame(): string {
  const [game, setGame] = useState('riftbound');
  useEffect(() => {
    try { setGame(localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME) || 'riftbound'); } catch {}
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<{ game: string }>).detail?.game;
      if (next) setGame(next);
    };
    window.addEventListener(EVENTS.GAME_CHANGE, onChange);
    return () => window.removeEventListener(EVENTS.GAME_CHANGE, onChange);
  }, []);
  return game;
}

/** The selected list, kept in the address (?list=) so a link or a refresh opens the same list. */
function useSelectedListParam(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { setId(new URLSearchParams(window.location.search).get('list')); }, []);
  const select = (next: string | null) => {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('list', next); else url.searchParams.delete('list');
    window.history.replaceState(window.history.state, '', url);
    setId(next);
  };
  return [id, select];
}

export function WishlistsApp() {
  const { t, lang } = useLanguage();
  const game = useActiveGame();
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [showAuth, setShowAuth] = useState(false);
  const { lists: allLists, loading, error } = useWishlists();
  const [orderTick, setOrderTick] = useState(0);
  const lists = useMemo(
    () => orderWishlists(allLists.filter((l) => l.game === game), game),
    [allLists, game, orderTick]
  );
  const [selectedId, setSelectedId] = useSelectedListParam();
  const selected = lists.find((l) => l.id === selectedId) || lists[0] || null;
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentProfile().then(setProfile);
    return onSignedInUserChange((session) => {
      if (session) getCurrentProfile().then(setProfile); else setProfile(null);
    });
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try { await fn(); } catch (e: any) { setActionError(e?.message || t('Something went wrong.', 'Hiba történt.')); } finally { setBusy(false); }
  };

  const create = () => run(async () => {
    const list = await createWishlist(newName, game);
    setNewName('');
    setSelectedId(list.id);
  });

  const move = (id: string, direction: -1 | 1) => {
    moveWishlist(lists, game, id, direction);
    setOrderTick((n) => n + 1);
  };

  const gameName = GAMES.find((g) => g.id === game)?.name || game;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,3vw,32px) clamp(16px,3vw,24px)' }}>
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black" style={{ color: 'var(--text-primary)' }}>
          {t('Wishlists', 'Kívánságlisták')}{' '}
          <span style={{ color: 'var(--text-accent)' }}>
            {lang === 'hu' ? `ehhez: ${gameName}` : `for ${gameName}`}
          </span>
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {t(
            'Lists of cards you want. Filter the catalog by one, or check if copies are available in the Store.',
            'Listák a kártyákról, amiket keresel. Szűrd a katalógust valamelyik alapján, vagy nézd meg a Bolt kínálatában.'
          )}
        </p>
      </div>

      {profile === undefined || (profile && loading) ? (
        <p className="text-sm font-semibold animate-pulse" style={{ color: 'var(--text-tertiary)' }}>{t('Loading…', 'Betöltés…')}</p>
      ) : !profile ? (
        <div className="rounded-2xl p-8 text-center border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            {t('Sign in to create wishlists - they\'re kept with your account.', 'Jelentkezz be kívánságlisták készítéséhez – a fiókodban tárolódnak.')}
          </p>
          <button type="button" onClick={() => setShowAuth(true)} className="px-5 py-2.5 rounded-xl text-sm font-bold cursor-pointer" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
            {t('Sign in', 'Bejelentkezés')}
          </button>
        </div>
      ) : error ? (
        <div className="rounded-2xl p-8 text-center border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('Wishlists aren\'t available right now.', 'A kívánságlisták jelenleg nem érhetők el.')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">
          {/* Lists */}
          <aside className="rounded-2xl p-3 border space-y-1.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            {lists.map((list, index) => {
              const active = selected?.id === list.id;
              return (
                <div key={list.id} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedId(list.id)}
                    aria-current={active ? 'true' : undefined}
                    className="flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left cursor-pointer transition"
                    style={active
                      ? { background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }
                      : { background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  >
                    <span className="text-sm font-bold truncate">{list.name}</span>
                    <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-tertiary)' }}>{wishlistCopies(list.items)}</span>
                  </button>
                  <div className="flex flex-col justify-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      aria-label={lang === 'hu' ? `${list.name} mozgatása feljebb` : `Move ${list.name} up`}
                      title={t('Move up', 'Feljebb')}
                      disabled={index === 0}
                      onClick={() => move(list.id, -1)}
                      className="w-6 h-[18px] rounded-md border flex items-center justify-center cursor-pointer transition hover:brightness-110 disabled:opacity-30 disabled:cursor-default"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
                    </button>
                    <button
                      type="button"
                      aria-label={lang === 'hu' ? `${list.name} mozgatása lejjebb` : `Move ${list.name} down`}
                      title={t('Move down', 'Lejjebb')}
                      disabled={index === lists.length - 1}
                      onClick={() => move(list.id, 1)}
                      className="w-6 h-[18px] rounded-md border flex items-center justify-center cursor-pointer transition hover:brightness-110 disabled:opacity-30 disabled:cursor-default"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                  </div>
                </div>
              );
            })}
            <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create(); }} className="flex gap-2 pt-1.5">
              <input
                type="text"
                value={newName}
                maxLength={MAX_WISHLIST_NAME}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={lists.length === 0 ? t('Name your first list', 'Nevezd el az első listádat') : t('New list', 'Új lista')}
                className="flex-1 min-w-0 rounded-xl px-3 py-2 text-xs border outline-none focus:border-[var(--accent)]"
                style={inputStyle}
              />
              <button type="submit" disabled={busy || !newName.trim()} className="px-3 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-default" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
                {t('Create', 'Létrehozás')}
              </button>
            </form>
          </aside>

          {/* Selected list */}
          {selected ? (
            <ListEditor
              key={selected.id}
              list={selected}
              game={game}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <div className="rounded-2xl p-8 text-center border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t(
                  'Create a list on the left, then add cards here or from any card\'s page in the catalog.',
                  'Hozz létre egy listát a bal oldalon, majd adj hozzá kártyákat itt vagy bármelyik kártya oldalán a katalógusban.'
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {actionError && <p role="alert" className="mt-3 text-xs font-semibold" style={{ color: 'var(--negative)' }}>{actionError}</p>}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={() => { setShowAuth(false); getCurrentProfile().then(setProfile); }} />}
    </div>
  );
}

function ListEditor({ list, game, onDeleted }: { list: Wishlist; game: string; onDeleted: () => void }) {
  const { t, lang } = useLanguage();
  const [cards, setCards] = useState<Map<string, WishlistCard>>(new Map());
  const [name, setName] = useState(list.name);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const values = useCardValueData();
  const { formatPrice } = useCurrency();

  const sortOptions = useMemo<{ value: WishlistSort; label: string }[]>(() => [
    { value: 'number', label: t('Card number', 'Kártyaszám') },
    { value: 'name', label: t('Name', 'Név') },
    { value: 'rarity', label: t('Rarity', 'Ritkaság') },
    { value: 'price', label: t('Price', 'Ár') },
    { value: 'count', label: t('Wanted count', 'Keresett darabszám') },
  ], [t]);

  // Card details for the list's entries; refetched only when a card is added that isn't loaded yet.
  const ids = useMemo(() => [...new Set(Object.keys(list.items).map((k) => k.replace(/_foil$/, '')))].sort().join(','), [list.items]);
  useEffect(() => {
    let alive = true;
    fetchWishlistCards(list.items).then((m) => alive && setCards(m), () => alive && setError(t('Could not load the cards on this list.', 'Nem sikerült betölteni a listán lévő kártyákat.')));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // Every entry with its estimated value worked out once, so sorting by price is cheap.
  const rows = useMemo(() => {
    return Object.entries(list.items)
      .filter(([, qty]) => qty > 0)
      .map(([key, qty]) => {
        const foil = key.endsWith('_foil');
        const card = cards.get(key.replace(/_foil$/, ''));
        const unit = card ? valueOfCard(card, foil, values).valueHuf : null;
        return { key, qty, foil, card, unit };
      });
  }, [list.items, cards, values]);

  const [sortBy, setSortBy] = useState<WishlistSort>('number');
  const [sortDesc, setSortDesc] = useState(false);
  const [groupBy, setGroupBy] = useState<WishlistGroup>('none');

  const sorted = useMemo(() => {
    const dir = sortDesc ? -1 : 1;
    const byNumber = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
      (a.card?.card_number || '').localeCompare(b.card?.card_number || '', undefined, { numeric: true });

    const compare = (a: (typeof rows)[number], b: (typeof rows)[number]): number => {
      // Grouping by rarity makes rarity the first key; the chosen sort orders the cards inside each group.
      if (groupBy === 'rarity') {
        const rank = getCardRarityRank(b.card ?? {}) - getCardRarityRank(a.card ?? {});
        if (rank !== 0) return rank;
      }
      switch (sortBy) {
        case 'name':
          return dir * (a.card?.name || '').localeCompare(b.card?.name || '');
        case 'rarity':
          return compareCardsByRarity(a.card ?? {}, b.card ?? {}, sortDesc ? 'desc' : 'asc');
        case 'price':
          if (a.unit === null && b.unit === null) return 0;
          if (a.unit === null) return 1; // cards without a price go last either way
          if (b.unit === null) return -1;
          return dir * (a.unit - b.unit);
        case 'count':
          return dir * (a.qty - b.qty);
        default:
          return dir * byNumber(a, b);
      }
    };

    return [...rows].sort((a, b) => compare(a, b) || byNumber(a, b) || (a.foil === b.foil ? 0 : a.foil ? 1 : -1));
  }, [rows, sortBy, sortDesc, groupBy]);

  // Totals per rarity group, for the headings when grouping.
  const groupTotals = useMemo(() => {
    const totals = new Map<string, { copies: number; value: number }>();
    for (const row of sorted) {
      const label = row.card?.rarity || 'Unknown';
      const group = totals.get(label) || { copies: 0, value: 0 };
      group.copies += row.qty;
      if (row.unit !== null) group.value += row.unit * row.qty;
      totals.set(label, group);
    }
    return totals;
  }, [sorted]);

  // Long lists (a whole set's want-list) come a page at a time, with a filter to find a card in them.
  const [filter, setFilter] = useState('');
  const listTopRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((e) => (e.card?.name || '').toLowerCase().includes(q) || (e.card?.card_number || '').toLowerCase().includes(q));
  }, [filter, sorted]);
  const pager = usePagination(shown, WISHLIST_PAGE_SIZE, `${filter}|${sortBy}|${sortDesc}|${groupBy}`);

  let estimate = 0;
  let unpriced = 0;
  for (const row of rows) {
    if (row.unit === null) { if (row.card) unpriced += 1; }
    else estimate += row.unit * row.qty;
  }

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusyKey(key);
    setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message || t('Something went wrong.', 'Hiba történt.')); } finally { setBusyKey(null); }
  };

  const browseStoreSingles = () => {
    window.location.href = '/store?category=singles';
  };

  const copies = wishlistCopies(list.items);
  const btn = 'px-3.5 py-2.5 rounded-xl text-xs font-bold border cursor-pointer transition hover:brightness-110 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-default';

  return (
    <section className="rounded-2xl p-4 sm:p-5 border min-w-0" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== list.name) act('rename', () => renameWishlist(list.id, name)); }}
        className="mb-1"
      >
        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
          {t('List name', 'Lista neve')}
        </label>
        <div className="flex items-center gap-2">
          <span className="relative flex-1 min-w-0">
            <input
              aria-label={t('List name', 'Lista neve')}
              title={t('Click to rename this list', 'Kattints a lista átnevezéséhez')}
              value={name}
              maxLength={MAX_WISHLIST_NAME}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => { if (name.trim() && name.trim() !== list.name) act('rename', () => renameWishlist(list.id, name)); else setName(list.name); }}
              className="w-full min-w-0 text-xl font-black outline-none rounded-lg px-2 pr-9 py-1 border focus:border-[var(--accent)]"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)', background: 'var(--bg-input)', borderColor: 'var(--border)' }}
            />
            <svg className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true">
              <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(lang === 'hu' ? `Törlöd a(z) "${list.name}" listát? Ez a művelet nem vonható vissza.` : `Delete "${list.name}"? This can't be undone.`)) {
                act('delete', async () => { await deleteWishlist(list.id); onDeleted(); });
              }
            }}
            disabled={busyKey === 'delete'}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer hover:brightness-110 shrink-0"
            style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
          >
            {t('Delete', 'Törlés')}
          </button>
        </div>
      </form>
      <p className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
        {t('Click the name above to rename this list.', 'Kattints a névre a fenti mezőben a lista átnevezéséhez.')}
      </p>
      <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
        {copies} {lang === 'hu' ? 'kártya' : copies === 1 ? 'card' : 'cards'}
        {estimate > 0 && <> · {lang === 'hu' ? 'kb. ' : 'about '}<span className="font-bold" style={{ color: 'var(--positive)' }}>{formatPrice(estimate)}</span></>}
        {unpriced > 0 && <> · {unpriced} {lang === 'hu' ? 'még ár nélkül' : 'without a price yet'}</>}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
        <a href={`/?wishlist=${list.id}`} className={btn} style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }}>
          {t('Show in catalog', 'Megtekintés a katalógusban')}
        </a>
        <button type="button" onClick={browseStoreSingles} className={btn} style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
          {t('Browse singles in Store', 'Egyedi kártyák a Boltban')}
        </button>
      </div>

      <AddCardSearch game={game} list={list} />
      <ImportWantList game={game} list={list} />

      {rows.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-tertiary)' }}>
          {t(
            'No cards yet - search above, or use the Wishlists box on any card\'s page.',
            'Még nincsenek kártyák – keress fent, vagy használd a Kívánságlisták dobozt a kártyák adatlapján.'
          )}
        </p>
      ) : (
        <div ref={listTopRef} className="mt-4 scroll-mt-24">
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>{t('Group by', 'Csoportosítás')}</span>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as WishlistGroup)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold border outline-none cursor-pointer focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <option value="none">{t('None', 'Nincs')}</option>
                <option value="rarity">{t('Rarity', 'Ritkaság')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>{t('Sort by', 'Rendezés')}</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as WishlistSort)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold border outline-none cursor-pointer focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setSortDesc((desc) => !desc)}
              aria-label={sortDesc ? t('Sorted high to low, switch to low to high', 'Csökkenő rendezés, váltás növekvőre') : t('Sorted low to high, switch to high to low', 'Növekvő rendezés, váltás csökkenőre')}
              title={sortDesc ? t('High to low (click for low to high)', 'Csökkenő (kattints a növekvőhöz)') : t('Low to high (click for high to low)', 'Növekvő (kattints a csökkenőhöz)')}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold border cursor-pointer transition hover:brightness-110"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {sortDesc ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M12 19V5M6 11l6-6 6 6" />}
              </svg>
              <span>{sortDesc ? t('Descending', 'Csökkenő') : t('Ascending', 'Növekvő')}</span>
            </button>
          </div>
          {rows.length > WISHLIST_PAGE_SIZE && (
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={t('Filter this list', 'Lista szűrése')}
              placeholder={lang === 'hu' ? `${rows.length} kártya szűrése név vagy szám alapján` : `Filter ${rows.length} cards by name or number`}
              className={`${inputCls} mb-3`}
              style={inputStyle}
            />
          )}
          {shown.length === 0 && (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
              {lang === 'hu' ? `Nincs kártya a listán, amely egyezik ezzel: "${filter.trim()}".` : `No card on this list matches "${filter.trim()}".`}
            </p>
          )}
          <ul className="space-y-2">
            {pager.pageItems.map((row, index) => {
              const { key, qty, foil, card, unit } = row;
              const cardId = key.replace(/_foil$/, '');
              const busy = busyKey === key;
              const step = 'w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold cursor-pointer hover:brightness-110 disabled:opacity-40 disabled:cursor-default';
              const stepStyle = { borderColor: 'var(--border)', background: 'var(--bg-raised)', color: 'var(--text-secondary)' };
              const rarity = card?.rarity || 'Unknown';
              const previous = index > 0 ? pager.pageItems[index - 1] : null;
              const startsGroup = groupBy === 'rarity' && (!previous || (previous.card?.rarity || 'Unknown') !== rarity);
              const group = groupTotals.get(rarity);
              return (
                <Fragment key={key}>
                  {startsGroup && (
                    <li className="flex items-center justify-between gap-2 px-1 pt-3 pb-0.5">
                      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>{rarity}</span>
                      {group && (
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                          {group.copies} {lang === 'hu' ? 'kártya' : group.copies === 1 ? 'card' : 'cards'}
                          {group.value > 0 && <> · ~{formatPrice(group.value)}</>}
                        </span>
                      )}
                    </li>
                  )}
                  <li className="flex items-center gap-3 p-2.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                    <button
                      type="button"
                      onClick={() => setPreviewCardId(cardId)}
                      aria-label={card?.name ? (lang === 'hu' ? `${card.name} megtekintése` : `View ${card.name}`) : t('View card', 'Kártya megtekintése')}
                      className="w-10 h-14 rounded-md overflow-hidden shrink-0 border cursor-pointer hover:opacity-80 transition p-0 text-left"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}
                    >
                      {card?.image_path && <img {...cardThumbProps(card.image_path, 'avatar')} alt="" className="w-full h-full object-cover" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setPreviewCardId(cardId)}
                        className="text-sm font-bold truncate block hover:underline text-left cursor-pointer border-none bg-transparent p-0 max-w-full"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {card?.name || t('Loading…', 'Betöltés…')}
                      </button>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                          {card?.card_number}{foil ? ' · Foil' : ''}
                        </span>
                        {card?.rarity && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                            {card.rarity}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {unit !== null ? (
                          <>
                            ~{formatPrice(unit)} {t('each', '/ db')}
                            {qty > 1 && <> · <span className="font-bold" style={{ color: 'var(--positive)' }}>{formatPrice(unit * qty)} {t('total', 'összesen')}</span></>}
                          </>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>{t('No price yet', 'Még nincs ár')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        aria-label={lang === 'hu' ? 'Egyel kevesebb' : 'One fewer'}
                        className={step}
                        style={stepStyle}
                        disabled={busy}
                        onClick={() => act(key, () => setWishlistQuantity(list.id, cardId, foil, qty - 1))}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-black" style={{ color: 'var(--text-primary)' }}>{qty}</span>
                      <button
                        type="button"
                        aria-label={lang === 'hu' ? 'Egyel több' : 'One more'}
                        className={step}
                        style={stepStyle}
                        disabled={busy}
                        onClick={() => act(key, () => setWishlistQuantity(list.id, cardId, foil, qty + 1))}
                      >
                        +
                      </button>
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ul>
          <Pagination state={pager} noun={lang === 'hu' ? 'kártya' : 'cards'} scrollTargetRef={listTopRef} />
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs font-semibold" style={{ color: 'var(--negative)' }}>{error}</p>}
      <CardPreviewOverlay cardId={previewCardId} onClose={() => setPreviewCardId(null)} zIndex={100} />
    </section>
  );
}

/**
 * Paste a want-list (the detailed one from the catalog's Export > Missing, or plain lines) or pick
 * its JSON file, and add those cards to this list.
 */
function ImportWantList({ game, list }: { game: string; list: Wishlist }) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; message: string; unmatched?: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importText = async (content: string) => {
    if (!content.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const { data: catalog } = await fetchCardsCatalog({ ...SEARCH_FILTERS, game }, '');
      const parsed = parseWantList(content, catalog);
      if (parsed.copies === 0) {
        setResult({ tone: 'error', message: t('No cards in that list matched the catalog.', 'A listában egyetlen kártya sem egyezett a katalógussal.'), unmatched: parsed.unmatched });
        return;
      }
      await addWishlistItems(list.id, parsed.items);
      setText('');
      setResult({
        tone: 'ok',
        message: lang === 'hu'
          ? `${parsed.copies} kártya hozzáadva a(z) "${list.name}" listához.`
          : `Added ${parsed.copies} ${parsed.copies === 1 ? 'card' : 'cards'} to "${list.name}".`,
        unmatched: parsed.unmatched,
      });
    } catch (e: any) {
      setResult({ tone: 'error', message: e?.message || t('Could not import that list.', 'Nem sikerült importálni a listát.') });
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(importText);
    e.target.value = '';
  };

  const small = 'px-3 py-2 rounded-xl text-xs font-bold border cursor-pointer transition hover:brightness-110 disabled:opacity-50 disabled:cursor-default';

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setResult(null); }}
        aria-expanded={open}
        className="text-xs font-bold cursor-pointer hover:underline"
        style={{ color: 'var(--text-accent)' }}
      >
        {open ? t('Hide import', 'Importálás elrejtése') : t('Import a want-list', 'Kívánságlista importálása')}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border p-3 space-y-2" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t(
              'Paste the detailed want-list from the catalog (Export, then Missing), or any list of cards like "2x Jinx" or "OGN-042". Cards already on this list add up.',
              'Illeszd be a részletes kívánságlistát a katalógusból (Exportálás, majd Hiányzók), vagy bármilyen kártyalistát, pl. „2x Jinx” vagy „OGN-042”. A már listán lévő kártyák darabszáma összeadódik.'
            )}
          </p>
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t('Want-list to import', 'Importálandó kívánságlista')}
            placeholder={'1x Jinx, Demolitionist (OGN-042/298) - Rare\n2x Brazen Buccaneer\nOGN-008 [Foil]'}
            className="w-full p-3 rounded-xl border text-xs font-mono outline-none resize-y focus:border-[var(--accent)]"
            style={inputStyle}
          />
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={small} style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              {t('Choose a JSON file', 'JSON fájl választása')}
            </button>
            <button type="button" onClick={() => importText(text)} disabled={busy || !text.trim()} className={small} style={{ background: 'var(--accent-strong)', borderColor: 'var(--accent)', color: 'var(--text-on-accent, #000)' }}>
              {busy ? t('Adding…', 'Hozzáadás…') : t('Add to list', 'Hozzáadás a listához')}
            </button>
          </div>
          {result && (
            <div role="status" className="text-xs font-semibold" style={{ color: result.tone === 'ok' ? 'var(--positive)' : 'var(--negative)' }}>
              {result.message}
              {result.unmatched && result.unmatched.length > 0 && (
                <span className="block font-normal mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Not found', 'Nem található')} ({result.unmatched.length}): {result.unmatched.slice(0, 5).join(', ')}{result.unmatched.length > 5 ? ', …' : ''}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Find a card by name or number and add it to the list. */
function AddCardSearch({ game, list }: { game: string; list: Wishlist }) {
  const { t } = useLanguage();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CatalogCard[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      fetchCardsCatalog({ ...SEARCH_FILTERS, game }, query).then(({ data }) => alive && setResults(data.slice(0, 8)), () => {});
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, game]);

  const add = async (card: CatalogCard, foil: boolean) => {
    const key = `${card.id}:${foil}`;
    setAdding(key);
    try {
      const current = list.items[foil ? `${card.id}_foil` : card.id] || 0;
      await setWishlistQuantity(list.id, card.id, foil, current + 1);
    } finally {
      setAdding(null);
    }
  };

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('Add a card - search by name or number', 'Kártya hozzáadása – keresés név vagy szám alapján')}
        className={inputCls}
        style={inputStyle}
      />
      {results.length > 0 && (
        <ul className="mt-2 rounded-xl border divide-y overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}>
          {results.map((card) => (
            <li key={card.id} className="flex items-center gap-3 px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="w-8 h-11 rounded overflow-hidden shrink-0" style={{ background: 'var(--bg-input)' }}>
                {card.image_path && <img {...cardThumbProps(card.image_path, 'avatar')} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{card.name}</div>
                <div className="text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{card.card_number}</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button type="button" disabled={adding !== null} onClick={() => add(card, false)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
                  {t('+ Add', '+ Hozzáadás')}
                </button>
                {hasFoilVariant(card) && (
                  <button type="button" disabled={adding !== null} onClick={() => add(card, true)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer disabled:opacity-50" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                    + Foil
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
