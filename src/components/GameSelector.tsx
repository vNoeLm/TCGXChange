import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { GAMES, STORAGE_KEYS, EVENTS } from '../lib/constants';
import { applySiteTheme } from '../lib/theme';
import { useExitTransition } from '../lib/useExitTransition';

interface GameSelectorProps {
  disabled?: boolean;
}

export function GameSelector({ disabled = false }: GameSelectorProps) {
  // Always initialize with 'riftbound' so SSR HTML and initial client render match identically (zero hydration mismatch)
  const [activeGame, setActiveGame] = useState('riftbound');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownAnim = useExitTransition(isOpen, 200);
  // On a narrow phone the menu can run past the right edge (which makes the whole page zoom out),
  // so shift it left by however much it overflows.
  const [menuShift, setMenuShift] = useState(0);
  useLayoutEffect(() => {
    if (!isOpen || !dropdownRef.current) return;
    const rect = dropdownRef.current.getBoundingClientRect();
    const menuWidth = Math.min(224, window.innerWidth - 16);
    const overflow = rect.left + menuWidth - (window.innerWidth - 8);
    setMenuShift(overflow > 0 ? -Math.min(overflow, Math.max(0, rect.left - 8)) : 0);
  }, [isOpen]);

  useEffect(() => {

    // Read from localStorage on mount (only active games)
    const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME);
    if (saved && GAMES.some(g => g.id === saved && g.active !== false)) {
      setActiveGame(saved);
      applySiteTheme(saved);
    } else {
      setActiveGame('riftbound');
      localStorage.setItem(STORAGE_KEYS.ACTIVE_GAME, 'riftbound');
      applySiteTheme('riftbound');
    }

    // Listen to external game change events
    const handleGameChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ game: string }>;
      if (customEvent.detail?.game && GAMES.some(g => g.id === customEvent.detail.game && g.active !== false)) {
        setActiveGame(customEvent.detail.game);
      }
    };
    window.addEventListener(EVENTS.GAME_CHANGE, handleGameChange);

    // Close on outside click
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener(EVENTS.GAME_CHANGE, handleGameChange);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelectGame = (gameId: string) => {
    const targetGame = GAMES.find(g => g.id === gameId);
    if (!targetGame || targetGame.active === false) return;

    // If game changed, remove cached stale filters so previous game's filters don't leak
    if (gameId !== activeGame) {
      try {
        sessionStorage.removeItem('catalogFilters');
        sessionStorage.removeItem(STORAGE_KEYS.INVENTORY_FILTERS);
      } catch (e) {}
    }

    setActiveGame(gameId);
    setIsOpen(false);
    localStorage.setItem(STORAGE_KEYS.ACTIVE_GAME, gameId);
    sessionStorage.setItem(STORAGE_KEYS.CATALOG_GAME, gameId);
    applySiteTheme(gameId);
    window.dispatchEvent(new CustomEvent(EVENTS.GAME_CHANGE, { detail: { game: gameId } }));
  };


  const currentGame = GAMES.find(g => g.id === activeGame) || GAMES[0];

  if (disabled) {
    return (
      <div className="relative inline-block text-left" title="Store catalog includes accessories and all games. Dedicated store filters are available on the page.">
        <div
          className="flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl border text-xs font-bold select-none whitespace-nowrap cursor-not-allowed opacity-60 transition"
          style={{
            background: 'var(--bg-surface-2)',
            borderColor: 'var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--text-muted)' }} />
          <span className="tracking-wide">Store Mode</span>
          <svg className="w-3.5 h-3.5 ml-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
      </div>
    );
  }

  // With a single game there is nothing to pick - just say which game the site is for.
  if (GAMES.filter(g => g.active !== false).length === 1) {
    return (
      <span className="flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl border text-xs font-bold whitespace-nowrap bg-[var(--bg-surface-2)] border-[var(--border)] text-[var(--text-primary)]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--accent-strong)', boxShadow: '0 0 8px var(--accent-glow)' }} />
        <span className="tracking-wide">{currentGame.name}</span>
      </span>
    );
  }

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Dropdown Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl border text-xs font-bold transition shadow-sm cursor-pointer select-none group whitespace-nowrap bg-[var(--bg-surface-2)] border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] hover:border-[var(--border-hover)] hover:text-[var(--text-accent)]"
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: 'var(--accent-strong)',
            boxShadow: '0 0 8px var(--accent-glow)',
          }}
        />
        <span className="tracking-wide truncate max-w-[85px] sm:max-w-none">{currentGame.name}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-muted)' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {dropdownAnim.rendered && (
        <div
          data-state={dropdownAnim.state}
          className="tv-popover tv-origin-top-left absolute left-0 mt-1.5 w-56 max-w-[calc(100vw-1rem)] rounded-xl border shadow-2xl z-50 py-1 overflow-hidden backdrop-blur-md"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border)',
            left: menuShift,
          }}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>
            Select Game
          </div>
          {GAMES.map(g => {
            const isSelected = g.id === activeGame;
            const isAvailable = g.active !== false;

            if (!isAvailable) {
              return (
                <div
                  key={g.id}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium opacity-40 cursor-not-allowed select-none" style={{ color: 'var(--text-muted)' }}
                  title={`${g.name} is coming soon`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-placeholder)' }} />
                    <span>{g.name}</span>
                  </div>
                  <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border" style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                    Soon
                  </span>
                </div>
              );
            }

            const gameDotColor =
              g.id === 'riftbound' ? '#f59e0b' :
              g.id === 'mtg' ? '#f97316' :
              g.id === 'onepiece' ? '#ef4444' :
              g.id === 'lorcana' ? '#8b5cf6' :
              g.id === 'starwars' ? '#06b6d4' :
              g.id === 'fab' ? '#e11d48' :
              '#a1a1aa';

            return (
              <button
                key={g.id}
                type="button"
                onClick={() => handleSelectGame(g.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold transition cursor-pointer text-left ${
                  isSelected
                    ? 'font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]'
                }`}
                style={{
                  background: isSelected ? 'var(--accent-muted)' : undefined,
                  color: isSelected ? 'var(--text-accent)' : undefined,
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: gameDotColor,
                      boxShadow: isSelected ? `0 0 8px ${gameDotColor}` : 'none',
                    }}
                  />
                  <span>{g.name}</span>
                </div>
                {isSelected && (
                  <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
