/**
 * Pure mapping and filtering helpers for Riftbound catalog sync
 * (playriftbound.com official sets + riftbound.gg / dotgg non-base special sets).
 */

export const OFFICIAL_TO_DB_SET_CODE: Record<string, string> = {
  OGN: 'OGN',
  SFD: 'SPI',
  UNL: 'UNL',
  VEN: 'VEN',
  RAD: 'RAD',
  OGS: 'PRO',
};

/** Main/base sets synced from playriftbound.com; excluded when pulling special sets from riftbound.gg. */
export const DOTGG_EXCLUDED_BASE_SETS = new Set([
  'origins',
  'proving grounds',
  'spiritforged',
  'unleashed',
  'vendetta',
  'radiance',
  'promo',
]);

const KNOWN_SPECIAL_SET_CODES: Record<string, string> = {
  'k/da couture collection': 'KDA',
  't1 2025 worlds champion collection': 'T1W',
  'secret garden set': 'SGN',
  'arcane box set': 'ARC',
};

export interface DotggRawCard {
  id: string;
  name?: string | null;
  effect?: string | null;
  flavor?: string | null;
  color?: string[] | string | null;
  cost?: string | number | null;
  type?: string[] | string | null;
  might?: string | number | null;
  mightBonus?: string | number | null;
  tags?: string[] | null;
  set_name?: string | null;
  rarity?: string | null;
  image?: string | null;
  promo?: string | number | boolean | null;
  cmid?: string | number | null;
}

