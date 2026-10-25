import { useState } from 'react';
import type { StoreProduct } from '../../types';
import { STORE_CATEGORIES, STORE_GAMES, STORE_SUBCATEGORIES_BY_CATEGORY } from '../../lib/storeConstants';
import { translateStoreCategory, useLanguage, type Language } from '../../lib/i18n';
import { EMPTY_STORE_FILTERS, activeFilterCount, facetCounts, type StoreFilters } from '../../lib/storeProducts';

interface StoreFilterPanelProps {
  products: StoreProduct[];
  filters: StoreFilters;
  onChange: (next: StoreFilters) => void;
  categoriesList?: { id: string; label: string; label_hu?: string }[];
  gamesList?: { id: string; name: string }[];
}

const defaultGameName = (id: string) => STORE_GAMES.find((g) => g.id === id)?.name.replace(' / Supplies (All Games)', '') || id;
const defaultCategoryName = (id: string, lang: Language) => {
  const fallback = STORE_CATEGORIES.find((c) => c.id === id)?.label || id;
  return translateStoreCategory(id, fallback, lang);
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
      <h3 className="text-[11px] font-black uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function CheckList({
  entries,
  selected,
  label,
  onToggle,
}: {
  entries: [string, number][];
  selected: string[];
  label: (v: string) => string;
  onToggle: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const LIMIT = 6;
  // A selected value stays listed even when the other filters make its count drop to zero.
  const all = [...entries];
  selected.forEach((s) => {
    if (!all.some(([v]) => v === s)) all.push([s, 0]);
  });
  const shown = expanded ? all : all.slice(0, LIMIT);

  if (all.length === 0) return <p className="text-xs" style={{ color: 'var(--text-placeholder)' }}>{t('No options', 'Nincs opció')}</p>;

  return (
    <div className="flex flex-col gap-0.5">
      {shown.map(([value, count]) => {
        const checked = selected.includes(value);
        return (
          <label
            key={value}
            className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg cursor-pointer text-xs transition hover:bg-[var(--bg-raised)]"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(value)}
              className="w-3.5 h-3.5 shrink-0 cursor-pointer"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="flex-1 truncate font-medium" style={{ color: checked ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {label(value)}
            </span>
            <span className="tabular-nums text-[11px]" style={{ color: 'var(--text-muted)' }}>{count}</span>
          </label>
        );
      })}
      {all.length > LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-left text-[11px] font-bold px-1.5 py-1 cursor-pointer"
          style={{ color: 'var(--text-accent)' }}
        >
          {expanded ? t('Show less', 'Kevesebb') : t(`Show ${all.length - LIMIT} more`, `Még ${all.length - LIMIT} megjelenítése`)}
        </button>
      )}
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * Faceted filters for the shop. Each facet's counts ignore its own selection (but respect every other
 * one), so ticking a brand does not make the other brands vanish - you can still add a second one.
 * Selecting a specific Game or Category surfaces granular sub-filters (e.g. Packs, Displays, Vault,
 * Starter Decks for TCGs; Playmat / Tube / Size / Color for supplies).
 */
export function StoreFilterPanel({ products, filters, onChange, categoriesList, gamesList }: StoreFilterPanelProps) {
  const { lang, t } = useLanguage();
  const set = (patch: Partial<StoreFilters>) => onChange({ ...filters, ...patch });

  const getCategoryLabel = (id: string) => {
    const match = categoriesList?.find((c) => c.id === id) || STORE_CATEGORIES.find((c) => c.id === id);
    const fallback = match?.label || id;
    return translateStoreCategory(id, fallback, lang, match?.label_hu);
  };

  const getGameName = (id: string) => {
    const match = gamesList?.find((g) => g.id === id) || STORE_GAMES.find((g) => g.id === id);
    return match?.name.replace(' / Supplies (All Games)', '') || id;
  };

  const categories = facetCounts(products, filters, 'category');
  const rawSubcategories = facetCounts(products, filters, 'subcategories');
  const brands = facetCounts(products, filters, 'brands');
  const games = facetCounts(products, filters, 'games');
  const sizes = facetCounts(products, filters, 'sizes');
  const colors = facetCounts(products, filters, 'colors');
  const languages = facetCounts(products, filters, 'languages');
  const active = activeFilterCount(filters);
  const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

  const selectedSubcategories = filters.subcategories || [];
  const selectedColors = filters.colors || [];

  // Build subcategory entries: when a specific category or game is selected, include standard subcategories
  // for that category (or sealed TCG subcategories when a game is selected) so shoppers always see
  // Packs / Displays / Vault / Starter Decks / Playmat / Toploader options.
  const subcategoryEntries: [string, number][] = (() => {
    const map = new Map<string, number>(rawSubcategories);
    const presetCat = filters.category !== 'all' ? filters.category : (filters.games.length > 0 ? 'sealed' : null);
    if (presetCat && STORE_SUBCATEGORIES_BY_CATEGORY[presetCat]) {
      for (const preset of STORE_SUBCATEGORIES_BY_CATEGORY[presetCat]) {
        if (!map.has(preset)) map.set(preset, 0);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  })();

  const sizeSectionTitle =
    filters.category === 'deck_boxes' ? t('Deck Box Size / Capacity', 'Paklitartó méret / kapacitás') :
    filters.category === 'playmats' ? t('Playmat Size', 'Playmat méret') :
    filters.category === 'protection' ? t('Thickness / Size', 'Vastagság / Méret') :
    filters.category === 'sleeves' ? t('Sleeve Size', 'Fólia méret') :
    t('Size / Capacity', 'Méret / Kapacitás');

  const subcatSectionTitle =
    filters.games.length === 1
      ? `${getGameName(filters.games[0])} — ${t('Product Type', 'Terméktípus')}`
      : filters.category !== 'all'
      ? `${getCategoryLabel(filters.category)} — ${t('Type', 'Típus')}`
      : t('Product Type', 'Terméktípus');

  return (
    <div className="pt-3">
      {active > 0 && (
        <div className="pb-3 border-b mb-1" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_STORE_FILTERS, search: filters.search })}
            className="text-xs font-bold cursor-pointer"
            style={{ color: 'var(--text-accent)' }}
          >
            {t(`Clear all filters (${active})`, `Összes szűrő törlése (${active})`)}
          </button>
        </div>
      )}

      <Section title={t('Game', 'Játék')}>
        <CheckList
          entries={games.filter(([v]) => v !== 'universal')}
          selected={filters.games}
          label={(v) => getGameName(v)}
          onToggle={(v) => set({ games: toggle(filters.games, v) })}
        />
      </Section>

      <Section title={t('Category', 'Kategória')}>
        <div className="flex flex-col gap-0.5">
          {[['all', products.length] as [string, number], ...categories].map(([id, count]) => {
            const selected = filters.category === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => set({ category: id, subcategories: [] })}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left cursor-pointer transition border"
                style={
                  selected
                    ? { background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)', fontWeight: 700 }
                    : { background: 'transparent', borderColor: 'transparent', color: 'var(--text-secondary)', fontWeight: 500 }
                }
              >
                <span className="flex-1 truncate">{id === 'all' ? t('All products', 'Összes termék') : getCategoryLabel(id)}</span>
                <span className="tabular-nums text-[11px]" style={{ color: 'var(--text-muted)' }}>{count}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {(subcategoryEntries.length > 0 || selectedSubcategories.length > 0) && (
        <Section title={subcatSectionTitle}>
          <CheckList
            entries={subcategoryEntries}
            selected={selectedSubcategories}
            label={(v) => v}
            onToggle={(v) => set({ subcategories: toggle(selectedSubcategories, v) })}
          />
        </Section>
      )}

      <Section title={t('Brand', 'Márka')}>
        <CheckList entries={brands} selected={filters.brands} label={(v) => v} onToggle={(v) => set({ brands: toggle(filters.brands, v) })} />
      </Section>

      {(sizes.length > 0 || filters.sizes.length > 0) && (
        <Section title={sizeSectionTitle}>
          <CheckList entries={sizes} selected={filters.sizes} label={(v) => v} onToggle={(v) => set({ sizes: toggle(filters.sizes, v) })} />
        </Section>
      )}

      {(colors.length > 0 || selectedColors.length > 0) && (
        <Section title={t('Color', 'Szín')}>
          <CheckList entries={colors} selected={selectedColors} label={(v) => v} onToggle={(v) => set({ colors: toggle(selectedColors, v) })} />
        </Section>
      )}

      {(languages.length > 0 || (filters.languages && filters.languages.length > 0)) && (
        <Section title={t('Language', 'Nyelv')}>
          <CheckList
            entries={languages}
            selected={filters.languages || []}
            label={(v) => v}
            onToggle={(v) => set({ languages: toggle(filters.languages || [], v) })}
          />
        </Section>
      )}

      <Section title={t('Price (HUF)', 'Ár (HUF)')}>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Min"
            aria-label="Minimum price"
            value={filters.minPrice ?? ''}
            onChange={(e) => set({ minPrice: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
            className="w-full min-w-0 px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            style={inputStyle}
          />
          <span style={{ color: 'var(--text-muted)' }}>-</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Max"
            aria-label="Maximum price"
            value={filters.maxPrice ?? ''}
            onChange={(e) => set({ maxPrice: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
            className="w-full min-w-0 px-2.5 py-1.5 text-xs rounded-lg border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            style={inputStyle}
          />
        </div>
      </Section>

      <div className="pt-4">
        <label className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg cursor-pointer text-xs font-medium hover:bg-[var(--bg-raised)]" style={{ color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={filters.inStockOnly}
            onChange={(e) => set({ inStockOnly: e.target.checked })}
            className="w-3.5 h-3.5 cursor-pointer"
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('In stock only', 'Csak raktáron')}
        </label>
      </div>
    </div>
  );
}
