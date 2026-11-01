import { useEffect, useState, useMemo } from 'react';
import type { CatalogCard } from '../../types';
import type { DeckState } from '../deck-builder/useDeckBuilder';
import { DeckBoardView } from '../deck-builder/DeckBoardView';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { fetchCardsCatalog } from '../../lib/api';
import { fetchDeckById, type PublicDeckSummary } from '../../lib/publicDecks';
import { useSavedDecks } from '../deck-builder/useSavedDecks';
import { toGameId, gameStorageKey, type GameId } from '../../lib/deckRules';
import { applySiteTheme } from '../../lib/theme';
import { STORAGE_KEYS } from '../../lib/constants';
import { useCurrency } from '../../lib/currency';
import { deckValueHuf } from '../../lib/deckBoard';
import { useUrlOverlay } from '../../lib/useUrlOverlay';
import { useCardValueData } from '../../lib/cardValues';

const DEFAULT_FILTERS = {
  sets: [],
  rarities: [],
  type: '',
  domains: [],
  tags: [],
  costMin: 1,
  costMax: 10,
  stockStatus: 'Any',
};

const EMPTY_DECK: DeckState = {
  legend: null,
  champion: null,
  extraLegends: [],
  mainDeck: {},
  runeDeck: {},
  battlefields: {},
  sideboard: {},
};

function HeaderStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="rounded-xl border px-3.5 py-2 min-w-[104px]"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div className="text-[9.5px] font-black uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </div>
      <div className="text-[15px] font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {hint && (
        <div className="text-[9.5px] font-semibold" style={{ color: 'var(--text-muted)' }}>{hint}</div>
      )}
    </div>
  );
}

export function DeckViewApp() {
  const [deckRow, setDeckRow] = useState<PublicDeckSummary | null>(null);
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // In the URL (?card=), so Back closes the preview and it can be shared.
  const [previewCardId, openPreview, closePreview] = useUrlOverlay('card');
  const showPreview = (card: CatalogCard) => openPreview(card.id);
  const activeGame: GameId = toGameId(deckRow?.game);
  const { saveDeck, updateDeck } = useSavedDecks(activeGame);
  const values = useCardValueData();
  const { formatPrice } = useCurrency();

  useEffect(() => {
    // Deliberately not "id" -- CardDetail (rendered below on card click) falls back to
    // reading a `?id=` query param as an inventory id when no prop is passed, which
    // would collide with this page's own id and make every card preview 404.
    const id = new URLSearchParams(window.location.search).get('deck');
    if (!id) { setLoading(false); setNotFound(true); return; }

    (async () => {
      const row = await fetchDeckById(id);
      if (!row) { setNotFound(true); setLoading(false); return; }
      setDeckRow(row);
      const { data } = await fetchCardsCatalog({ ...DEFAULT_FILTERS, game: row.game }, '');
      setCards(data || []);
      setLoading(false);
    })();
  }, []);

  const deck = useMemo<DeckState>(() => deckRow?.deck || EMPTY_DECK, [deckRow]);
  const deckValue = useMemo(() => deckValueHuf(deck, cards, values), [deck, cards, values]);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center p-8">
        <span className="font-bold text-base animate-pulse" style={{ color: 'var(--text-accent)' }}>Loading deck…</span>
      </div>
    );
  }

  if (notFound || !deckRow) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>This deck doesn't exist, or is no longer public.</p>
          <a href="/decks" className="inline-block px-5 py-2.5 rounded-xl font-black text-xs cursor-pointer" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
            Back to Deck Browser
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 20px 48px' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-5 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <a
            href="/decks"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-2 hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Deck Browser
          </a>
          <h1 className="text-xl sm:text-2xl font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{deckRow.name}</h1>
          <div className="flex items-center gap-2 mt-1 text-xs font-bold flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
            <a href={`/user?id=${deckRow.user_id}`} className="hover:underline">by {deckRow.owner_name}</a>
            <span aria-hidden="true">·</span>
            <span className="uppercase tracking-wider">{activeGame}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap min-w-0">
          <HeaderStat label="Cards" value={String(deckValue.totalCards)} />
          <HeaderStat
            label="Deck value"
            value={formatPrice(deckValue.totalHuf)}
            hint={deckValue.unpricedCards > 0 ? `${deckValue.unpricedCards} unpriced` : undefined}
          />
          <button
            type="button"
            onClick={() => {
              if (activeGame) {
                localStorage.setItem(STORAGE_KEYS.ACTIVE_GAME, activeGame);
                applySiteTheme(activeGame);
              }
              localStorage.setItem(gameStorageKey(activeGame, 'deck'), JSON.stringify(deck));

              // Check if we already have this deck in savedDecks
              const storageKey = gameStorageKey(activeGame, 'saved_decks');
              const raw = localStorage.getItem(storageKey);
              let currentList: any[] = [];
              try { currentList = raw ? JSON.parse(raw) : []; } catch { currentList = []; }

              const existing = currentList.find((d: any) =>
                d.publishedDeckId === deckRow.id ||
                d.name.trim().toLowerCase() === deckRow.name.trim().toLowerCase()
              );

              let targetSavedId = '';
              if (existing) {
                targetSavedId = existing.id;
                updateDeck(existing.id, deck, deckRow.name, deckRow.id);
              } else {
                const created = saveDeck(deckRow.name, deck, deckRow.id);
                targetSavedId = created.id;
              }

              if (targetSavedId) {
                localStorage.setItem(gameStorageKey(activeGame, 'loaded_deck_id'), targetSavedId);
              }
              localStorage.setItem(gameStorageKey(activeGame, 'loaded_published_deck_id'), deckRow.id);

              window.location.href = '/deck-builder';
            }}
            className="h-[52px] px-4 rounded-xl font-black text-xs cursor-pointer transition hover:brightness-110 flex items-center gap-2"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            title="Open and edit this deck in the Deck Builder"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span>Open in Deck Builder</span>
          </button>
        </div>
      </div>

      <DeckBoardView
        deck={deck}
        cards={cards}
        activeGame={activeGame}
        onCardClick={showPreview}
      />

      <CardPreviewOverlay cardId={previewCardId} onClose={closePreview} />
    </div>
  );
}
