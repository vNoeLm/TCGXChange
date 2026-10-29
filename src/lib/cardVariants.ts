import type { FilterState } from '../types';

export const hasFoilVariant = (card: { rarity?: string | null; is_foil?: boolean; game?: string | null; card_type?: string | null; card_number?: string | null; subtype?: string | null; tags?: any; name?: string | null }) => {
  if (card.is_foil) return true;
  const game = card.game || 'riftbound';
  const rarity = card.rarity || '';

  if (game === 'riftbound') {
    // In Riftbound, Common & Uncommon have separate cold foil variants. Rare & higher are always foil in base set.
    return rarity === 'Common' || rarity === 'Uncommon';
  }

  if (card.card_type === 'Token' || card.card_type === 'Rule') return false;

  if (game === 'lorcana') {
    // In Lorcana, Enchanted rarity is intrinsically foil/full-art (no non-foil counterpart).
    if (rarity.toLowerCase() === 'enchanted') return false;
    return true;
  }

  if (game === 'onepiece') {
    // In One Piece:
    // - Super Rare (SR) and Secret Rare (SEC) in normal boosters are always foil (no standard non-foil exists).
    // - Standard Common (C) and Uncommon (UC) are non-foil only (no foil in normal boosters).
    // - Rare (R) and Leaders (L) have foil variants; Alt Arts/Parallel Arts are foiled.
    if (isAltArt(card)) return true;
    const rLower = rarity.toLowerCase();
    if (rLower === 'super rare' || rLower === 'secret rare' || rLower === 'sr' || rLower === 'sec') {
      return false;
    }
    if (rLower === 'common' || rLower === 'uncommon' || rLower === 'c' || rLower === 'uc') {
      return false;
    }
    return true;
  }

  // Star Wars: Unlimited, Magic: The Gathering, Flesh and Blood: all standard rarities have foil versions
  return true;
};

export const isOvernumbered = (card: { card_number?: string | null }) => {
  if (!card.card_number) return false;
  if (card.card_number.includes('/')) {
    const parts = card.card_number.split('/');
    if (parts.length < 2) return false;
    const numMatch = parts[0].match(/\d+/);
    const denMatch = parts[1].match(/\d+/);
    if (numMatch && denMatch) {
      return parseInt(numMatch[0], 10) > parseInt(denMatch[0], 10);
    }
    return false;
  }
  const radMatch = card.card_number.match(/^RAD-(\d+)/i);
  if (radMatch) {
    return parseInt(radMatch[1], 10) > 167;
  }
  return false;
};

export const isSigned = (card: { card_number?: string | null; subtype?: string | null; tags?: any; name?: string | null }) => {
  const num = (card.card_number || '').toUpperCase();
  const sub = (card.subtype || '').toLowerCase().trim();
  const tags = Array.isArray(card.tags) ? card.tags.map((t: any) => String(t).toLowerCase().trim()) : [];
  const name = (card.name || '').toLowerCase();

  return Boolean(
    name.includes('signature') ||
    name.includes('(signed)') ||
    num.includes('*') ||
    num.includes('★') ||
    num.includes('STAR') ||
    sub === 'signed' ||
    tags.includes('signed') ||
    tags.includes('star')
  );
};

export const isSp = (card: { card_number?: string | null; subtype?: string | null; tags?: any }) => {
  const num = (card.card_number || '').toUpperCase();
  const sub = (card.subtype || '').toUpperCase().trim();
  const tags = Array.isArray(card.tags) ? card.tags.map((t: any) => String(t).toUpperCase().trim()) : [];
  return Boolean(
    num.includes('-SP') ||
    num.includes('SP/') ||
    num.startsWith('SP') ||
    sub === 'SP' ||
    tags.includes('SP')
  );
};

