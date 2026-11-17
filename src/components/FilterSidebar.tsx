import { useState, useEffect } from "react";
import type { FilterState } from "../types";
import {
  SEALED_PRODUCT_TYPES,
  ONEPIECE_ATTRIBUTES,
  ONEPIECE_COUNTERS,
  ONEPIECE_BLOCK_ICONS,
  ONEPIECE_ILLUSTRATION_TYPES,
  LORCANA_ABILITIES,
  LORCANA_LEGALITIES,
} from "../lib/constants";
import { useSiteTheme } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { DOMAIN_STYLES, RARITY_STYLES } from "../lib/domainColors";
import { LorcanaInkIcon, LorcanaInkableIcon } from "../lib/lorcanaIcons";
import { SEARCHABLE_KEYWORDS } from "../lib/keywordSearch";
import { keywordSolidColor } from "../lib/formatGameText";

interface FilterSidebarProps {
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  sticky?: boolean;
  options: {
    sets: string[];
    rarities: string[];
    types: string[];
    domains: string[];
    tags: string[];
    /** The signed-in user's wishlists for this game; the Wishlist filter shows only when there are some. */
    wishlists?: { id: string; name: string }[];
  };
}


function SectionHeader({ label, badge, collapsible = true, open, onToggle, theme }: {
  label: string;
  badge?: number;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  theme?: {
    sectionHover?: string;
    sectionBadge?: string;
    sectionArrow?: string;
  };
}) {
  return (
    <div
      onClick={collapsible ? onToggle : undefined}
      className={`flex items-center justify-between py-1 text-xs font-bold uppercase tracking-wider ${theme?.sectionHover || "hover:text-[var(--text-accent)]"} cursor-pointer select-none transition group`}
      style={{ color: 'var(--text-primary)' }}
    >
      <span className="flex items-center gap-1.5">
        {label}
        {badge != null && badge > 0 && (
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${theme?.sectionBadge || "bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border)]"}`}>
            {badge}
          </span>
        )}
      </span>
      {collapsible && (
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
          className={`${theme?.sectionArrow || "text-[var(--text-tertiary)] group-hover:text-[var(--text-accent)]"} transition-transform duration-200 ${open ? "rotate-180" : "rotate-0"}`}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      )}
    </div>
  );
}

function MinMaxRangeBox({
  minVal,
  maxVal,
  boundMin,
  boundMax,
  step = 1,
  clearLabel = "Clear",
  onChangeMin,
  onChangeMax,
  onClear,
  inputClass,
}: {
  minVal: number | null | undefined;
  maxVal: number | null | undefined;
  boundMin: number;
  boundMax: number;
  step?: number;
  clearLabel?: string;
  onChangeMin: (val: number | null) => void;
  onChangeMax: (val: number | null) => void;
  onClear: () => void;
  inputClass: string;
}) {
  const hasValue = minVal != null || maxVal != null;
  const parseInput = (rawStr: string) => {
    const trimmed = rawStr.trim();
    if (trimmed === "") return null;
    const n = parseInt(trimmed, 10);
    if (Number.isNaN(n)) return null;
    return Math.max(boundMin, Math.min(boundMax, n));
  };
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <div className={`flex-1 flex items-center ${inputClass} rounded-md px-2 py-1 text-xs`}>
          <span className="text-[10px] uppercase font-bold mr-1" style={{ color: 'var(--text-muted)' }}>Min</span>
          <input
            type="number"
            min={boundMin}
            max={boundMax}
            step={step}
            placeholder={String(boundMin)}
            value={minVal ?? ""}
            onChange={(e) => onChangeMin(parseInput(e.target.value))}
            className="w-full bg-transparent font-bold text-center outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
        <span className="font-bold" style={{ color: 'var(--text-placeholder)' }}>–</span>
        <div className={`flex-1 flex items-center ${inputClass} rounded-md px-2 py-1 text-xs`}>
          <span className="text-[10px] uppercase font-bold mr-1" style={{ color: 'var(--text-muted)' }}>Max</span>
          <input
            type="number"
            min={boundMin}
            max={boundMax}
            step={step}
            placeholder={String(boundMax)}
            value={maxVal ?? ""}
            onChange={(e) => onChangeMax(parseInput(e.target.value))}
            className="w-full bg-transparent font-bold text-center outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>
      {hasValue && (
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] font-bold hover:text-[var(--text-primary)] cursor-pointer"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}

export function FilterSidebar({ filters, setFilters, options }: FilterSidebarProps) {
  const { t } = useLanguage();
  // Default OPEN: Set, Type, Domain. Default COLLAPSED: Card Variant, Rarity, Tags, Energy Cost
  const [setOpen, setSetOpen] = useState(true);
  const [typeOpen, setTypeOpen] = useState(true);
  const [domainOpen, setDomainOpen] = useState(true);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [rarityOpen, setRarityOpen] = useState(false);
  const [sealedOpen, setSealedOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [attributeOpen, setAttributeOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const [blockIconOpen, setBlockIconOpen] = useState(false);
  const [illustrationOpen, setIllustrationOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [inkableOpen, setInkableOpen] = useState(false);
  const [abilityOpen, setAbilityOpen] = useState(false);
  const [loreOpen, setLoreOpen] = useState(false);
  const [strengthOpen, setStrengthOpen] = useState(false);
  const [willpowerOpen, setWillpowerOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [legalityOpen, setLegalityOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [keywordSearch, setKeywordSearch] = useState("");
  const [setSearch, setSetSearch] = useState("");


  const isSealedCategory = filters.category === 'sealed';
  const isRiftbound = !filters.game || filters.game === 'riftbound';
  const isOnePiece = filters.game === 'onepiece';
  const isLorcana = filters.game === 'lorcana';

  const set = (key: keyof FilterState, val: any) =>
    setFilters({ ...filters, [key]: val });

  const selectedSets = filters.sets || [];

  const toggleSetOption = (s: string) => {
    const next = selectedSets.includes(s)
      ? selectedSets.filter((x) => x !== s)
      : [...selectedSets, s];
    set("sets", next);
  };

  const toggleRarity = (r: string) => {
    const next = filters.rarities.includes(r)
      ? filters.rarities.filter((x) => x !== r)
      : [...filters.rarities, r];
    set("rarities", next);
  };

  const toggleDomain = (d: string) => {
    const next = filters.domains.includes(d)
      ? filters.domains.filter((x) => x !== d)
      : [...filters.domains, d];
    set("domains", next);
  };

  const toggleTag = (t: string) => {
    const next = filters.tags.includes(t)
      ? filters.tags.filter((x) => x !== t)
      : [...filters.tags, t];
    set("tags", next);
  };

  const toggleKeyword = (k: string) => {
    const current = filters.keywords || [];
    const next = current.includes(k) ? current.filter((x) => x !== k) : [...current, k];
    set("keywords", next);
  };

  const toggleAttribute = (a: string) => {
    const current = filters.attributes || [];
    const next = current.includes(a) ? current.filter((x) => x !== a) : [...current, a];
    set("attributes", next);
  };

  const toggleCounter = (c: number) => {
    const current = filters.counters || [];
    const next = current.includes(c) ? current.filter((x) => x !== c) : [...current, c];
    set("counters", next);
  };

  const toggleBlockIcon = (b: string | number) => {
    const current = filters.blockIcons || [];
    const next = current.includes(b) ? current.filter((x) => x !== b) : [...current, b];
    set("blockIcons", next);
  };

  const toggleIllustrationType = (ill: string) => {
    const current = filters.illustrationTypes || [];
    const next = current.includes(ill) ? current.filter((x) => x !== ill) : [...current, ill];
    set("illustrationTypes", next);
  };

  const toggleAbility = (ab: string) => {
    const current = filters.abilities || [];
    const next = current.includes(ab) ? current.filter((x) => x !== ab) : [...current, ab];
    set("abilities", next);
  };

  const toggleLegality = (leg: string) => {
    const current = filters.legality || [];
    const next = current.includes(leg) ? current.filter((x) => x !== leg) : [...current, leg];
    set("legality", next);
  };

  const toggleSealedType = (st: string) => {
    const current = filters.sealedTypes || [];
    const next = current.includes(st)
      ? current.filter((x) => x !== st)
      : [...current, st];
    set("sealedTypes", next);
  };

  const minCostBound = (isOnePiece || isLorcana) ? 0 : 1;
  const maxCostBound = isLorcana ? 12 : 10;

  const reset = () => {
    setTagSearch("");
    setSetSearch("");
    setFilters({
      category: filters.category || 'singles',
      game: filters.game || 'riftbound',
      sets: [],
      rarities: [],
      type: "",
      domains: [],
      tags: [],
      attributes: [],
      counters: [],
      blockIcons: [],
      illustrationTypes: [],
      hideReprints: false,
      powerMin: null,
      powerMax: null,
      inkable: 'all',
      abilities: [],
      loreMin: null,
      loreMax: null,
      strengthMin: null,
      strengthMax: null,
      willpowerMin: null,
      willpowerMax: null,
      movementMin: null,
      movementMax: null,
      legality: [],
      keywords: [],
      keywordMode: 'and',
      sealedTypes: [],
      costMin: minCostBound,
      costMax: maxCostBound,
      stockStatus: "Any",
      foilFilter: false,
      signedFilter: 'all',
      altArtFilter: 'all',
      overnumberedFilter: 'all',
      spFilter: 'all',
      baseSetFilter: 'all',
    });
  };

  const cycleSigned = () => {
    const current = filters.signedFilter || 'all';
    if (current === 'all') {
      set("signedFilter", 'only');
    } else if (current === 'only') {
      set("signedFilter", 'none');
    } else {
      set("signedFilter", 'all');
    }
  };

  const cycleOvernumbered = () => {
    const current = filters.overnumberedFilter || 'all';
    if (current === 'all') {
      set("overnumberedFilter", 'only');
    } else if (current === 'only') {
      set("overnumberedFilter", 'none');
    } else {
      set("overnumberedFilter", 'all');
    }
  };

  const cycleAltArt = () => {
    const current = filters.altArtFilter || 'all';
    if (current === 'all') {
      set("altArtFilter", 'only');
    } else if (current === 'only') {
      set("altArtFilter", 'none');
    } else {
      set("altArtFilter", 'all');
    }
  };

  const cycleSp = () => {
    const current = filters.spFilter || 'all';
    if (current === 'all') {
      set("spFilter", 'only');
    } else if (current === 'only') {
      set("spFilter", 'none');
    } else {
      set("spFilter", 'all');
    }
  };

  const toggleBaseSet = () => {
    const current = filters.baseSetFilter || 'all';
    set("baseSetFilter", current === 'only' ? 'all' : 'only');
  };

  const handleCostMin = (v: string) => {
    const parsed = parseInt(v, 10);
    const n = Number.isNaN(parsed) ? minCostBound : Math.max(minCostBound, Math.min(maxCostBound, parsed));
    set("costMin", n);
  };
  const handleCostMax = (v: string) => {
    const parsed = parseInt(v, 10);
    const n = Number.isNaN(parsed) ? maxCostBound : Math.max(minCostBound, Math.min(maxCostBound, parsed));
    set("costMax", n);
  };

  const overnumbered = filters.overnumberedFilter || 'all';
  const altArt = filters.altArtFilter || 'all';
  const signed = filters.signedFilter || 'all';
  const sp = filters.spFilter || 'all';
  const baseSet = filters.baseSetFilter || 'all';

  const variantBadgeCount = (filters.foilFilter ? 1 : 0) + 
    (signed !== 'all' ? 1 : 0) + 
    (altArt !== 'all' ? 1 : 0) + 
    (overnumbered !== 'all' ? 1 : 0) +
    (sp !== 'all' ? 1 : 0) +
    (baseSet !== 'all' ? 1 : 0);

  const costActiveCount = (filters.costMin > minCostBound || filters.costMax < maxCostBound) ? 1 : 0;
  const powerActiveCount = (filters.powerMin != null || filters.powerMax != null) ? 1 : 0;
  const loreActiveCount = (filters.loreMin != null || filters.loreMax != null) ? 1 : 0;
  const strengthActiveCount = (filters.strengthMin != null || filters.strengthMax != null) ? 1 : 0;
  const willpowerActiveCount = (filters.willpowerMin != null || filters.willpowerMax != null) ? 1 : 0;
  const movementActiveCount = (filters.movementMin != null || filters.movementMax != null) ? 1 : 0;

  const filteredTags = (options.tags || []).filter(t => 
    !tagSearch.trim() || t.toLowerCase().includes(tagSearch.trim().toLowerCase())
  );

  const filteredKeywords = SEARCHABLE_KEYWORDS.filter(k =>
    !keywordSearch.trim() || k.toLowerCase().includes(keywordSearch.trim().toLowerCase())
  );

  const filteredSets = (options.sets || []).filter(s =>
    !setSearch.trim() || s.toLowerCase().includes(setSearch.trim().toLowerCase())
  );

  const { isDark } = useSiteTheme(filters.game);

  const sidebarTheme = {
    container: "bg-[var(--bg-surface)]/95 border border-[var(--border)] shadow-[var(--shadow-card)]",
    divider: "border-[var(--border-subtle)]",
    headerTitle: "text-[var(--text-accent)]",
    headerIcon: "text-[var(--accent)]",
    sectionHover: "hover:text-[var(--text-accent)]",
    sectionBadge: "bg-[var(--accent-muted)] text-[var(--text-accent)] border border-[var(--accent-border)]",
    sectionArrow: "text-[var(--text-tertiary)] group-hover:text-[var(--text-accent)]",
    input: "bg-[var(--bg-input)] border border-[var(--border)] hover:border-[var(--border-hover)] focus:border-[var(--accent)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
    btnDefault: "bg-[var(--bg-input)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-accent)] hover:border-[var(--accent-border)] hover:bg-[var(--bg-raised)]",
    btnActive: "bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-accent)] font-bold shadow-[0_0_10px_var(--accent-glow)]",
  };

  const activeAccentClass = "bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-accent)] font-semibold shadow-[0_0_8px_var(--accent-glow)]";

  return (
    <div className={`w-full ${sidebarTheme.container} rounded-xl p-3 space-y-2.5 shadow-lg`}>
      {/* Pinned header */}
      <div className={`flex items-center justify-between pb-2 border-b ${sidebarTheme.divider}`}>
        <span className={`font-bold text-xs flex items-center gap-1.5 uppercase tracking-wider ${sidebarTheme.headerTitle}`}>
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} className={sidebarTheme.headerIcon}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          {t('Filters', 'Szűrők')}
        </span>
        <button
          onClick={reset}
          className="tv-btn-danger text-[11px] px-2 py-0.5 rounded font-medium transition cursor-pointer"
        >
          {t('Reset', 'Alaphelyzet')}
        </button>
      </div>

      {/* 0. WISHLIST - only cards on one of your lists (shown once you have a list) */}
      {options.wishlists && options.wishlists.length > 0 && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader label="Wishlist" badge={filters.wishlistId ? 1 : 0} collapsible={false} theme={sidebarTheme} />
          <div className="mt-1">
            <select
              value={filters.wishlistId || ''}
              onChange={(e) => set("wishlistId", e.target.value || undefined)}
              className={`w-full ${sidebarTheme.input} rounded-md px-2.5 py-1.5 text-xs outline-none cursor-pointer appearance-none transition font-medium`}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23d4d4d8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 8px center",
                backgroundSize: "12px",
              }}
            >
              <option value="">Any card</option>
              {options.wishlists.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* 1. SET SECTION (Default OPEN) - checkbox multi-select */}
      <div className={`border-b ${sidebarTheme.divider} pb-2`}>
        <SectionHeader
          label={isOnePiece ? "Card Set(s)" : isLorcana ? "Card Set" : "Set"}
          badge={selectedSets.length}
          open={setOpen}
          onToggle={() => setSetOpen(o => !o)}
          theme={sidebarTheme}
        />
        {setOpen && (
          <div className="mt-1">
            {options.sets.length > 6 && (
              <div className="relative mb-1.5">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search sets..."
                  value={setSearch}
                  onChange={(e) => setSetSearch(e.target.value)}
                  className={`w-full ${sidebarTheme.input} rounded-md pl-7 pr-6 py-1 text-xs outline-none transition`}
                />
                {setSearch && (
                  <button
                    type="button"
                    onClick={() => setSetSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 hover:text-[var(--text-primary)] text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}
                    aria-label="Clear set search"
                  >
                    ×
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto custom-scrollbar pr-1" role="group" aria-label="Sets">
              {filteredSets.map((s) => {
                const active = selectedSets.includes(s);
                return (
                  <label
                    key={s}
                    className={`flex items-center gap-2 w-full py-1 px-2 rounded-md border text-xs cursor-pointer transition select-none focus-within:ring-1 focus-within:ring-[var(--accent)] ${
                      active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleSetOption(s)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`w-3.5 h-3.5 shrink-0 rounded-[3px] border flex items-center justify-center transition ${
                        active
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--bg-surface)]'
                          : 'border-[var(--border-hover)] bg-transparent'
                      }`}
                    >
                      {active && (
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{s}</span>
                  </label>
                );
              })}
              {filteredSets.length === 0 && (
                <div className="text-[11px] py-1" style={{ color: 'var(--text-tertiary)' }}>
                  {`No sets matching "${setSearch}"`}
                </div>
              )}
            </div>

            {selectedSets.length > 0 && (
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {`${selectedSets.length} selected`}
                </span>
                <button
                  type="button"
                  onClick={() => set("sets", [])}
                  className="text-[10px] font-bold rounded px-1.5 py-0.5 transition cursor-pointer hover:text-[var(--text-primary)]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Clear sets
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. TYPE / CARD TYPE SECTION (Default OPEN) - Symmetrical 2-Column Grid */}
      {!isSealedCategory && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label={isOnePiece ? "Card type" : isLorcana ? "Card Type" : "Type"}
            badge={filters.type ? 1 : 0}
            open={typeOpen}
            onToggle={() => setTypeOpen(o => !o)}
            theme={sidebarTheme}
          />
          {typeOpen && (
            <div className="grid grid-cols-2 gap-1 mt-1">
              {["", ...options.types].map((val) => {
                const active = filters.type === val;
                return (
                  <button
                    key={val || "all"}
                    onClick={() => set("type", val)}
                    className={`w-full py-1.5 px-1.5 min-h-[32px] text-xs rounded-md border text-center transition cursor-pointer font-medium leading-tight flex items-center justify-center ${
                      active
                        ? sidebarTheme.btnActive
                        : sidebarTheme.btnDefault
                    }`}
                  >
                    {val || "All"}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. DOMAIN / COLOR / INK / ASPECT / CLASS SECTION (Default OPEN) - Balanced 3-Column Micro Grid */}
      {!isSealedCategory && options.domains && options.domains.length > 0 && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label={
              filters.game === 'onepiece' ? "Color" :
              filters.game === 'lorcana' ? "Ink Color" :
              filters.game === 'starwars' ? "Aspect" :
              filters.game === 'fab' ? "Class" :
              "Domain"
            }
            badge={filters.domains.length}
            open={domainOpen}
            onToggle={() => setDomainOpen(o => !o)}
            theme={sidebarTheme}
          />
          {domainOpen && (
            <div className="grid grid-cols-3 gap-1 mt-1">
              {options.domains.map((d, index, arr) => {
                const active = filters.domains.includes(d);
                const isLastOdd = index === arr.length - 1 && arr.length % 3 === 1;
                const ds = DOMAIN_STYLES[d] ?? {
                  ...DOMAIN_STYLES.Colorless,
                  hoverBg: "rgba(255,255,255,0.08)",
                  hoverBorder: "rgba(255,255,255,0.25)"
                };
                return (
                  <button
                    key={d}
                    onClick={() => toggleDomain(d)}
                    style={{
                      background: active ? ds.activeBg : undefined,
                      borderColor: active ? ds.border : undefined,
                      color: active ? ds.text : undefined,
                      boxShadow: active ? `0 0 8px ${ds.activeBg}` : undefined,
                    }}
                    className={`flex items-center justify-center gap-1.5 py-1 px-1.5 rounded text-[11px] font-medium cursor-pointer border transition capitalize ${
                      isLastOdd ? 'col-span-3' : ''
                    } ${
                      active
                        ? 'font-bold'
                        : sidebarTheme.btnDefault
                    }`}
                    onMouseEnter={e => {
                      if (!active) {
                        e.currentTarget.style.background = ds.hoverBg;
                        e.currentTarget.style.borderColor = ds.hoverBorder;
                        e.currentTarget.style.color = ds.text;
                      }
                    }}
                    onMouseLeave={e => {
                      if (!active) {
                        e.currentTarget.style.background = '';
                        e.currentTarget.style.borderColor = '';
                        e.currentTarget.style.color = '';
                      }
                    }}
                  >
                    {filters.game === 'lorcana' ? (
                      <LorcanaInkIcon ink={d} className="w-3.5 h-3.5 shrink-0" style={{ color: ds.dot }} />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ds.dot }} />
                    )}
                    <span className="truncate">{d}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3b. LORCANA INKABLE SECTION */}
      {!isSealedCategory && isLorcana && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label="Inkable"
            badge={filters.inkable && filters.inkable !== 'all' ? 1 : 0}
            open={inkableOpen}
            onToggle={() => setInkableOpen(o => !o)}
            theme={sidebarTheme}
          />
          {inkableOpen && (
            <div className="grid grid-cols-2 gap-1 mt-1">
              {(['yes', 'no'] as const).map((val) => {
                const active = filters.inkable === val;
                return (
                  <button
                    type="button"
                    key={val}
                    onClick={() => set("inkable", active ? 'all' : val)}
                    className={`py-1.5 text-xs rounded-md border flex items-center justify-center gap-1.5 transition cursor-pointer font-semibold ${
                      active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                    }`}
                  >
                    <LorcanaInkableIcon inkable={val === 'yes'} className="w-4 h-4 shrink-0" />
                    <span>{val === 'yes' ? 'Yes' : 'No'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. CARD VARIANT SECTION (Default COLLAPSED) - 2x2 Grid */}
      {!isSealedCategory && isRiftbound && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label="Card Variant"
            badge={variantBadgeCount}
            open={variantsOpen}
            onToggle={() => setVariantsOpen(o => !o)}
            theme={sidebarTheme}
          />
          {variantsOpen && (
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              {/* Base Set Only Toggle (Full width) */}
              <button
                onClick={toggleBaseSet}
                title="Show only core base set cards (1 to max set number, excluding promos, alt arts, signatures, overnumbered, tokens, and SP cards)"
                className={`col-span-2 text-xs py-1.5 px-2.5 rounded-md border text-center font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${
                  baseSet === 'only'
                    ? "bg-emerald-500/20 border-emerald-500/80 text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
                    : sidebarTheme.btnDefault
                }`}
              >
                <span className="inline-flex items-center gap-1">{baseSet === 'only' && <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>}{baseSet === 'only' ? "Base Set Only (1 - Max): ON" : "Base Set Only (1 - Max)"}</span>
              </button>

              {/* Foil Toggle */}
              <button
                onClick={() => set("foilFilter", !filters.foilFilter)}
                className={`text-xs py-1.5 px-2 rounded-md border text-center font-medium transition cursor-pointer ${
                  filters.foilFilter
                    ? activeAccentClass
                    : sidebarTheme.btnDefault
                }`}
              >
                {filters.foilFilter ? "Foil: ON" : "Foil Only"}
              </button>

              {/* SP 3-State Cycle */}
              <button
                onClick={cycleSp}
                title="Click to cycle: Only SP Cards -> Exclude SP Cards -> All Cards"
                className={`text-xs py-1.5 px-2 rounded-md border text-center font-medium transition cursor-pointer ${
                  sp === 'only'
                    ? activeAccentClass
                    : sp === 'none'
                    ? "bg-rose-500/20 border-rose-500/80 text-rose-300 font-semibold shadow-[0_0_8px_rgba(244,63,94,0.2)]"
                    : sidebarTheme.btnDefault
                }`}
              >
                {sp === 'only' ? "SP: ONLY" : sp === 'none' ? "SP: NO" : "SP Cards"}
              </button>

              {/* Signed 3-State Cycle */}
              <button
                onClick={cycleSigned}
                title="Click to cycle: Only Signed -> Exclude Signed -> All Cards"
                className={`text-xs py-1.5 px-2 rounded-md border text-center font-medium transition cursor-pointer ${
                  signed === 'only'
                    ? "bg-purple-500/20 border-purple-500/80 text-purple-200 font-semibold shadow-[0_0_8px_rgba(168,85,247,0.25)]"
                    : signed === 'none'
                    ? "bg-rose-500/20 border-rose-500/80 text-rose-300 font-semibold shadow-[0_0_8px_rgba(244,63,94,0.2)]"
                    : sidebarTheme.btnDefault
                }`}
              >
                {signed === 'only' ? "Signed: ONLY" : signed === 'none' ? "Signed: NO" : "Signed"}
              </button>

              {/* Alt Art 3-State Cycle */}
              <button
                onClick={cycleAltArt}
                title="Click to cycle: Only Alt Arts -> Exclude Alt Arts -> All Cards"
                className={`text-xs py-1.5 px-2 rounded-md border text-center font-medium transition cursor-pointer ${
                  altArt === 'only'
                    ? "bg-pink-500/20 border-pink-500/80 text-pink-200 font-semibold shadow-[0_0_8px_rgba(236,72,153,0.25)]"
                    : altArt === 'none'
                    ? "bg-rose-500/20 border-rose-500/80 text-rose-300 font-semibold shadow-[0_0_8px_rgba(244,63,94,0.2)]"
                    : sidebarTheme.btnDefault
                }`}
              >
                {altArt === 'only' ? "Alt Art: ONLY" : altArt === 'none' ? "Alt Art: NO" : "Alt Art"}
              </button>

              {/* Overnumbered 3-State Cycle */}
              <button
                onClick={cycleOvernumbered}
                title="Click to cycle: Only Overnumbered -> Exclude Overnumbered -> All Cards"
                className={`col-span-2 text-xs py-1.5 px-2 rounded-md border text-center font-medium transition cursor-pointer ${
                  overnumbered === 'only'
                    ? "bg-violet-500/20 border-violet-500/80 text-violet-200 font-semibold shadow-[0_0_8px_rgba(139,92,246,0.25)]"
                    : overnumbered === 'none'
                    ? "bg-rose-500/20 border-rose-500/80 text-rose-300 font-semibold shadow-[0_0_8px_rgba(244,63,94,0.2)]"
                    : sidebarTheme.btnDefault
                }`}
              >
                {overnumbered === 'only' ? "Overnum: ONLY" : overnumbered === 'none' ? "Overnum: NO" : "Overnumbered"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 5. RARITY SECTION (Default COLLAPSED) - 2-Column Compact Grid */}
      {!isSealedCategory && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label="Rarity"
            badge={filters.rarities.length}
            open={rarityOpen}
            onToggle={() => setRarityOpen(o => !o)}
            theme={sidebarTheme}
          />
          {rarityOpen && (
            <div className="grid grid-cols-2 gap-1 mt-1">
              {options.rarities.map((r) => {
                const active = filters.rarities.includes(r);
                const rs = RARITY_STYLES[r] ?? { 
                  dot: "var(--accent)",
                  activeBg: "var(--accent-muted)",
                  border: "var(--accent)", 
                  text: "var(--text-accent)",
                  hoverBg: "rgba(255,255,255,0.1)",
                  hoverBorder: "var(--border-hover)" 
                };
                return (
                  <button
                    key={r}
                    onClick={() => toggleRarity(r)}
                    style={{
                      background: active ? rs.activeBg : undefined,
                      borderColor: active ? rs.border : undefined,
                      color: active ? rs.text : undefined,
                      boxShadow: active ? `0 0 8px ${rs.activeBg}` : undefined,
                    }}
                    className={`flex items-center gap-1.5 py-1 px-2 rounded text-xs font-medium cursor-pointer border transition text-left ${
                      active
                        ? 'font-semibold'
                        : sidebarTheme.btnDefault
                    }`}
                    onMouseEnter={e => {
                      if (!active) {
                        e.currentTarget.style.background = rs.hoverBg;
                        e.currentTarget.style.borderColor = rs.hoverBorder;
                        e.currentTarget.style.color = rs.text;
                      }
                    }}
                    onMouseLeave={e => {
                      if (!active) {
                        e.currentTarget.style.background = '';
                        e.currentTarget.style.borderColor = '';
                        e.currentTarget.style.color = '';
                      }
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: rs.dot }} />
                    <span className="truncate">{r}</span>
                    {active && <svg className="ml-auto w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 6. SEALED PRODUCT TYPE (Default COLLAPSED) */}
      {isSealedCategory && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label="Product Type"
            badge={filters.sealedTypes?.length || 0}
            open={sealedOpen}
            onToggle={() => setSealedOpen(o => !o)}
            theme={sidebarTheme}
          />
          {sealedOpen && (
            <div className="grid grid-cols-2 gap-1 mt-1">
              {SEALED_PRODUCT_TYPES.map((st) => {
                const active = (filters.sealedTypes || []).includes(st);
                return (
                  <button
                    key={st}
                    onClick={() => toggleSealedType(st)}
                    className={`flex items-center justify-between py-1 px-2 rounded text-xs font-medium cursor-pointer border transition text-left ${
                      active
                        ? activeAccentClass
                        : sidebarTheme.btnDefault
                    }`}
                  >
                    <span className="truncate">{st}</span>
                    {active && <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 7. TAGS / ONE PIECE TYPE / LORCANA CLASSIFICATION SECTION (Default COLLAPSED) */}
      {!isSealedCategory && options.tags && options.tags.length > 0 && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label={isOnePiece ? "Type" : isLorcana ? "Classification" : "Tags"}
            badge={filters.tags.length}
            open={tagsOpen}
            onToggle={() => setTagsOpen(o => !o)}
            theme={sidebarTheme}
          />
          {tagsOpen && (
            <div className="mt-1.5">
              {/* Search Bar for Tags / Types / Classification */}
              <div className="relative mb-2">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  type="text"
                  placeholder={isOnePiece ? t('Search type...', 'Típus keresése...') : isLorcana ? t('Search classification...', 'Besorolás keresése...') : t('Search tags...', 'Címkék keresése...')}
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className={`w-full ${sidebarTheme.input} rounded-lg pl-7 pr-6 py-1.5 text-xs outline-none transition`}
                />
                {tagSearch && (
                  <button
                    type="button"
                    onClick={() => setTagSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 hover:text-[var(--text-primary)] text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Tags List (2-column pill grid) */}
              <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                {filteredTags.map((t) => {
                  const active = filters.tags.includes(t);
                  return (
                    <button
                      type="button"
                      key={t}
                      onClick={() => toggleTag(t)}
                      title={t}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition cursor-pointer font-semibold text-left truncate ${
                        active
                          ? sidebarTheme.btnActive
                          : sidebarTheme.btnDefault
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
                {filteredTags.length === 0 && (
                  <div className="col-span-2 text-[11px] py-1" style={{ color: 'var(--text-tertiary)' }}>
                    {t(`No tags matching "${tagSearch}"`, `Nincs találat: "${tagSearch}"`)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7b. KEYWORDS SECTION (Riftbound only, Default COLLAPSED) */}
      {!isSealedCategory && isRiftbound && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label={t('Keywords', 'Kulcsszavak')}
            badge={(filters.keywords || []).length}
            open={keywordsOpen}
            onToggle={() => setKeywordsOpen(o => !o)}
            theme={sidebarTheme}
          />
          {keywordsOpen && (
            <div className="mt-1.5">
              {/* Match mode AND / OR */}
              <div className="flex items-center justify-between gap-1.5 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  {t('Match', 'Egyezés')}
                </span>
                <div className="flex items-center gap-1">
                  {(['and', 'or'] as const).map(m => {
                    const active = (filters.keywordMode || 'and') === m;
                    return (
                      <button
                        type="button"
                        key={m}
                        onClick={() => set("keywordMode", m)}
                        title={m === 'and' ? t('Cards must have every selected keyword', 'A kártyáknak az összes kiválasztott kulcsszóval rendelkezniük kell') : t('Cards may have any selected keyword', 'A kártyáknak a kiválasztott kulcsszavak bármelyikével rendelkezniük kell')}
                        className={`px-2.5 py-1 text-[11px] rounded-lg border transition cursor-pointer font-bold ${
                          active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                        }`}
                      >
                        {m === 'and' ? t('All (AND)', 'Mind (ÉS)') : t('Any (OR)', 'Bármelyik (VAGY)')}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Search Bar for Keywords */}
              <div className="relative mb-2">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  type="text"
                  placeholder={t('Search keywords...', 'Kulcsszavak keresése...')}
                  value={keywordSearch}
                  onChange={(e) => setKeywordSearch(e.target.value)}
                  className={`w-full ${sidebarTheme.input} rounded-lg pl-7 pr-6 py-1.5 text-xs outline-none transition`}
                />
                {keywordSearch && (
                  <button
                    type="button"
                    onClick={() => setKeywordSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 hover:text-[var(--text-primary)] text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Keywords List (2-column pill grid with color dots) */}
              <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                {filteredKeywords.map((k) => {
                  const active = (filters.keywords || []).includes(k);
                  const color = keywordSolidColor(k);
                  return (
                    <button
                      type="button"
                      key={k}
                      onClick={() => toggleKeyword(k)}
                      title={k}
                      className={`px-2.5 py-1.5 text-xs rounded-lg border transition cursor-pointer font-semibold text-left flex items-center gap-1.5 min-w-0 ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="truncate">{k}</span>
                    </button>
                  );
                })}
                {filteredKeywords.length === 0 && (
                  <div className="col-span-2 text-[11px] py-1" style={{ color: 'var(--text-tertiary)' }}>
                    {t(`No keywords matching "${keywordSearch}"`, `Nincs találat: "${keywordSearch}"`)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 7c. ONE PIECE FILTERS: Attribute, Counter, Power, Block icon */}
      {!isSealedCategory && isOnePiece && (
        <>
          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Attribute"
              badge={(filters.attributes || []).length}
              open={attributeOpen}
              onToggle={() => setAttributeOpen(o => !o)}
              theme={sidebarTheme}
            />
            {attributeOpen && (
              <div className="grid grid-cols-2 gap-1 mt-1">
                {ONEPIECE_ATTRIBUTES.map((attr) => {
                  const active = (filters.attributes || []).includes(attr);
                  return (
                    <button
                      type="button"
                      key={attr}
                      onClick={() => toggleAttribute(attr)}
                      className={`py-1.5 px-2 text-xs rounded-md border text-center transition cursor-pointer font-medium ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      {attr}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Counter"
              badge={(filters.counters || []).length}
              open={counterOpen}
              onToggle={() => setCounterOpen(o => !o)}
              theme={sidebarTheme}
            />
            {counterOpen && (
              <div className="grid grid-cols-3 gap-1 mt-1">
                {ONEPIECE_COUNTERS.map((c) => {
                  const active = (filters.counters || []).includes(c);
                  return (
                    <button
                      type="button"
                      key={c}
                      onClick={() => toggleCounter(c)}
                      className={`py-1.5 px-1.5 text-xs rounded-md border text-center transition cursor-pointer font-semibold ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      {c === 0 ? "- / 0" : `+${c}`}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Power"
              badge={powerActiveCount}
              open={powerOpen}
              onToggle={() => setPowerOpen(o => !o)}
              theme={sidebarTheme}
            />
            {powerOpen && (
              <div className="mt-1.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className={`flex-1 flex items-center ${sidebarTheme.input} rounded-md px-2 py-1 text-xs`}>
                    <span className="text-[10px] uppercase font-bold mr-1" style={{ color: 'var(--text-muted)' }}>Min</span>
                    <input
                      type="number" min={0} max={20000} step={1000}
                      placeholder="0"
                      value={filters.powerMin ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        set("powerMin", raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0));
                      }}
                      className="w-full bg-transparent font-bold text-center outline-none" style={{ color: 'var(--text-primary)' }}
                    />
                  </div>
                  <span className="font-bold" style={{ color: 'var(--text-placeholder)' }}>–</span>
                  <div className={`flex-1 flex items-center ${sidebarTheme.input} rounded-md px-2 py-1 text-xs`}>
                    <span className="text-[10px] uppercase font-bold mr-1" style={{ color: 'var(--text-muted)' }}>Max</span>
                    <input
                      type="number" min={0} max={20000} step={1000}
                      placeholder="13000"
                      value={filters.powerMax ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        set("powerMax", raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0));
                      }}
                      className="w-full bg-transparent font-bold text-center outline-none" style={{ color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>
                {powerActiveCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilters({ ...filters, powerMin: null, powerMax: null })}
                    className="text-[10px] font-bold hover:text-[var(--text-primary)] cursor-pointer"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Clear power
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Illustration Type"
              badge={(filters.illustrationTypes || []).length}
              open={illustrationOpen}
              onToggle={() => setIllustrationOpen(o => !o)}
              theme={sidebarTheme}
            />
            {illustrationOpen && (
              <div className="grid grid-cols-2 gap-1 mt-1">
                {ONEPIECE_ILLUSTRATION_TYPES.map((ill) => {
                  const active = (filters.illustrationTypes || []).includes(ill);
                  return (
                    <button
                      type="button"
                      key={ill}
                      onClick={() => toggleIllustrationType(ill)}
                      className={`py-1.5 px-1.5 text-xs rounded-md border text-center transition cursor-pointer font-medium leading-tight ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      {ill}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Block icon"
              badge={(filters.blockIcons || []).length}
              open={blockIconOpen}
              onToggle={() => setBlockIconOpen(o => !o)}
              theme={sidebarTheme}
            />
            {blockIconOpen && (
              <div className="grid grid-cols-6 gap-1 mt-1">
                {ONEPIECE_BLOCK_ICONS.map((b) => {
                  const active = (filters.blockIcons || []).includes(b);
                  return (
                    <button
                      type="button"
                      key={b}
                      onClick={() => toggleBlockIcon(b)}
                      className={`py-1.5 text-xs rounded-md border text-center transition cursor-pointer font-bold ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      {b}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <label className="flex items-center gap-2 py-1 px-1 text-xs font-semibold cursor-pointer select-none" style={{ color: 'var(--text-primary)' }}>
              <input
                type="checkbox"
                checked={Boolean(filters.hideReprints)}
                onChange={(e) => set("hideReprints", e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--accent-strong)] cursor-pointer"
              />
              <span>Hide reprint cards</span>
            </label>
          </div>
        </>
      )}

      {/* 7d. DISNEY LORCANA FILTERS: Ability, Lore Value, Strength, Willpower, Movement, Legality */}
      {!isSealedCategory && isLorcana && (
        <>
          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Ability"
              badge={(filters.abilities || []).length}
              open={abilityOpen}
              onToggle={() => setAbilityOpen(o => !o)}
              theme={sidebarTheme}
            />
            {abilityOpen && (
              <div className="grid grid-cols-2 gap-1 mt-1 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                {LORCANA_ABILITIES.map((ab) => {
                  const active = (filters.abilities || []).includes(ab);
                  return (
                    <button
                      type="button"
                      key={ab}
                      onClick={() => toggleAbility(ab)}
                      className={`py-1.5 px-2 text-xs rounded-md border text-left truncate transition cursor-pointer font-medium ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      {ab}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Lore Value (0 - 5)"
              badge={loreActiveCount}
              open={loreOpen}
              onToggle={() => setLoreOpen(o => !o)}
              theme={sidebarTheme}
            />
            {loreOpen && (
              <MinMaxRangeBox
                minVal={filters.loreMin}
                maxVal={filters.loreMax}
                boundMin={0}
                boundMax={5}
                clearLabel="Clear lore"
                onChangeMin={(v) => set("loreMin", v)}
                onChangeMax={(v) => set("loreMax", v)}
                onClear={() => setFilters({ ...filters, loreMin: null, loreMax: null })}
                inputClass={sidebarTheme.input}
              />
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Strength (0 - 12)"
              badge={strengthActiveCount}
              open={strengthOpen}
              onToggle={() => setStrengthOpen(o => !o)}
              theme={sidebarTheme}
            />
            {strengthOpen && (
              <MinMaxRangeBox
                minVal={filters.strengthMin}
                maxVal={filters.strengthMax}
                boundMin={0}
                boundMax={12}
                clearLabel="Clear strength"
                onChangeMin={(v) => set("strengthMin", v)}
                onChangeMax={(v) => set("strengthMax", v)}
                onClear={() => setFilters({ ...filters, strengthMin: null, strengthMax: null })}
                inputClass={sidebarTheme.input}
              />
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Willpower (1 - 30)"
              badge={willpowerActiveCount}
              open={willpowerOpen}
              onToggle={() => setWillpowerOpen(o => !o)}
              theme={sidebarTheme}
            />
            {willpowerOpen && (
              <MinMaxRangeBox
                minVal={filters.willpowerMin}
                maxVal={filters.willpowerMax}
                boundMin={1}
                boundMax={30}
                clearLabel="Clear willpower"
                onChangeMin={(v) => set("willpowerMin", v)}
                onChangeMax={(v) => set("willpowerMax", v)}
                onClear={() => setFilters({ ...filters, willpowerMin: null, willpowerMax: null })}
                inputClass={sidebarTheme.input}
              />
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Movement (0 - 6)"
              badge={movementActiveCount}
              open={movementOpen}
              onToggle={() => setMovementOpen(o => !o)}
              theme={sidebarTheme}
            />
            {movementOpen && (
              <MinMaxRangeBox
                minVal={filters.movementMin}
                maxVal={filters.movementMax}
                boundMin={0}
                boundMax={6}
                clearLabel="Clear movement"
                onChangeMin={(v) => set("movementMin", v)}
                onChangeMax={(v) => set("movementMax", v)}
                onClear={() => setFilters({ ...filters, movementMin: null, movementMax: null })}
                inputClass={sidebarTheme.input}
              />
            )}
          </div>

          <div className={`border-b ${sidebarTheme.divider} pb-2`}>
            <SectionHeader
              label="Legality"
              badge={(filters.legality || []).length}
              open={legalityOpen}
              onToggle={() => setLegalityOpen(o => !o)}
              theme={sidebarTheme}
            />
            {legalityOpen && (
              <div className="grid grid-cols-2 gap-1 mt-1">
                {LORCANA_LEGALITIES.map((leg) => {
                  const active = (filters.legality || []).includes(leg);
                  return (
                    <button
                      type="button"
                      key={leg}
                      onClick={() => toggleLegality(leg)}
                      className={`py-1.5 px-1.5 text-xs rounded-md border text-center transition cursor-pointer font-medium leading-tight ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      {leg}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* 8. ENERGY / COST / LIFE SECTION (Default COLLAPSED) */}
      {!isSealedCategory && (
        <div>
          <SectionHeader
            label={isOnePiece ? "Cost / Life" : isLorcana ? "Cost (0 - 12)" : isRiftbound ? "Energy Cost" : "Mana Value"}
            badge={costActiveCount}
            open={costOpen}
            onToggle={() => setCostOpen(o => !o)}
            theme={sidebarTheme}
          />
          {costOpen && (
            <div className="mt-1.5">
              <div className="flex items-center gap-2">
                <div className={`flex-1 flex items-center ${sidebarTheme.input} rounded-md px-2 py-1 text-xs`}>
                  <span className="text-[10px] uppercase font-bold mr-1.5" style={{ color: 'var(--text-muted)' }}>Min</span>
                  <input
                    type="number" min={minCostBound} max={maxCostBound} value={filters.costMin}
                    onChange={(e) => handleCostMin(e.target.value)}
                    className="w-full bg-transparent font-bold text-center outline-none" style={{ color: 'var(--text-primary)' }}
                  />
                </div>
                <span className="font-bold" style={{ color: 'var(--text-placeholder)' }}>–</span>
                <div className={`flex-1 flex items-center ${sidebarTheme.input} rounded-md px-2 py-1 text-xs`}>
                  <span className="text-[10px] uppercase font-bold mr-1.5" style={{ color: 'var(--text-muted)' }}>Max</span>
                  <input
                    type="number" min={minCostBound} max={maxCostBound} value={filters.costMax}
                    onChange={(e) => handleCostMax(e.target.value)}
                    className="w-full bg-transparent font-bold text-center outline-none" style={{ color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
