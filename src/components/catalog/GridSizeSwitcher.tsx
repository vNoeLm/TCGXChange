import React from 'react';
import type { GridSize } from '../../lib/gridSize';
import { useLanguage } from '../../lib/i18n';

export interface GridSizeSwitcherProps {
  size: GridSize;
  onChange: (size: GridSize) => void;
  className?: string;
}

export function GridSizeSwitcher({ size, onChange, className = '' }: GridSizeSwitcherProps) {
  const { t } = useLanguage();

  return (
    <div className={`grid grid-cols-3 sm:flex items-center bg-[var(--bg-input)] border border-[var(--border)] rounded-xl p-1 h-10 sm:h-9 shrink-0 gap-1 w-full sm:w-auto ${className}`}>
      {(['small', 'normal', 'large'] as const).map((s) => {
        const active = size === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            title={t(`Card display size: ${s}`, `Kártya mérete: ${s}`)}
            className={`flex items-center justify-center px-3 py-1.5 sm:py-1 text-xs rounded-lg transition cursor-pointer capitalize font-semibold ${
              active
                ? 'text-[var(--text-primary)] bg-[var(--bg-raised)] border border-[var(--border-hover)] shadow-sm'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] border border-transparent'
            }`}
          >
            {s === 'small' ? t('Small', 'Kicsi') : s === 'large' ? t('Large', 'Nagy') : t('Normal', 'Normál')}
          </button>
        );
      })}
    </div>
  );
}
