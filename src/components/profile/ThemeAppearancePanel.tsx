import { useEffect, useState } from 'react';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import {
  useSiteTheme,
  getCustomTheme,
  saveCustomTheme,
  DEFAULT_CUSTOM_THEME,
  type ThemeMode,
  type CustomThemeConfig,
} from '../../lib/theme';

export const THEME_SWATCHES: { mode: ThemeMode; name: string; hex: string[] }[] = [
  { mode: 'auto', name: 'Auto (System)', hex: ['#3b82f6', '#fb7185'] },
  { mode: 'dark', name: 'Midnight Slate', hex: ['#3b82f6'] },
  { mode: 'light', name: 'Ivory Parchment', hex: ['#f3ede2', '#fb7185'] },
  { mode: 'custom', name: 'Custom Studio', hex: ['#a855f7', '#06b6d4'] },
];

interface ThemeAppearancePanelProps {
  onToast?: (msg: string) => void;
  compact?: boolean;
}

/**
 * Shared Theme, Display Currency & Custom Palette Studio panel used inside both
 * the Profile Settings tab and the Profile Settings modal.
 */
export function ThemeAppearancePanel({ onToast, compact = false }: ThemeAppearancePanelProps) {
  const { themeMode, setThemeMode } = useSiteTheme();
  const { currency, setCurrency } = useCurrency();
  const { t, lang } = useLanguage();

  const [customConfig, setCustomConfig] = useState<CustomThemeConfig>(() => getCustomTheme());
  const [showThemeJsonBox, setShowThemeJsonBox] = useState(false);
  const [themeJsonInput, setThemeJsonInput] = useState('');

  useEffect(() => {
    const handleCustomChange = (e: Event) => {
      const custom = e as CustomEvent<CustomThemeConfig>;
      if (custom.detail) setCustomConfig(custom.detail);
    };
    window.addEventListener('tcg-custom-theme-change', handleCustomChange);
    return () => window.removeEventListener('tcg-custom-theme-change', handleCustomChange);
  }, []);

  const activeSwatch = THEME_SWATCHES.find((opt) => opt.mode === themeMode) || THEME_SWATCHES[0];

  return (
    <div
      className={`rounded-2xl ${compact ? 'p-4' : 'p-5'} border space-y-5`}
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
          <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a4.5 4.5 0 0 0 0 9 4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0-9 4.5 4.5 0 0 1 0-9" />
          </svg>
          <span>{t('Theme & Appearance', 'Téma és Megjelenés')}</span>
        </h3>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)', background: 'var(--bg-surface-2)' }}>
          {activeSwatch.name}
        </span>
      </div>

      {/* Theme Swatches */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {THEME_SWATCHES.map((opt) => {
          const active = themeMode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => {
                setThemeMode(opt.mode);
                onToast?.(lang === 'hu' ? `Téma: ${opt.name}` : `Theme: ${opt.name}`);
              }}
              title={opt.hex.join(' / ')}
              className={`px-3.5 py-3 rounded-xl text-left transition cursor-pointer border flex items-center gap-3 ${
                active
                  ? 'bg-[var(--accent-muted)] border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]'
                  : 'bg-[var(--bg-input)] border-[var(--border)] hover:bg-[var(--bg-raised)] hover:border-[var(--border-hover)]'
              }`}
            >
              {opt.hex.length > 1 ? (
                <span className="flex -space-x-1 shrink-0">
                  {opt.hex.map((h) => (
                    <span
                      key={h}
                      className="w-3.5 h-3.5 rounded-full border"
                      style={{ background: h, borderColor: 'var(--border-hover)' }}
                    />
                  ))}
                </span>
              ) : (
                <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: opt.hex[0], boxShadow: `0 0 6px ${opt.hex[0]}99` }} />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold truncate" style={{ color: active ? 'var(--text-accent)' : 'var(--text-primary)' }}>
                  {opt.name}
                </div>
                <div className="text-[10px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                  {opt.hex.join(' / ')}
                </div>
              </div>
              {active && (
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2.5}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Currency Preference */}
      <div className="pt-4 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{t('Display Currency', 'Megjelenített pénznem')}</h4>
        <div className="inline-flex rounded-xl p-1 border gap-1 self-start sm:self-auto" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
          <button
            type="button"
            onClick={() => { setCurrency('HUF'); onToast?.(lang === 'hu' ? 'Pénznem beállítva: HUF (Ft)' : 'Display currency set to HUF (Ft)'); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${currency === 'HUF' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            HUF (Ft)
          </button>
          <button
            type="button"
            onClick={() => { setCurrency('EUR'); onToast?.(lang === 'hu' ? 'Pénznem beállítva: EUR (€)' : 'Display currency set to EUR (€)'); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${currency === 'EUR' ? 'bg-[var(--accent-strong)] text-[var(--text-on-accent)] shadow-xs' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            EUR (€)
          </button>
        </div>
      </div>

      {/* Custom Theme Studio */}
      {themeMode === 'custom' && (
        <div className="pt-5 border-t border-[var(--border-subtle)] space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h4 className="text-xs font-black text-[var(--text-primary)] flex items-center gap-2">
              <span>{t('Custom Palette Studio', 'Egyéni Paletta Stúdió')}</span>
            </h4>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(JSON.stringify(customConfig, null, 2));
                    onToast?.(lang === 'hu' ? 'Téma JSON a vágólapra másolva' : 'Theme JSON copied to clipboard');
                  } catch {
                    onToast?.(lang === 'hu' ? 'A másolás nem sikerült' : 'Unable to copy to clipboard');
                  }
                }}
                className="text-xs font-bold px-3 py-1.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>{t('Export JSON', 'JSON exportálás')}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowThemeJsonBox(!showThemeJsonBox)}
                className="text-xs font-bold px-3 py-1.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>{t('Import JSON', 'JSON importálás')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const def = DEFAULT_CUSTOM_THEME;
                  setCustomConfig(def);
                  saveCustomTheme(def);
                  onToast?.(lang === 'hu' ? 'Egyéni paletta visszaállítva az alapértékekre' : 'Reset custom palette to defaults');
                }}
                className="text-xs font-bold px-3 py-1.5 rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                {t('Reset', 'Alaphelyzet')}
              </button>
            </div>
          </div>

          {showThemeJsonBox && (
            <div className="p-3.5 rounded-xl border border-[var(--accent-border)] bg-[var(--bg-input)] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--text-primary)]">{t('Paste Theme JSON', 'Téma JSON beillesztése')}</span>
                <button
                  type="button"
                  onClick={() => setShowThemeJsonBox(false)}
                  className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  {t('Close', 'Bezárás')}
                </button>
              </div>
              <textarea
                rows={3}
                value={themeJsonInput}
                onChange={(e) => setThemeJsonInput(e.target.value)}
                placeholder='{"bgPage": "#080811", "accent": "#06b6d4", ...}'
                className="w-full p-2 text-xs font-mono rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] resize-y"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(themeJsonInput.trim());
                      if (parsed && typeof parsed === 'object') {
                        const updated = { ...DEFAULT_CUSTOM_THEME, ...parsed };
                        setCustomConfig(updated);
                        saveCustomTheme(updated);
                        setShowThemeJsonBox(false);
                        setThemeJsonInput('');
                        onToast?.(lang === 'hu' ? 'Egyéni téma sikeresen importálva' : 'Custom theme imported successfully');
                      } else {
                        onToast?.(lang === 'hu' ? 'Érvénytelen JSON formátum' : 'Invalid JSON structure');
                      }
                    } catch {
                      onToast?.(lang === 'hu' ? 'A JSON szöveg beolvasása sikertelen' : 'Failed to parse JSON string');
                    }
                  }}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:brightness-110 cursor-pointer"
                >
                  {t('Apply Theme', 'Téma alkalmazása')}
                </button>
              </div>
            </div>
          )}

          {/* Sliders */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-[var(--text-primary)]">{t('Border Radius Geometry', 'Lekerekítés mértéke')}</div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--accent)]">
                  {customConfig.borderRadius ?? 12}px
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={24}
                step={1}
                value={customConfig.borderRadius ?? 12}
                onChange={(e) => {
                  const next = { ...customConfig, borderRadius: Number(e.target.value) };
                  setCustomConfig(next);
                  saveCustomTheme(next);
                }}
                aria-label={t('Border Radius Geometry', 'Lekerekítés mértéke')}
                className="tv-range-slider w-full"
              />
            </div>

            <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-[var(--text-primary)]">{t('Glow & Shadow Intensity', 'Ragyogás és Árnyék Intenzitás')}</div>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--accent)]">
                  {customConfig.glowIntensity ?? 50}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={customConfig.glowIntensity ?? 50}
                onChange={(e) => {
                  const next = { ...customConfig, glowIntensity: Number(e.target.value) };
                  setCustomConfig(next);
                  saveCustomTheme(next);
                }}
                aria-label={t('Glow & Shadow Intensity', 'Ragyogás és Árnyék Intenzitás')}
                className="tv-range-slider w-full"
              />
            </div>
          </div>

          {/* Color Pickers Grid */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">{t('Palette Colors', 'Paletta színei')}</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { key: 'bgPage' as const, label: t('Page Background', 'Oldal háttér') },
                { key: 'bgSurface' as const, label: t('Surface Container', 'Felület tároló') },
                { key: 'bgSurface2' as const, label: t('Secondary Surface', 'Másodlagos felület') },
                { key: 'border' as const, label: t('Border Highlight', 'Szegély kiemelés') },
                { key: 'accent' as const, label: t('Primary Accent', 'Elsődleges hangsúly') },
                { key: 'accentSecondary' as const, label: t('Secondary Accent', 'Másodlagos hangsúly') },
                { key: 'textPrimary' as const, label: t('Primary Text', 'Főszöveg') },
                { key: 'textMuted' as const, label: t('Muted Text', 'Halvány szöveg') },
              ].map((field) => {
                const rawVal = customConfig[field.key];
                const val = (rawVal && typeof rawVal === 'string') ? rawVal : (field.key === 'accentSecondary' ? '#06b6d4' : field.key === 'textMuted' ? '#94a3b8' : field.key === 'border' ? 'rgba(168, 85, 247, 0.3)' : '#a855f7');
                const colorPickerVal = val.startsWith('#') && (val.length === 7 || val.length === 4) ? val : '#a855f7';

                return (
                  <div
                    key={field.key}
                    className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-input)] flex items-center gap-3"
                  >
                    <label className="relative w-9 h-9 rounded-lg border border-[var(--border-hover)] shadow-sm shrink-0 cursor-pointer overflow-hidden block">
                      <span className="absolute inset-0" style={{ background: val }} />
                      <input
                        type="color"
                        value={colorPickerVal}
                        onChange={(e) => {
                          const next = { ...customConfig, [field.key]: e.target.value };
                          setCustomConfig(next);
                          saveCustomTheme(next);
                        }}
                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[var(--text-primary)] truncate">{field.label}</div>
                    </div>
                    <input
                      type="text"
                      value={typeof rawVal === 'string' ? rawVal : ''}
                      placeholder={field.key === 'border' ? 'rgba(...)' : '#hex'}
                      onChange={(e) => {
                        const next = { ...customConfig, [field.key]: e.target.value };
                        setCustomConfig(next);
                        saveCustomTheme(next);
                      }}
                      className="w-20 px-2 py-1 text-[11px] font-mono rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-center focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
