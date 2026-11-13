import { CARD_CONDITIONS } from '../../lib/collectionDefaults';
import { RARITY_STYLES } from '../../lib/domainColors';
import { useLanguage } from '../../lib/i18n';
import {
  BULK_FLOOR_PRESETS,
  BULK_RARITY_KEYS,
  type BulkPriceMode,
  type BulkPricingSettings,
  type BulkRoundStep,
  type CardCondition,
} from '../../lib/storeBulkPricing';

interface Props {
  settings: BulkPricingSettings;
  eurRate: number;
  expanded: boolean;
  queueCount: number;
  onChange: (next: BulkPricingSettings) => void;
  onApplyToQueue: () => void;
  onClosePanel: () => void;
}

export default function StoreBulkPricingPanel({
  settings,
  eurRate,
  expanded,
  queueCount,
  onChange,
  onApplyToQueue,
  onClosePanel,
}: Props) {
  const { t } = useLanguage();

  const patch = (partial: Partial<BulkPricingSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const setRarityValue = (key: string, val: number) => {
    const clean = Math.max(10, Math.round(val || 10));
    if (settings.priceMode === 'rarity_fixed') {
      patch({ rarityFixed: { ...settings.rarityFixed, [key]: clean } });
    } else {
      patch({ rarityFloors: { ...settings.rarityFloors, [key]: clean } });
    }
  };

  const inputClass =
    'px-2.5 py-1.5 rounded-lg border text-xs font-semibold outline-none focus:ring-2 focus:ring-[var(--accent)]/40';
  const inputStyle = {
    background: 'var(--bg-input)',
    borderColor: 'var(--border)',
    color: 'var(--text-primary)',
  };

  if (!expanded) return null;

  const isRarityFixed = settings.priceMode === 'rarity_fixed';
  const activeRarityMap = isRarityFixed ? settings.rarityFixed : settings.rarityFloors;

  return (
    <div
      className="px-4 sm:px-6 py-4 border-b shrink-0 space-y-4 overflow-y-auto max-h-[55vh]"
      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
    >
      {/* Row 1: Primary Mode & Rules */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="space-y-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('Condition', 'Alap állapot')}
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

        <div className="space-y-1 lg:col-span-2">
          <label className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('Pricing Strategy', 'Árazási mód')} ({Math.round(eurRate)} Ft/€)
          </label>
          <select
            value={settings.priceMode}
            onChange={(e) => patch({ priceMode: e.target.value as BulkPriceMode })}
            className={`${inputClass} w-full cursor-pointer`}
            style={inputStyle}
          >
            <option value="market">{t('Cardmarket Price + Rarity Floor', 'Cardmarket ár + Rarity minimum')}</option>
            <option value="rarity_fixed">{t('Fixed Price per Rarity Tier', 'Fix ár ritkaságonként')}</option>
            <option value="fixed">{t('Single Flat Price for All Cards', 'Egységes fix darabár')}</option>
          </select>
        </div>

        {settings.priceMode === 'market' ? (
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {t('Margin %', 'Árrés %')}
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={settings.marketPercent}
                onChange={(e) => patch({ marketPercent: Number(e.target.value) || 0 })}
                className={`${inputClass} w-16 text-center`}
                style={inputStyle}
              />
              {[-10, 0, 10, 20].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => patch({ marketPercent: pct })}
                  className="px-1.5 py-1 rounded text-[10px] font-bold border cursor-pointer"
                  style={
                    settings.marketPercent === pct
                      ? { borderColor: 'var(--accent)', background: 'var(--accent-muted)', color: 'var(--text-accent)' }
                      : { borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', background: 'var(--bg-surface)' }
                  }
                >
                  {pct > 0 ? `+${pct}` : pct}%
                </button>
              ))}
            </div>
          </div>
        ) : settings.priceMode === 'fixed' ? (
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {t('Flat Price (Ft)', 'Fix darabár (Ft)')}
            </label>
            <input
              type="number"
              min={10}
              step={5}
              value={settings.fixedPriceHuf}
              onChange={(e) => patch({ fixedPriceHuf: Math.max(10, Number(e.target.value) || 10) })}
              className={`${inputClass} w-full`}
              style={inputStyle}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {t('Target Fill Stock', 'Célkészlet (db)')}
            </label>
            <input
              type="number"
              min={1}
              max={99}
              value={settings.targetStockCount}
              onChange={(e) => patch({ targetStockCount: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
              className={`${inputClass} w-full`}
              style={inputStyle}
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
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

        <div className="space-y-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
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

      {/* Row 2: Rarity Floor / Fixed Matrix + Foil Multiplier + Presets */}
      {settings.priceMode !== 'fixed' && (
        <div className="p-3 rounded-xl border space-y-2.5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
                {isRarityFixed
                  ? t('Fixed Price by Rarity (Ft)', 'Fix ár ritkaságonként (Ft)')
                  : t('Minimum Floor Price by Rarity (Ft)', 'Minimum (Floor) ár ritkaságonként (Ft)')}
              </span>
              {!isRarityFixed && (
                <div className="flex items-center gap-1 flex-wrap">
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
                      className="px-2 py-0.5 rounded-md border text-[10px] font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-surface-2)' }}
                    >
                      {t(preset.labelEn, preset.labelHu)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                  {t('Foil floor mult:', 'Fólia szorzó:')}
                </span>
                {[1, 1.5, 2, 3].map((mult) => (
                  <button
                    key={mult}
                    type="button"
                    onClick={() => patch({ foilFloorMultiplier: mult })}
                    className="px-2 py-0.5 rounded text-[11px] font-bold border cursor-pointer"
                    style={
                      settings.foilFloorMultiplier === mult
                        ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.16)', color: '#fbbf24' }
                        : { borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', background: 'var(--bg-surface-2)' }
                    }
                  >
                    {mult}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {BULK_RARITY_KEYS.map((key) => {
              const styleToken = RARITY_STYLES[key] || { dot: '#94a3b8', text: 'var(--text-secondary)' };
              const val = activeRarityMap[key] ?? (isRarityFixed ? 30 : 20);
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                >
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold truncate" style={{ color: 'var(--text-secondary)' }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: styleToken.dot }} />
                    {key === 'default' ? t('Other', 'Egyéb') : key}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min={10}
                      step={5}
                      value={val}
                      onChange={(e) => setRarityValue(key, Number(e.target.value))}
                      className="w-16 px-1.5 py-1 rounded border text-right text-xs font-bold outline-none"
                      style={inputStyle}
                    />
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Ft</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Row 3: Stock merge, Unpriced fallback, Target stock & Apply */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={settings.mergeExisting}
              onChange={(e) => patch({ mergeExisting: e.target.checked })}
              className="rounded accent-[var(--accent)]"
            />
            <span>{t('Merge matching Store stock', 'Meglévő készlet összevonása')}</span>
          </label>

          {settings.mergeExisting && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={settings.updateExistingPrice}
                onChange={(e) => patch({ updateExistingPrice: e.target.checked })}
                className="rounded accent-[var(--accent)]"
              />
              <span>{t('Overwrite existing listing price', 'Meglévő termék árának felülírása')}</span>
            </label>
          )}

          {settings.priceMode === 'market' && (
            <div className="inline-flex items-center gap-1.5">
              <span style={{ color: 'var(--text-muted)' }}>{t('If no EUR price:', 'Ha nincs piaci ár:')}</span>
              <select
                value={settings.unpricedMode}
                onChange={(e) => patch({ unpricedMode: e.target.value as 'floor' | 'fixed' })}
                className="px-2 py-1 rounded border text-[11px] font-semibold cursor-pointer"
                style={inputStyle}
              >
                <option value="floor">{t('Use Rarity Floor', 'Rarity minimum')}</option>
                <option value="fixed">{t('Fixed Fallback (Ft)', 'Fix tartalék (Ft)')}</option>
              </select>
              {settings.unpricedMode === 'fixed' && (
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={settings.unpricedFallbackHuf}
                  onChange={(e) => patch({ unpricedFallbackHuf: Math.max(10, Number(e.target.value) || 10) })}
                  className="w-16 px-2 py-1 rounded border text-right text-[11px] font-bold"
                  style={inputStyle}
                />
              )}
            </div>
          )}

          <div className="inline-flex items-center gap-1.5">
            <span style={{ color: 'var(--text-muted)' }}>{t('Target stock helper:', 'Célkészlet segéd:')}</span>
            <input
              type="number"
              min={1}
              max={99}
              value={settings.targetStockCount}
              onChange={(e) => patch({ targetStockCount: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
              className="w-14 px-2 py-1 rounded border text-center text-[11px] font-bold"
              style={inputStyle}
            />
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>db</span>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {queueCount > 0 && (
            <button
              type="button"
              onClick={onApplyToQueue}
              className="px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--accent)', color: 'var(--text-accent)', background: 'var(--bg-surface)' }}
            >
              {t('Re-apply rules to Queue', 'Szabályok újraszámolása a listán')}
            </button>
          )}
          <button
            type="button"
            onClick={onClosePanel}
            className="px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}
          >
            {t('Hide settings', 'Beállítások elrejtése')}
          </button>
        </div>
      </div>
    </div>
  );
}
