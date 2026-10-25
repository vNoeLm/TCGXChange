import { GLYPH_ICONS } from './riftboundIcons';

/**
 * Riftbound keyword badge colors, sampled directly from the colored pill printed on
 * real cards (e.g. Miss Fortune, Captain OGN-162 for Accelerate/Ganking; Rengar,
 * Unseen UNL-024 for Assault) rather than guessed, so the in-app pill and any other
 * UI referencing a keyword's color (e.g. deck stats) matches what's actually printed.
 * Keywords not listed here don't have a confirmed sample yet and fall back to a
 * generic color rather than a guessed one.
 */
export const KEYWORD_COLORS: Record<string, string> = {
  accelerate: 'linear-gradient(135deg,#2f8a72,#1f6b56)',
  ganking:    'linear-gradient(135deg,#a8c93f,#8aab2a)',
  assault:    'linear-gradient(135deg,#d63a7a,#b82f68)',
  deflect:    'linear-gradient(135deg,#22c55e,#16a34a)',
  shield:     'linear-gradient(135deg,#3b82f6,#2563eb)',
  empower:    'linear-gradient(135deg,#a855f7,#9333ea)',
  empowered:  'linear-gradient(135deg,#a855f7,#9333ea)',
  predict:    'linear-gradient(135deg,#8b5cf6,#7c3aed)',
  hunt:       'linear-gradient(135deg,#eab308,#ca8a04)',
  burn:       'linear-gradient(135deg,#f97316,#ea580c)',
  deathknell: 'linear-gradient(135deg,#475569,#334155)',
  flow:       'linear-gradient(135deg,#06b6d4,#0891b2)',
  ambush:     'linear-gradient(135deg,#10b981,#059669)',
  vanguard:   'linear-gradient(135deg,#6366f1,#4f46e5)',
  intercept:  'linear-gradient(135deg,#6366f1,#4f46e5)',
  stun:       'linear-gradient(135deg,#fbbf24,#d97706)',
  disarm:     'linear-gradient(135deg,#e11d48,#be123c)',
  deploy:     'linear-gradient(135deg,#0284c7,#0369a1)',
  'show off': 'linear-gradient(135deg,#d97706,#b45309)',
};

export const KEYWORD_FALLBACK_COLOR = 'linear-gradient(135deg,#ec4899,#db2777)';

export const KEYWORD_LIST = [
  'Assault', 'Shield', 'Deflect', 'Hunt', 'Burn', 'Predict', 'Level',
  'Accelerate', 'Deathknell', 'Ambush', 'Flow', 'Repeat', 'Empower', 'Empowered',
  'Ganking', 'Backline', 'Tank', 'Stun', 'Hidden', 'Legion', 'Mighty',
  'Quick-Draw', 'Unique', 'Vision', 'Weaponmaster', 'Equip', 'Equipment',
  'Temporary', 'Buff', 'Spellshield', 'Lifesteal', 'Vanguard', 'Intercept', 'Retaliate',
  'Disarm', 'Deploy', 'Show Off',
];

