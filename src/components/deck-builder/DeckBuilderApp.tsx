import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { CatalogCard } from '../../types';
import { supabase, getCardImageUrl } from '../../lib/supabase';
import { useDeckBuilder, type DeckState } from './useDeckBuilder';
import { useSavedDecks } from './useSavedDecks';
import { DeckCatalog } from './DeckCatalog';
import { DeckList } from './DeckList';
import { DeckPreviewColumn } from './DeckPreviewColumn';
import { DeckStatisticsModal } from './DeckStatisticsModal';
import { formatGameText } from '../../lib/formatGameText';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { useUrlOverlay } from '../../lib/useUrlOverlay';
import { fetchCardsCatalog } from '../../lib/api';
import { exportDeckToText, exportDeckToJson, exportSavedDecksToJson } from './deckSerializer';
import { Modal } from '../ui/Modal';
import { publishDeck, setDeckVisibility, deletePublishedDeck, fetchMyDecks, type PublicDeckSummary } from '../../lib/publicDecks';

import { getActiveGame } from '../../lib/theme';
import { EVENTS, STORAGE_KEYS } from '../../lib/constants';
import { toGameId, gameStorageKey, defaultZone, hasZone, type GameId } from '../../lib/deckRules';

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
    padding: '7px 4px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s ease',
    width: '100%',
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

  const [activeGame, setActiveGame] = useState<GameId>(() => toGameId(getActiveGame()));

  useEffect(() => {
    const handleGameChange = (e: Event) => {
      const detail = (e as CustomEvent<{ game: string }>).detail;
      if (detail?.game) {
        setActiveGame(toGameId(detail.game));
      }
    };
    window.addEventListener(EVENTS.GAME_CHANGE, handleGameChange);
    return () => window.removeEventListener(EVENTS.GAME_CHANGE, handleGameChange);
  }, []);

  const { deck, addCard, removeCard, removeCardFromAnyZone, clearDeck, loadDeck, loaded } = useDeckBuilder(activeGame);
  const { savedDecks, saveDeck, updateDeck, deleteDeck, importDeck, loaded: savedDecksLoaded } = useSavedDecks(activeGame);
  // The saved deck currently being edited, so Save can offer to update it instead of always
  // creating a copy. Cleared when the deck is emptied or the game changes. Persisted per game
  // (like the working deck itself) so a page refresh doesn't lose the association and silently
  // turn every future Save into a duplicate instead of an overwrite.
  const loadedDeckIdStorageKey = gameStorageKey(activeGame, 'loaded_deck_id');
  const [loadedSavedDeckId, setLoadedSavedDeckId] = useState<string | null>(null);
  const [loadedSavedDeckIdReady, setLoadedSavedDeckIdReady] = useState(false);

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

  const [saveMode, setSaveMode] = useState<'update' | 'new'>('update');
  const loadedSavedDeck = savedDecks.find(d => d.id === loadedSavedDeckId) || null;
  const [activeZone, setActiveZone] = useState<keyof DeckState>(() => defaultZone(activeGame));

  // Reset active zone if it doesn't belong to the current game
  useEffect(() => {
    if (!hasZone(activeGame, activeZone as string)) {
      setActiveZone(defaultZone(activeGame));
    }
  }, [activeGame, activeZone]);

  // Left column shows either the deck preview or the catalog filters. The filter panel itself
  // is owned by DeckCatalog and portaled into this slot so its state stays next to the catalog logic.
  const [leftTab, setLeftTab] = useState<'preview' | 'filters'>('preview');
  const [filtersSlot, setFiltersSlot] = useState<HTMLElement | null>(null);
  const [activeFiltersCount, setActiveFiltersCount] = useState(0);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showBrowserModal, setShowBrowserModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  
  const [deckNameInput, setDeckNameInput] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [publishedDecks, setPublishedDecks] = useState<PublicDeckSummary[]>([]);
  const [publishingSavedDeckId, setPublishingSavedDeckId] = useState<string | null>(null);

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



  // Lock background scroll when preview modal or dialog is open, and handle Escape key to close modals
  useEffect(() => {
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

    if (previewCardId || showSaveModal || showBrowserModal || showExportModal || showImportModal || showStatsModal) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewCardId, showSaveModal, showBrowserModal, showExportModal, showImportModal, showStatsModal]);

  const processImportString = (content: string) => {
    if (!content || !content.trim()) {
      alert('Please enter or upload deck content.');
      return;
    }
    const result = importDeck(content, cards);
    if (result.type === 'single') {
      loadDeck(result.deck);
      setShowImportModal(false);
      setPasteInput('');
      alert(`Successfully imported and loaded "${result.name}"!`);
    } else if (result.type === 'multi') {
      if (result.decks.length > 0) {
        loadDeck(result.decks[0].deck);
      }
      setShowImportModal(false);
      setPasteInput('');
      alert(`Successfully imported ${result.count} decks! Loaded the first deck and added all to your saved decks.`);
    } else {
      alert(result.message || 'Failed to import deck. Please check format.');
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

  const handlePublishSavedDeck = async (sd: { id: string; name: string; deck: DeckState }) => {
    if (!currentUser) {
      alert('Sign in to publish decks to your profile.');
      return;
    }
    setPublishingSavedDeckId(sd.id);
    try {
      const result = await publishDeck(sd.name, sd.deck.game || activeGame, sd.deck);
      if (result.success) {
        refreshPublishedDecks();
        alert(`"${sd.name}" is now public on your profile!`);
      } else {
        alert(result.error || 'Failed to publish deck.');
      }
    } finally {
      setPublishingSavedDeckId(null);
    }
  };

  const handleUnpublishDeck = async (publishedId: string) => {
    if (!confirm('Remove this deck from your public profile?')) return;
    const ok = await deletePublishedDeck(publishedId);
    if (ok) refreshPublishedDecks();
    else alert('Failed to unpublish deck.');
  };

  // Fetch cards whenever activeGame changes
  useEffect(() => {
    async function loadCards() {
      setLoading(true);
      const { data } = await fetchCardsCatalog({ ...DEFAULT_FILTERS, game: activeGame } as any, '');
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
    return legendCard.domain.split(',').map(d => d.trim().toLowerCase());
  }, [legendCard]);

  if (loading || !loaded) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0', color: 'var(--accent-light)' }}>
        Loading Deck Builder...
      </div>
    );
  }

  if (activeGame !== 'riftbound') {
    return (
      <div style={{ maxWidth: 640, margin: '60px auto', padding: 'clamp(16px,3vw,32px)', textAlign: 'center' }}>
        <div className="rounded-2xl p-8 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
            </svg>
          </div>
          <h2 className="text-xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
            Deck Builder Unavailable
          </h2>
          <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--text-secondary)' }}>
            The deck builder is currently exclusively available for <strong>Riftbound</strong>.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(STORAGE_KEYS.ACTIVE_GAME, 'riftbound');
                setActiveGame('riftbound');
                window.dispatchEvent(new CustomEvent(EVENTS.GAME_CHANGE, { detail: { game: 'riftbound' } }));
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
            >
              Switch to Riftbound
            </button>
            <a
              href="/"
              className="px-4 py-2 rounded-xl text-xs font-bold transition border"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              Back to Catalog
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{
        width: '100%',
        padding: "clamp(16px,2vw,24px)",
        display: "flex",
        flexDirection: isWide ? 'row' : 'column',
        gap: 24,
        height: isWide ? 'calc(100dvh - var(--page-chrome-h))' : 'auto',
      }}>

        {/* Left: Deck Preview / Filters */}
        <div style={{
          flex: isWide ? '0 0 clamp(280px, 25vw, 400px)' : (leftTab === 'filters' ? '0 0 auto' : '0 0 320px'),
          background: 'var(--bg-surface-2)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            {([
              { id: 'preview' as const, label: 'Preview' },
              { id: 'filters' as const, label: 'Filters' },
            ]).map(tab => {
              const active = leftTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLeftTab(tab.id)}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--text-on-accent, #000)' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tab.label}
                  {tab.id === 'filters' && activeFiltersCount > 0 && (
                    <span style={{
                      background: active ? 'rgba(0,0,0,0.25)' : 'var(--accent)',
                      color: active ? 'inherit' : 'var(--text-on-accent, #000)',
                      borderRadius: 10, padding: '0 7px', fontSize: 11, fontWeight: 900,
                    }}>
                      {activeFiltersCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <div style={{ height: isWide ? '100%' : 'auto', display: leftTab === 'preview' ? 'block' : 'none' }}>
              <DeckPreviewColumn
                deck={deck}
                cards={cards}
                activeGame={activeGame}
                legendCard={legendCard}
                championCard={championCard}
                onCardClick={showPreview}
                onRemoveCard={removeCardFromAnyZone}
                isWide={isWide}
              />
            </div>
            <div
              ref={setFiltersSlot}
              className="custom-scrollbar"
              style={{
                height: isWide ? '100%' : 'auto',
                maxHeight: isWide ? undefined : '70vh',
                overflowY: 'auto',
                overflowX: 'hidden',
                display: leftTab === 'filters' ? 'block' : 'none',
              }}
            />
          </div>
        </div>

        {/* Center: Catalog */}
        <div style={{ flex: isWide ? 1 : 'none', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
          />
        </div>

        {/* Right: Requirements & Management */}
        <div style={{
          flex: isWide ? '0 0 360px' : 'none',
          width: isWide ? 360 : '100%',
          minWidth: isWide ? 360 : undefined,
          maxWidth: isWide ? 360 : undefined,
          background: 'var(--bg-surface)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-card)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h1 style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 900,
                color: 'var(--text-accent)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                Deck Limits
              </h1>
            </div>

            {/* Uniform 3x2 Action Buttons Grid taking 100% available space with hover feedback */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, width: '100%' }}>
              <ActionButton
                onClick={() => setShowStatsModal(true)}
                type="stats"
                title={"Deck Statistics"}
              >
                Statistics
              </ActionButton>

              <ActionButton
                onClick={() => {
                  setSaveMode('update');
                  if (loadedSavedDeck) setDeckNameInput(loadedSavedDeck.name);
                  setShowSaveModal(true);
                }}
                type="save"
              >
                Save
              </ActionButton>

              <ActionButton
                onClick={() => setShowBrowserModal(true)}
                type="browse"
              >
                Browse
              </ActionButton>

              <ActionButton
                onClick={() => setShowImportModal(true)}
                type="import"
              >
                Import
              </ActionButton>

              <ActionButton
                onClick={() => setShowExportModal(true)}
                type="export"
              >
                Export
              </ActionButton>

              <ActionButton
                onClick={() => { if(confirm('Clear entire deck?')) { clearDeck(); setLoadedSavedDeckId(null); } }}
                type="clear"
              >
                Clear Deck
              </ActionButton>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <DeckList 
              deck={deck} 
              cards={cards} 
              activeGame={activeGame}
              legendCard={legendCard} 
              championCard={championCard} 
              onRemoveCard={removeCard}
              onCardClick={showPreview}
              activeZone={activeZone}
              onSetZone={setActiveZone}
              isWide={isWide}
            />
          </div>
        </div>

      </div>

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
          onClose={() => setShowSaveModal(false)}
          title={"Save Deck"}
        >
          {loadedSavedDeck && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                You loaded "{loadedSavedDeck.name}" from your saved decks. What do you want to do with your changes?
              </p>
              {([
                { mode: 'update' as const, title: `Update "${loadedSavedDeck.name}"`, desc: 'Replace the saved deck list with the current one' },
                { mode: 'new' as const, title: 'Save as a new deck', desc: 'Keep the original as it was and add this as a separate deck' },
              ]).map(opt => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => {
                    setSaveMode(opt.mode);
                    setDeckNameInput(opt.mode === 'update' ? loadedSavedDeck.name : `${loadedSavedDeck.name} (copy)`);
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
            </div>
          )}
          <input autoFocus type="text" value={deckNameInput} onChange={e => setDeckNameInput(e.target.value)} placeholder={"Deck Name"} style={inputStyle} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
            <button onClick={() => setShowSaveModal(false)} style={btnStyle()}>Cancel</button>
            <button
              onClick={() => {
                const name = deckNameInput.trim();
                if (!name) return;
                if (loadedSavedDeck && saveMode === 'update') {
                  updateDeck(loadedSavedDeck.id, deck, name);
                } else {
                  const created = saveDeck(name, deck);
                  setLoadedSavedDeckId(created.id);
                }
                setDeckNameInput('');
                setShowSaveModal(false);
              }}
              style={btnStyle('#6366f1', '#fff', '#6366f1')}
            >
              {loadedSavedDeck && saveMode === 'update' ? 'Update Deck' : 'Save'}
            </button>
          </div>
      </Modal>

      <Modal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
          title={"Import Deck"}
          maxWidth="max-w-xl"
        >
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            Upload a deck file (.json or .txt) or paste a JSON object / text decklist below.
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
              Choose JSON / TXT File…
            </button>
          </div>

          <textarea
            value={pasteInput}
            onChange={e => setPasteInput(e.target.value)}
            placeholder={`Paste deck JSON or text list here...\n\nExample:\n// Legend\n1 Blind Monk\n// Champion\n1 Lee Sin, Dragon\n// Main Deck\n3 Affectionate Poro\n2 Ahri, Inquisitive`}
            style={{
              width: '100%', height: 160, padding: 12, borderRadius: 10,
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 12,
              outline: 'none', resize: 'vertical', boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button onClick={() => setShowImportModal(false)} style={btnStyle()}>Cancel</button>
            <button 
              onClick={() => processImportString(pasteInput)}
              style={btnStyle('#6366f1', '#fff', '#6366f1')}
            >
              Import Deck
            </button>
          </div>
      </Modal>

      <Modal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title={"Export Deck"}
          maxWidth="max-w-xl"
        >
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Export your current active deck or download all saved decks.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Export Current Deck JSON */}
            <button
              onClick={() => {
                const deckName = deckNameInput.trim() || (legendCard ? `${legendCard.name} Deck` : 'My Deck');
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
                <div style={{ fontWeight: 700 }}>Download Current Deck (JSON)</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Single deck file with card names and metadata</div>
              </div>
              <span>↓</span>
            </button>

            {/* Copy Decklist as Text */}
            <button
              onClick={() => {
                const deckName = deckNameInput.trim() || (legendCard ? `${legendCard.name} Deck` : 'My Deck');
                const textDeck = exportDeckToText(deck, cards, deckName);
                navigator.clipboard.writeText(textDeck);
                alert('Decklist copied to clipboard!');
                setShowExportModal(false);
              }}
              style={{
                ...btnStyle('var(--bg-input)', 'var(--text-primary)', 'var(--border)'),
                padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, textAlign: 'left',
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Copy Decklist to Clipboard</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Plain text format with card names for Discord or forums</div>
              </div>
              <span>→</span>
            </button>

            {/* Publish Current Deck to Public Profile */}
            <button
              onClick={async () => {
                if (!currentUser) {
                  alert('Sign in to publish decks to your profile.');
                  return;
                }
                const deckName = deckNameInput.trim() || (legendCard ? `${legendCard.name} Deck` : 'My Deck');
                const result = await publishDeck(deckName, activeGame, deck);
                if (result.success) {
                  refreshPublishedDecks();
                  alert(`"${deckName}" is now public on your profile!`);
                  setShowExportModal(false);
                } else {
                  alert(result.error || 'Failed to publish deck.');
                }
              }}
              style={{
                ...btnStyle('var(--bg-input)', 'var(--text-primary)', 'var(--border)'),
                padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, textAlign: 'left',
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Publish to Your Profile</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Make this deck browsable by anyone on your public profile</div>
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
                <div style={{ fontWeight: 700 }}>Backup All Saved Decks ({savedDecks.length})</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Full backup with complete card names and stats</div>
              </div>
              <span>↓</span>
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button onClick={() => setShowExportModal(false)} style={btnStyle()}>Close</button>
          </div>
      </Modal>

      <Modal
        isOpen={showBrowserModal}
        onClose={() => setShowBrowserModal(false)}
        title={"Saved Decks"}
        maxWidth="max-w-2xl"
      >
        <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1">
          {savedDecks.length === 0 && (
            <p className="text-zinc-500 text-sm py-4 text-center">No saved decks found.</p>
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
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-bold text-base text-zinc-100">{sd.name}</div>
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
                      {lCard && <div><span className="text-zinc-500">{isOnePiece ? 'Leader:' : 'Legend:'}</span> {lCard.name}</div>}
                      {cCard && <div><span className="text-zinc-500">Champion:</span> {cCard.name}</div>}
                      {!lCard && !cCard && (
                        <div><span className="text-zinc-500">Cards:</span> {Object.values(sd.deck.mainDeck || {}).reduce((a, b) => a + b, 0)}</div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => { if(confirm('Delete this deck?')) deleteDeck(sd.id); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition cursor-pointer"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePublishSavedDeck(sd)}
                    disabled={publishingSavedDeckId === sd.id}
                    title="Publish a snapshot of this deck to your public profile"
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-[var(--positive)] border border-emerald-500/30 transition cursor-pointer disabled:opacity-50"
                  >
                    {publishingSavedDeckId === sd.id ? 'Publishing…' : 'Publish'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { loadDeck(sd.deck); setLoadedSavedDeckId(sd.id); setSaveMode('update'); setShowBrowserModal(false); }}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition cursor-pointer"
                  >
                    Load Deck
                  </button>
                </div>
              </div>
            );
          })}

          {currentUser && (
            <div className="pt-2 mt-1 border-t border-zinc-800">
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3">
                Published to Your Profile ({publishedDecks.length})
              </div>
              {publishedDecks.length === 0 ? (
                <p className="text-zinc-500 text-xs py-2">Nothing published yet — hit "Publish" on a saved deck above to let others browse it.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {publishedDecks.map(pd => (
                    <div key={pd.id} className="flex items-center justify-between gap-3 p-3 bg-zinc-950/60 rounded-xl border border-zinc-800">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-zinc-100 truncate">{pd.name}</div>
                        <div className="text-[11px] text-zinc-500">{pd.is_public ? 'Public' : 'Unlisted'}</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={async () => { const ok = await setDeckVisibility(pd.id, !pd.is_public); if (ok) refreshPublishedDecks(); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition cursor-pointer"
                        >
                          {pd.is_public ? 'Unlist' : 'Make Public'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnpublishDeck(pd.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition cursor-pointer"
                        >
                          Remove
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


    </>
  );
}

const btnStyle = (bg = 'var(--bg-surface)', color = 'var(--text-primary)', border = 'var(--border)') => ({
  background: bg, border: `1px solid ${border}`, color, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700
});
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none', fontSize: 14 };