export const isToken = (card: {
  card_number?: string | null;
  card_type?: string | null;
  subtype?: string | null;
  tags?: any;
  rarity?: string | null;
  name?: string | null;
  metadata?: Record<string, any> | null;
}): boolean => {
  if (!card) return false;
  const num = (card.card_number || '').toUpperCase().trim();
  const type = (card.card_type || '').toLowerCase().trim();
  const sub = (card.subtype || '').toLowerCase().trim();
  const rarity = (card.rarity || '').toLowerCase().trim();
  const name = (card.name || '').toLowerCase().trim();

  let tagList: string[] = [];
  if (Array.isArray(card.tags)) {
    tagList = card.tags.map((t: any) => String(t || '').toLowerCase().trim());
  } else if (typeof card.tags === 'string') {
    tagList = card.tags.toLowerCase().split(/[,;]/).map((t: string) => t.trim());
  } else if (card.tags && typeof card.tags === 'object') {
    if (Array.isArray(card.tags.tags)) {
      tagList = card.tags.tags.map((t: any) => String(t || '').toLowerCase().trim());
    }
  }

  const hasTokenTag = tagList.some((t: string) => t === 'token' || t.includes('token'));

  const hasTokenNumber = Boolean(
    num.includes('-T') ||
    num.startsWith('T-') ||
    num.endsWith('-T') ||
    /(?:^|[^A-Z0-9])T\d+(?:$|[^A-Z0-9])/.test(num)
  );

  const hasTokenName = Boolean(
    name.endsWith(' token') ||
    name.includes('(token)') ||
    name.includes('[token]')
  );

  const hasTokenMetadata = Boolean(
    card.metadata?.is_token ||
    (typeof card.metadata?.type === 'string' && card.metadata.type.toLowerCase().includes('token'))
  );

  return Boolean(
    type === 'token' ||
    type.includes('token') ||
    sub === 'token' ||
    sub.includes('token') ||
    rarity === 'token' ||
    hasTokenTag ||
    hasTokenNumber ||
    hasTokenName ||
    hasTokenMetadata
  );
};

export const isAltArt = (card: { card_number?: string | null; subtype?: string | null; tags?: any; rarity?: string | null; card_type?: string | null; name?: string | null }) => {
  if (isOvernumbered(card) || isSigned(card) || isSp(card)) return false;
  if (!card.card_number && !card.name) return false;
  const num = (card.card_number || '').trim();
  const numPart = num.split('/')[0].replace(/^[a-z0-9]+-/i, '');
  // Matches standard alt art numbering (e.g. 109a, 214a, 007a-P), rune alt arts (e.g. R04a, SFD-R04a, RAD-R01A, VEN-R01b-P), and parallel art (_p1)
  const hasSuffix = /^(?:R?\d+|\d+)-?[ab](?:-P\d*)?$/i.test(numPart) || /_p\d*$/i.test(num);
  const isAltSubtype = card.subtype?.toLowerCase().includes('alt') || card.subtype?.toLowerCase().includes('alternate');
  const isAltTag = Array.isArray(card.tags) && card.tags.some((t: any) => String(t).toLowerCase().includes('alt') || String(t).toLowerCase().includes('alternate'));
  const isAltName = Boolean(card.name && (card.name.toLowerCase().includes('alternate art') || card.name.toLowerCase().includes('parallel art')));
  return Boolean(hasSuffix || isAltSubtype || isAltTag || isAltName);
};

/**
 * Granular rarity score for sorting:
 * Overnumbered Signature (110) > Signed (105) > Overnumbered (100) > SP (90) > Alt Art (80) > Showcase (75)
 * > Epic (50) > Rare (40) > Uncommon (30) > Common (20) > Token / Basic (10).
 */
export const getCardRarityRank = (card: {
  rarity?: string | null;
  card_number?: string | null;
  subtype?: string | null;
  tags?: any;
  card_type?: string | null;
  name?: string | null;
}): number => {
  const over = isOvernumbered(card);
  const signed = isSigned(card);
  if (over && signed) return 110;
  if (signed) return 105;
  if (over) return 100;
  if (isSp(card)) return 90;
  if (isAltArt(card)) return 80;
  if (card.rarity === 'Showcase') return 75;
  if (card.rarity === 'Epic') return 50;
  if (card.rarity === 'Rare') return 40;
  if (card.rarity === 'Uncommon') return 30;
  if (card.rarity === 'Common') return 20;
  return 10;
};

