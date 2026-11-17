/**
 * Builds Cardmarket search links using `SETCODE SETNUMBER` (e.g. "OGN 045", "RAD 045a", "OP17 112"),
 * stripping total print counts (/298), promo/reprint suffixes (_p2, _r1, -P, -STAR), and falling back
 * to the card name only if no number/set code is available.
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
  name?: string | null;
  card_number?: string | null;
  set_code?: string | null;
  sets?: { code?: string | null } | null;
}): string {
  const rawNum = (card.card_number || '').trim();
  if (rawNum) {
    const cleaned = rawNum
      .replace(/\/.*$/, '')
      .replace(/(?:_p\d+|_r\d+|_sp\d*|-P|-STAR|\*)$/i, '')
      .trim();

    const prefixed = cleaned.match(/^([A-Za-z0-9]{2,6})[-_\s]+([A-Za-z0-9]+)$/);
    if (prefixed) {
      return `${prefixed[1].toUpperCase()} ${prefixed[2]}`;
    }

    const setCode = (card.set_code || card.sets?.code || '').trim().toUpperCase();
    if (setCode && cleaned) {
      return `${setCode} ${cleaned}`;
    }
    if (cleaned) return cleaned;
  }
  return (card.name || '').trim();
}

export function getCardmarketSearchUrl(card: {
  game?: string | null;
  name?: string | null;
  card_number?: string | null;
  set_code?: string | null;
  sets?: { code?: string | null } | null;
}): string {
  const cmSlug = getCardmarketGameSlug(card.game);
  const query = formatCardmarketSearchQuery(card);
  return query
    ? `https://www.cardmarket.com/en/${cmSlug}/Products/Search?searchString=${encodeURIComponent(query)}`
    : `https://www.cardmarket.com/en/${cmSlug}`;
}
