import { SETS, RARITIES, TYPES, DOMAINS, TAGS } from './constants';
import { findSearchableKeyword, cardMatchesSearchTag } from './keywordSearch';

export interface SearchCommandDef {
  key: string;
  aliases: string[];
  label: string;
  labelHu: string;
  description: string;
  descriptionHu: string;
  example: string;
  category: 'text' | 'attribute' | 'stats';
  suggestedValues?: Array<{ value: string; label?: string; labelHu?: string }>;
}

export const SEARCH_COMMAND_DEFS: SearchCommandDef[] = [
  {
    key: 'text',
    aliases: ['t', 'flavor', 'ability', 'oracle', 'o'],
    label: 'Text / Ability',
    labelHu: 'Szöveg / Képesség',
    description: 'Search card abilities, rules & flavor text',
    descriptionHu: 'Keresés a képesség-, szabály- és háttérszövegben',
    example: 'text:gold',
    category: 'text',
    suggestedValues: [
      { value: 'gold', label: 'Gold (gear token / wager)', labelHu: 'Gold (arany jelző / tét)' },
      { value: 'draw', label: 'Draw cards', labelHu: 'Kártyahúzás' },
      { value: 'strike', label: 'Strike / combat', labelHu: 'Ütés / harc' },
      { value: 'exhaust', label: 'Exhaust effects', labelHu: 'Kimerítés hatások' },
      { value: 'hold', label: 'When I hold', labelHu: 'Megtartási képességek' },
      { value: 'conquer', label: 'When I conquer', labelHu: 'Hódítási képességek' },
      { value: 'accelerate', label: 'Accelerate', labelHu: 'Gyorsítás' },
      { value: 'shield', label: 'Shield', labelHu: 'Pajzs' },
      { value: 'equip', label: 'Equip', labelHu: 'Felszerelés' },
      { value: 'deathknell', label: 'Deathknell', labelHu: 'Halálharang' },
    ],
  },
  {
    key: 'name',
    aliases: ['n'],
    label: 'Card Name',
    labelHu: 'Kártyanév',
    description: 'Filter specifically by card title',
    descriptionHu: 'Szűrés kártyanév szerint',
    example: 'name:Ahri',
    category: 'attribute',
  },
  {
    key: 'set',
    aliases: ['s'],
    label: 'Set',
    labelHu: 'Készlet',
    description: 'Filter by set code or name',
    descriptionHu: 'Szűrés készletkód vagy név szerint',
    example: 'set:rad',
    category: 'attribute',
    suggestedValues: [
      { value: 'rad', label: 'Radiance (RAD)', labelHu: 'Radiance (RAD)' },
      { value: 'ven', label: 'Vendetta (VEN)', labelHu: 'Vendetta (VEN)' },
      { value: 'unl', label: 'Unleashed (UNL)', labelHu: 'Unleashed (UNL)' },
      { value: 'sfg', label: 'Spiritforged (SFG)', labelHu: 'Spiritforged (SFG)' },
      { value: 'ogn', label: 'Origins (OGN)', labelHu: 'Origins (OGN)' },
      { value: 'promo', label: 'Promos / Proving Grounds', labelHu: 'Promók / Proving Grounds' },
    ],
  },
  {
    key: 'type',
    aliases: [],
    label: 'Card Type',
    labelHu: 'Kártyatípus',
    description: 'Filter by type or subtype',
    descriptionHu: 'Szűrés típus vagy altípus szerint',
    example: 'type:signature',
    category: 'attribute',
    suggestedValues: [
      { value: 'unit', label: 'Unit', labelHu: 'Egység' },
      { value: 'champion', label: 'Champion', labelHu: 'Bajnok' },
      { value: 'spell', label: 'Spell', labelHu: 'Varázslat' },
      { value: 'signature', label: 'Signature (Spell/Gear/Unit)', labelHu: 'Aláírás (Varázslat/Felszerelés/Egység)' },
      { value: 'gear', label: 'Gear', labelHu: 'Felszerelés' },
      { value: 'legend', label: 'Legend', labelHu: 'Legenda' },
      { value: 'battlefield', label: 'Battlefield', labelHu: 'Csatamező' },
      { value: 'rune', label: 'Rune', labelHu: 'Rúna' },
      { value: 'token', label: 'Token', labelHu: 'Jelző' },
    ],
  },
  {
    key: 'rarity',
    aliases: ['r'],
    label: 'Rarity',
    labelHu: 'Ritkaság',
    description: 'Filter by card rarity',
    descriptionHu: 'Szűrés ritkaság szerint',
    example: 'rarity:epic',
    category: 'attribute',
    suggestedValues: [
      { value: 'common', label: 'Common', labelHu: 'Gyakori (Common)' },
      { value: 'uncommon', label: 'Uncommon', labelHu: 'Nem gyakori (Uncommon)' },
      { value: 'rare', label: 'Rare', labelHu: 'Ritka (Rare)' },
      { value: 'epic', label: 'Epic', labelHu: 'Epikus (Epic)' },
      { value: 'showcase', label: 'Showcase', labelHu: 'Showcase' },
    ],
  },
  {
    key: 'domain',
    aliases: ['d', 'color', 'c'],
    label: 'Domain / Color',
    labelHu: 'Domén / Szín',
    description: 'Filter by rune domain or color',
    descriptionHu: 'Szűrés domén vagy szín szerint',
    example: 'domain:fury',
    category: 'attribute',
    suggestedValues: [
      { value: 'fury', label: 'Fury (Piros)', labelHu: 'Fury (Piros)' },
      { value: 'calm', label: 'Calm (Zöld)', labelHu: 'Calm (Zöld)' },
      { value: 'mind', label: 'Mind (Kék)', labelHu: 'Mind (Kék)' },
      { value: 'body', label: 'Body (Narancs)', labelHu: 'Body (Narancs)' },
      { value: 'chaos', label: 'Chaos (Lila)', labelHu: 'Chaos (Lila)' },
      { value: 'order', label: 'Order (Sárga)', labelHu: 'Order (Sárga)' },
      { value: 'colorless', label: 'Colorless (Színtelen)', labelHu: 'Colorless (Színtelen)' },
    ],
  },
  {
    key: 'artist',
    aliases: ['a'],
    label: 'Artist',
    labelHu: 'Művész',
    description: 'Filter by illustrator name',
    descriptionHu: 'Szűrés illusztrátor szerint',
    example: 'artist:sixmorevodka',
    category: 'attribute',
  },
  {
    key: 'tag',
    aliases: [],
    label: 'Tag / Faction',
    labelHu: 'Címke / Frakció',
    description: 'Filter by champion tag or region',
    descriptionHu: 'Szűrés bajnok vagy régió címke szerint',
    example: 'tag:annie',
    category: 'attribute',
    suggestedValues: [
      { value: 'annie', label: 'Annie' },
      { value: 'ahri', label: 'Ahri' },
      { value: 'ionia', label: 'Ionia' },
      { value: 'piltover', label: 'Piltover' },
      { value: 'demacia', label: 'Demacia' },
      { value: 'noxus', label: 'Noxus' },
      { value: 'shadow isles', label: 'Shadow Isles' },
      { value: 'freljord', label: 'Freljord' },
    ],
  },
  {
    key: 'cost',
    aliases: [],
    label: 'Cost / Energy',
    labelHu: 'Költség / Energia',
    description: 'Filter by energy cost (=, >, <, >=, <=)',
    descriptionHu: 'Szűrés energiaköltség szerint',
    example: 'cost:>3',
    category: 'stats',
  },
  {
    key: 'might',
    aliases: ['m'],
    label: 'Might',
    labelHu: 'Erő',
    description: 'Filter by might stat (=, >, <, >=, <=)',
    descriptionHu: 'Szűrés erőérték szerint',
    example: 'might:5',
    category: 'stats',
  },
  {
    key: 'power',
    aliases: ['p'],
    label: 'Power Requirement',
    labelHu: 'Rúnaerő követelmény',
    description: 'Filter by rune power cost',
    descriptionHu: 'Szűrés rúnaerő követelmény szerint',
    example: 'power:2',
    category: 'stats',
  },
];

