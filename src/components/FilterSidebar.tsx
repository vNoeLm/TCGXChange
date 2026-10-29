import { useState, useEffect } from "react";
import type { FilterState } from "../types";
import { SEALED_PRODUCT_TYPES } from "../lib/constants";
import { useSiteTheme } from "../lib/theme";
import { DOMAIN_STYLES, RARITY_STYLES } from "../lib/domainColors";
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

export function FilterSidebar({ filters, setFilters, options }: FilterSidebarProps) {
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
  const [tagSearch, setTagSearch] = useState("");
  const [setSearch, setSetSearch] = useState("");


  const isSealedCategory = filters.category === 'sealed';
  const isRiftbound = !filters.game || filters.game === 'riftbound';
  const isOnePiece = filters.game === 'onepiece';

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

  const toggleSealedType = (st: string) => {
    const current = filters.sealedTypes || [];
    const next = current.includes(st)
      ? current.filter((x) => x !== st)
      : [...current, st];
    set("sealedTypes", next);
  };

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
      keywords: [],
      keywordMode: 'and',
      sealedTypes: [],
      costMin: 1,
      costMax: 10,
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
    const n = Math.max(1, Math.min(10, parseInt(v) || 1));
    set("costMin", n);
  };
  const handleCostMax = (v: string) => {
    const n = Math.max(1, Math.min(10, parseInt(v) || 10));
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

  const costActiveCount = (filters.costMin > 1 || filters.costMax < 10) ? 1 : 0;

  const filteredTags = (options.tags || []).filter(t => 
    !tagSearch.trim() || t.toLowerCase().includes(tagSearch.trim().toLowerCase())
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
          Filters
        </span>
        <button
          onClick={reset}
          className="tv-btn-danger text-[11px] px-2 py-0.5 rounded font-medium transition cursor-pointer"
        >
          Reset
        </button>
      </div>

      {/* 0. WISHLIST - only cards on one of your lists (shown once you have a list) */}
      {options.wishlists && options.wishlists.length > 0 && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader label={"Wishlist"} badge={filters.wishlistId ? 1 : 0} collapsible={false} theme={sidebarTheme} />
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
          label={"Set"}
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
                  placeholder={'Search sets...'}
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

      {/* 2. TYPE SECTION (Default OPEN) - Symmetrical 2-Column Grid */}
      {!isSealedCategory && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label={"Type"}
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
              filters.game === 'lorcana' ? "Ink" :
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
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ds.dot }} />
                    <span className="truncate">{d}</span>
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
            label={"Card Variant"}
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
                title="Click to cycle: Only SP Cards → Exclude SP Cards → All Cards"
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
                title="Click to cycle: Only Signed → Exclude Signed → All Cards"
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
                title="Click to cycle: Only Alt Arts → Exclude Alt Arts → All Cards"
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
                title="Click to cycle: Only Overnumbered → Exclude Overnumbered → All Cards"
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
            label={"Rarity"}
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
            label={'Product Type'}
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

      {/* 7. TAGS SECTION (Default COLLAPSED) */}
      {!isSealedCategory && options.tags && options.tags.length > 0 && (
        <div className={`border-b ${sidebarTheme.divider} pb-2`}>
          <SectionHeader
            label={"Tags"}
            badge={filters.tags.length}
            open={tagsOpen}
            onToggle={() => setTagsOpen(o => !o)}
            theme={sidebarTheme}
          />
          {tagsOpen && (
            <div className="mt-1.5">
              {/* Search Bar for Tags */}
              <div className="relative mb-1.5">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  type="text"
                  placeholder={'Search tags...'}
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className={`w-full ${sidebarTheme.input} rounded-md pl-7 pr-6 py-1 text-xs outline-none transition`}
                />
                {tagSearch && (
                  <button
                    onClick={() => setTagSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 hover:text-[var(--text-primary)] text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Tags List */}
              <div className="flex flex-wrap gap-1 max-h-64 sm:max-h-80 overflow-y-auto custom-scrollbar pr-1">
                {filteredTags.map((t) => {
                  const active = filters.tags.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggleTag(t)}
                      className={`px-2 py-0.5 text-[11px] rounded-md border transition cursor-pointer font-medium ${
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
                  <div className="text-[11px] py-1" style={{ color: 'var(--text-tertiary)' }}>
                    {`No tags matching "${tagSearch}"`}
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
            label={"Keywords"}
            badge={(filters.keywords || []).length}
            open={keywordsOpen}
            onToggle={() => setKeywordsOpen(o => !o)}
            theme={sidebarTheme}
          />
          {keywordsOpen && (
            <div className="mt-1.5">
              <div className="flex flex-wrap gap-1">
                {SEARCHABLE_KEYWORDS.map((k) => {
                  const active = (filters.keywords || []).includes(k);
                  const color = keywordSolidColor(k);
                  return (
                    <button
                      key={k}
                      onClick={() => toggleKeyword(k)}
                      className={`px-2 py-0.5 text-[11px] rounded-md border transition cursor-pointer font-medium inline-flex items-center gap-1 ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      {k}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Match</span>
                {(['and', 'or'] as const).map(m => {
                  const active = (filters.keywordMode || 'and') === m;
                  return (
                    <button
                      key={m}
                      onClick={() => set("keywordMode", m)}
                      title={m === 'and' ? 'Cards must have every selected keyword' : 'Cards may have any selected keyword'}
                      className={`px-3 py-0.5 text-[11px] rounded-md border transition cursor-pointer font-bold ${
                        active ? sidebarTheme.btnActive : sidebarTheme.btnDefault
                      }`}
                    >
                      {m === 'and' ? 'All (AND)' : 'Any (OR)'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 8. ENERGY / COST SECTION (Default COLLAPSED) */}
      {!isSealedCategory && (
        <div>
          <SectionHeader
            label={isOnePiece ? "Cost" : isRiftbound ? "Energy Cost" : "Mana Value"}
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
                    type="number" min={1} max={10} value={filters.costMin}
                    onChange={(e) => handleCostMin(e.target.value)}
                    className="w-full bg-transparent font-bold text-center outline-none" style={{ color: 'var(--text-primary)' }}
                  />
                </div>
                <span className="font-bold" style={{ color: 'var(--text-placeholder)' }}>–</span>
                <div className={`flex-1 flex items-center ${sidebarTheme.input} rounded-md px-2 py-1 text-xs`}>
                  <span className="text-[10px] uppercase font-bold mr-1.5" style={{ color: 'var(--text-muted)' }}>Max</span>
                  <input
                    type="number" min={1} max={10} value={filters.costMax}
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
