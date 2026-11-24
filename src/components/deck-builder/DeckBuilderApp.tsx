import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { CatalogCard } from '../../types';
import { supabase, getCardImageUrl } from '../../lib/supabase';
import { useDeckBuilder, type DeckState } from './useDeckBuilder';
import { useSavedDecks } from './useSavedDecks';
import { DeckCatalog } from './DeckCatalog';
import { DeckBoardView } from './DeckBoardView';
import { DeckList } from './DeckList';
import { DeckStatisticsModal } from './DeckStatisticsModal';
import { deckValueHuf } from '../../lib/deckBoard';
import { useCardValueData } from '../../lib/cardValues';
import { useCurrency } from '../../lib/currency';
import { getDeckRules, zoneRule, type ZoneKey } from '../../lib/deckRules';
import type { GridSize } from '../../lib/gridSize';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { formatGameText } from '../../lib/formatGameText';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { useUrlOverlay } from '../../lib/useUrlOverlay';
import { fetchCardsCatalog } from '../../lib/api';
import { defaultCostBounds } from '../../lib/activeFilterCount';
import { exportDeckToText, exportDeckToJson, exportSavedDecksToJson } from './deckSerializer';
import { Modal } from '../ui/Modal';
import { publishDeck, updatePublishedDeck, setDeckVisibility, deletePublishedDeck, fetchMyDecks, type PublicDeckSummary } from '../../lib/publicDecks';

import { getActiveGame } from '../../lib/theme';
import { EVENTS, STORAGE_KEYS } from '../../lib/constants';
import { toGameId, gameStorageKey, defaultZone, hasZone, type GameId } from '../../lib/deckRules';
import { useLanguage } from '../../lib/i18n';

const BREAKPOINT = 1100;

const DEFAULT_FILTERS = {
  sets: [],
  rarities: [],
  type: "",
  domains: [],
  tags: [],
  costMin: 1,
  costMax: 10,
  stockStatus: "Any",
};

const DOMAIN_COLORS: Record<string, string> = {
  fury:    '#ef4444', calm:  '#22c55e', mind:  '#3b82f6',
  body:    '#f97316', chaos: '#a855f7', order: '#eab308', colorless: '#94a3b8',
};

interface ActionButtonProps {
  onClick: () => void;
  title?: string;
  type: 'stats' | 'save' | 'browse' | 'import' | 'export' | 'clear';
  children: React.ReactNode;
}

function ActionButton({ onClick, title, type, children }: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);

  let baseStyle: React.CSSProperties = {
    padding: '7px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s ease',
    width: 'auto',
    whiteSpace: 'nowrap',
  };

  switch (type) {
    case 'stats':
      baseStyle = {
        ...baseStyle,
        background: hovered ? 'var(--accent-glow)' : 'var(--accent-muted)',
        color: 'var(--text-accent)',
        border: `1px solid ${hovered ? 'var(--accent)' : 'var(--accent-border, var(--border))'}`,
        boxShadow: hovered ? '0 0 14px var(--accent-glow)' : 'none',
        fontWeight: 800,
        transform: hovered ? 'translateY(-1px)' : 'none',
      };
      break;
    case 'save':
    case 'browse':
      baseStyle = {
        ...baseStyle,
        background: hovered ? 'var(--bg-raised)' : 'var(--bg-surface-2)',
        color: hovered ? '#ffffff' : 'var(--text-primary)',
        border: `1px solid ${hovered ? 'var(--border-hover)' : 'var(--border)'}`,
        boxShadow: hovered ? '0 2px 8px rgba(0,0,0,0.5)' : 'none',
        transform: hovered ? 'translateY(-1px)' : 'none',
      };
      break;
    case 'import':
    case 'export':
      baseStyle = {
        ...baseStyle,
        background: hovered ? 'rgba(14, 165, 233, 0.22)' : 'rgba(14, 165, 233, 0.1)',
        color: '#38bdf8',
        border: `1px solid ${hovered ? '#38bdf8' : 'rgba(14, 165, 233, 0.35)'}`,
        boxShadow: hovered ? '0 0 12px rgba(14, 165, 233, 0.35)' : 'none',
        transform: hovered ? 'translateY(-1px)' : 'none',
      };
      break;
    case 'clear':
      baseStyle = {
        ...baseStyle,
        background: hovered ? 'rgba(239, 68, 68, 0.25)' : 'rgba(239, 68, 68, 0.1)',
        color: '#ef4444',
        border: `1px solid ${hovered ? '#ef4444' : 'rgba(239, 68, 68, 0.4)'}`,
        boxShadow: hovered ? '0 0 12px rgba(239, 68, 68, 0.35)' : 'none',
        fontWeight: 800,
        transform: hovered ? 'translateY(-1px)' : 'none',
      };
      break;
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      style={baseStyle}
    >
      {children}
    </button>
  );
}