/** Canonical map lookup for commands (e.g. 't' -> 'text') */
const COMMAND_CANONICAL_MAP = new Map<string, string>();
SEARCH_COMMAND_DEFS.forEach((def) => {
  COMMAND_CANONICAL_MAP.set(def.key.toLowerCase(), def.key);
  def.aliases.forEach((alias) => COMMAND_CANONICAL_MAP.set(alias.toLowerCase(), def.key));
});

export interface NumericComparison {
  op: '=' | '>' | '<' | '>=' | '<=';
  val: number;
}

export interface CardSearchCommand {
  canonicalKey: string;
  rawKey: string;
  value: string;
  operator: string;
}

export interface ParsedCardSearch {
  raw: string;
  hasCommands: boolean;
  plainQuery: string;
  commands: CardSearchCommand[];
  textKeywords: string[];
  nameKeywords: string[];
  setKeywords: string[];
  typeKeywords: string[];
  rarityKeywords: string[];
  domainKeywords: string[];
  artistKeywords: string[];
  tagKeywords: string[];
  costFilters: NumericComparison[];
  mightFilters: NumericComparison[];
  powerFilters: NumericComparison[];
}

function parseNumericComparison(raw: string): NumericComparison | null {
  const match = raw.trim().match(/^([><]=?|=)?\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const op = (match[1] || '=') as NumericComparison['op'];
  const val = parseFloat(match[2]);
  if (isNaN(val)) return null;
  return { op, val };
}

export function parseCardSearch(input: string): ParsedCardSearch {
  const raw = (input || '').trim();
  if (!raw) {
    return {
      raw: '',
      hasCommands: false,
      plainQuery: '',
      commands: [],
      textKeywords: [],
      nameKeywords: [],
      setKeywords: [],
      typeKeywords: [],
      rarityKeywords: [],
      domainKeywords: [],
      artistKeywords: [],
      tagKeywords: [],
      costFilters: [],
      mightFilters: [],
      powerFilters: [],
    };
  }

  // Regex matches key:value or key:="value with spaces" or key>3
  // Captures: 1: key, 2: op (:|>=|<=|>|<|=), 3: full quoted or unquoted val, 4: double-quote content, 5: single-quote content, 6: unquoted content
  const regex = /\b([a-zA-Z]+)([:><]=?|=)(?:"([^"]*)"|'([^']*)'|([^\s]*))/g;
  const commands: CardSearchCommand[] = [];
  let remainingText = raw;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const rawKey = match[1].toLowerCase();
    const canonicalKey = COMMAND_CANONICAL_MAP.get(rawKey);
    if (!canonicalKey) {
      // Not a recognized command, skip
      continue;
    }

    const operator = match[2];
    const value = (match[3] ?? match[4] ?? match[5] ?? '').trim();
    if (!value && operator === ':') continue;

    commands.push({
      canonicalKey,
      rawKey,
      value,
      operator,
    });

    // Remove the full matched command substring from remaining text
    remainingText = remainingText.replace(match[0], ' ');
  }

  const plainQuery = remainingText.replace(/\s+/g, ' ').trim();

  const textKeywords: string[] = [];
  const nameKeywords: string[] = [];
  const setKeywords: string[] = [];
  const typeKeywords: string[] = [];
  const rarityKeywords: string[] = [];
  const domainKeywords: string[] = [];
  const artistKeywords: string[] = [];
  const tagKeywords: string[] = [];
  const costFilters: NumericComparison[] = [];
  const mightFilters: NumericComparison[] = [];
  const powerFilters: NumericComparison[] = [];

  for (const cmd of commands) {
    const v = cmd.value;
    switch (cmd.canonicalKey) {
      case 'text':
        if (v) textKeywords.push(v);
        break;
      case 'name':
        if (v) nameKeywords.push(v);
        break;
      case 'set':
        if (v) setKeywords.push(v);
        break;
      case 'type':
        if (v) typeKeywords.push(v.toLowerCase());
        break;
      case 'rarity':
        if (v) rarityKeywords.push(v.toLowerCase());
        break;
      case 'domain':
        if (v) domainKeywords.push(v.toLowerCase());
        break;
      case 'artist':
        if (v) artistKeywords.push(v);
        break;
      case 'tag':
        if (v) tagKeywords.push(v);
        break;
      case 'cost': {
        const fullOpVal = (cmd.operator !== ':' ? cmd.operator : '') + v;
        const comp = parseNumericComparison(fullOpVal);
        if (comp) costFilters.push(comp);
        break;
      }
      case 'might': {
        const fullOpVal = (cmd.operator !== ':' ? cmd.operator : '') + v;
        const comp = parseNumericComparison(fullOpVal);
        if (comp) mightFilters.push(comp);
        break;
      }
      case 'power': {
        const fullOpVal = (cmd.operator !== ':' ? cmd.operator : '') + v;
        const comp = parseNumericComparison(fullOpVal);
        if (comp) powerFilters.push(comp);
        break;
      }
    }
  }

  return {
    raw,
    hasCommands: commands.length > 0,
    plainQuery,
    commands,
    textKeywords,
    nameKeywords,
    setKeywords,
    typeKeywords,
    rarityKeywords,
    domainKeywords,
    artistKeywords,
    tagKeywords,
    costFilters,
    mightFilters,
    powerFilters,
  };
}

