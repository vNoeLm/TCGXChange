import { useEffect, useRef, useState } from 'react';
import { searchCatalogCards, type P2PCardInfo } from '../../lib/p2pClient';
import { cardThumbProps } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';

interface CardAutocompleteProps {
  onSelect: (card: P2PCardInfo) => void;
  game?: string;
  placeholder?: string;
  clearOnSelect?: boolean;
  initialLabel?: string;
}

export function CardAutocomplete({
  onSelect,
  game,
  placeholder,
  clearOnSelect = false,
  initialLabel = '',
}: CardAutocompleteProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState(initialLabel);
  const [results, setResults] = useState<P2PCardInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchCatalogCards(q, game);
        if (!cancelled) {
          setResults(found);
          setOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, game]);

  return (
    <div className="relative" ref={wrapRef}>
      <div className="relative">
        <svg
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--text-tertiary)' }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onFocus={() => results.length > 0 && setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          placeholder={placeholder || t('Search card name or number...', 'Kártya neve vagy száma...')}
          className="w-full pl-9 pr-8 py-2 rounded-xl border text-xs font-medium outline-none transition focus:border-[var(--accent)]"
          style={{
            background: 'var(--bg-input)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        {loading && (
          <span
            className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin absolute right-3 top-1/2 -translate-y-1/2"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
        )}
      </div>

      {open && results.length > 0 && (
        <div
          className="absolute left-0 right-0 mt-1.5 rounded-xl border shadow-2xl z-50 max-h-64 overflow-y-auto p-1"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          {results.map((card) => {
            const thumb = card.image_path ? cardThumbProps(card.image_path, 'avatar') : null;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => {
                  onSelect(card);
                  setQuery(clearOnSelect ? '' : `${card.name} (${card.card_number})`);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition hover:bg-[var(--bg-raised)] cursor-pointer"
              >
                {thumb ? (
                  <img
                    src={thumb.src}
                    alt={card.name}
                    className="w-8 h-11 rounded object-cover shrink-0 border"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  />
                ) : (
                  <div
                    className="w-8 h-11 rounded shrink-0 border flex items-center justify-center text-[9px] font-bold"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                  >
                    TCG
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {card.name}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {card.card_number} {card.sets?.name ? `· ${card.sets.name}` : ''} · {card.rarity}
                  </div>
                </div>
                {card.market_price_eur != null && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }}
                  >
                    ~€{Number(card.market_price_eur).toFixed(2)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface MentionTextareaProps {
  value: string;
  onChange: (next: string) => void;
  onTagCard: (card: P2PCardInfo) => void;
  placeholder?: string;
  rows?: number;
}

/**
 * Facebook-style description box: typing `@cardname` pops up a card picker and inserts `@[Card Name #Num]`.
 */
export function MentionTextarea({
  value,
  onChange,
  onTagCard,
  placeholder,
  rows = 4,
}: MentionTextareaProps) {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [suggestions, setSuggestions] = useState<P2PCardInfo[]>([]);

  useEffect(() => {
    if (!mentionQuery || mentionQuery.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchCatalogCards(mentionQuery);
      if (!cancelled) setSuggestions(found);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mentionQuery]);

  const detectMention = (text: string, caret: number) => {
    const upToCaret = text.slice(0, caret);
    const match = upToCaret.match(/(?:^|\s)@([^\n@\[\]]{1,40})$/);
    if (match) {
      const fullMatch = match[0];
      const atOffset = fullMatch.indexOf('@');
      const start = caret - (fullMatch.length - atOffset);
      setMentionQuery(match[1]);
      setMentionRange({ start, end: caret });
    } else {
      setMentionQuery(null);
      setMentionRange(null);
      setSuggestions([]);
    }
  };

  const applySuggestion = (card: P2PCardInfo) => {
    if (mentionRange) {
      const tagToken = `@[${card.name} · ${card.card_number}] `;
      const next = value.slice(0, mentionRange.start) + tagToken + value.slice(mentionRange.end);
      onChange(next);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          const pos = mentionRange.start + tagToken.length;
          el.focus();
          el.setSelectionRange(pos, pos);
        }
      }, 0);
    }
    onTagCard(card);
    setMentionQuery(null);
    setMentionRange(null);
    setSuggestions([]);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          detectMention(next, e.target.selectionStart ?? next.length);
        }}
        onKeyUp={(e) => {
          const el = e.currentTarget;
          detectMention(el.value, el.selectionStart ?? el.value.length);
        }}
        placeholder={
          placeholder ||
          t(
            'Describe your cards, condition, or meetup preferences... Type @card to tag a card inline.',
            'Írd le a részleteket vagy az átvétel módját... Használd a @kártyanév jelölést kártyák tageléséhez!'
          )
        }
        className="w-full px-3 py-2.5 rounded-xl border text-xs leading-relaxed outline-none resize-y transition focus:border-[var(--accent)]"
        style={{
          background: 'var(--bg-input)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
      />

      {suggestions.length > 0 && mentionQuery && (
        <div
          className="absolute left-0 right-0 mt-1 rounded-xl border shadow-2xl z-50 max-h-56 overflow-y-auto p-1"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            {t('Tag Card in Description', 'Kártya megjelölése')}
          </div>
          {suggestions.map((card) => {
            const thumb = card.image_path ? cardThumbProps(card.image_path, 'avatar') : null;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => applySuggestion(card)}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition hover:bg-[var(--bg-raised)] cursor-pointer"
              >
                {thumb && (
                  <img src={thumb.src} alt={card.name} className="w-7 h-10 rounded object-cover shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {card.name}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {card.card_number} {card.sets?.name ? `· ${card.sets.name}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
