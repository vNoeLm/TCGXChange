/**
 * What a trade review rates, per direction. Shared by the review API (which validates against it)
 * and the rating form / review displays.
 */

export type ReviewDirection = 'buyer_to_seller' | 'seller_to_buyer';

export interface ReviewCategory {
  key: string;
  label: string;
  /** One line under the label in the rating form. */
  hint: string;
}

/** The buyer rating the seller. */
export const SELLER_CATEGORIES: ReviewCategory[] = [
  { key: 'communication', label: 'Communication', hint: 'Replied quickly and clearly' },
  { key: 'packaging', label: 'Packaging & card care', hint: 'Sleeved, protected, arrived safe' },
  { key: 'speed', label: 'Speed', hint: 'How fast it was sent or the meetup happened' },
  { key: 'accuracy', label: 'Item as described', hint: 'Condition and version matched the listing' },
];

export const SELLER_CATEGORIES_HU: ReviewCategory[] = [
  { key: 'communication', label: 'Kommunikáció', hint: 'Gyorsan és egyértelműen válaszolt' },
  { key: 'packaging', label: 'Csomagolás és védelem', hint: 'Bugyiban, biztonságosan csomagolva érkezett' },
  { key: 'speed', label: 'Gyorsaság', hint: 'Milyen gyorsan adta fel vagy zajlott az átadás' },
  { key: 'accuracy', label: 'Leírásnak megfelelő', hint: 'Az állapot és a kiadás egyezett a hirdetéssel' },
];

/** The seller rating the buyer. */
export const BUYER_CATEGORIES: ReviewCategory[] = [
  { key: 'communication', label: 'Communication', hint: 'Replied quickly and clearly' },
  { key: 'payment', label: 'Payment', hint: 'Paid on time, as agreed' },
  { key: 'reliability', label: 'Reliability', hint: 'Showed up / picked up on time, no last-minute changes' },
];

export const BUYER_CATEGORIES_HU: ReviewCategory[] = [
  { key: 'communication', label: 'Kommunikáció', hint: 'Gyorsan és egyértelműen válaszolt' },
  { key: 'payment', label: 'Fizetés', hint: 'Időben, a megbeszéltek szerint fizetett' },
  { key: 'reliability', label: 'Megbízhatóság', hint: 'Időben megjelent / átvette, nem mondta le az utolsó pillanatban' },
];

export const categoriesFor = (direction: ReviewDirection, lang: string = 'en'): ReviewCategory[] => {
  if (lang === 'hu') {
    return direction === 'buyer_to_seller' ? SELLER_CATEGORIES_HU : BUYER_CATEGORIES_HU;
  }
  return direction === 'buyer_to_seller' ? SELLER_CATEGORIES : BUYER_CATEGORIES;
};

/** Whole-star scores for every category of a direction, or null if any is missing or out of range. */
export function validScores(direction: ReviewDirection, scores: unknown): Record<string, number> | null {
  if (!scores || typeof scores !== 'object') return null;
  const out: Record<string, number> = {};
  for (const c of categoriesFor(direction, 'en')) {
    const v = Number((scores as Record<string, unknown>)[c.key]);
    if (!Number.isInteger(v) || v < 1 || v > 5) return null;
    out[c.key] = v;
  }
  return out;
}

/** The overall rating a set of category scores gives, to one decimal. */
export function overallOf(scores: Record<string, number>): number {
  const values = Object.values(scores);
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}
