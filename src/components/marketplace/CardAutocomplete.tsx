import { useEffect, useRef, useState } from 'react';
import { searchCatalogCards, type P2PCardInfo } from '../../lib/p2pClient';
import { cardThumbProps } from '../../lib/supabase';
import { useLanguage } from '../../lib/i18n';
import { PostDescriptionRenderer, type PostDescriptionTagRef } from './PostDescriptionRenderer';

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
  game?: string;
  placeholder?: string;
  rows?: number;
  previewTaggedCards?: PostDescriptionTagRef[];
}

/**
 * Rich description editor with formatting toolbar, live preview, and `@cardname` card picker.
 */
export function MentionTextarea({
  value,
  onChange,
  onTagCard,
  game,
  placeholder,
  rows = 5,
  previewTaggedCards = [],
}: MentionTextareaProps) {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editorMode, setEditorMode] = useState<'write' | 'preview'>('write');
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
      const found = await searchCatalogCards(mentionQuery, game);
      if (!cancelled) setSuggestions(found);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mentionQuery, game]);

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

  const focusWithSelection = (start: number, end: number) => {
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(start, end);
      }
    }, 0);
  };

  const wrapSelection = (before: string, after: string, fallbackText: string) => {
    const el = textareaRef.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const selected = value.slice(start, end);
    const inner = selected || fallbackText;
    const next = value.slice(0, start) + before + inner + after + value.slice(end);
    onChange(next);
    focusWithSelection(start + before.length, start + before.length + inner.length);
  };

  const prefixLines = (prefix: string) => {
    const el = textareaRef.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndIdx = value.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const updated = block
      .split('\n')
      .map((line, i) => {
        if (prefix === '1. ') return `${i + 1}. ${line.replace(/^\d+\.\s+/, '')}`;
        return line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`;
      })
      .join('\n');
    const next = value.slice(0, lineStart) + updated + value.slice(lineEnd);
    onChange(next);
    focusWithSelection(lineStart, lineStart + updated.length);
  };

  const insertDivider = () => {
    const el = textareaRef.current;
    const pos = el ? el.selectionStart : value.length;
    const prefix = pos > 0 && value[pos - 1] !== '\n' ? '\n' : '';
    const snippet = `${prefix}---\n`;
    const next = value.slice(0, pos) + snippet + value.slice(pos);
    onChange(next);
    focusWithSelection(pos + snippet.length, pos + snippet.length);
  };

  const triggerAtMention = () => {
    const el = textareaRef.current;
    const pos = el ? el.selectionStart : value.length;
    const needSpace = pos > 0 && !/\s/.test(value[pos - 1]);
    const insert = `${needSpace ? ' ' : ''}@`;
    const next = value.slice(0, pos) + insert + value.slice(pos);
    onChange(next);
    const nextPos = pos + insert.length;
    detectMention(next, nextPos);
    focusWithSelection(nextPos, nextPos);
  };

  const toolBtnCls =
    'h-7 px-2 rounded-md text-xs font-bold flex items-center justify-center transition hover:bg-[var(--bg-raised)] cursor-pointer';

  return (
    <div
      className="relative rounded-xl border overflow-visible"
      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
    >
      {/* Editor Toolbar + Write/Preview Tabs */}
      <div
        className="px-2 py-1.5 border-b flex items-center justify-between gap-2 flex-wrap rounded-t-xl"
        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-0.5 flex-wrap">
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={() => wrapSelection('**', '**', t('bold', 'félkövér'))}
            title={t('Bold (Ctrl+B)', 'Félkövér (Ctrl+B)')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <strong className="font-black">B</strong>
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={() => wrapSelection('*', '*', t('italic', 'dőlt'))}
            title={t('Italic (Ctrl+I)', 'Dőlt (Ctrl+I)')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <em className="italic font-serif">I</em>
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={() => wrapSelection('~~', '~~', t('strikethrough', 'áthúzott'))}
            title={t('Strikethrough', 'Áthúzott')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <span className="line-through">S</span>
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={() => prefixLines('## ')}
            title={t('Heading', 'Címsor')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            H
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={() => prefixLines('- ')}
            title={t('Bullet list', 'Felsorolás')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="9" y1="6" x2="20" y2="6" />
              <line x1="9" y1="12" x2="20" y2="12" />
              <line x1="9" y1="18" x2="20" y2="18" />
              <circle cx="4" cy="6" r="1" fill="currentColor" />
              <circle cx="4" cy="12" r="1" fill="currentColor" />
              <circle cx="4" cy="18" r="1" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={() => prefixLines('1. ')}
            title={t('Numbered list', 'Számozott lista')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="10" y1="6" x2="21" y2="6" />
              <line x1="10" y1="12" x2="21" y2="12" />
              <line x1="10" y1="18" x2="21" y2="18" />
              <path d="M4 6h1v4" />
              <path d="M4 10h2" />
              <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
            </svg>
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={() => prefixLines('> ')}
            title={t('Quote', 'Idézet')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
              <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
            </svg>
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={() => wrapSelection('`', '`', t('note', 'kiemelt'))}
            title={t('Inline highlight', 'Kiemelés')}
            className={`${toolBtnCls} font-mono disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            {'</>'}
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={insertDivider}
            title={t('Divider', 'Elválasztó')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-secondary)' }}
          >
            —
          </button>
          <button
            type="button"
            disabled={editorMode !== 'write'}
            onClick={triggerAtMention}
            title={t('Tag a card (@)', 'Kártya megjelölése (@)')}
            className={`${toolBtnCls} disabled:opacity-40`}
            style={{ color: 'var(--text-accent)' }}
          >
            @{t('Lap', 'Lap')}
          </button>
        </div>

        <div
          className="inline-flex rounded-lg border p-0.5 gap-0.5"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
        >
          <button
            type="button"
            onClick={() => setEditorMode('write')}
            className="px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition"
            style={
              editorMode === 'write'
                ? { background: 'var(--accent)', color: 'var(--text-on-accent, #000)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            {t('Write', 'Szerkesztés')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMentionQuery(null);
              setMentionRange(null);
              setSuggestions([]);
              setEditorMode('preview');
            }}
            className="px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition"
            style={
              editorMode === 'preview'
                ? { background: 'var(--accent)', color: 'var(--text-on-accent, #000)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            {t('Preview', 'Előnézet')}
          </button>
        </div>
      </div>

      {editorMode === 'write' ? (
        <textarea
          ref={textareaRef}
          rows={rows}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            detectMention(next, e.target.selectionStart ?? next.length);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
              if (e.key.toLowerCase() === 'b') {
                e.preventDefault();
                wrapSelection('**', '**', t('bold', 'félkövér'));
              } else if (e.key.toLowerCase() === 'i') {
                e.preventDefault();
                wrapSelection('*', '*', t('italic', 'dőlt'));
              }
            }
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
          className="w-full px-3 py-2.5 rounded-b-xl text-xs leading-relaxed outline-none resize-y bg-transparent"
          style={{ color: 'var(--text-primary)' }}
        />
      ) : (
        <div
          className="px-3 py-2.5 min-h-[112px] max-h-64 overflow-y-auto text-xs leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          <PostDescriptionRenderer
            body={value}
            taggedCards={previewTaggedCards}
            emptyFallback={t('Nothing to preview yet.', 'Még nincs mit megjeleníteni.')}
          />
        </div>
      )}

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
