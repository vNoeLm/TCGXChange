import React from 'react';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import {
  clampBundleDiscountPct,
  computeAdaptiveBundlePrice,
  type BundlePricingMode,
  type PriceableBundleCard,
} from '../../lib/bundlePricing';

const DISCOUNT_PRESETS = [0, 5, 10, 15, 20];

interface BundlePricingControlProps {
  mode: BundlePricingMode;
  onModeChange: (mode: BundlePricingMode) => void;
  fixedPriceHuf: string;
  onFixedPriceChange: (val: string) => void;
  discountPct: number;
  onDiscountPctChange: (pct: number) => void;
  bundleOnly?: boolean;
  onBundleOnlyChange?: (val: boolean) => void;
  taggedCards: PriceableBundleCard[];
}

export function BundlePricingControl({
  mode,
  onModeChange,
  fixedPriceHuf,
  onFixedPriceChange,
  discountPct,
  onDiscountPctChange,
  onBundleOnlyChange,
  taggedCards,
}: BundlePricingControlProps) {
  const { t } = useLanguage();
  const { formatPrice } = useCurrency();

  const adaptive = computeAdaptiveBundlePrice(taggedCards, discountPct);
  const isBundleMode = mode === 'fixed' || mode === 'adaptive';

  const selectPerCard = () => {
    onModeChange('none');
    onBundleOnlyChange?.(false);
  };

  const selectFixedBundleOnly = () => {
    onModeChange('fixed');
    onBundleOnlyChange?.(true);
  };

  const selectAdaptiveSplittable = () => {
    onModeChange('adaptive');
    onBundleOnlyChange?.(false);
  };

  return (
    <div className="space-y-2.5">
      <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        {t('Pricing Mode', 'Árazási mód')}
      </label>

      {/* Top-level 2-mode selector: Per card vs Bundle */}
      <div
        className="grid grid-cols-2 gap-1 p-1 rounded-lg border"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
      >
        <button
          type="button"
          onClick={selectPerCard}
          className="py-1.5 px-2 rounded-md text-xs font-bold transition cursor-pointer"
          style={
            !isBundleMode
              ? { background: 'var(--accent)', color: 'var(--text-on-accent, #000)' }
              : { background: 'transparent', color: 'var(--text-secondary)' }
          }
        >
          {t('Per card', 'Laponként')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!isBundleMode) selectAdaptiveSplittable();
          }}
          className="py-1.5 px-2 rounded-md text-xs font-bold transition cursor-pointer"
          style={
            isBundleMode
              ? { background: 'var(--accent)', color: 'var(--text-on-accent, #000)' }
              : { background: 'transparent', color: 'var(--text-secondary)' }
          }
        >
          {t('Bundle', 'Csomagár')}
        </button>
      </div>

      {isBundleMode && (
        <div
          className="rounded-lg border p-3 space-y-3"
          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
        >
          {/* Sub-mode: Bundle-only (Fixed) vs Splittable (Adaptive) */}
          <div
            className="grid grid-cols-2 gap-1 p-1 rounded-lg border"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
          >
            <button
              type="button"
              onClick={selectFixedBundleOnly}
              className="py-1.5 px-2 rounded-md text-xs font-bold transition cursor-pointer"
              style={
                mode === 'fixed'
                  ? { background: 'var(--accent-muted)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)' }
                  : { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' }
              }
            >
              {t('Bundle only (Fixed)', 'Csak egyben (Fix ár)')}
            </button>
            <button
              type="button"
              onClick={selectAdaptiveSplittable}
              className="py-1.5 px-2 rounded-md text-xs font-bold transition cursor-pointer"
              style={
                mode === 'adaptive'
                  ? { background: 'var(--accent-muted)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)' }
                  : { background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' }
              }
            >
              {t('Splittable (Adaptive −%)', 'Laponként is (Adaptív −%)')}
            </button>
          </div>

          {mode === 'fixed' && (
            <div className="relative w-full sm:w-64">
              <input
                type="number"
                min={1}
                max={50000000}
                value={fixedPriceHuf}
                onChange={(e) => onFixedPriceChange(e.target.value)}
                placeholder={t('Fixed bundle price', 'Fix csomagár')}
                className="w-full h-9 pl-3 pr-9 rounded-lg border text-sm font-black font-mono outline-none focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold pointer-events-none"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Ft
              </span>
            </div>
          )}

          {mode === 'adaptive' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {DISCOUNT_PRESETS.map((pct) => {
                    const active = discountPct === pct;
                    return (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => onDiscountPctChange(pct)}
                        className="px-2.5 py-1 rounded-md border text-xs font-bold cursor-pointer transition"
                        style={
                          active
                            ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                            : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                        }
                      >
                        {pct === 0 ? '0%' : `−${pct}%`}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>
                    {t('Discount:', 'Kedvezmény:')}
                  </span>
                  <div className="relative w-20">
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={discountPct}
                      onChange={(e) => onDiscountPctChange(clampBundleDiscountPct(e.target.value))}
                      className="w-full h-8 pl-2.5 pr-6 rounded-md border text-xs font-black font-mono outline-none focus:border-[var(--accent)]"
                      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>
                      %
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="pt-2 border-t flex items-center justify-between gap-2 flex-wrap text-xs"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                {adaptive.bundlePriceHuf != null ? (
                  <>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {t('Available sum:', 'Elérhető összár:')}{' '}
                      <strong className="font-mono" style={{ color: 'var(--text-primary)' }}>
                        {formatPrice(adaptive.availableTotalHuf)}
                      </strong>
                      {adaptive.discountPct > 0 ? ` (−${adaptive.discountPct}%)` : ''}
                    </span>
                    <span className="font-black font-mono text-sm" style={{ color: 'var(--positive)' }}>
                      {formatPrice(adaptive.bundlePriceHuf)}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {t('At least 2 available priced cards required.', 'Legalább 2 elérhető árazott lap szükséges.')}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
