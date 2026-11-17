export interface DomainStyle {
  name: string;
  key: string;
  bg: string;
  border: string;
  text: string;
  glow: string;
}

export const SINGLE_DOMAIN_MAP: Record<string, DomainStyle> = {
  // Riftbound Domains
  fury:      { name: 'Fury',      key: 'fury',      bg: 'rgba(220,38,38,0.95)',   border: 'rgba(239,68,68,1)',   text: '#ffffff', glow: 'rgba(239,68,68,0.6)' },
  calm:      { name: 'Calm',      key: 'calm',      bg: 'rgba(22,163,74,0.95)',   border: 'rgba(34,197,94,1)',   text: '#ffffff', glow: 'rgba(34,197,94,0.6)' },
  mind:      { name: 'Mind',      key: 'mind',      bg: 'rgba(37,99,235,0.95)',   border: 'rgba(59,130,246,1)',  text: '#ffffff', glow: 'rgba(59,130,246,0.6)' },
  body:      { name: 'Body',      key: 'body',      bg: 'rgba(249,115,22,0.95)',  border: 'rgba(249,115,22,1)',  text: '#ffffff', glow: 'rgba(249,115,22,0.6)' },
  chaos:     { name: 'Chaos',     key: 'chaos',     bg: 'rgba(147,51,234,0.95)',  border: 'rgba(168,85,247,1)',  text: '#ffffff', glow: 'rgba(168,85,247,0.6)' },
  order:     { name: 'Order',     key: 'order',     bg: 'rgba(234,179,8,0.95)',   border: 'rgba(234,179,8,1)',   text: '#ffffff', glow: 'rgba(234,179,8,0.6)' },
  colorless:   { name: 'Colorless', key: 'colorless', bg: 'rgba(75,85,99,0.95)',    border: 'rgba(107,114,128,1)', text: '#ffffff', glow: 'rgba(107,114,128,0.4)' },
  'no aspect': { name: 'No Aspect', key: 'no aspect', bg: 'rgba(75,85,99,0.95)',    border: 'rgba(107,114,128,1)', text: '#ffffff', glow: 'rgba(107,114,128,0.4)' },
  // One Piece Colors
  red:       { name: 'Red',       key: 'red',       bg: 'rgba(220,38,38,0.95)',   border: 'rgba(239,68,68,1)',   text: '#ffffff', glow: 'rgba(239,68,68,0.6)' },
  green:     { name: 'Green',     key: 'green',     bg: 'rgba(22,163,74,0.95)',   border: 'rgba(34,197,94,1)',   text: '#ffffff', glow: 'rgba(34,197,94,0.6)' },
  blue:      { name: 'Blue',      key: 'blue',      bg: 'rgba(37,99,235,0.95)',   border: 'rgba(59,130,246,1)',  text: '#ffffff', glow: 'rgba(59,130,246,0.6)' },
  purple:    { name: 'Purple',    key: 'purple',    bg: 'rgba(147,51,234,0.95)',  border: 'rgba(168,85,247,1)',  text: '#ffffff', glow: 'rgba(168,85,247,0.6)' },
  black:     { name: 'Black',     key: 'black',     bg: 'rgba(31,41,55,0.95)',    border: 'rgba(75,85,99,1)',    text: '#ffffff', glow: 'rgba(75,85,99,0.5)' },
  yellow:    { name: 'Yellow',    key: 'yellow',    bg: 'rgba(234,179,8,0.95)',   border: 'rgba(250,204,21,1)',  text: '#111827', glow: 'rgba(234,179,8,0.6)' },
  // Disney Lorcana Inks
  amber:     { name: 'Amber',     key: 'amber',     bg: 'rgba(217,119,6,0.95)',   border: 'rgba(245,158,11,1)',  text: '#ffffff', glow: 'rgba(245,158,11,0.6)' },
  amethyst:  { name: 'Amethyst',  key: 'amethyst',  bg: 'rgba(147,51,234,0.95)',  border: 'rgba(168,85,247,1)',  text: '#ffffff', glow: 'rgba(168,85,247,0.6)' },
  emerald:   { name: 'Emerald',   key: 'emerald',   bg: 'rgba(5,150,105,0.95)',   border: 'rgba(16,185,129,1)',  text: '#ffffff', glow: 'rgba(16,185,129,0.6)' },
  ruby:      { name: 'Ruby',      key: 'ruby',      bg: 'rgba(220,38,38,0.95)',   border: 'rgba(239,68,68,1)',   text: '#ffffff', glow: 'rgba(239,68,68,0.6)' },
  sapphire:  { name: 'Sapphire',  key: 'sapphire',  bg: 'rgba(2,132,199,0.95)',   border: 'rgba(14,165,233,1)',  text: '#ffffff', glow: 'rgba(14,165,233,0.6)' },
  steel:     { name: 'Steel',     key: 'steel',     bg: 'rgba(100,116,139,0.95)', border: 'rgba(148,163,184,1)', text: '#ffffff', glow: 'rgba(148,163,184,0.5)' },
};