/** First solid color stop from a KEYWORD_COLORS gradient string, for chips/bars that can't use a CSS gradient. */
export function keywordSolidColor(kw: string): string {
  const gradient = KEYWORD_COLORS[kw.toLowerCase()] || KEYWORD_FALLBACK_COLOR;
  const match = gradient.match(/#[0-9a-fA-F]{3,8}/);
  return match ? match[0] : '#ec4899';
}

/**
 * Formats Riftbound card ability text with styled keywords, energy circles, icons.
 *
 * COLORING RULES:
 * - Only tokens inside [brackets] get styled badges e.g. [Assault 4], [Empower], [>]
 * - Plain text outside brackets is left unstyled
 * - Keywords with a numeric value (e.g. [Empower] [5] or [Assault 4]) are merged into one badge
 * - Rune tokens (:rb_rune_X:) become official inline SVG icons
 * - Energy tokens (:rb_energy_N: or [N]) become numbered indigo circles
 * - :rb_might: / [S] / [M] become the official might SVG glyph
 * - :rb_exhaust: / [T] become the official exhaust SVG glyph
 */
const ONE_PIECE_KEYWORDS: Record<string, string> = {
  rush: 'linear-gradient(135deg,#0284c7,#0369a1)',
  blocker: 'linear-gradient(135deg,#16a34a,#15803d)',
  banish: 'linear-gradient(135deg,#9333ea,#7e22ce)',
  'double attack': 'linear-gradient(135deg,#dc2626,#b91c1c)',
  trigger: 'linear-gradient(135deg,#eab308,#ca8a04)',
  'on play': 'linear-gradient(135deg,#d97706,#b45309)',
  'when attacking': 'linear-gradient(135deg,#d97706,#b45309)',
  'on k.o.': 'linear-gradient(135deg,#475569,#334155)',
  'activate: main': 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
  'once per turn': 'linear-gradient(135deg,#64748b,#475569)',
  'your turn': 'linear-gradient(135deg,#2563eb,#1d4ed8)',
  "opponent's turn": 'linear-gradient(135deg,#dc2626,#991b1b)',
  'end of your turn': 'linear-gradient(135deg,#64748b,#475569)',
  main: 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  counter: 'linear-gradient(135deg,#059669,#047857)',
};

export function formatGameText(text: string | null | undefined): string {
  if (!text) return '';

  // 0a. Map safe, permitted semantic HTML formatting tags (BR, UL, OL, LI, P, B/STRONG, I/EM)
  // to internal placeholders before defensive escaping.
  // This allows official formatted abilities (e.g. Riftbound <br />, <ul><li>...</li></ul>)
  // to render visually while stripping any malicious/unexpected tags and attributes.
  const placeholders: Record<string, string> = {
    '__RB_TAG_BR__': '<br />',
    '__RB_TAG_UL_OPEN__': '<ul class="list-disc pl-5 my-1.5 space-y-1" style="list-style-type:disc; padding-left:1.25rem; margin:0.35rem 0;">',
    '__RB_TAG_UL_CLOSE__': '</ul>',
    '__RB_TAG_OL_OPEN__': '<ol class="list-decimal pl-5 my-1.5 space-y-1" style="list-style-type:decimal; padding-left:1.25rem; margin:0.35rem 0;">',
    '__RB_TAG_OL_CLOSE__': '</ol>',
    '__RB_TAG_LI_OPEN__': '<li class="leading-relaxed" style="margin-bottom:0.2rem;">',
    '__RB_TAG_LI_CLOSE__': '</li>',
    '__RB_TAG_B_OPEN__': '<strong style="color:var(--text-primary); font-weight:800;">',
    '__RB_TAG_B_CLOSE__': '</strong>',
    '__RB_TAG_I_OPEN__': '<em class="italic" style="color:var(--text-secondary);">',
    '__RB_TAG_I_CLOSE__': '</em>',
    '__RB_TAG_P_OPEN__': '<p class="my-1.5" style="margin:0.35rem 0;">',
    '__RB_TAG_P_CLOSE__': '</p>',
  };

  let f = text
    .replace(/(?:<|&lt;)\s*br\s*\/?\s*(?:>|&gt;)/gi, '__RB_TAG_BR__')
    .replace(/(?:<|&lt;)\s*ul(?:\s+[^>]*?)?\s*(?:>|&gt;)/gi, '__RB_TAG_UL_OPEN__')
    .replace(/(?:<|&lt;)\s*\/ul\s*(?:>|&gt;)/gi, '__RB_TAG_UL_CLOSE__')
    .replace(/(?:<|&lt;)\s*ol(?:\s+[^>]*?)?\s*(?:>|&gt;)/gi, '__RB_TAG_OL_OPEN__')
    .replace(/(?:<|&lt;)\s*\/ol\s*(?:>|&gt;)/gi, '__RB_TAG_OL_CLOSE__')
    .replace(/(?:<|&lt;)\s*li(?:\s+[^>]*?)?\s*(?:>|&gt;)/gi, '__RB_TAG_LI_OPEN__')
    .replace(/(?:<|&lt;)\s*\/li\s*(?:>|&gt;)/gi, '__RB_TAG_LI_CLOSE__')
    .replace(/(?:<|&lt;)\s*(?:strong|b)(?:\s+[^>]*?)?\s*(?:>|&gt;)/gi, '__RB_TAG_B_OPEN__')
    .replace(/(?:<|&lt;)\s*\/(?:strong|b)\s*(?:>|&gt;)/gi, '__RB_TAG_B_CLOSE__')
    .replace(/(?:<|&lt;)\s*(?:em|i)(?:\s+[^>]*?)?\s*(?:>|&gt;)/gi, '__RB_TAG_I_OPEN__')
    .replace(/(?:<|&lt;)\s*\/(?:em|i)\s*(?:>|&gt;)/gi, '__RB_TAG_I_CLOSE__')
    .replace(/(?:<|&lt;)\s*p(?:\s+[^>]*?)?\s*(?:>|&gt;)/gi, '__RB_TAG_P_OPEN__')
    .replace(/(?:<|&lt;)\s*\/p\s*(?:>|&gt;)/gi, '__RB_TAG_P_CLOSE__');

  // 0b. Defensive HTML escaping to prevent XSS injection for all remaining raw < and > tags
  f = f
    .replace(/&(?!(?:amp|lt|gt|quot|#39|#x27A4);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Support markdown bold (**bold**) safely
  f = f.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--text-primary); font-weight:800;">$1</strong>');

  // Helper: inline SVG icon from CDN
  const icon = (url: string, title: string, size = 18) =>
    `<img src="${url}" alt="${title}" title="${title}" style="width:${size}px; height:${size}px; display:inline; vertical-align:middle; margin:0 2px; image-rendering:auto;" />`;

  // Helper: numeric energy circle
  const numCircle = (n: string) =>
    `<span style="display:inline-flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#4f46e5,#6366f1); color:#fff; border:1px solid #818cf8; border-radius:50%; width:18px; height:18px; font-size:10px; font-weight:900; margin:0 2px; vertical-align:middle; box-shadow:0 0 6px rgba(99,102,241,0.5);">${n}</span>`;

  // Helper: keyword pill with context color
  const pill = (kw: string, val?: string, customBg?: string) => {
    const key = kw.toLowerCase();
    const bg = customBg || KEYWORD_COLORS[key] || KEYWORD_FALLBACK_COLOR;
    const label = val ? `${kw.toUpperCase()} ${val}` : kw.toUpperCase();
    return `<span style="display:inline-flex; align-items:center; background:${bg}; color:#fff; font-weight:900; font-size:11px; letter-spacing:0.04em; padding:2px 7px; border-radius:5px; margin:0 2px; text-transform:uppercase; vertical-align:middle; white-space:nowrap;">${label}</span>`;
  };

  // 1. Runes - inline SVG icons (before energy to avoid eating rune numbers)
  f = f.replace(/:rb_rune_([a-zA-Z]+):/g, (_: string, rune: string) => {
    const key = (`rune_${rune.toLowerCase()}`) as keyof typeof GLYPH_ICONS;
    const url = GLYPH_ICONS[key] || GLYPH_ICONS.rune;
    return icon(url, `${rune} Rune`, 18);
  });

  // 2. Energy circles
  f = f.replace(/:rb_energy_(\d+):/g, (_: string, n: string) => numCircle(n));

  // 3. Might and Exhaust - official SVG glyphs (no emoji)
  f = f.replace(/:rb_might:|\[S\]|\[M\]/g, icon(GLYPH_ICONS.might, 'Might', 18));
  f = f.replace(/:rb_exhaust:|\[T\]/g, icon(GLYPH_ICONS.exhaust, 'Exhaust', 18));

  // 4. Arrow [>] / [>>] / [&gt;] / [&gt;&gt;]
  f = f.replace(/\[(?:&gt;|>){1,2}\]/g, `<span style="color:var(--text-muted); font-weight:900; margin:0 3px; vertical-align:middle;">&#x27A4;</span>`);

  // 5. [Action] / [Reaction] tags
  f = f.replace(/\[Action\]/gi, `<span style="display:inline-flex; align-items:center; background:rgba(234,179,8,0.18); color:#facc15; border:1px solid rgba(234,179,8,0.4); font-size:11px; font-weight:900; letter-spacing:0.05em; text-transform:uppercase; padding:1px 7px; border-radius:5px; margin:0 2px; vertical-align:middle;">Action</span>`);
  f = f.replace(/\[Reaction\]/gi, `<span style="display:inline-flex; align-items:center; background:rgba(6,182,212,0.18); color:#22d3ee; border:1px solid rgba(6,182,212,0.4); font-size:11px; font-weight:900; letter-spacing:0.05em; text-transform:uppercase; padding:1px 7px; border-radius:5px; margin:0 2px; vertical-align:middle;">Reaction</span>`);

  // 6. Generic rune placeholders [A] = any rune, [C] = domain rune
  f = f.replace(/\[A\]/g, icon(GLYPH_ICONS.rune, 'Any Rune', 18));
  f = f.replace(/\[C\]/g, icon(GLYPH_ICONS.rune, 'Domain Rune', 18));

  // 7. Flesh and Blood game symbols
  f = f.replace(/\{p\}/gi, `<span style="display:inline-flex; align-items:center; justify-content:center; background:#dc2626; color:#fff; border-radius:4px; font-weight:900; font-size:10px; padding:1px 5px; margin:0 2px; vertical-align:middle;" title="Attack Power">ATK</span>`);
  f = f.replace(/\{d\}/gi, `<span style="display:inline-flex; align-items:center; justify-content:center; background:#2563eb; color:#fff; border-radius:4px; font-weight:900; font-size:10px; padding:1px 5px; margin:0 2px; vertical-align:middle;" title="Defense">DEF</span>`);
  f = f.replace(/\{r\}/gi, `<span style="display:inline-flex; align-items:center; justify-content:center; background:#eab308; color:#000; border-radius:50%; font-weight:900; font-size:10px; width:17px; height:17px; margin:0 2px; vertical-align:middle;" title="Resource Pitch">R</span>`);
  f = f.replace(/\{h\}/gi, `<span style="display:inline-flex; align-items:center; justify-content:center; background:#16a34a; color:#fff; border-radius:4px; font-weight:900; font-size:10px; padding:1px 5px; margin:0 2px; vertical-align:middle;" title="Life / Health">HP</span>`);

  // 8. Star Wars: Unlimited symbols: {C=1}, {Exhaust}
  f = f.replace(/\{C=(\d+)\}/gi, (_: string, n: string) =>
    `<span style="display:inline-flex; align-items:center; justify-content:center; background:var(--accent-strong); color:var(--text-on-accent, #000); border-radius:50%; width:18px; height:18px; font-size:10px; font-weight:900; margin:0 2px; vertical-align:middle;" title="Cost ${n}">${n}</span>`
  );
  f = f.replace(/\{(?:Exhaust|exhaust)\}/g, `<span style="display:inline-flex; align-items:center; justify-content:center; background:var(--bg-raised); border:1px solid var(--border); color:var(--text-secondary); border-radius:4px; font-size:10px; font-weight:900; padding:1px 5px; margin:0 2px; vertical-align:middle;" title="Exhaust">Exhaust</span>`);

  // 9. Disney Lorcana symbols and ability headers
  f = f.replace(/\{E\}|\[E\]/g, `<span style="display:inline-flex; align-items:center; justify-content:center; background:var(--bg-raised); border:1px solid var(--border); color:var(--text-secondary); border-radius:4px; font-size:10px; font-weight:900; padding:1px 5px; margin:0 2px; vertical-align:middle;" title="Exert">Exert</span>`);
  f = f.replace(/\{L\}|\[L\]/g, `<span style="display:inline-flex; align-items:center; justify-content:center; background:#eab308; color:#000; border-radius:4px; font-size:10px; font-weight:900; padding:1px 5px; margin:0 2px; vertical-align:middle;" title="Lore">Lore</span>`);
  f = f.replace(/\{I\}|\[I\]/g, `<span style="display:inline-flex; align-items:center; justify-content:center; background:#6366f1; color:#fff; border-radius:4px; font-size:10px; font-weight:900; padding:1px 5px; margin:0 2px; vertical-align:middle;" title="Ink">Ink</span>`);

  // Lorcana uppercase ability titles (e.g. "TRAINING EXERCISES", "BIGGEST FAN:", "A GREATER PURPOSE")
  f = f.replace(/(?:^|\n)([A-Z][A-Z0-9',!? -]{2,40})(?:\s*[:—–-]\s*|\s+(?=[A-Z][a-z]))/gm, (match: string, title: string) => {
    const trimmed = title.trim();
    if (trimmed.startsWith('DON!!') || trimmed === 'THE' || trimmed === 'AND' || trimmed === 'FOR') return match;
    return `<span style="display:inline-block; font-weight:900; letter-spacing:0.04em; text-transform:uppercase; color:#f59e0b; background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.35); border-radius:4px; padding:1px 6px; margin:0 4px 0 0; font-size:11px; vertical-align:middle;">${trimmed}</span> `;
  });

  // Lorcana core keywords
  const LORCANA_KEYWORDS = [
    'Bodyguard', 'Evasive', 'Rush', 'Ward', 'Support', 'Reckless',
    'Shift(?: \\d+)?', 'Singer(?: \\d+)?', 'Challenger(?: \\+\\d+)?', 'Resist(?: \\+\\d+)?'
  ];
  const lorcanaKwRegex = new RegExp(`\\b(${LORCANA_KEYWORDS.join('|')})\\b`, 'gi');
  f = f.replace(lorcanaKwRegex, (_: string, kw: string) =>
    `<span style="display:inline-flex; align-items:center; background:rgba(99,102,241,0.18); color:#818cf8; border:1px solid rgba(99,102,241,0.35); font-weight:800; font-size:11px; padding:0 5px; border-radius:4px; margin:0 2px; vertical-align:middle;">${kw}</span>`
  );

  // 10. One Piece DON!! modifiers: [DON!! x1], [DON!! -1]
  f = f.replace(/\[DON!!\s*([x\-]?\d+)\]/gi, (_: string, val: string) =>
    `<span style="display:inline-flex; align-items:center; background:linear-gradient(135deg,#ea580c,#c2410c); color:#fff; font-weight:900; font-size:10px; padding:1px 6px; border-radius:4px; margin:0 2px; vertical-align:middle; text-transform:uppercase;">DON!! ${val}</span>`
  );

  // 11. One Piece keyword triggers (Rush, Blocker, When Attacking, On Play, etc.)
  const opKwKeys = Object.keys(ONE_PIECE_KEYWORDS).join('|');
  const opRegex = new RegExp(`\\[(${opKwKeys})\\]`, 'gi');
  f = f.replace(opRegex, (_: string, kw: string) => {
    const bg = ONE_PIECE_KEYWORDS[kw.toLowerCase()] || KEYWORD_FALLBACK_COLOR;
    return `<span style="display:inline-flex; align-items:center; background:${bg}; color:#fff; font-weight:900; font-size:10px; letter-spacing:0.04em; padding:1px 6px; border-radius:4px; margin:0 2px; text-transform:uppercase; vertical-align:middle; white-space:nowrap;">${kw.toUpperCase()}</span>`;
  });

  // 12. Standalone number-in-brackets [0]-[12] (energy costs, not part of keywords)
  f = f.replace(/\[(\d{1,2})\]/g, (_: string, n: string) => numCircle(n));

  // 13. Riftbound keywords inside [brackets]
  const kwBracketRe = new RegExp(
    `\\[(${KEYWORD_LIST.join('|')})(?: (\\d+))?\\](?:\\s*\\[(\\d+)\\])?`,
    'gi'
  );
  f = f.replace(kwBracketRe, (_: string, kw: string, inlineVal: string, separateVal: string) => {
    const val = inlineVal || separateVal;
    return pill(kw, val);
  });

  // 14. Restore safe semantic HTML formatting tags (BR, LI, UL, OL, P, B, I)
  for (const [placeholder, html] of Object.entries(placeholders)) {
    f = f.replaceAll(placeholder, html);
  }

  return f;
}

/**
 * Splits a card name into primary name and secondary subtitle/title.
 * Handles the card name formats:
 * - "Ahri - Alluring"
 * - "Akali, Silent", "Azir, Ascendant", "Lillia, Fae Fawn"
 */
export function splitCardTitle(name?: string | null): { main: string; sub?: string } {
  if (!name) return { main: '' };

  const dashParts = name.split(/\s+[—–-]\s+/);
  if (dashParts.length > 1) {
    return { main: dashParts[0].trim(), sub: dashParts.slice(1).join(' — ').trim() };
  }

  const commaIdx = name.indexOf(', ');
  if (commaIdx !== -1) {
    return {
      main: name.slice(0, commaIdx).trim(),
      sub: name.slice(commaIdx + 2).trim(),
    };
  }

  return { main: name.trim() };
}

/**
 * Strips set prefix codes from card numbers (e.g. "VEN-019a" -> "019a", "SFD-050/221" -> "050/221").
 */
export function formatCleanCardNumber(cardNumber?: string | null): string {
  if (!cardNumber) return '';
  return cardNumber.replace(/^[A-Za-z0-9]+-([0-9])/, '$1');
}