export function htmlToPlainText(html: string | null | undefined): string {
  return String(html || '')
    .replace(/<\/p>\s*<p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function cleanOfficialAbility(html: string | null | undefined): string | null {
  const cleaned = String(html || '')
    .replace(/<\/p>\s*<p>/gi, '<br />')
    .replace(/<\/?p>/gi, '')
    .replace(/<br\s*\/?>/gi, '<br />')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function cleanDotggEffect(html: string | null | undefined): string | null {
  const cleaned = String(html || '')
    .replace(/<br\s*\/?>/gi, '<br />')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Generates candidate uppercase lookup keys so collector numbers like "RAD-SP1/005"
 * cleanly match existing DB rows stored as "RAD-SP1" (or vice versa).
 */
export function normalizeCardMatchKeys(cardNumber: string | null | undefined): string[] {
  const exact = String(cardNumber || '').trim().toUpperCase();
  if (!exact) return [];
  const keys = [exact];
  if (exact.includes('/')) {
    const base = exact.split('/')[0].trim();
    if (base && !keys.includes(base)) keys.push(base);
  }
  return keys;
}

/**
 * Returns true only for non-base special collector/promo sets on riftbound.gg
 * (e.g. K/DA Couture Collection, T1 2025 Worlds Champion Collection, Secret Garden Set, Arcane Box Set).
 * Main sets (Origins, Proving Grounds, Spiritforged, Unleashed, Vendetta, Radiance) come from playriftbound.com.
 */
export function isDotggSpecialSetCard(card: DotggRawCard | null | undefined): boolean {
  if (!card || !card.id || !card.set_name) return false;
  const normalizedSet = String(card.set_name).trim().toLowerCase();
  if (!normalizedSet) return false;
  return !DOTGG_EXCLUDED_BASE_SETS.has(normalizedSet);
}

export function deriveSpecialSetCode(setName: string, sampleCardNumber?: string | null): string {
  const known = KNOWN_SPECIAL_SET_CODES[setName.trim().toLowerCase()];
  if (known) return known;
  const prefixMatch = String(sampleCardNumber || '').trim().toUpperCase().match(/^([A-Z0-9]{2,5})-/);
  if (prefixMatch) return prefixMatch[1];
  const letters = setName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (letters.slice(0, 4) || 'SPL');
}

export function mapOfficialCard(c: any, setId: string, existing?: { image_path?: string | null; ability?: string | null } | null) {
  const cardType = c.cardType?.type?.[0]?.label || 'Unit';
  const rarity = c.rarity?.value?.label || 'Common';
  const domains = Array.isArray(c.domain?.values)
    ? c.domain.values.map((d: any) => d?.label).filter(Boolean).join(', ')
    : null;
  const artists = Array.isArray(c.illustrator?.values)
    ? c.illustrator.values.map((a: any) => a?.label).filter(Boolean).join(', ')
    : null;
  const energy = c.energy?.value?.id ?? (c.energy?.value?.label ? Number(c.energy.value.label) : null);
  const might = c.might?.value?.id ?? (c.might?.value?.label ? String(c.might.value.label) : null);
  const tags = Array.isArray(c.tags?.tags)
    ? c.tags.tags.map((t: any) => (typeof t === 'string' ? t : t?.label || t?.name)).filter(Boolean)
    : Array.isArray(c.tags)
    ? c.tags.map((t: any) => (typeof t === 'string' ? t : t?.label || t?.name)).filter(Boolean)
    : [];
  const ability = cleanOfficialAbility(c.text?.richText?.body) || existing?.ability || null;

  const hasCustomR2 = existing?.image_path && !String(existing.image_path).startsWith('http');
  const imagePath = hasCustomR2 ? existing.image_path : (c.cardImage?.url || existing?.image_path || null);

  return {
    set_id: setId,
    card_number: String(c.publicCode).trim(),
    name: String(c.name || '').trim(),
    rarity,
    card_type: cardType,
    cost: typeof energy === 'number' && !Number.isNaN(energy) ? energy : 0,
    energy: energy !== null && energy !== undefined ? String(energy) : null,
    might: might !== null && might !== undefined ? String(might) : null,
    domain: domains || null,
    tags: tags.length > 0 ? tags : null,
    ability,
    artist: artists || null,
    image_path: imagePath,
    game: 'riftbound',
    is_archived: false,
  };
}

export function mapDotggSpecialCard(
  c: DotggRawCard,
  setId: string,
  existing?: { image_path?: string | null; metadata?: Record<string, any> | null; text?: string | null; ability?: string | null } | null
) {
  const cardNumber = String(c.id).trim();
  const name = String(c.name || '').trim();
  const rawType = Array.isArray(c.type) ? c.type.find(Boolean) : c.type;
  const looksLikeToken = /(?:^|-)T\d*(?:-P)?$/i.test(cardNumber) || /\/\/|\btoken\b/i.test(name);
  const cardType = rawType ? String(rawType).trim() : (looksLikeToken ? 'Token' : 'Unit');
  const rarity = String(c.rarity || 'Showcase').trim();

  const domains = Array.isArray(c.color)
    ? c.color.map((d) => String(d || '').trim()).filter(Boolean).join(', ')
    : c.color
    ? String(c.color).trim()
    : null;

  const costNum = c.cost !== null && c.cost !== undefined && c.cost !== '' && !Number.isNaN(Number(c.cost))
    ? Number(c.cost)
    : null;
  const mightVal = c.might !== null && c.might !== undefined && c.might !== '' ? String(c.might).trim() : null;
  const mightBonusVal = c.mightBonus !== null && c.mightBonus !== undefined && c.mightBonus !== '' && !Number.isNaN(Number(c.mightBonus))
    ? Number(c.mightBonus)
    : null;
  const tags = Array.isArray(c.tags) ? c.tags.map((t) => String(t || '').trim()).filter(Boolean) : [];
  const ability = cleanDotggEffect(c.effect) || existing?.ability || null;
  const flavor = c.flavor && String(c.flavor).trim() ? String(c.flavor).trim() : (existing?.text ?? null);

  const hasCustomR2 = existing?.image_path && !String(existing.image_path).startsWith('http');
  const imagePath = hasCustomR2 ? existing.image_path : (c.image ? String(c.image).trim() : existing?.image_path || null);

  const existingMeta = (existing?.metadata && typeof existing.metadata === 'object') ? { ...existing.metadata } : {};
  const cmidNum = c.cmid !== null && c.cmid !== undefined && c.cmid !== '' ? Number(c.cmid) : NaN;
  if (Number.isInteger(cmidNum) && cmidNum > 0 && !existingMeta.cardmarket_id) {
    existingMeta.cardmarket_id = cmidNum;
  }
  const isPromoFlag = c.promo === '1' || c.promo === 1 || c.promo === true || /-P\d*$/i.test(cardNumber) || /\([^)]*promo[^)]*\)/i.test(name);
  if (isPromoFlag) {
    existingMeta.is_promo = true;
  }
  existingMeta.source = 'riftbound.gg';

  return {
    set_id: setId,
    card_number: cardNumber,
    name,
    rarity,
    card_type: cardType,
    cost: costNum ?? 0,
    energy: costNum !== null ? String(costNum) : null,
    might: mightVal,
    might_bonus: mightBonusVal,
    domain: domains || null,
    tags: tags.length > 0 ? tags : null,
    ability,
    text: flavor,
    image_path: imagePath,
    metadata: existingMeta,
    game: 'riftbound',
    is_archived: false,
  };
}