function compareNumeric(val: number | null | undefined, comp: NumericComparison): boolean {
  if (val == null || isNaN(val)) return false;
  switch (comp.op) {
    case '=': return val === comp.val;
    case '>': return val > comp.val;
    case '<': return val < comp.val;
    case '>=': return val >= comp.val;
    case '<=': return val <= comp.val;
    default: return val === comp.val;
  }
}

/**
 * Client-side card matcher for searches supporting commands and plain terms.
 */
export function cardMatchesSearch(card: any, search: string | ParsedCardSearch): boolean {
  if (!card) return false;
  const parsed = typeof search === 'string' ? parseCardSearch(search) : search;
  if (!parsed.raw) return true;

  // 1. Text commands (ability, text, effect)
  if (parsed.textKeywords.length > 0) {
    const haystacks = [
      card.ability || '',
      card.text || '',
      card.effect || '',
    ].map(s => String(s).toLowerCase());
    const matchesAllText = parsed.textKeywords.every(kw => {
      const q = kw.toLowerCase();
      return haystacks.some(h => h.includes(q));
    });
    if (!matchesAllText) return false;
  }

  // 2. Name command
  if (parsed.nameKeywords.length > 0) {
    const cardName = (card.name || '').toLowerCase();
    const matchesAllName = parsed.nameKeywords.every(kw => cardName.includes(kw.toLowerCase()));
    if (!matchesAllName) return false;
  }

  // 3. Set command
  if (parsed.setKeywords.length > 0) {
    const setName = (card.set_name || card.sets?.name || '').toLowerCase();
    const setCode = (card.set_code || card.sets?.code || '').toLowerCase();
    const cardNum = (card.card_number || '').toLowerCase();
    const matchesAllSets = parsed.setKeywords.every(kw => {
      const q = kw.toLowerCase();
      return setName.includes(q) || setCode.includes(q) || cardNum.startsWith(q);
    });
    if (!matchesAllSets) return false;
  }

  // 4. Type command
  if (parsed.typeKeywords.length > 0) {
    const cType = (card.card_type || '').toLowerCase();
    const cSub = (card.subtype || '').toLowerCase();
    const matchesAllTypes = parsed.typeKeywords.every(kw => {
      if (kw === 'champion') return cSub === 'champion' || cType === 'champion';
      if (kw === 'signature') return cSub.includes('signature');
      if (kw === 'token') return cType === 'token' || cSub.includes('token');
      return cType.includes(kw) || cSub.includes(kw);
    });
    if (!matchesAllTypes) return false;
  }

  // 5. Rarity command
  if (parsed.rarityKeywords.length > 0) {
    const cRarity = (card.rarity || '').toLowerCase();
    const matchesAllRarities = parsed.rarityKeywords.every(kw => cRarity.includes(kw));
    if (!matchesAllRarities) return false;
  }

  // 6. Domain command
  if (parsed.domainKeywords.length > 0) {
    const cDomain = (card.domain || '').toLowerCase();
    const matchesAllDomains = parsed.domainKeywords.every(kw => cDomain.includes(kw));
    if (!matchesAllDomains) return false;
  }

  // 7. Artist command
  if (parsed.artistKeywords.length > 0) {
    const cArtist = (card.artist || '').toLowerCase();
    const matchesAllArtists = parsed.artistKeywords.every(kw => cArtist.includes(kw.toLowerCase()));
    if (!matchesAllArtists) return false;
  }

  // 8. Tag command
  if (parsed.tagKeywords.length > 0) {
    const matchesAllTags = parsed.tagKeywords.every(kw => cardMatchesSearchTag(card, kw));
    if (!matchesAllTags) return false;
  }

  // 9. Cost / Might / Power filters
  if (parsed.costFilters.length > 0) {
    const costVal = card.cost != null ? parseInt(String(card.cost), 10) : null;
    if (!parsed.costFilters.every(comp => compareNumeric(costVal, comp))) return false;
  }
  if (parsed.mightFilters.length > 0) {
    const mightVal = card.might != null ? parseInt(String(card.might), 10) : null;
    if (!parsed.mightFilters.every(comp => compareNumeric(mightVal, comp))) return false;
  }
  if (parsed.powerFilters.length > 0) {
    const powerVal = card.energy != null ? parseInt(String(card.energy), 10) : null;
    if (!parsed.powerFilters.every(comp => compareNumeric(powerVal, comp))) return false;
  }

  // 10. Plain text remainder
  if (parsed.plainQuery) {
    const q = parsed.plainQuery.toLowerCase();
    const nameMatch = (card.name || '').toLowerCase().includes(q);
    const numMatch = (card.card_number || '').toLowerCase().includes(q);
    const artistMatch = (card.artist || '').toLowerCase().includes(q);
    const tagMatch = cardMatchesSearchTag(card, q);
    const keyword = findSearchableKeyword(q);
    const keywordMatch = Boolean(
      keyword &&
      ((card.ability || '').toLowerCase().includes(keyword.toLowerCase()) ||
       (card.text || '').toLowerCase().includes(keyword.toLowerCase()) ||
       (card.effect || '').toLowerCase().includes(keyword.toLowerCase()))
    );

    if (!nameMatch && !numMatch && !artistMatch && !tagMatch && !keywordMatch) {
      return false;
    }
  }

  return true;
}

