import { useEffect } from 'react';
import { CARD_CONDITIONS } from '../../lib/collectionDefaults';
import { RARITY_STYLES } from '../../lib/domainColors';
import { useLanguage } from '../../lib/i18n';
import { backdropCloseProps } from '../../lib/modalBackdrop';
import {
  BULK_FLOOR_PRESETS,
  BULK_RARITY_KEYS,
  type BulkPriceMode,
  type BulkPricingSettings,
  type BulkRoundStep,
  type CardCondition,
} from '../../lib/storeBulkPricing';
import { NumericInput } from './NumericInput';

interface Props {
  settings: BulkPricingSettings;
  eurRate: number;
  open: boolean;
  queueCount: number;
  onChange: (next: BulkPricingSettings) => void;
  onApplyToQueue: () => void;
  onClose: () => void;
}

export default function StoreBulkPricingPanel({
  settings,
  eurRate,
  open,
  queueCount,
  onChange,
  onApplyToQueue,
  onClose,
}: Props) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (partial: Partial<BulkPricingSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const setRarityValue = (key: string, val: number) => {
    const clean = Math.max(10, Math.round(val));
    if (settings.priceMode === 'rarity_fixed') {
      patch({ rarityFixed: { ...settings.rarityFixed, [key]: clean } });
    } else {
      patch({ rarityFloors: { ...settings.rarityFloors, [key]: clean } });
    }
  };

  const inputClass =
    'px-2.5 py-2 rounded-xl border text-xs font-semibold outline-none focus:ring-2 focus:ring-[var(--accent)]/40';
  const inputStyle = {
    background: 'var(--bg-input)',
    borderColor: 'var(--border)',
    color: 'var(--text-primary)',
  };

  const isRarityFixed = settings.priceMode === 'rarity_fixed';
  const activeRarityMap = isRarityFixed ? settings.rarityFixed : settings.rarityFloors;

  return (
    <div
      {...backdropCloseProps(onClose)}
      className="fixed inset-0 z-[135] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs overflow-y-auto"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Pricing & Floor Rules', 'Floor árak és szabályok')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        {/* Modal Header */}
        <div
          className="px-5 py-4 border-b flex items-start justify-between gap-4 shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
        >
          <div>
            <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
              {t('Pricing & Rarity Floor Rules', 'Árazás és Rarity Floor beállítások')}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {t(
                `Saved automatically in your browser. Current EUR rate: ${Math.round(eurRate)} Ft/€`,
                `Automatikusan mentve a böngészőben. Aktuális EUR árfolyam: ${Math.round(eurRate)} Ft/€`
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close', 'Bezárás')}
            className="p-1.5 rounded-lg border cursor-pointer hover:bg-[var(--bg-raised)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 custom-scrollbar">
          {/* Primary Strategy Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('Default Condition', 'Alap állapot')}
              </label>
              <select
                value={settings.defaultCondition}
                onChange={(e) => patch({ defaultCondition: e.target.value as CardCondition })}
                className={`${inputClass} w-full cursor-pointer`}
                style={inputStyle}
              >
                {CARD_CONDITIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.labelEn, c.labelHu)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('Pricing Strategy', 'Árazási mód')}
              </label>
              <select
                value={settings.priceMode}
                onChange={(e) => patch({ priceMode: e.target.value as BulkPriceMode })}
                className={`${inputClass} w-full cursor-pointer`}
                style={inputStyle}
              >
                <option value="market">{t('Cardmarket Market Price + Rarity Floor', 'Cardmarket ár + Rarity minimum (Floor)')}</option>
                <option value="rarity_fixed">{t('Fixed Price per Rarity Tier', 'Fix ár ritkaságonként')}</option>
                <option value="fixed">{t('Single Flat Price for All Cards', 'Egységes fix darabár minden lapra')}</option>
              </select>
            </div>

            {settings.priceMode === 'market' ? (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {t('Margin Adjustment (%)', 'Árrés módosítás (%)')}
                </label>
                <div className="flex items-center gap-1.5">
                  <NumericInput
                    value={settings.marketPercent}
                    min={-90}
                    max={500}
                    allowNegative
                    onChangeValue={(v) => patch({ marketPercent: v })}
                    className={`${inputClass} w-20 text-center`}
                    style={inputStyle}
                  />
                  {[-10, 0, 10, 20].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => patch({ marketPercent: pct })}
                      className="px-2 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer"
                      style={
                        settings.marketPercent === pct
                          ? { borderColor: 'var(--accent)', background: 'var(--accent-muted)', color: 'var(--text-accent)' }
                          : { borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', background: 'var(--bg-surface-2)' }
                      }
                    >
                      {pct > 0 ? `+${pct}` : pct}%
                    </button>
                  ))}
                </div>
              </div>
            ) : settings.priceMode === 'fixed' ? (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {t('Flat Price (Ft)', 'Fix darabár (Ft)')}
                </label>
                <NumericInput
                  value={settings.fixedPriceHuf}
                  min={10}
                  onChangeValue={(v) => patch({ fixedPriceHuf: v })}
                  className={`${inputClass} w-full`}
                  style={inputStyle}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('Rounding Step', 'Kerekítés')}
              </label>
              <select
                value={String(settings.roundStep)}
                onChange={(e) => {
                  const v = e.target.value;
                  patch({ roundStep: v === 'auto' ? 'auto' : (Number(v) as BulkRoundStep) });
                }}
                className={`${inputClass} w-full cursor-pointer`}
                style={inputStyle}
              >
                <option value="auto">{t('Smart (5/10/50/100 Ft)', 'Okos (5/10/50/100 Ft)')}</option>
                <option value="10">10 Ft</option>
                <option value="50">50 Ft</option>
                <option value="100">100 Ft</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                {t('Store Status', 'Bolti státusz')}
              </label>
              <select
                value={settings.targetStatus}
                onChange={(e) => patch({ targetStatus: e.target.value as 'active' | 'draft' })}
                className={`${inputClass} w-full cursor-pointer`}
                style={inputStyle}
              >
                <option value="active">{t('Active (Published)', 'Aktív a boltban')}</option>
                <option value="draft">{t('Draft (Hidden)', 'Vázlat (Rejtett)')}</option>
              </select>
            </div>
          </div>

          {/* Per-Rarity Floor / Fixed Prices */}
          {settings.priceMode !== 'fixed' && (
            <div className="p-4 rounded-xl border space-y-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <h3 className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
                    {isRarityFixed
                      ? t('Fixed Price by Rarity (Ft)', 'Fix ár ritkaságonként (Ft)')
                      : t('Minimum Floor Price by Rarity (Ft)', 'Minimum (Floor) ár ritkaságonként (Ft)')}
                  </h3>
                  {!isRarityFixed && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {BULK_FLOOR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() =>
                            patch({
                              rarityFloors: { ...preset.floors },
                              foilFloorMultiplier: preset.foilMultiplier,
                            })
                          }
                          className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}
                        >
                          {t(preset.labelEn, preset.labelHu)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {t('Foil floor mult:', 'Fólia szorzó:')}
                  </span>
                  {[1, 1.5, 2, 3].map((mult) => (
                    <button
                      key={mult}
                      type="button"
                      onClick={() => patch({ foilFloorMultiplier: mult })}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer"
                      style={
                        settings.foilFloorMultiplier === mult
                          ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.16)', color: '#fbbf24' }
                          : { borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', background: 'var(--bg-surface)' }
                      }
                    >
                      {mult}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {BULK_RARITY_KEYS.map((key) => {
                  const styleToken = RARITY_STYLES[key] || { dot: '#94a3b8' };
                  const val = activeRarityMap[key] ?? (isRarityFixed ? 30 : 20);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                    >
                      <span className="inline-flex items-center gap-2 text-xs font-bold truncate" style={{ color: 'var(--text-secondary)' }}>
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: styleToken.dot }} />
                        {key === 'default' ? t('Other', 'Egyéb') : key}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <NumericInput
                          value={val}
                          min={10}
                          onChangeValue={(v) => setRarityValue(key, v)}
                          className="w-20 px-2 py-1 rounded-lg border text-right text-xs font-bold outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
                          style={inputStyle}
                        />
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Ft</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inventory & Helper Options */}
          <div className="p-4 rounded-xl border space-y-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-center gap-5 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={settings.mergeExisting}
                  onChange={(e) => patch({ mergeExisting: e.target.checked })}
                  className="rounded accent-[var(--accent)]"
                />
                <span>{t('Merge matching Store stock (add quantity instead of duplicating)', 'Meglévő készlet összevonása (mennyiség növelése duplikálás helyett)')}</span>
              </label>

              {settings.mergeExisting && (
                <label className="inline-flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    checked={settings.updateExistingPrice}
                    onChange={(e) => patch({ updateExistingPrice: e.target.checked })}
                    className="rounded accent-[var(--accent)]"
                  />
                  <span>{t('Overwrite existing listing price', 'Meglévő termék árának felülírása')}</span>
                </label>
              )}
            </div>

            {settings.priceMode === 'market' && (
              <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
                <div className="inline-flex items-center gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>{t('If no Cardmarket price:', 'Ha nincs piaci ár:')}</span>
                  <select
                    value={settings.unpricedMode}
                    onChange={(e) => patch({ unpricedMode: e.target.value as 'floor' | 'fixed' })}
                    className="px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer"
                    style={inputStyle}
                  >
                    <option value="floor">{t('Use Rarity Floor', 'Rarity minimum')}</option>
                    <option value="fixed">{t('Fixed Fallback (Ft)', 'Fix tartalék (Ft)')}</option>
                  </select>
                  {settings.unpricedMode === 'fixed' && (
                    <NumericInput
                      value={settings.unpricedFallbackHuf}
                      min={10}
                      onChangeValue={(v) => patch({ unpricedFallbackHuf: v })}
                      className="w-20 px-2 py-1.5 rounded-lg border text-right text-xs font-bold"
                      style={inputStyle}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3.5 border-t flex flex-wrap items-center justify-between gap-3 shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
        >
          {queueCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                onApplyToQueue();
                onClose();
              }}
              className="px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--accent)', color: 'var(--text-accent)', background: 'var(--bg-surface-2)' }}
            >
              {t(`Recalculate ${queueCount} queued item(s) & close`, `Várólista (${queueCount} tétel) újraszámolása és bezárás`)}
            </button>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('Changes take effect immediately on newly added cards.', 'A módosítások azonnal érvényesülnek.')}
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-5 py-2 rounded-xl text-xs font-black cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {t('Done', 'Kész')}
          </button>
        </div>
      </div>
    </div>
  );
}