/**
 * Parses a domain string like "Fury, Chaos", "Red Black", or "Amber-Emerald" into an array of DomainStyles.
 */
export function parseDomains(domainRaw?: string | null): DomainStyle[] {
  if (!domainRaw || !domainRaw.trim()) {
    return [SINGLE_DOMAIN_MAP.colorless];
  }
  const parts = domainRaw
    .split(/[\s,/&-]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const found: DomainStyle[] = [];
  for (const p of parts) {
    if (SINGLE_DOMAIN_MAP[p]) {
      found.push(SINGLE_DOMAIN_MAP[p]);
    }
  }

  return found.length > 0 ? found : [SINGLE_DOMAIN_MAP.colorless];
}

/**
 * Generates badge styling (supporting single domain solid color, 2 domain 50/50 half-and-half gradient, and multi-domain).
 */
export function getEnergyBadgeStyle(domainRaw?: string | null) {
  const domains = parseDomains(domainRaw);

  if (domains.length === 1) {
    return {
      background: domains[0].bg,
      border: `clamp(1.5px, 0.7cqi, 3px) solid ${domains[0].border}`,
      boxShadow: `0 0 clamp(6px, 2.5cqi, 16px) ${domains[0].glow}`,
      color: domains[0].text,
    };
  }

  // 2 colors: 50% / 50% split at 135deg
  if (domains.length === 2) {
    return {
      background: `linear-gradient(135deg, ${domains[0].bg} 0%, ${domains[0].bg} 50%, ${domains[1].bg} 50%, ${domains[1].bg} 100%)`,
      border: `clamp(1.5px, 0.7cqi, 3px) solid rgba(255, 255, 255, 0.85)`,
      boxShadow: `0 0 clamp(6px, 2.5cqi, 16px) ${domains[0].glow}, 0 0 clamp(6px, 2.5cqi, 16px) ${domains[1].glow}`,
      color: '#ffffff',
    };
  }

  // 3+ colors: equal percentage stops
  const step = 100 / domains.length;
  const stops = domains.map((d, i) => `${d.bg} ${i * step}%, ${d.bg} ${(i + 1) * step}%`).join(', ');
  return {
    background: `linear-gradient(135deg, ${stops})`,
    border: `clamp(1.5px, 0.7cqi, 3px) solid rgba(255, 255, 255, 0.85)`,
    boxShadow: `0 0 clamp(6px, 2.5cqi, 16px) ${domains[0].glow}`,
    color: '#ffffff',
  };
}

// ─── Filter & Sidebar Style Maps ──────────────────────────────────
export interface FilterTokenStyle {
  dot: string;
  activeBg: string;
  border: string;
  text: string;
  hoverBg: string;
  hoverBorder: string;
}

export const DOMAIN_STYLES: Record<string, FilterTokenStyle> = {
  Fury:       { dot: "#ef4444", activeBg: "rgba(239,68,68,0.22)",   border: "rgba(239,68,68,0.7)", text: "#fca5a5", hoverBg: "rgba(239,68,68,0.12)",   hoverBorder: "rgba(239,68,68,0.45)" },
  Calm:       { dot: "#22c55e", activeBg: "rgba(34,197,94,0.22)",   border: "rgba(34,197,94,0.7)", text: "#86efac", hoverBg: "rgba(34,197,94,0.12)",   hoverBorder: "rgba(34,197,94,0.45)" },
  Mind:       { dot: "#3b82f6", activeBg: "rgba(59,130,246,0.22)",  border: "rgba(59,130,246,0.7)", text: "#93c5fd", hoverBg: "rgba(59,130,246,0.12)",  hoverBorder: "rgba(59,130,246,0.45)" },
  Body:       { dot: "#f97316", activeBg: "rgba(249,115,22,0.22)",  border: "rgba(249,115,22,0.7)", text: "#fdba74", hoverBg: "rgba(249,115,22,0.12)",  hoverBorder: "rgba(249,115,22,0.45)" },
  Chaos:      { dot: "#a855f7", activeBg: "rgba(168,85,247,0.22)",  border: "rgba(168,85,247,0.7)", text: "#d8b4fe", hoverBg: "rgba(168,85,247,0.12)",  hoverBorder: "rgba(168,85,247,0.45)" },
  Order:      { dot: "#eab308", activeBg: "rgba(234,179,8,0.22)",   border: "rgba(234,179,8,0.7)", text: "#fde047", hoverBg: "rgba(234,179,8,0.12)",   hoverBorder: "rgba(234,179,8,0.45)" },
  Colorless:  { dot: "#cbd5e1", activeBg: "rgba(203,213,225,0.18)", border: "rgba(203,213,225,0.6)", text: "#f1f5f9", hoverBg: "rgba(203,213,225,0.1)",  hoverBorder: "rgba(203,213,225,0.35)" },
  // One Piece Card Game Colors
  Red:        { dot: "#ef4444", activeBg: "rgba(239,68,68,0.22)",   border: "rgba(239,68,68,0.7)", text: "#fca5a5", hoverBg: "rgba(239,68,68,0.12)",   hoverBorder: "rgba(239,68,68,0.45)" },
  Green:      { dot: "#22c55e", activeBg: "rgba(34,197,94,0.22)",   border: "rgba(34,197,94,0.7)", text: "#86efac", hoverBg: "rgba(34,197,94,0.12)",   hoverBorder: "rgba(34,197,94,0.45)" },
  Blue:       { dot: "#3b82f6", activeBg: "rgba(59,130,246,0.22)",  border: "rgba(59,130,246,0.7)", text: "#93c5fd", hoverBg: "rgba(59,130,246,0.12)",  hoverBorder: "rgba(59,130,246,0.45)" },
  Purple:     { dot: "#a855f7", activeBg: "rgba(168,85,247,0.22)",  border: "rgba(168,85,247,0.7)", text: "#d8b4fe", hoverBg: "rgba(168,85,247,0.12)",  hoverBorder: "rgba(168,85,247,0.45)" },
  Black:      { dot: "#64748b", activeBg: "rgba(51,65,85,0.35)",    border: "rgba(148,163,184,0.7)", text: "#cbd5e1", hoverBg: "rgba(51,65,85,0.2)",    hoverBorder: "rgba(148,163,184,0.45)" },
  Yellow:     { dot: "#eab308", activeBg: "rgba(234,179,8,0.22)",   border: "rgba(234,179,8,0.7)", text: "#fde047", hoverBg: "rgba(234,179,8,0.12)",   hoverBorder: "rgba(234,179,8,0.45)" },
  Multicolor: { dot: "linear-gradient(135deg, #ef4444, #22c55e, #3b82f6, #eab308)", activeBg: "rgba(244,63,94,0.2)", border: "rgba(251,146,60,0.75)", text: "#fed7aa", hoverBg: "rgba(244,63,94,0.1)", hoverBorder: "rgba(251,146,60,0.45)" },
  // Disney Lorcana Inks
  Amber:      { dot: "#f59e0b", activeBg: "rgba(245,158,11,0.22)",  border: "rgba(245,158,11,0.7)", text: "#fcd34d", hoverBg: "rgba(245,158,11,0.12)",  hoverBorder: "rgba(245,158,11,0.45)" },
  Amethyst:   { dot: "#a855f7", activeBg: "rgba(168,85,247,0.22)",  border: "rgba(168,85,247,0.7)", text: "#d8b4fe", hoverBg: "rgba(168,85,247,0.12)",  hoverBorder: "rgba(168,85,247,0.45)" },
  Emerald:    { dot: "#10b981", activeBg: "rgba(16,185,129,0.22)",  border: "rgba(16,185,129,0.7)", text: "#6ee7b7", hoverBg: "rgba(16,185,129,0.12)",  hoverBorder: "rgba(16,185,129,0.45)" },
  Ruby:       { dot: "#ef4444", activeBg: "rgba(239,68,68,0.22)",   border: "rgba(239,68,68,0.7)", text: "#fca5a5", hoverBg: "rgba(239,68,68,0.12)",   hoverBorder: "rgba(239,68,68,0.45)" },
  Sapphire:   { dot: "#0ea5e9", activeBg: "rgba(14,165,233,0.22)",  border: "rgba(14,165,233,0.7)", text: "#7dd3fc", hoverBg: "rgba(14,165,233,0.12)",  hoverBorder: "rgba(14,165,233,0.45)" },
  Steel:      { dot: "#94a3b8", activeBg: "rgba(148,163,184,0.22)", border: "rgba(148,163,184,0.7)", text: "#cbd5e1", hoverBg: "rgba(148,163,184,0.12)", hoverBorder: "rgba(148,163,184,0.45)" },
  // Star Wars: Unlimited Aspects
  Vigilance:  { dot: "#3b82f6", activeBg: "rgba(59,130,246,0.22)",  border: "rgba(59,130,246,0.7)", text: "#93c5fd", hoverBg: "rgba(59,130,246,0.12)",  hoverBorder: "rgba(59,130,246,0.45)" },
  Command:    { dot: "#16a34a", activeBg: "rgba(22,163,74,0.22)",   border: "rgba(22,163,74,0.7)", text: "#86efac", hoverBg: "rgba(22,163,74,0.12)",   hoverBorder: "rgba(22,163,74,0.45)" },
  Aggression: { dot: "#ef4444", activeBg: "rgba(239,68,68,0.22)",   border: "rgba(239,68,68,0.7)", text: "#fca5a5", hoverBg: "rgba(239,68,68,0.12)",   hoverBorder: "rgba(239,68,68,0.45)" },
  Cunning:    { dot: "#eab308", activeBg: "rgba(234,179,8,0.22)",   border: "rgba(234,179,8,0.7)", text: "#fde047", hoverBg: "rgba(234,179,8,0.12)",   hoverBorder: "rgba(234,179,8,0.45)" },
  Villainy:    { dot: "#64748b", activeBg: "rgba(100,116,139,0.25)", border: "rgba(148,163,184,0.7)", text: "#e2e8f0", hoverBg: "rgba(100,116,139,0.15)", hoverBorder: "rgba(148,163,184,0.45)" },
  Heroism:     { dot: "#38bdf8", activeBg: "rgba(56,189,248,0.22)",  border: "rgba(56,189,248,0.7)", text: "#bae6fd", hoverBg: "rgba(56,189,248,0.12)",  hoverBorder: "rgba(56,189,248,0.45)" },
  'No Aspect': { dot: "#94a3b8", activeBg: "rgba(148,163,184,0.18)", border: "rgba(148,163,184,0.6)", text: "#e2e8f0", hoverBg: "rgba(148,163,184,0.1)",  hoverBorder: "rgba(148,163,184,0.35)" },
  // Flesh and Blood Classes
  Generic:       { dot: "#94a3b8", activeBg: "rgba(148,163,184,0.22)", border: "rgba(148,163,184,0.7)", text: "#e2e8f0", hoverBg: "rgba(148,163,184,0.12)", hoverBorder: "rgba(148,163,184,0.45)" },
  Brute:         { dot: "#ea580c", activeBg: "rgba(234,88,12,0.22)",  border: "rgba(234,88,12,0.7)",  text: "#fdba74", hoverBg: "rgba(234,88,12,0.12)",  hoverBorder: "rgba(234,88,12,0.45)" },
  Guardian:      { dot: "#0284c7", activeBg: "rgba(2,132,199,0.22)",  border: "rgba(2,132,199,0.7)",  text: "#7dd3fc", hoverBg: "rgba(2,132,199,0.12)",  hoverBorder: "rgba(2,132,199,0.45)" },
  Ninja:         { dot: "#059669", activeBg: "rgba(5,150,105,0.22)",  border: "rgba(5,150,105,0.7)",  text: "#6ee7b7", hoverBg: "rgba(5,150,105,0.12)",  hoverBorder: "rgba(5,150,105,0.45)" },
  Warrior:       { dot: "#eab308", activeBg: "rgba(234,179,8,0.22)",   border: "rgba(234,179,8,0.7)",  text: "#fde047", hoverBg: "rgba(234,179,8,0.12)",   hoverBorder: "rgba(234,179,8,0.45)" },
  Mechanologist: { dot: "#d97706", activeBg: "rgba(217,119,6,0.22)",  border: "rgba(217,119,6,0.7)",  text: "#fcd34d", hoverBg: "rgba(217,119,6,0.12)",  hoverBorder: "rgba(217,119,6,0.45)" },
  Ranger:        { dot: "#16a34a", activeBg: "rgba(22,163,74,0.22)",   border: "rgba(22,163,74,0.7)",  text: "#86efac", hoverBg: "rgba(22,163,74,0.12)",   hoverBorder: "rgba(22,163,74,0.45)" },
  Runeblade:     { dot: "#7c3aed", activeBg: "rgba(124,58,237,0.22)",  border: "rgba(124,58,237,0.7)", text: "#c4b5fd", hoverBg: "rgba(124,58,237,0.12)", hoverBorder: "rgba(124,58,237,0.45)" },
  Wizard:        { dot: "#2563eb", activeBg: "rgba(37,99,235,0.22)",  border: "rgba(37,99,235,0.7)",  text: "#93c5fd", hoverBg: "rgba(37,99,235,0.12)",  hoverBorder: "rgba(37,99,235,0.45)" },
  Illusionist:   { dot: "#ec4899", activeBg: "rgba(236,72,153,0.22)",  border: "rgba(236,72,153,0.7)", text: "#fbcfe8", hoverBg: "rgba(236,72,153,0.12)", hoverBorder: "rgba(236,72,153,0.45)" },
  Assassin:      { dot: "#475569", activeBg: "rgba(71,85,105,0.3)",    border: "rgba(100,116,139,0.7)",text: "#cbd5e1", hoverBg: "rgba(71,85,105,0.2)",   hoverBorder: "rgba(100,116,139,0.45)" },
  Necromancer:   { dot: "#9333ea", activeBg: "rgba(147,51,234,0.22)",  border: "rgba(147,51,234,0.7)", text: "#d8b4fe", hoverBg: "rgba(147,51,234,0.12)", hoverBorder: "rgba(147,51,234,0.45)" },
};

export const RARITY_STYLES: Record<string, FilterTokenStyle> = {
  Common:          { dot: "#94a3b8", activeBg: "rgba(148,163,184,0.22)", border: "rgba(148,163,184,0.7)", text: "#e2e8f0", hoverBg: "rgba(148,163,184,0.12)", hoverBorder: "rgba(148,163,184,0.45)" },
  Uncommon:        { dot: "#38bdf8", activeBg: "rgba(56,189,248,0.22)",  border: "rgba(56,189,248,0.7)",  text: "#7dd3fc", hoverBg: "rgba(56,189,248,0.12)",  hoverBorder: "rgba(56,189,248,0.45)" },
  Rare:            { dot: "#c084fc", activeBg: "rgba(192,132,252,0.22)", border: "rgba(192,132,252,0.7)", text: "#e9d5ff", hoverBg: "rgba(192,132,252,0.12)", hoverBorder: "rgba(192,132,252,0.45)" },
  Epic:            { dot: "#fb923c", activeBg: "rgba(251,146,60,0.22)",  border: "rgba(251,146,60,0.7)",  text: "#fed7aa", hoverBg: "rgba(251,146,60,0.12)",  hoverBorder: "rgba(251,146,60,0.45)" },
  Showcase:        { dot: "#fde047", activeBg: "rgba(253,224,71,0.22)",  border: "rgba(253,224,71,0.8)",  text: "#fef08a", hoverBg: "rgba(253,224,71,0.14)",  hoverBorder: "rgba(253,224,71,0.55)" },
  Mythic:          { dot: "#f97316", activeBg: "rgba(249,115,22,0.22)",  border: "rgba(249,115,22,0.8)",  text: "#fdba74", hoverBg: "rgba(249,115,22,0.12)",  hoverBorder: "rgba(249,115,22,0.5)" },
  Special:         { dot: "#a855f7", activeBg: "rgba(168,85,247,0.22)",  border: "rgba(168,85,247,0.7)",  text: "#d8b4fe", hoverBg: "rgba(168,85,247,0.12)",  hoverBorder: "rgba(168,85,247,0.45)" },
  Bonus:           { dot: "#ec4899", activeBg: "rgba(236,72,153,0.22)",  border: "rgba(236,72,153,0.7)",  text: "#fbcfe8", hoverBg: "rgba(236,72,153,0.12)",  hoverBorder: "rgba(236,72,153,0.45)" },
  // One Piece Card Game Rarities
  'Super Rare':    { dot: "#e11d48", activeBg: "rgba(225,29,72,0.22)",   border: "rgba(225,29,72,0.7)",   text: "#fda4af", hoverBg: "rgba(225,29,72,0.12)",   hoverBorder: "rgba(225,29,72,0.45)" },
  'Secret Rare':   { dot: "#06b6d4", activeBg: "rgba(6,182,212,0.22)",   border: "rgba(6,182,212,0.7)",   text: "#67e8f9", hoverBg: "rgba(6,182,212,0.12)",   hoverBorder: "rgba(6,182,212,0.45)" },
  'Leader':        { dot: "#f59e0b", activeBg: "rgba(245,158,11,0.22)",  border: "rgba(245,158,11,0.7)",  text: "#fcd34d", hoverBg: "rgba(245,158,11,0.12)",  hoverBorder: "rgba(245,158,11,0.45)" },
  'Treasure Rare': { dot: "#10b981", activeBg: "rgba(16,185,129,0.22)",  border: "rgba(16,185,129,0.7)",  text: "#6ee7b7", hoverBg: "rgba(16,185,129,0.12)",  hoverBorder: "rgba(16,185,129,0.45)" },
  'Promo':         { dot: "#a855f7", activeBg: "rgba(168,85,247,0.22)",  border: "rgba(168,85,247,0.7)",  text: "#d8b4fe", hoverBg: "rgba(168,85,247,0.12)",  hoverBorder: "rgba(168,85,247,0.45)" },
  // Lorcana / SWU / FaB Rarities
  'Super':         { dot: "#fb923c", activeBg: "rgba(251,146,60,0.22)",  border: "rgba(251,146,60,0.75)", text: "#fed7aa", hoverBg: "rgba(251,146,60,0.12)",  hoverBorder: "rgba(251,146,60,0.45)" },
  'Legendary':     { dot: "#f59e0b", activeBg: "rgba(245,158,11,0.22)",  border: "rgba(245,158,11,0.8)",  text: "#fcd34d", hoverBg: "rgba(245,158,11,0.12)",  hoverBorder: "rgba(245,158,11,0.5)" },
  'Enchanted':     { dot: "#ec4899", activeBg: "rgba(236,72,153,0.22)", border: "rgba(236,72,153,0.8)", text: "#fbcfe8", hoverBg: "rgba(236,72,153,0.12)", hoverBorder: "rgba(236,72,153,0.5)" },
  'Iconic':        { dot: "#38bdf8", activeBg: "rgba(56,189,248,0.22)",  border: "rgba(56,189,248,0.8)",  text: "#bae6fd", hoverBg: "rgba(56,189,248,0.12)",  hoverBorder: "rgba(56,189,248,0.5)" },
  'PROMO':         { dot: "#a855f7", activeBg: "rgba(168,85,247,0.22)",  border: "rgba(168,85,247,0.7)",  text: "#d8b4fe", hoverBg: "rgba(168,85,247,0.12)",  hoverBorder: "rgba(168,85,247,0.45)" },
  'CHALLENGE':     { dot: "#ef4444", activeBg: "rgba(239,68,68,0.22)",   border: "rgba(239,68,68,0.7)",   text: "#fca5a5", hoverBg: "rgba(239,68,68,0.12)",   hoverBorder: "rgba(239,68,68,0.45)" },
  'QUEST':         { dot: "#10b981", activeBg: "rgba(16,185,129,0.22)",  border: "rgba(16,185,129,0.7)",  text: "#6ee7b7", hoverBg: "rgba(16,185,129,0.12)",  hoverBorder: "rgba(16,185,129,0.45)" },
  'D23':           { dot: "#3b82f6", activeBg: "rgba(59,130,246,0.22)",  border: "rgba(59,130,246,0.7)",  text: "#93c5fd", hoverBg: "rgba(59,130,246,0.12)",  hoverBorder: "rgba(59,130,246,0.45)" },
  'D100':          { dot: "#cbd5e1", activeBg: "rgba(203,213,225,0.22)", border: "rgba(203,213,225,0.75)", text: "#f1f5f9", hoverBg: "rgba(203,213,225,0.12)", hoverBorder: "rgba(203,213,225,0.45)" },
  'Majestic':      { dot: "#8b5cf6", activeBg: "rgba(139,92,246,0.22)",  border: "rgba(139,92,246,0.8)",  text: "#c4b5fd", hoverBg: "rgba(139,92,246,0.12)",  hoverBorder: "rgba(139,92,246,0.5)" },
  'Fabled':        { dot: "#06b6d4", activeBg: "rgba(6,182,212,0.22)",   border: "rgba(6,182,212,0.8)",   text: "#67e8f9", hoverBg: "rgba(6,182,212,0.12)",   hoverBorder: "rgba(6,182,212,0.5)" },
  'Token':         { dot: "#94a3b8", activeBg: "rgba(148,163,184,0.22)", border: "rgba(148,163,184,0.7)", text: "#cbd5e1", hoverBg: "rgba(148,163,184,0.12)", hoverBorder: "rgba(148,163,184,0.45)" },
};