/** Suggestion item for IntelliSense */
export interface IntelliSenseSuggestion {
  id: string;
  insertText: string;
  displayText: string;
  description: string;
  badge?: string;
  category: 'command' | 'value';
  commandKey?: string;
}

/**
 * Computes autocomplete suggestions based on the user's cursor position in the search bar.
 */
export function getIntelliSenseSuggestions(
  input: string,
  cursorIndex: number,
  lang: 'en' | 'hu' = 'en'
): {
  suggestions: IntelliSenseSuggestion[];
  tokenStart: number;
  tokenEnd: number;
  activeToken: string;
} {
  const isHu = lang === 'hu';
  const textBeforeCursor = input.slice(0, cursorIndex);

  // Find the token under the cursor (delimited by whitespace or start of string)
  const tokenMatch = textBeforeCursor.match(/(?:^|\s)([^\s]*)$/);
  const activeToken = tokenMatch ? tokenMatch[1] : '';
  const tokenStart = tokenMatch ? cursorIndex - activeToken.length : cursorIndex;
  const tokenEnd = cursorIndex;

  // Case 1: Cursor is typing after a colon (e.g. "type:" or "type:sp" or "s:" or "text:go")
  const colonIdx = activeToken.indexOf(':');
  if (colonIdx !== -1) {
    const rawPrefix = activeToken.slice(0, colonIdx).toLowerCase();
    const valPrefix = activeToken.slice(colonIdx + 1).toLowerCase();
    const canonicalKey = COMMAND_CANONICAL_MAP.get(rawPrefix);

    if (canonicalKey) {
      const def = SEARCH_COMMAND_DEFS.find(d => d.key === canonicalKey);
      if (def?.suggestedValues && def.suggestedValues.length > 0) {
        const filtered = def.suggestedValues.filter(v =>
          !valPrefix || v.value.toLowerCase().includes(valPrefix) || (v.label && v.label.toLowerCase().includes(valPrefix))
        );

        return {
          suggestions: filtered.map(item => ({
            id: `${canonicalKey}:${item.value}`,
            insertText: `${rawPrefix}:${item.value} `,
            displayText: `${rawPrefix}:${item.value}`,
            description: isHu ? (item.labelHu || item.label || '') : (item.label || ''),
            badge: def.key,
            category: 'value',
            commandKey: canonicalKey,
          })),
          tokenStart,
          tokenEnd,
          activeToken,
        };
      }
    }
  }

  // Case 2: Cursor is typing a command prefix (e.g. "t", "tex", "set", "r", or empty)
  const query = activeToken.toLowerCase().replace(/:$/, '');
  const filteredDefs = SEARCH_COMMAND_DEFS.filter(def => {
    if (!query) return true;
    if (def.key.startsWith(query)) return true;
    if (def.aliases.some(a => a.startsWith(query))) return true;
    return false;
  });

  return {
    suggestions: filteredDefs.map(def => ({
      id: def.key,
      insertText: `${def.key}:`,
      displayText: `${def.key}:`,
      description: isHu ? def.descriptionHu : def.description,
      badge: def.example,
      category: 'command',
      commandKey: def.key,
    })),
    tokenStart,
    tokenEnd,
    activeToken,
  };
}
