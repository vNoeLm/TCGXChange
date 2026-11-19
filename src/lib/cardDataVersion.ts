/**
 * A short fingerprint of the card data, so browsers can tell when their cached card lists are out
 * of date (a set added, removed or restored, a release date moved, the daily price sync) without
 * anyone bumping a version number by hand. Computed by /api/card-data-version, compared in
 * lib/api.ts.
 */

export interface CardDataSnapshot {
  /** How many cards there are. */
  cardCount: number | null;
  /** created_at of the newest card. */
  newestCard: string | null;
  /** The latest last_price_updated_at of any card. */
  newestPrice: string | null;
  /** Bumped when a moderator/admin edits card text, errata, or legality. */
  cardContentVersion?: string | null;
  /** Every set with its release date (release dates decide which cards are shown). */
  sets: { code: string; release_date: string | null }[];
}

/** FNV-1a, 32-bit: enough to tell two snapshots apart, short enough to store and compare. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The same snapshot always gives the same version, whatever order the sets came back in. */
export function cardDataVersion(snapshot: CardDataSnapshot): string {
  const sets = [...snapshot.sets]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(s => `${s.code}:${s.release_date || ''}`)
    .join(',');
  return hash([snapshot.cardCount ?? '', snapshot.newestCard || '', snapshot.newestPrice || '', snapshot.cardContentVersion || '', sets].join('|'));
}
