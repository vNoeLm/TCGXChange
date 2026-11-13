import { isAltArt, isOvernumbered, isSigned, isSp } from './cardVariants';
import { normalizeCardCondition } from './collectionDefaults';
import { slugify } from './storeConstants';

export interface SingleVariantCardInput {
  name?: string | null;
  card_number?: string | null;
  rarity?: string | null;
  subtype?: string | null;
  tags?: unknown;
  is_foil?: boolean;
  condition?: string | null;
}

const EDITION_SUFFIX_RE =
  /\s*\(([^)]*(?:\bpromo\b|\bnexus\s*night\b|\bsummoner\s*skirmish\b|\bregional\s*qualifier\b|\barcane\s*box\b|\bovernumbered\b|\bsigned\b|\bsignature\b|\balt(?:ernate)?\s*art\b|\bparallel\s*art\b|\bshowcase\b|\bfull\s*art\b|\bextended\s*art\b|\bborderless\b)|nx)\)\s*$/i;

/**
 * Strips trailing promo/variant parentheticals (e.g. "(Origins Nexus Night Promo)",
 * "(Overnumbered)") while preserving gameplay-distinct suffixes such as FaB pitch colors.
 */
export function stripSingleEditionSuffix(name?: string | null): { baseName: string; editionTag: string | null } {
  const raw = String(name || '').trim();
  if (!raw) return { baseName: '', editionTag: null };

  const match = raw.match(EDITION_SUFFIX_RE);
  if (!match || match.index === undefined) {
    return { baseName: raw, editionTag: null };
  }

  const baseName = raw.slice(0, match.index).trim();
  const editionTag = match[1].trim();
  return {
    baseName: baseName || raw,
    editionTag: editionTag || null,
  };
}

/**
 * Derives a human-readable variant_group key from a single card's base title
 * (e.g. "Battle Mistress" -> "battle-mistress") so Regular, Overnumbered, Alt Art,
 * Signed, SP, Promo, Foil, and Condition printings share one product switcher.
 */
export function buildSingleVariantGroup(name?: string | null): string {
  const { baseName } = stripSingleEditionSuffix(name);
  const ascii = baseName.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return slugify(ascii).slice(0, 120) || 'single-card';
}

/** Returns true when a stored variant_group still uses the older opaque "single-<uuid>" format. */
export function isLegacySingleUuidGroup(group?: string | null): boolean {
  return Boolean(group && /^single-[0-9a-f]{8}-[0-9a-f-]{4,}/i.test(group.trim()));
}

function summarizeEditionTag(tag: string): string {
  const cleaned = tag.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 28) return cleaned;
  const shorter = cleaned
    .replace(/\b20\d{2}\b\s*/g, '')
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return shorter.length <= 28 ? shorter : `${shorter.slice(0, 27).trim()}...`;
}

/**
 * Builds a concise variant_label (<= 80 chars) for a single card so Regular,
 * Overnumbered, Alt Art, Signed, SP, Promo, Foil, and Condition rows are
 * cleanly distinguishable in the product page switcher.
 */
export function buildSingleVariantLabel(card: SingleVariantCardInput): string {
  const { editionTag } = stripSingleEditionSuffix(card.name);
  const signed = isSigned(card);
  const overnumbered = isOvernumbered(card);
  const sp = isSp(card);
  const altArt = isAltArt(card);

  const traits: string[] = [];
  if (signed && overnumbered) traits.push('Signed Overnumbered');
  else if (signed) traits.push('Signed');
  else if (overnumbered) traits.push('Overnumbered');
  else if (sp) traits.push('SP');
  else if (altArt && !editionTag) traits.push('Alt Art');

  if (editionTag) {
    const shortTag = summarizeEditionTag(editionTag);
    const lowerTag = shortTag.toLowerCase();
    const alreadyCovered = traits.some((t) => lowerTag.includes(t.toLowerCase()));
    if (!alreadyCovered) traits.push(shortTag);
  }

  const rawNum = String(card.card_number || '').trim();
  const shortNum = rawNum.split('/')[0].trim();
  const condition = normalizeCardCondition(card.condition || 'Near Mint');

  const parts: string[] = [];
  if (traits.length > 0) parts.push(traits.join(' · '));
  if (shortNum) parts.push(shortNum);
  if (card.is_foil) parts.push('Foil');
  parts.push(condition);

  let label = parts.join(' · ');
  if (label.length > 80) {
    const compact: string[] = [];
    if (signed && overnumbered) compact.push('Signed Overnumbered');
    else if (signed) compact.push('Signed');
    else if (overnumbered) compact.push('Overnumbered');
    else if (sp) compact.push('SP');
    else if (altArt && !editionTag) compact.push('Alt Art');
    else if (editionTag) compact.push('Promo');
    if (shortNum) compact.push(shortNum);
    if (card.is_foil) compact.push('Foil');
    compact.push(condition);
    label = compact.join(' · ').slice(0, 80);
  }

  return label;
}
