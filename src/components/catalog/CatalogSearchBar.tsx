import React from 'react';
import { useLanguage } from '../../lib/i18n';

export interface CatalogSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  title?: string;
  className?: string;
}

export function CatalogSearchBar({
  value,
  onChange,
  placeholder,
  onClear,
  inputRef,
  onKeyDown,
  title,
  className = '',
}: CatalogSearchBarProps) {
  const { t } = useLanguage();
  const defaultPlaceholder = t(
    'Search cards by name, number, or artist...',
    'Keresés kártyanév, szám vagy művész alapján...'
  );

  return (
    <div className={`flex-1 relative min-w-0 ${className}`}>
      <svg
        className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
        style={{ color: 'var(--text-muted)' }}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder || defaultPlaceholder}
        title={title}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-full h-10 rounded-xl pl-10 pr-8 text-xs font-medium outline-none transition shadow-inner border border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-primary)] focus:border-[var(--accent)]"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            if (onClear) onClear();
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-xs font-bold rounded-full hover:bg-[var(--bg-raised)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
          title={t('Clear search', 'Keresés törlése')}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
