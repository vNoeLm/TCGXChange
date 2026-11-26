/**
 * Builds Cardmarket search links tailored to Cardmarket's GET `/Products/Search?searchString=` behavior:
 * Cardmarket's GET endpoint matches product titles rather than collector numbers, so we pass the
 * Cardmarket-formatted card title for Riftbound, Lorcana, Star Wars Unlimited, and Flesh and Blood,
 * and keep the hyphenated `SET-NUMBER` code (which Cardmarket puts in One Piece titles, e.g. `Roronoa Zoro (OP01-001)`)
 * for One Piece cards.
 */
export function getCardmarketGameSlug(game?: string | null): string {
  const g = (game || 'riftbound').toLowerCase();
  if (g === 'mtg') return 'Magic';
  if (g === 'onepiece') return 'OnePiece';
  if (g === 'lorcana') return 'Lorcana';
  if (g === 'starwars') return 'StarWarsUnlimited';
  if (g === 'fab') return 'FleshAndBlood';
  return 'Riftbound';
}

export function formatCardmarketSearchQuery(card: {
  game?: string | null;
  name?: string | null;
  card_type?: string | null;
  card_number?: string | null;
  set_code?: string | null;
  sets?: { code?: string | null } | null;
}): string {
  const g = (card.game || 'riftbound').toLowerCase();
  const rawName = (card.name || '').trim();

  if (g === 'onepiece') {
    const rawNum = (card.card_number || '').trim();
    if (rawNum) {
      const cleaned = rawNum
        .replace(/\/.*$/, '')
        .replace(/(?:_p\d+|_r\d+|_sp\d*|-P|-STAR|\*)$/i, '')
        .trim()
        .toUpperCase();
      if (/^[A-Z0-9]{1,6}-[A-Z0-9]+$/.test(cleaned)) {
        return cleaned;
      }
    }
    return rawName
      .replace(/\s*\((?:Alternate Art|Alt Art|Parallel|SP|Manga(?: Art)?|Box Topper|Pirate Foil|Full Art|Jolly Roger Foil|Treasure Rare|Reprint|Promo|Anniversary|Tournament|Dash Pack)[^)]*\)/gi, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim();
  }

  if (g === 'riftbound') {
    const clean = rawName
      .replace(/\s*\([^)]*\)\s*$/, '')
      .split(/\s+\/\/\s+/)[0]
      .replace(/\s+-\s+/g, ', ')
      .trim();
    return clean || rawName;
  }

  if (g === 'lorcana') {
    return rawName
      .replace(/\s*\((?:Enchanted|Promo|Iconic|Epic|D23|Challenge|Quest)[^)]*\)\s*$/i, '')
      .trim();
  }

  if (g === 'starwars') {
    const clean = rawName.split(/\s+\/\/\s+/)[0].trim();
    if ((card.card_type || '').toLowerCase() === 'base') {
      return clean.replace(/\s+-\s+.*$/, '').trim();
    }
    return clean.replace(/\s+-\s+/g, ', ').trim();
  }

  if (g === 'fab') {
    return rawName.replace(/\s*\((?:Red|Yellow|Blue)\)\s*$/i, '').trim();
  }

  return rawName;
}

export function getCardmarketSearchUrl(card: {
  game?: string | null;
  name?: string | null;
  card_type?: string | null;
  card_number?: string | null;
  set_code?: string | null;
  sets?: { code?: string | null } | null;
  cardmarket_id?: number | string | null;
  metadata?: Record<string, any> | null;
}): string {
  const cmSlug = getCardmarketGameSlug(card.game);
  const rawCmid = card.cardmarket_id ?? card.metadata?.cardmarket_id ?? card.metadata?.cardmarket_id_auto;
  const cmid = rawCmid !== null && rawCmid !== undefined && rawCmid !== '' ? Number(rawCmid) : NaN;
  if (Number.isInteger(cmid) && cmid > 0) {
    return `https://www.cardmarket.com/en/${cmSlug}/Products?idProduct=${cmid}`;
  }
  const query = formatCardmarketSearchQuery(card);
  return query
    ? `https://www.cardmarket.com/en/${cmSlug}/Products/Search?searchString=${encodeURIComponent(query)}`
    : `https://www.cardmarket.com/en/${cmSlug}`;
}
