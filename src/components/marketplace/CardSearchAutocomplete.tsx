import React, { useState, useEffect, useRef } from 'react';
import { supabase, cardThumbProps } from '../../lib/supabase';
import type { CatalogCard } from '../../types';

export interface CardSearchAutocompleteProps {
  activeGame: string;
  onSelect: (card: CatalogCard) => void;
  selectedCard?: CatalogCard | null;
  onClearSelected?: () => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function CardSearchAutocomplete({
  activeGame,
  onSelect,
  selectedCard,
  onClearSelected,
  label = 'Search card',
  placeholder = 'Type card name or number (e.g. Ahri, 038)...',
  autoFocus = false,
  className = '',
}: CardSearchAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Debounced search
  useEffect(() => {
    const clean = query.trim().replace(/[,()%]/g, '');
    if (selectedCard || clean.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase
          .from('cards')
          .select(`
            id, card_number, name, rarity, card_type, cost, image_path, subtype,
            game, energy, might, domain, tags, market_price_eur, market_price_foil_eur,
            sets ( id, name, code )
          `)
          .eq('game', activeGame)
          .or(`name.ilike.%${clean}%,card_number.ilike.%${clean}%`)
          .limit(8);

        if (!error && data) {
          setResults(data as CatalogCard[]);
          setIsOpen(data.length > 0);
        } else {
          setResults([]);
          setIsOpen(false);
        }
      } catch {
        setResults([]);
        setIsOpen(false);
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [query, activeGame, selectedCard]);

  const handleSelect = (card: CatalogCard) => {
    onSelect(card);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </label>
      )}

      {selectedCard ? (
        <div
          className="flex items-center justify-between p-2.5 rounded-xl border"
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-12 rounded overflow-hidden shrink-0 border flex items-center justify-center"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
            >
              {selectedCard.image_path ? (
                <img {...cardThumbProps(selectedCard.image_path, 'avatar')} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[8px] font-mono text-[var(--text-muted)]">TCG</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                {selectedCard.name}
              </div>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                #{selectedCard.card_number} · {selectedCard.rarity || 'Common'}
              </div>
            </div>
          </div>

          {onClearSelected && (
            <button
              type="button"
              onClick={onClearSelected}
              className="p-1 rounded-lg border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)] transition"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Change
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (results.length > 0) setIsOpen(true); }}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className="w-full px-3 py-2 pr-8 rounded-xl text-xs font-semibold border outline-none focus:border-[var(--accent)]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />

          {searching ? (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <div className="w-3.5 h-3.5 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
            </div>
          ) : query ? (
            <button
              type="button"
              onClick={() => { setQuery(''); setResults([]); setIsOpen(false); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          ) : null}

          {/* Autocomplete Dropdown */}
          {isOpen && results.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full mt-1.5 rounded-xl border shadow-2xl overflow-hidden z-50 max-h-60 overflow-y-auto"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              {results.map((card) => (
                <div
                  key={card.id}
                  onClick={() => handleSelect(card)}
                  className="flex items-center gap-2.5 p-2 hover:bg-[var(--bg-surface-2)] cursor-pointer transition border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div
                    className="w-7 h-10 rounded overflow-hidden shrink-0 border flex items-center justify-center"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
                  >
                    {card.image_path ? (
                      <img {...cardThumbProps(card.image_path, 'avatar')} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[7px] font-mono text-[var(--text-muted)]">TCG</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {card.name}
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                      #{card.card_number} · {card.rarity || 'Common'}{card.sets?.name ? ` · ${card.sets.name}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