export const compareCardsByRarity = (
  a: { rarity?: string | null; card_number?: string | null; subtype?: string | null; tags?: any; card_type?: string | null; name?: string | null },
  b: { rarity?: string | null; card_number?: string | null; subtype?: string | null; tags?: any; card_type?: string | null; name?: string | null },
  direction: 'desc' | 'asc' = 'desc'
): number => {
  const rA = getCardRarityRank(a);
  const rB = getCardRarityRank(b);
  if (rA !== rB) {
    return direction === 'desc' ? rB - rA : rA - rB;
  }
  return (a.card_number || '').localeCompare(b.card_number || '', undefined, { numeric: true });
};

export const isBaseSetCard = (card: { card_number?: string | null; subtype?: string | null; card_type?: string | null; tags?: any; name?: string | null; rarity?: string | null }) => {
  if (isOvernumbered(card)) return false;
  if (isSigned(card)) return false;
  if (isSp(card)) return false;
  if (isToken(card)) return false;
  if (isAltArt(card)) return false;

  if (card.card_number && card.card_number.includes('/')) {
    const parts = card.card_number.split('/');
    const mainNumStr = parts[0].replace(/^[a-z]+-/i, '').trim();
    const match = mainNumStr.match(/^(\d+)$/);
    if (!match) return false;
    const numVal = parseInt(match[1], 10);
    const denVal = parseInt(parts[1]?.match(/\d+/)?.[0] || '0', 10);
    if (denVal > 0 && numVal >= 1 && numVal <= denVal) {
      return true;
    }
  }
  const radMatch = card.card_number?.match(/^RAD-(\d+)$/i);
  if (radMatch) {
    const numVal = parseInt(radMatch[1], 10);
    return numVal >= 1 && numVal <= 167;
  }
  return false;
};

export function matchesCardVariants(card: any, filters: FilterState): boolean {
  const showFoilOnly = !!filters.foilFilter;
  const signedFilter = filters.signedFilter || 'all';
  const altArtFilter = filters.altArtFilter || 'all';
  const overnumberedFilter = filters.overnumberedFilter || 'all';
  const spFilter = filters.spFilter || 'all';
  const baseSetFilter = filters.baseSetFilter || 'all';

  if (showFoilOnly && !card.is_foil && !hasFoilVariant(card)) {
    return false;
  }

  if (baseSetFilter === 'only') {
    if (!isBaseSetCard(card)) return false;
  } else {
    if (signedFilter === 'only' && !isSigned(card)) return false;
    if (signedFilter === 'none' && isSigned(card)) return false;

    if (altArtFilter === 'only' && !isAltArt(card)) return false;
    if (altArtFilter === 'none' && isAltArt(card)) return false;

    if (overnumberedFilter === 'only' && !isOvernumbered(card)) return false;
    if (overnumberedFilter === 'none' && isOvernumbered(card)) return false;

    if (spFilter === 'only' && !isSp(card)) return false;
    if (spFilter === 'none' && isSp(card)) return false;
  }

  // Tags filter
  if (filters.tags && filters.tags.length > 0) {
    const cardTags = Array.isArray(card.tags) 
      ? card.tags.map((t: any) => String(t).toLowerCase()) 
      : (card.tags?.tags || []).map((t: any) => String(t).toLowerCase());
    const hasAllTags = filters.tags.every(t => cardTags.includes(t.toLowerCase()));
    if (!hasAllTags) return false;
  }

  // Cost filter
  if (card.cost != null) {
    const numericCost = typeof card.cost === 'number' ? card.cost : parseInt(String(card.cost), 10);
    if (!isNaN(numericCost)) {
      if (filters.costMin > 1 && numericCost < filters.costMin) return false;
      if (filters.costMax < 10 && numericCost > filters.costMax) return false;
    }
  }

  return true;
}
