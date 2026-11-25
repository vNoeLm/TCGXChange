import React, { useState } from 'react';
import { useLanguage } from '../../lib/i18n';

const BULK_DISCOUNT_PRESETS = [0, 5, 10, 15, 20];

interface BulkTagPricingBarProps {
  pricedMarketCount: number;
  totalCount: number;
  onApplyDiscount: (discountPct: number) => void;
}

/**
 * Compact bar above tagged cards in post creation & edit modals to fill
 * all tagged cards' HUF prices from Cardmarket market prices minus X%.
 */
export function BulkTagPricingBar({
  pricedMarketCount,
  totalCount,
  onApplyDiscount,
}: BulkTagPricingBarProps) {
  const { t } = useLanguage();
  const [selectedPct, setSelectedPct] = useState<number>(10);

  if (totalCount === 0) return null;

  return (
    <div
      className="flex items-center justify-between gap-2 flex-wrap px-3 py-2 rounded-lg border"
      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider mr-1" style={{ color: 'var(--text-secondary)' }}>
          {t('Market price', 'Piaci ár')}
        </span>
        {BULK_DISCOUNT_PRESETS.map((pct) => {
          const active = selectedPct === pct;
          return (
            <button
              key={pct}
              type="button"
              onClick={() => setSelectedPct(pct)}
              className="px-2 py-0.5 rounded-md border text-[11px] font-bold cursor-pointer transition"
              style={
                active
                  ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                  : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
              }
            >
              {pct === 0 ? '100%' : `−${pct}%`}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={pricedMarketCount === 0}
        onClick={() => onApplyDiscount(selectedPct)}
        className="px-2.5 py-1 rounded-md border text-[11px] font-bold cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: 'var(--bg-input)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
      >
        {t(`Apply to ${pricedMarketCount} card${pricedMarketCount === 1 ? '' : 's'}`, `Alkalmazás (${pricedMarketCount} lap)`)}
      </button>
    </div>
  );
}
