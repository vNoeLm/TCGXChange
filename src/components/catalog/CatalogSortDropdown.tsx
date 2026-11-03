import React, { useState, useRef, useEffect } from 'react';
import { useExitTransition } from '../../lib/useExitTransition';
import { useLanguage } from '../../lib/i18n';

export interface SortOption {
  mode: string;
  label?: string;
  labelHu?: string;
}

export const CATALOG_SORT_OPTIONS: SortOption[] = [
  { mode: "Card Number (Asc)", label: "Card Number (Asc)", labelHu: "Kártyaszám (Növekvő)" },
  { mode: "Card Number (Desc)", label: "Card Number (Desc)", labelHu: "Kártyaszám (Csökkenő)" },
  { mode: "Quantity (High to Low)", label: "Quantity (High to Low)", labelHu: "Mennyiség (Csökkenő)" },
  { mode: "Quantity (Low to High)", label: "Quantity (Low to High)", labelHu: "Mennyiség (Növekvő)" },
  { mode: "Rarity (High to Low)", label: "Rarity (High to Low)", labelHu: "Ritkaság (Csökkenő)" },
  { mode: "Rarity (Low to High)", label: "Rarity (Low to High)", labelHu: "Ritkaság (Növekvő)" },
  { mode: "Name (A to Z)", label: "Name (A to Z)", labelHu: "Név (A - Z)" },
  { mode: "Name (Z to A)", label: "Name (Z to A)", labelHu: "Név (Z - A)" },
  { mode: "Energy Cost (Low to High)", label: "Energy Cost (Low to High)", labelHu: "Energia költség (Növekvő)" },
  { mode: "Energy Cost (High to Low)", label: "Energy Cost (High to Low)", labelHu: "Energia költség (Csökkenő)" },
  { mode: "Est. Value (High to Low)", label: "Est. Value (High to Low)", labelHu: "Becsült érték (Csökkenő)" },
  { mode: "Est. Value (Low to High)", label: "Est. Value (Low to High)", labelHu: "Becsült érték (Növekvő)" },
];

export interface CatalogSortDropdownProps {
  value: string;
  onChange: (mode: string) => void;
  options?: SortOption[];
  className?: string;
}

export function CatalogSortDropdown({
  value,
  onChange,
  options = CATALOG_SORT_OPTIONS,
  className = 'w-56 shrink-0 z-40',
}: CatalogSortDropdownProps) {
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const anim = useExitTransition(open, 150);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeOption = options.find((o) => o.mode === value);
  const activeLabel =
    lang === 'hu'
      ? activeOption?.labelHu || activeOption?.label || value
      : activeOption?.label || value;

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full h-10 px-3.5 flex items-center justify-between gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-primary)] text-xs font-semibold transition shadow-sm cursor-pointer select-none hover:bg-[var(--bg-raised)]"
      >
        <span className="truncate">{activeLabel}</span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-muted)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {anim.rendered && (
        <div
          data-state={anim.state}
          className="tv-popover tv-origin-top-right absolute right-0 mt-1.5 w-full min-w-[13rem] rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] backdrop-blur-md z-50 overflow-hidden max-h-80 overflow-y-auto shadow-2xl p-1"
        >
          {options.map((opt) => {
            const isSelected = opt.mode === value;
            const label = lang === 'hu' ? opt.labelHu || opt.label || opt.mode : opt.label || opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                onClick={() => {
                  onChange(opt.mode);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold transition cursor-pointer text-left rounded-lg ${
                  isSelected
                    ? 'bg-[var(--accent-muted)] text-[var(--text-accent)] font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)]'
                }`}
              >
                <span className="truncate">{label}</span>
                {isSelected && (
                  <svg className="w-3.5 h-3.5 shrink-0 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
