import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getIntelliSenseSuggestions, type IntelliSenseSuggestion } from '../../lib/cardSearchParser';

export interface SearchCommandIntelliSenseProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (newValue: string) => void;
  isOpen: boolean;
  onClose: () => void;
  lang?: 'en' | 'hu';
}

function getCommandIcon(commandKey?: string) {
  switch (commandKey) {
    case 'text':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case 'name':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="7" y1="8" x2="17" y2="8" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </svg>
      );
    case 'set':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        </svg>
      );
    case 'type':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      );
    case 'rarity':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case 'domain':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        </svg>
      );
    case 'artist':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        </svg>
      );
    case 'tag':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      );
    default:
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
  }
}

export function SearchCommandIntelliSense({
  inputRef,
  value,
  onChange,
  isOpen,
  onClose,
  lang = 'en',
}: SearchCommandIntelliSenseProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(value.length);
  const listRef = useRef<HTMLDivElement>(null);
  const isHu = lang === 'hu';

  // Update cursor position on input interactions
  const updateCursor = useCallback(() => {
    if (inputRef.current) {
      setCursorPosition(inputRef.current.selectionStart ?? value.length);
    }
  }, [inputRef, value]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.addEventListener('click', updateCursor);
    el.addEventListener('keyup', updateCursor);
    return () => {
      el.removeEventListener('click', updateCursor);
      el.removeEventListener('keyup', updateCursor);
    };
  }, [inputRef, updateCursor]);

  const { suggestions, tokenStart, tokenEnd, activeToken } = getIntelliSenseSuggestions(
    value,
    cursorPosition,
    lang
  );

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [activeToken]);

  const applySuggestion = useCallback(
    (suggestion: IntelliSenseSuggestion) => {
      const before = value.slice(0, tokenStart);
      const after = value.slice(tokenEnd);
      const newValue = before + suggestion.insertText + after;
      onChange(newValue);

      // Focus back and position cursor right after the inserted text
      const nextCursor = tokenStart + suggestion.insertText.length;
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(nextCursor, nextCursor);
          setCursorPosition(nextCursor);
        }
      });
    },
    [value, tokenStart, tokenEnd, onChange, inputRef]
  );

  // Keyboard navigation
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (suggestions.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Tab' || (e.key === 'Enter' && selectedIndex >= 0)) {
        // Only consume Enter if suggestions are open and not on an exact match
        const activeSuggestion = suggestions[selectedIndex];
        if (activeSuggestion) {
          e.preventDefault();
          e.stopPropagation();
          applySuggestion(activeSuggestion);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    el.addEventListener('keydown', handleKeyDown, true);
    return () => el.removeEventListener('keydown', handleKeyDown, true);
  }, [inputRef, isOpen, suggestions, selectedIndex, applySuggestion, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen || suggestions.length === 0) return null;

  const isValueList = suggestions[0]?.category === 'value';

  return (
    <div
      className="absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl border shadow-2xl overflow-hidden backdrop-blur-md transition-all select-none"
      style={{
        background: 'var(--bg-surface, #13151a)',
        borderColor: 'var(--border, #27272a)',
        boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7)',
        maxHeight: '340px',
      }}
      onMouseDown={(e) => {
        // Prevent search input from losing focus when clicking suggestions
        e.preventDefault();
      }}
    >
      {/* Header bar with contextual mode & shortcut hints */}
      <div
        className="px-3.5 py-2 border-b flex items-center justify-between text-[11px] font-bold"
        style={{
          background: 'var(--bg-surface-2, #181b21)',
          borderColor: 'var(--border-subtle, #27272a)',
          color: 'var(--text-tertiary, #a1a1aa)',
        }}
      >
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          {isValueList
            ? isHu
              ? `Javasolt értékek (${suggestions[0]?.commandKey}:)`
              : `Suggested values for ${suggestions[0]?.commandKey}:`
            : isHu
            ? 'Keresési parancsok'
            : 'Search Commands'}
        </span>
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] opacity-75 font-mono">
          <span className="inline-flex items-center">
            <svg className="w-3 h-3 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </span>
          <span>{isHu ? 'navigálás' : 'navigate'}</span>
          <span>&bull;</span>
          <span>Tab/Enter {isHu ? 'kiválasztás' : 'select'}</span>
          <span>&bull;</span>
          <span>Esc {isHu ? 'bezárás' : 'close'}</span>
        </span>
      </div>

      {/* Suggestion list */}
      <div ref={listRef} className="overflow-y-auto max-h-[280px] p-1.5 space-y-0.5" role="listbox">
        {suggestions.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => applySuggestion(item)}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between gap-3 transition cursor-pointer ${
                isSelected
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                  : 'hover:bg-zinc-800/60 text-zinc-300 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`p-1.5 rounded-lg shrink-0 ${
                    isSelected ? 'bg-cyan-500/25 text-cyan-300' : 'bg-zinc-800/80 text-zinc-400'
                  }`}
                >
                  {getCommandIcon(item.commandKey)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-mono font-bold text-xs truncate">
                    <span className={isSelected ? 'text-cyan-200' : 'text-zinc-100'}>{item.displayText}</span>
                  </div>
                  {item.description && (
                    <div className="text-[11px] truncate text-zinc-400">{item.description}</div>
                  )}
                </div>
              </div>

              {item.badge && (
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-md shrink-0 border ${
                    isSelected
                      ? 'bg-cyan-950/60 text-cyan-300 border-cyan-500/30'
                      : 'bg-zinc-900/80 text-zinc-400 border-zinc-700/50'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