export function DeckBuilderApp() {
  const { isHu } = useLanguage();
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [loading, setLoading] = useState(true);
  // In the URL (?card=), so Back closes the preview and it can be shared.
  const [previewCardId, openPreview, closePreview] = useUrlOverlay('card');
  const showPreview = (card: CatalogCard) => openPreview(card.id);
  const [isWide, setIsWide] = useState(true);

  useEffect(() => {
    const check = () => setIsWide(window.innerWidth >= BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Deck Builder is currently Riftbound-only.
  const activeGame: GameId = 'riftbound';

  const { deck, addCard, removeCard, removeCardFromAnyZone, clearDeck, loadDeck, loaded } = useDeckBuilder(activeGame);
  const { savedDecks, saveDeck, updateDeck, deleteDeck, importDeck, loaded: savedDecksLoaded } = useSavedDecks(activeGame);
  // The saved deck currently being edited, so Save can offer to update it instead of always
  // creating a copy. Cleared when the deck is emptied or the game changes. Persisted per game
  // (like the working deck itself) so a page refresh doesn't lose the association and silently
  // turn every future Save into a duplicate instead of an overwrite.
  const loadedDeckIdStorageKey = gameStorageKey(activeGame, 'loaded_deck_id');
  const [loadedSavedDeckId, setLoadedSavedDeckId] = useState<string | null>(null);
  const [loadedSavedDeckIdReady, setLoadedSavedDeckIdReady] = useState(false);

  const loadedPublishedDeckIdStorageKey = gameStorageKey(activeGame, 'loaded_published_deck_id');
  const [loadedPublishedDeckId, setLoadedPublishedDeckId] = useState<string | null>(null);
  const [loadedPublishedDeckIdReady, setLoadedPublishedDeckIdReady] = useState(false);

  useEffect(() => {
    setLoadedSavedDeckIdReady(false);
    const saved = localStorage.getItem(loadedDeckIdStorageKey);
    setLoadedSavedDeckId(saved || null);
    setLoadedSavedDeckIdReady(true);
  }, [loadedDeckIdStorageKey]);

  useEffect(() => {
    if (!loadedSavedDeckIdReady) return;
    if (loadedSavedDeckId) localStorage.setItem(loadedDeckIdStorageKey, loadedSavedDeckId);
    else localStorage.removeItem(loadedDeckIdStorageKey);
  }, [loadedSavedDeckId, loadedSavedDeckIdReady, loadedDeckIdStorageKey]);

  useEffect(() => {
    setLoadedPublishedDeckIdReady(false);
    const saved = localStorage.getItem(loadedPublishedDeckIdStorageKey);
    setLoadedPublishedDeckId(saved || null);
    setLoadedPublishedDeckIdReady(true);
  }, [loadedPublishedDeckIdStorageKey]);

  useEffect(() => {
    if (!loadedPublishedDeckIdReady) return;
    if (loadedPublishedDeckId) localStorage.setItem(loadedPublishedDeckIdStorageKey, loadedPublishedDeckId);
    else localStorage.removeItem(loadedPublishedDeckIdStorageKey);
  }, [loadedPublishedDeckId, loadedPublishedDeckIdReady, loadedPublishedDeckIdStorageKey]);

  const [saveMode, setSaveMode] = useState<'update' | 'new'>('update');
  const loadedSavedDeck = savedDecks.find(d => d.id === loadedSavedDeckId) || null;
  const [activeZone, setActiveZone] = useState<keyof DeckState>(() => defaultZone(activeGame));

  // Reset active zone if it doesn't belong to the current game
  useEffect(() => {
    if (!hasZone(activeGame, activeZone as string)) {
      setActiveZone(defaultZone(activeGame));
    }
  }, [activeGame, activeZone]);

  const [viewMode, setViewMode] = useState<'builder' | 'preview'>('builder');
  const builderScrollYRef = useRef<number>(0);
  const switchViewMode = useCallback((next: 'builder' | 'preview') => {
    setViewMode((prev) => {
      if (prev === next) return prev;
      if (prev === 'builder' && next === 'preview') {
        builderScrollYRef.current = window.scrollY;
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
      } else if (prev === 'preview' && next === 'builder') {
        const restoreY = builderScrollYRef.current;
        requestAnimationFrame(() => window.scrollTo({ top: restoreY, behavior: 'instant' as ScrollBehavior }));
      }
      return next;
    });
  }, []);

  const [sideDeckOpen, setSideDeckOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('deckBuilderSideDeckOpen') === '1';
    } catch {
      return false;
    }
  });
  const toggleSideDeck = useCallback(() => {
    setSideDeckOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('deckBuilderSideDeckOpen', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  const [sideDeckView, setSideDeckView] = useState<'list' | 'grid'>(() => {
    if (typeof window === 'undefined') return 'grid';
    try {
      return localStorage.getItem('deckBuilderSideDeckView') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const handleSideDeckViewChange = useCallback((mode: 'list' | 'grid') => {
    setSideDeckView(mode);
    try {
      localStorage.setItem('deckBuilderSideDeckView', mode);
    } catch {}
  }, []);
  const values = useCardValueData();
  const { formatPrice } = useCurrency();
  const deckValue = useMemo(() => deckValueHuf(deck, cards, values), [deck, cards, values]);
  const rules = useMemo(() => getDeckRules(activeGame), [activeGame]);

  const sideboardCount = useMemo(() => {
    return Object.values(deck.sideboard || {}).reduce((a, b) => a + b, 0);
  }, [deck]);

  const mainBoardCount = useMemo(() => {
    let count = 0;
    if (deck.legend) count += 1;
    if (deck.champion) count += 1;
    if (deck.extraLegends) count += deck.extraLegends.length;
    Object.values(deck.mainDeck || {}).forEach(qty => { count += qty; });
    Object.values(deck.runeDeck || {}).forEach(qty => { count += qty; });
    Object.values(deck.battlefields || {}).forEach(qty => { count += qty; });
    return count;
  }, [deck]);

  const totalDeckCards = mainBoardCount + sideboardCount;

  const getZoneCount = useCallback((zoneKey: ZoneKey) => {
    switch (zoneKey) {
      case 'legend': return deck.legend ? 1 : 0;
      case 'champion': return deck.champion ? 1 : 0;
      case 'extraLegends': return (deck.extraLegends || []).length;
      case 'mainDeck': {
        const mainCount = Object.values(deck.mainDeck || {}).reduce((a, b) => a + b, 0);
        // In Riftbound, the Chosen Champion counts towards the 40 Main Deck cards (39 cards + 1 Champion = 40)
        const champCount = (hasZone(activeGame, 'champion') && deck.champion) ? 1 : 0;
        return mainCount + champCount;
      }
      case 'runeDeck': return Object.values(deck.runeDeck || {}).reduce((a, b) => a + b, 0);
      case 'battlefields': return Object.values(deck.battlefields || {}).reduce((a, b) => a + b, 0);
      case 'sideboard': return Object.values(deck.sideboard || {}).reduce((a, b) => a + b, 0);
      default: return 0;
    }
  }, [deck, activeGame]);

  const closeSaveModal = useCallback(() => setShowSaveModal(false), []);
  const closeBrowserModal = useCallback(() => setShowBrowserModal(false), []);
  const closeExportModal = useCallback(() => setShowExportModal(false), []);
  const closeImportModal = useCallback(() => setShowImportModal(false), []);
  const closeStatsModal = useCallback(() => setShowStatsModal(false), []);
  const [filtersSlot, setFiltersSlot] = useState<HTMLElement | null>(null);
  const [activeFiltersCount, setActiveFiltersCount] = useState(0);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showBrowserModal, setShowBrowserModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  
  const [gridSize, setGridSize] = useState<GridSize>(() => {
    if (typeof window === 'undefined') return 'normal';
    try {
      const saved = localStorage.getItem('deckBuilderGridSize') || sessionStorage.getItem('catalogGridSize');
      if (saved === 'small' || saved === 'normal' || saved === 'large') return saved as GridSize;
    } catch {}
    return 'normal';
  });

  const handleGridSizeChange = useCallback((size: GridSize) => {
    setGridSize(size);
    try {
      localStorage.setItem('deckBuilderGridSize', size);
    } catch {}
  }, []);
  
  const [deckNameInput, setDeckNameInput] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [publishedDecks, setPublishedDecks] = useState<PublicDeckSummary[]>([]);
  const [publishingSavedDeckId, setPublishingSavedDeckId] = useState<string | null>(null);
  const [syncToPublished, setSyncToPublished] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUser(data.user || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const refreshPublishedDecks = () => {
    if (!currentUser) { setPublishedDecks([]); return; }
    fetchMyDecks().then(setPublishedDecks);
  };

  useEffect(() => {
    refreshPublishedDecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  const linkedPublishedDeck = useMemo(() => {
    if (!currentUser) return null;
    if (loadedPublishedDeckId) {
      const found = publishedDecks.find(pd => pd.id === loadedPublishedDeckId);
      if (found) return found;
    }
    if (loadedSavedDeck?.publishedDeckId) {
      const found = publishedDecks.find(pd => pd.id === loadedSavedDeck.publishedDeckId);
      if (found) return found;
    }
    const currentName = (loadedSavedDeck?.name || deckNameInput).trim().toLowerCase();
    if (currentName) {
      const found = publishedDecks.find(pd => pd.name.trim().toLowerCase() === currentName);
      if (found) return found;
    }
    return null;
  }, [currentUser, loadedPublishedDeckId, loadedSavedDeck, publishedDecks, deckNameInput]);



  const isAnyModalOpen = Boolean(
    previewCardId || showSaveModal || showBrowserModal || showExportModal || showImportModal || showStatsModal
  );

  // Close modals on Escape key
  useEffect(() => {
    if (!isAnyModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePreview();
        setShowSaveModal(false);
        setShowBrowserModal(false);
        setShowExportModal(false);
        setShowImportModal(false);
        setShowStatsModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAnyModalOpen, closePreview]);

  // Lock background scroll when preview modal or any dialog is open
  useBodyScrollLock(isAnyModalOpen);

  const processImportString = (content: string) => {
    if (!content || !content.trim()) {
      alert(isHu ? 'Kérlek adj meg vagy tölts fel egy pakli tartalmat.' : 'Please enter or upload deck content.');
      return;
    }
    const result = importDeck(content, cards);
    if (result.type === 'single') {
      loadDeck(result.deck);
      setShowImportModal(false);
      setPasteInput('');
      alert(isHu ? `"${result.name}" sikeresen importálva és betöltve!` : `Successfully imported and loaded "${result.name}"!`);
    } else if (result.type === 'multi') {
      if (result.decks.length > 0) {
        loadDeck(result.decks[0].deck);
      }
      setShowImportModal(false);
      setPasteInput('');
      alert(isHu ? `Sikeresen importálva ${result.count} pakli! Az első pakli betöltve, és az összes hozzáadva a mentett paklikhoz.` : `Successfully imported ${result.count} decks! Loaded the first deck and added all to your saved decks.`);
    } else {
      alert(result.message || (isHu ? 'Nem sikerült a pakli importálása. Kérlek ellenőrizd a formátumot.' : 'Failed to import deck. Please check format.'));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        processImportString(content);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handlePublishSavedDeck = async (sd: { id: string; name: string; deck: DeckState; publishedDeckId?: string }) => {
    if (!currentUser) {
      alert(isHu ? 'Jelentkezz be paklik közzétételéhez a profilodon.' : 'Sign in to publish decks to your profile.');
      return;
    }
    const matchingPublished = publishedDecks.find(pd => pd.id === sd.publishedDeckId || pd.name.trim().toLowerCase() === sd.name.trim().toLowerCase());
    setPublishingSavedDeckId(sd.id);
    try {
      if (matchingPublished) {
        const result = await updatePublishedDeck(matchingPublished.id, sd.name, sd.deck.game || activeGame, sd.deck);
        if (result.success) {
          updateDeck(sd.id, sd.deck, sd.name, matchingPublished.id);
          refreshPublishedDecks();
          alert(isHu ? `A(z) "${sd.name}" frissítve lett a legfrissebb módosításaiddal a /decks oldalon!` : `"${sd.name}" on /decks has been updated with your latest changes!`);
        } else {
          alert(result.error || (isHu ? 'Nem sikerült frissíteni a paklit a /decks oldalon.' : 'Failed to update deck on /decks.'));
        }
      } else {
        const result = await publishDeck(sd.name, sd.deck.game || activeGame, sd.deck);
        if (result.success) {
          if (result.deck?.id) {
            updateDeck(sd.id, sd.deck, sd.name, result.deck.id);
          }
          refreshPublishedDecks();
          alert(isHu ? `A(z) "${sd.name}" mostantól nyilvános a profilodon!` : `"${sd.name}" is now public on your profile!`);
        } else {
          alert(result.error || (isHu ? 'Nem sikerült közzétenni a paklit.' : 'Failed to publish deck.'));
        }
      }
    } finally {
      setPublishingSavedDeckId(null);
    }
  };

  const handleUnpublishDeck = async (publishedId: string) => {
    if (!confirm(isHu ? 'Eltávolítod ezt a paklit a nyilvános profilodról?' : 'Remove this deck from your public profile?')) return;
    const ok = await deletePublishedDeck(publishedId);
    if (ok) refreshPublishedDecks();
    else alert(isHu ? 'Nem sikerült a pakli visszavonása.' : 'Failed to unpublish deck.');
  };

  // Fetch cards whenever activeGame changes
  useEffect(() => {
    async function loadCards() {
      setLoading(true);
      const { data } = await fetchCardsCatalog({ ...DEFAULT_FILTERS, game: activeGame, ...defaultCostBounds(activeGame) } as any, '');
      if (data) {
        setCards(data);
      }
      setLoading(false);
    }
    loadCards();
  }, [activeGame]);

  const legendCard = useMemo(() => {
    if (!deck.legend) return null;
    return cards.find(c => c.id === deck.legend) || null;
  }, [deck.legend, cards]);

  const championCard = useMemo(() => {
    if (!deck.champion) return null;
    return cards.find(c => c.id === deck.champion) || null;
  }, [deck.champion, cards]);

  const allowedDomains = useMemo(() => {
    if (!legendCard || !legendCard.domain) return null;
    return legendCard.domain.split(/[,/]/).map(d => d.trim().toLowerCase()).filter(Boolean);
  }, [legendCard]);

  if (loading || !loaded) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0', color: 'var(--accent-light)' }}>
        {isHu ? 'Pakliépítő betöltése...' : 'Loading Deck Builder...'}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', padding: '0 clamp(12px, 1.5vw, 24px) clamp(16px, 2vw, 28px)' }}>
      {/* Sticky Top Chrome: Deck Header + Zone Selector */}
      <div
        className="sticky z-30 -mx-[clamp(12px,1.5vw,24px)] px-[clamp(12px,1.5vw,24px)] pt-3 pb-2 mb-4 border-b"
        style={{
          top: 'var(--header-h, 58px)',
          background: 'var(--bg-header)',
          backdropFilter: 'blur(14px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          {/* Left: Deck Title & Stats */}
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-black leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
                  {loadedSavedDeck ? loadedSavedDeck.name : (legendCard ? (isHu ? `${legendCard.name} Pakli` : `${legendCard.name} Deck`) : (isHu ? 'Új pakli' : 'New Deck'))}
                </h1>
                <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)', color: 'var(--text-accent)' }}>
                  {activeGame}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                <span>{sideboardCount > 0 ? (isHu ? `${mainBoardCount} főpakli (+${sideboardCount} sideboard)` : `${mainBoardCount} main board (+${sideboardCount} sideboard)`) : (isHu ? `${mainBoardCount} kártya` : `${mainBoardCount} cards`)}</span>
                <span aria-hidden="true">·</span>
                <span style={{ color: 'var(--text-accent)', fontWeight: 800 }}>
                  {formatPrice(deckValue.totalHuf)}
                </span>
                {deckValue.unpricedCards > 0 && (
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    ({deckValue.unpricedCards} {isHu ? 'ár nélküli' : 'unpriced'})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Center: View Switcher (Builder vs Preview) + Side Deck Toggle */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <div className="flex items-center p-1 rounded-xl border shrink-0" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => switchViewMode('builder')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'builder'
                    ? 'bg-[var(--accent)] text-[var(--text-on-accent,#000)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
                <span>{isHu ? 'Kártyák' : 'Cards'}</span>
              </button>
              <button
                type="button"
                onClick={() => switchViewMode('preview')}
                className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'preview'
                    ? 'bg-[var(--accent)] text-[var(--text-on-accent,#000)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                </svg>
                <span>{isHu ? 'Teljes előnézet' : 'Full Preview'}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${viewMode === 'preview' ? 'bg-black/25 text-inherit' : 'bg-[var(--bg-raised)] text-[var(--text-primary)]'}`}>
                  {mainBoardCount}{sideboardCount > 0 ? `+${sideboardCount}` : ''}
                </span>
              </button>
            </div>

            {viewMode === 'builder' && (
              <button
                type="button"
                onClick={toggleSideDeck}
                aria-pressed={sideDeckOpen}
                className="h-9 px-3 rounded-xl border text-xs font-bold transition cursor-pointer inline-flex items-center gap-1.5 shrink-0"
                style={
                  sideDeckOpen
                    ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                    : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }
                }
                title={isHu ? 'Oldalsó kompakt paklilista ki-/bekapcsolása' : 'Toggle compact side deck list'}
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="15" y1="3" x2="15" y2="21" />
                </svg>
                <span>{isHu ? 'Oldalsó pakli' : 'Side Deck'}</span>
                <span className="text-[10px] font-mono font-black opacity-80">
                  {totalDeckCards}
                </span>
              </button>
            )}
          </div>

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <ActionButton onClick={() => setShowStatsModal(true)} type="stats" title={isHu ? 'Pakli statisztikák' : 'Deck Statistics'}>
              {isHu ? 'Statisztika' : 'Statistics'}
            </ActionButton>
            <ActionButton
              onClick={() => {
                setSaveMode('update');
                if (loadedSavedDeck) {
                  setDeckNameInput(loadedSavedDeck.name);
                } else if (linkedPublishedDeck) {
                  setDeckNameInput(linkedPublishedDeck.name);
                }
                setSyncToPublished(true);
                setShowSaveModal(true);
              }}
              type="save"
            >
              {isHu ? 'Mentés' : 'Save'}
            </ActionButton>
            <ActionButton onClick={() => setShowBrowserModal(true)} type="browse">
              {isHu ? 'Böngészés' : 'Browse'}
            </ActionButton>
            <ActionButton onClick={() => setShowImportModal(true)} type="import">
              {isHu ? 'Importálás' : 'Import'}
            </ActionButton>
            <ActionButton onClick={() => setShowExportModal(true)} type="export">
              {isHu ? 'Exportálás' : 'Export'}
            </ActionButton>
            <ActionButton
              onClick={() => {
                if (confirm(isHu ? 'Biztosan törlöd a teljes paklit?' : 'Clear entire deck?')) {
                  clearDeck();
                  setLoadedSavedDeckId(null);
                  setLoadedPublishedDeckId(null);
                }
              }}
              type="clear"
            >
              {isHu ? 'Pakli ürítése' : 'Clear Deck'}
            </ActionButton>
          </div>
        </div>

        {/* Sticky Zone Selector Bar (only in builder mode) */}
        {viewMode === 'builder' && (
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            {rules.zones.map(zone => {
              const count = getZoneCount(zone.key);
              const isSelected = activeZone === zone.key;
              const isComplete = zone.exact ? count === zone.max : (zone.min ? count >= zone.min : count > 0);
              const isExceeded = count > zone.max;
              return (
                <button
                  key={zone.key}
                  type="button"
                  onClick={() => setActiveZone(zone.key)}
                  title={
                    zone.key === 'mainDeck' && hasZone(activeGame, 'champion') && deck.champion
                      ? (isHu ? `${Object.values(deck.mainDeck || {}).reduce((a, b) => a + b, 0)} kártya a Főpakliban + 1 Kiválasztott Bajnok` : `${Object.values(deck.mainDeck || {}).reduce((a, b) => a + b, 0)} cards in Main Deck + 1 Chosen Champion`)
                      : undefined
                  }
                  className={`h-8 px-3 border-b-2 text-xs font-bold transition flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'border-[var(--accent)] text-[var(--text-primary)]'
                      : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)]'
                  }`}
                >
                  <span>
                    {isHu ? (
                      zone.key === 'legend' ? 'Legenda' :
                      zone.key === 'extraLegends' ? 'Extra Legendák' :
                      zone.key === 'champion' ? 'Bajnok' :
                      zone.key === 'mainDeck' ? 'Főpakli' :
                      zone.key === 'runeDeck' ? 'Rúna Pakli' :
                      zone.key === 'battlefields' ? 'Csatamezők' :
                      zone.key === 'sideboard' ? 'Sideboard' :
                      zone.label
                    ) : zone.label}
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      isExceeded
                        ? 'text-red-400'
                        : isComplete
                        ? 'text-[var(--positive)]'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {count}{zone.exact ? `/${zone.max}` : zone.min ? `/${zone.min}+` : `/${zone.max}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Full Deck Board View (kept mounted to preserve filter state and performance) */}
      <div className={`w-full ${viewMode === 'preview' ? '' : 'hidden'}`}>
        <DeckBoardView
          deck={deck}
          cards={cards}
          activeGame={activeGame}
          onCardClick={showPreview}
          onRemoveCard={(c, zone) => removeCard(c.id, zone)}
          onAddCard={(c, zone) => addCard(c, zone, cards)}
          gridSize={gridSize}
          onGridSizeChange={handleGridSizeChange}
        />
      </div>

      {/* Builder View: Left Filters + Center Catalog + Optional Compact Side Deck Panel */}
      <div className={`flex flex-col gap-3 ${viewMode === 'builder' ? '' : 'hidden'}`}>
          {/* Catalog, Filters & Optional Side Deck Container */}
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: isWide ? 'row' : 'column',
              gap: 16,
              minHeight: 0,
            }}
          >
            {/* Left: Filters Sidebar */}
            <div
              style={{
                flex: isWide ? '0 0 clamp(250px, 18vw, 310px)' : '0 0 auto',
                width: isWide ? 'clamp(250px, 18vw, 310px)' : '100%',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg, 6px)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                position: isWide ? 'sticky' : undefined,
                top: isWide ? 'calc(var(--header-h, 58px) + 122px)' : undefined,
                alignSelf: 'flex-start',
              }}
            >
              <div
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
                  {isHu ? 'Szűrők' : 'Filters'}
                </span>
                {activeFiltersCount > 0 && (
                  <span
                    style={{
                      background: 'var(--bg-raised)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 4,
                      padding: '1px 6px',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {activeFiltersCount} {isHu ? 'aktív' : 'active'}
                  </span>
                )}
              </div>
              <div
                ref={setFiltersSlot}
                className="custom-scrollbar"
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  maxHeight: isWide ? 'calc(100dvh - var(--header-h, 58px) - 180px)' : '60dvh',
                }}
              />
            </div>

            {/* Center: Catalog Grid (Flex 1 - Full Width) */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <DeckCatalog
                cards={cards}
                activeGame={activeGame}
                allowedDomains={allowedDomains}
                legendCard={legendCard}
                championCard={championCard}
                activeZone={activeZone}
                deck={deck}
                onAddCard={(c) => addCard(c, activeZone, cards)}
                onPreviewCard={showPreview}
                isWide={isWide}
                filtersSlot={filtersSlot}
                onActiveFiltersCountChange={setActiveFiltersCount}
                gridSize={gridSize}
                onGridSizeChange={handleGridSizeChange}
              />
            </div>

            {/* Right: Optional Compact Sticky Side Deck List (Desktop) */}
            {isWide && sideDeckOpen && (
              <aside
                style={{
                  flex: '0 0 clamp(270px, 21vw, 350px)',
                  width: 'clamp(270px, 21vw, 350px)',
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-lg, 6px)',
                  border: '1px solid var(--border)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'sticky',
                  top: 'calc(var(--header-h, 58px) + 122px)',
                  maxHeight: 'calc(100dvh - var(--header-h, 58px) - 138px)',
                  alignSelf: 'flex-start',
                }}
              >
                <div
                  className="px-3.5 py-2 border-b flex items-center justify-between gap-2 shrink-0"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-secondary)' }}>
                      {isHu ? 'Pakli' : 'Deck'}
                    </span>
                    <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color: 'var(--text-accent)' }}>
                      {mainBoardCount}{sideboardCount > 0 ? `+${sideboardCount}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div
                      className="inline-flex items-center p-0.5 rounded-md border"
                      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
                    >
                      <button
                        type="button"
                        onClick={() => handleSideDeckViewChange('list')}
                        aria-label={isHu ? 'Lista nézet' : 'List view'}
                        title={isHu ? 'Lista nézet' : 'List view'}
                        className="w-6 h-5 rounded flex items-center justify-center cursor-pointer transition"
                        style={
                          sideDeckView === 'list'
                            ? { background: 'var(--accent)', color: 'var(--text-on-accent, #000)' }
                            : { color: 'var(--text-tertiary)' }
                        }
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSideDeckViewChange('grid')}
                        aria-label={isHu ? 'Rács nézet' : 'Grid view'}
                        title={isHu ? 'Rács nézet' : 'Grid view'}
                        className="w-6 h-5 rounded flex items-center justify-center cursor-pointer transition"
                        style={
                          sideDeckView === 'grid'
                            ? { background: 'var(--accent)', color: 'var(--text-on-accent, #000)' }
                            : { color: 'var(--text-tertiary)' }
                        }
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                        </svg>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={toggleSideDeck}
                      aria-label={isHu ? 'Oldalsó pakli bezárása' : 'Close side deck'}
                      className="w-6 h-6 rounded flex items-center justify-center cursor-pointer hover:bg-[var(--bg-raised)]"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3">
                  <DeckList
                    deck={deck}
                    cards={cards}
                    activeGame={activeGame}
                    legendCard={legendCard}
                    championCard={championCard}
                    onRemoveCard={(id, zone) => removeCard(id, zone)}
                    onCardClick={showPreview}
                    activeZone={activeZone}
                    onSetZone={setActiveZone}
                    isWide={false}
                    viewMode={sideDeckView}
                  />
                </div>
              </aside>
            )}
          </div>
        </div>

      {/* Compact Side Deck Drawer for narrow screens */}
      {!isWide && viewMode === 'builder' && sideDeckOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={toggleSideDeck}
        >
          <aside
            className="w-full max-w-sm h-full flex flex-col border-l shadow-2xl"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="px-4 py-3 border-b flex items-center justify-between gap-2 shrink-0"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                  {isHu ? 'Pakli' : 'Deck'}
                </span>
                <span className="text-xs font-mono font-bold" style={{ color: 'var(--text-accent)' }}>
                  {mainBoardCount}{sideboardCount > 0 ? `+${sideboardCount}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="inline-flex items-center p-0.5 rounded-lg border"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
                >
                  <button
                    type="button"
                    onClick={() => handleSideDeckViewChange('list')}
                    aria-label={isHu ? 'Lista nézet' : 'List view'}
                    className="w-7 h-6 rounded flex items-center justify-center cursor-pointer transition"
                    style={
                      sideDeckView === 'list'
                        ? { background: 'var(--accent)', color: 'var(--text-on-accent, #000)' }
                        : { color: 'var(--text-tertiary)' }
                    }
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSideDeckViewChange('grid')}
                    aria-label={isHu ? 'Rács nézet' : 'Grid view'}
                    className="w-7 h-6 rounded flex items-center justify-center cursor-pointer transition"
                    style={
                      sideDeckView === 'grid'
                        ? { background: 'var(--accent)', color: 'var(--text-on-accent, #000)' }
                        : { color: 'var(--text-tertiary)' }
                    }
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                    </svg>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={toggleSideDeck}
                  aria-label={isHu ? 'Bezárás' : 'Close'}
                  className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3.5 pb-4">
              <DeckList
                deck={deck}
                cards={cards}
                activeGame={activeGame}
                legendCard={legendCard}
                championCard={championCard}
                onRemoveCard={(id, zone) => removeCard(id, zone)}
                onCardClick={showPreview}
                activeZone={activeZone}
                onSetZone={setActiveZone}
                isWide={false}
                viewMode={sideDeckView}
              />
            </div>
          </aside>
        </div>
      )}

      {/* Deck Statistics Modal */}
      {showStatsModal && (
        <DeckStatisticsModal
          deck={deck}
          cards={cards}
          activeGame={activeGame}
          legendCard={legendCard}
          championCard={championCard}
          onClose={() => setShowStatsModal(false)}
          
        />
      )}

      {/* Card Preview Modal */}
      <CardPreviewOverlay cardId={previewCardId} onClose={closePreview} />

      {/* Modals for Saved Decks features. Modal holds itself open for its own exit transition
          (isOpen), so each is rendered unconditionally rather than wrapped in `{flag && (...)}`,
          which would unmount it before that transition gets to play. */}
      <Modal
        isOpen={showSaveModal}
        onClose={closeSaveModal}
        title={loadedSavedDeck || linkedPublishedDeck ? (saveMode === 'update' ? (isHu ? 'Pakli frissítése' : 'Update Deck') : (isHu ? 'Mentés új pakliként' : 'Save as New Deck')) : (isHu ? 'Pakli mentése' : 'Save Deck')}
      >
        {(loadedSavedDeck || linkedPublishedDeck) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
              {isHu ? `Betöltötted a(z) "${loadedSavedDeck?.name || linkedPublishedDeck?.name}" paklit a mentett paklijaid közül. Mit szeretnél tenni a módosításokkal?` : `You loaded "${loadedSavedDeck?.name || linkedPublishedDeck?.name}" from your saved decks. What do you want to do with your changes?`}
            </p>
            {([
              {
                mode: 'update' as const,
                title: isHu ? `"${loadedSavedDeck?.name || linkedPublishedDeck?.name}" frissítése` : `Update "${loadedSavedDeck?.name || linkedPublishedDeck?.name}"`,
                desc: linkedPublishedDeck
                  ? (isHu ? 'A mentett pakli felülírása és a /decks oldalon közzétett változat frissítése' : 'Replace the saved deck list and update the version posted to /decks')
                  : (isHu ? 'A mentett pakli felülírása a jelenlegivel' : 'Replace the saved deck list with the current one'),
              },
              {
                mode: 'new' as const,
                title: isHu ? 'Mentés új pakliként' : 'Save as a new deck',
                desc: isHu ? 'Az eredeti megtartása és ennek hozzáadása külön pakliként' : 'Keep the original as it was and add this as a separate deck',
              },
            ]).map(opt => (
              <button
                key={opt.mode}
                type="button"
                onClick={() => {
                  setSaveMode(opt.mode);
                  const baseName = loadedSavedDeck?.name || linkedPublishedDeck?.name || '';
                  setDeckNameInput(opt.mode === 'update' ? baseName : `${baseName} (copy)`);
                }}
                style={{
                  textAlign: 'left', cursor: 'pointer', padding: '10px 14px', borderRadius: 10,
                  background: saveMode === opt.mode ? 'var(--accent-muted)' : 'var(--bg-input)',
                  border: `1px solid ${saveMode === opt.mode ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--text-primary)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800 }}>{opt.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
            {linkedPublishedDeck && saveMode === 'update' && (
              <label className="flex items-center gap-2 mt-1 text-xs cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={syncToPublished}
                  onChange={e => setSyncToPublished(e.target.checked)}
                  className="rounded cursor-pointer"
                />
                <span>{isHu ? 'Frissítések szinkronizálása a /decks oldalon lévő nyilvános paklival is' : 'Also sync updates to public deck on /decks'}</span>
              </label>
            )}
          </div>
        )}
        <input autoFocus type="text" value={deckNameInput} onChange={e => setDeckNameInput(e.target.value)} placeholder={isHu ? 'Pakli neve' : 'Deck Name'} style={inputStyle} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button onClick={() => setShowSaveModal(false)} style={btnStyle()}>{isHu ? 'Mégse' : 'Cancel'}</button>
          <button
            onClick={async () => {
              const name = deckNameInput.trim();
              if (!name) return;
              const targetPubId = linkedPublishedDeck?.id || loadedSavedDeck?.publishedDeckId;
              if (loadedSavedDeck && saveMode === 'update') {
                updateDeck(loadedSavedDeck.id, deck, name, targetPubId);
              } else if (linkedPublishedDeck && saveMode === 'update') {
                const created = saveDeck(name, deck, targetPubId);
                setLoadedSavedDeckId(created.id);
              } else {
                const created = saveDeck(name, deck);
                setLoadedSavedDeckId(created.id);
                setLoadedPublishedDeckId(null);
              }

              if (linkedPublishedDeck && saveMode === 'update' && syncToPublished) {
                try {
                  const res = await updatePublishedDeck(linkedPublishedDeck.id, name, activeGame, deck);
                  if (res.success) {
                    refreshPublishedDecks();
                  } else {
                    console.warn('Failed to update published deck:', res.error);
                  }
                } catch (err) {
                  console.error('Error syncing published deck:', err);
                }
              }

              setDeckNameInput('');
              setShowSaveModal(false);
            }}
            style={btnStyle('#6366f1', '#fff', '#6366f1')}
          >
            {(loadedSavedDeck || linkedPublishedDeck) && saveMode === 'update' ? (isHu ? 'Pakli frissítése' : 'Update Deck') : (isHu ? 'Mentés' : 'Save')}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={showImportModal}
        onClose={closeImportModal}
        title={isHu ? "Pakli importálása" : "Import Deck"}
        maxWidth="max-w-xl"
      >
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
          {isHu ? 'Tölts fel egy paklifájlt (.json vagy .txt), vagy illessz be egy JSON objektumot / szöveges listát alább.' : 'Upload a deck file (.json or .txt) or paste a JSON object / text decklist below.'}
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              ...btnStyle('var(--bg-input)', 'var(--text-primary)', 'var(--border)'),
              flex: 1, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13,
            }}
          >
            {isHu ? 'JSON / TXT fájl kiválasztása…' : 'Choose JSON / TXT File…'}
          </button>
        </div>

        <textarea
          value={pasteInput}
          onChange={e => setPasteInput(e.target.value)}
          placeholder={isHu ? `Illeszd be a pakli JSON vagy szöveges listáját ide...\n\nPélda:\n// Legend\n1 Blind Monk\n// Champion\n1 Lee Sin, Dragon\n// Main Deck\n3 Affectionate Poro\n2 Ahri, Inquisitive` : `Paste deck JSON or text list here...\n\nExample:\n// Legend\n1 Blind Monk\n// Champion\n1 Lee Sin, Dragon\n// Main Deck\n3 Affectionate Poro\n2 Ahri, Inquisitive`}
          style={{
            width: '100%', height: 160, padding: 12, borderRadius: 10,
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 12,
            resize: 'vertical', boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button onClick={() => setShowImportModal(false)} style={btnStyle()}>{isHu ? 'Mégse' : 'Cancel'}</button>
          <button 
            onClick={() => processImportString(pasteInput)}
            style={btnStyle('#6366f1', '#fff', '#6366f1')}
          >
            {isHu ? 'Pakli importálása' : 'Import Deck'}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={showExportModal}
        onClose={closeExportModal}
        title={isHu ? "Pakli exportálása" : "Export Deck"}
        maxWidth="max-w-xl"
      >
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          {isHu ? 'Exportáld a jelenlegi aktív paklidat, vagy töltsd le az összes mentett paklit.' : 'Export your current active deck or download all saved decks.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Export Current Deck JSON */}
          <button
            onClick={() => {
              const deckName = deckNameInput.trim() || (legendCard ? (isHu ? `${legendCard.name} Pakli` : `${legendCard.name} Deck`) : (isHu ? 'Paklim' : 'My Deck'));
              const jsonStr = exportDeckToJson(deck, cards, deckName);
              const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
              const anchor = document.createElement('a');
              anchor.setAttribute("href", dataStr);
              const safeFilename = deckName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
              anchor.setAttribute("download", `${safeFilename}.json`);
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              setShowExportModal(false);
            }}
            style={{
              ...btnStyle('var(--bg-input)', 'var(--text-primary)', 'var(--border)'),
              padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{isHu ? 'Jelenlegi pakli letöltése (JSON)' : 'Download Current Deck (JSON)'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{isHu ? 'Egyedi paklifájl kártyanevekkel és metaadatokkal' : 'Single deck file with card names and metadata'}</div>
            </div>
            <span>↓</span>
          </button>

          {/* Copy Decklist as Text */}
          <button
            onClick={() => {
              const deckName = deckNameInput.trim() || (legendCard ? (isHu ? `${legendCard.name} Pakli` : `${legendCard.name} Deck`) : (isHu ? 'Paklim' : 'My Deck'));
              const textDeck = exportDeckToText(deck, cards, deckName);
              navigator.clipboard.writeText(textDeck);
              alert(isHu ? 'Paklilista másolva a vágólapra!' : 'Decklist copied to clipboard!');
              setShowExportModal(false);
            }}
            style={{
              ...btnStyle('var(--bg-input)', 'var(--text-primary)', 'var(--border)'),
              padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{isHu ? 'Paklilista másolása a vágólapra' : 'Copy Decklist to Clipboard'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{isHu ? 'Egyszerű szöveges formátum kártyanevekkel Discordhoz vagy fórumokhoz' : 'Plain text format with card names for Discord or forums'}</div>
            </div>
            <span>→</span>
          </button>

          {/* Publish or Update Current Deck on /decks */}
          <button
            onClick={async () => {
              if (!currentUser) {
                alert(isHu ? 'Jelentkezz be paklik közzétételéhez a profilodon.' : 'Sign in to publish decks to your profile.');
                return;
              }
              const deckName = deckNameInput.trim() || (legendCard ? (isHu ? `${legendCard.name} Pakli` : `${legendCard.name} Deck`) : (isHu ? 'Paklim' : 'My Deck'));
              const matchingPublished = linkedPublishedDeck || publishedDecks.find(pd => pd.name.trim().toLowerCase() === deckName.toLowerCase());
              if (matchingPublished) {
                const result = await updatePublishedDeck(matchingPublished.id, deckName, activeGame, deck);
                if (result.success) {
                  if (loadedSavedDeck) {
                    updateDeck(loadedSavedDeck.id, deck, deckName, matchingPublished.id);
                  }
                  refreshPublishedDecks();
                  alert(isHu ? `A(z) "${deckName}" frissítve lett a legfrissebb módosításaiddal a /decks oldalon!` : `"${deckName}" on /decks has been updated with your latest changes!`);
                  setShowExportModal(false);
                } else {
                  alert(result.error || (isHu ? 'Nem sikerült frissíteni a paklit a /decks oldalon.' : 'Failed to update deck on /decks.'));
                }
              } else {
                const result = await publishDeck(deckName, activeGame, deck);
                if (result.success) {
                  if (result.deck?.id && loadedSavedDeck) {
                    updateDeck(loadedSavedDeck.id, deck, deckName, result.deck.id);
                  }
                  if (result.deck?.id) {
                    setLoadedPublishedDeckId(result.deck.id);
                  }
                  refreshPublishedDecks();
                  alert(isHu ? `A(z) "${deckName}" mostantól nyilvános a profilodon!` : `"${deckName}" is now public on your profile!`);
                  setShowExportModal(false);
                } else {
                  alert(result.error || (isHu ? 'Nem sikerült közzétenni a paklit.' : 'Failed to publish deck.'));
                }
              }
            }}
            style={{
              ...btnStyle('var(--bg-input)', 'var(--text-primary)', 'var(--border)'),
              padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{linkedPublishedDeck ? (isHu ? 'Frissítés a /decks oldalon' : 'Update on /decks') : (isHu ? 'Közzététel a profilodon' : 'Publish to Your Profile')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {linkedPublishedDeck ? (isHu ? `Módosítások szinkronizálása a(z) "${linkedPublishedDeck.name}" nyilvános paklival a /decks oldalon` : `Sync changes to your public deck "${linkedPublishedDeck.name}" on /decks`) : (isHu ? 'Tedd ezt a paklit bárki számára böngészhetővé a nyilvános profilodon' : 'Make this deck browsable by anyone on your public profile')}
              </div>
            </div>
            <span>→</span>
          </button>

          {/* Export All Saved Decks Backup */}
          <button
            onClick={() => {
              const jsonStr = exportSavedDecksToJson(savedDecks, cards);
              const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
              const anchor = document.createElement('a');
              anchor.setAttribute("href", dataStr);
              anchor.setAttribute("download", "tcgxchange_all_saved_decks.json");
              document.body.appendChild(anchor);
              anchor.click();
              anchor.remove();
              setShowExportModal(false);
            }}
            style={{
              ...btnStyle('var(--bg-input)', 'var(--text-primary)', 'var(--border)'),
              padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, textAlign: 'left',
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{isHu ? `Összes mentett pakli biztonsági mentése (${savedDecks.length})` : `Backup All Saved Decks (${savedDecks.length})`}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{isHu ? 'Teljes biztonsági mentés kártyanevekkel és statisztikákkal' : 'Full backup with complete card names and stats'}</div>
            </div>
            <span>↓</span>
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={() => setShowExportModal(false)} style={btnStyle()}>{isHu ? 'Bezárás' : 'Close'}</button>
        </div>
      </Modal>

      <Modal
        isOpen={showBrowserModal}
        onClose={closeBrowserModal}
        title={isHu ? "Mentett paklik" : "Saved Decks"}
        maxWidth="max-w-2xl"
      >
        <div className="flex flex-col gap-4 max-h-[70dvh] overflow-y-auto pr-1">
          {savedDecks.length === 0 && (
            <p className="text-zinc-500 text-sm py-4 text-center">{isHu ? 'Nem találhatók mentett paklik.' : 'No saved decks found.'}</p>
          )}
          {savedDecks.map(sd => {
            const lCard = cards.find(c => c.id === sd.deck.legend);
            const cCard = cards.find(c => c.id === sd.deck.champion);
            const firstMainId = Object.keys(sd.deck.mainDeck || {})[0];
            const fallbackCard = cards.find(c => c.id === firstMainId);
            const fallback = `https://placehold.co/400x560/1e293b/94a3b8?text=Deck`;
            const primaryCard = lCard || fallbackCard;
            const primaryImg = primaryCard?.image_path ? getCardImageUrl(primaryCard.image_path) : fallback;
            const domains = lCard?.domain ? lCard.domain.split(',').map(d => d.trim().toLowerCase()) : [];
            const isOnePiece = (sd.deck.game || activeGame) === 'onepiece';
            const isPublished = Boolean(
              publishedDecks.some(pd => pd.id === sd.publishedDeckId || pd.name.trim().toLowerCase() === sd.name.trim().toLowerCase())
            );

            return (
              <div key={sd.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-zinc-950/60 rounded-xl border border-zinc-800">
                <div className="flex items-center gap-4">
                  <div className="flex relative">
                    <div className="w-14 h-20 rounded-lg overflow-hidden z-10 border border-zinc-700 shadow-md">
                      <img src={primaryImg} alt={primaryCard?.name || "Deck"} className="w-full h-full object-cover" />
                    </div>
                    {cCard && (
                      <div className="w-14 h-20 rounded-lg overflow-hidden -ml-6 z-0 border border-zinc-700 shadow-md">
                        <img src={cCard.image_path ? getCardImageUrl(cCard.image_path) : fallback} alt="Champion" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <div className="font-bold text-base text-zinc-100">{sd.name}</div>
                      {isPublished && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                          {isHu ? 'Közzétéve' : 'Published'}
                        </span>
                      )}
                      {domains.length > 0 && (
                        <div className="flex gap-1">
                          {domains.map(d => (
                            <div key={d} className="w-2.5 h-2.5 rounded-full" style={{ background: DOMAIN_COLORS[d] || '#94a3b8' }} title={d} />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 mb-1">{new Date(sd.createdAt).toLocaleDateString(undefined)}</div>
                    <div className="text-xs text-zinc-400 space-y-0.5">
                      {lCard && <div><span className="text-zinc-500">{isOnePiece ? 'Leader:' : (isHu ? 'Legenda:' : 'Legend:')}</span> {lCard.name}</div>}
                      {cCard && <div><span className="text-zinc-500">{isHu ? 'Bajnok:' : 'Champion:'}</span> {cCard.name}</div>}
                      {!lCard && !cCard && (
                        <div><span className="text-zinc-500">{isHu ? 'Kártyák:' : 'Cards:'}</span> {Object.values(sd.deck.mainDeck || {}).reduce((a, b) => a + b, 0)}</div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 self-end sm:self-auto flex-wrap">
                  <button
                    type="button"
                    onClick={() => { if(confirm(isHu ? 'Biztosan törlöd ezt a paklit?' : 'Delete this deck?')) deleteDeck(sd.id); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition cursor-pointer"
                  >
                    {isHu ? 'Törlés' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePublishSavedDeck(sd)}
                    disabled={publishingSavedDeckId === sd.id}
                    title={isPublished ? (isHu ? "A /decks oldalon közzétett pakli frissítése" : "Update the deck published on /decks") : (isHu ? "A pakli egy pillanatképének közzététele a profilodon" : "Publish a snapshot of this deck to your public profile")}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-[var(--positive)] border border-emerald-500/30 transition cursor-pointer disabled:opacity-50"
                  >
                    {publishingSavedDeckId === sd.id ? (isHu ? 'Mentés…' : 'Saving…') : isPublished ? (isHu ? 'Frissítés a /decks oldalon' : 'Update on /decks') : (isHu ? 'Közzététel' : 'Publish')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      loadDeck(sd.deck);
                      setLoadedSavedDeckId(sd.id);
                      const matchPub = publishedDecks.find(pd => pd.id === sd.publishedDeckId || pd.name.trim().toLowerCase() === sd.name.trim().toLowerCase());
                      setLoadedPublishedDeckId(matchPub?.id || sd.publishedDeckId || null);
                      setSaveMode('update');
                      setShowBrowserModal(false);
                    }}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition cursor-pointer"
                  >
                    {isHu ? 'Pakli betöltése' : 'Load Deck'}
                  </button>
                </div>
              </div>
            );
          })}

          {currentUser && (
            <div className="pt-2 mt-1 border-t border-zinc-800">
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3">
                {isHu ? `A profilodon közzétéve (${publishedDecks.length})` : `Published to Your Profile (${publishedDecks.length})`}
              </div>
              {publishedDecks.length === 0 ? (
                <p className="text-zinc-500 text-xs py-2">{isHu ? 'Még semmi sincs közzétéve — kattints a „Közzététel” gombra egy fenti mentett paklinál, hogy mások is böngészhessék.' : 'Nothing published yet — hit "Publish" on a saved deck above to let others browse it.'}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {publishedDecks.map(pd => (
                    <div key={pd.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-zinc-950/60 rounded-xl border border-zinc-800">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-zinc-100 truncate">{pd.name}</div>
                        <div className="text-[11px] text-zinc-500">{pd.is_public ? (isHu ? 'Nyilvános' : 'Public') : (isHu ? 'Nem listázott' : 'Unlisted')}</div>
                      </div>
                      <div className="flex gap-2 shrink-0 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            if (pd.deck) loadDeck(pd.deck);
                            const matchingSaved = savedDecks.find(sd => sd.publishedDeckId === pd.id || sd.name.trim().toLowerCase() === pd.name.trim().toLowerCase());
                            if (matchingSaved) {
                              setLoadedSavedDeckId(matchingSaved.id);
                            } else if (pd.deck) {
                              const created = saveDeck(pd.name, pd.deck, pd.id);
                              setLoadedSavedDeckId(created.id);
                            }
                            setLoadedPublishedDeckId(pd.id);
                            setSaveMode('update');
                            setDeckNameInput(pd.name);
                            setShowBrowserModal(false);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 transition cursor-pointer"
                          title={isHu ? "A közzétett pakli megnyitása az építőben" : "Open this published deck in the builder"}
                        >
                          {isHu ? 'Megnyitás az Építőben' : 'Load in Builder'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => { const ok = await setDeckVisibility(pd.id, !pd.is_public); if (ok) refreshPublishedDecks(); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition cursor-pointer"
                        >
                          {pd.is_public ? (isHu ? 'Elrejtés' : 'Unlist') : (isHu ? 'Nyilvánossá tétel' : 'Make Public')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnpublishDeck(pd.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition cursor-pointer"
                        >
                          {isHu ? 'Eltávolítás' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
}

const btnStyle = (bg = 'var(--bg-surface)', color = 'var(--text-primary)', border = 'var(--border)') => ({
  background: bg, border: `1px solid ${border}`, color, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700
});
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14 };

