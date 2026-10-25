import React, { useMemo } from 'react';
import type { CatalogCard } from '../types';
import { useCardValueData, valueOfCard } from '../lib/cardValues';
import { useCurrency } from '../lib/currency';

export type CollectionValueMode = 'All' | 'Owned' | 'Playset' | 'Missing';

interface CollectionValueChipProps {
  /** Owned counts: a card id, or the id with "_foil" on the end for foil copies. */
  collection: Record<string, number>;
  /** Every card of the game being shown, so owned ids can be turned back into cards. */
  cards: CatalogCard[];
  /** What the catalog's collection tab is showing right now. */
  mode: CollectionValueMode;
  /** The catalog's foil-only filter: target values then use foil prices too. */
  foilOnly?: boolean;
}

const LABELS: Record<CollectionValueMode, string> = {
  All: 'All cards value',
  Owned: 'Owned collection value',
  Playset: 'Playset value',
  Missing: 'Missing cards value',
};

const DESCRIPTIONS: Record<CollectionValueMode, string> = {
  All: 'Estimated value of one copy of every card currently shown.',
  Owned: 'Estimated value of the cards you own in this game, each at its own finish.',
  Playset: 'Estimated value of a 3-copy playset for every card you have at least three of.',
  Missing: 'Estimated value of one copy of every card currently shown that you do not own.',
};

/**
 * The estimated value behind whichever collection tab is active: the whole shown catalog, what you
 * own, the playsets you have completed, or what is still missing. Cards with no price add nothing,
 * and the tooltip says how many so the total is not mistaken for a complete one.
 */
export function CollectionValueChip({ collection, cards, mode, foilOnly = false }: CollectionValueChipProps) {
  const values = useCardValueData();
  const { formatPrice } = useCurrency();

  const { total, copies, unpriced } = useMemo(() => {
    let total = 0;
    let copies = 0;
    let unpriced = 0;

    if (mode === 'Owned') {
      const byId = new Map(cards.map((card) => [card.id, card]));
      for (const [key, count] of Object.entries(collection)) {
        if (!count || count <= 0) continue;
        const isFoil = key.endsWith('_foil');
        const card = byId.get(isFoil ? key.slice(0, -'_foil'.length) : key);
        if (!card) continue; // another game's card, or one that no longer exists

        copies += count;
        const value = valueOfCard(card, isFoil, values).valueHuf;
        if (value === null) unpriced += count;
        else total += value * count;
      }
      return { total, copies, unpriced };
    }

    for (const card of cards) {
      const regular = collection[card.id] || 0;
      const foil = collection[`${card.id}_foil`] || 0;
      const owned = regular + foil;

      if (mode === 'Playset') {
        if (owned < 3) continue;
        copies += 3;
        const value = valueOfCard(card, foilOnly, values).valueHuf;
        if (value === null) unpriced += 3;
        else total += value * 3;
      } else if (mode === 'Missing') {
        if (owned > 0) continue;
        copies += 1;
        const value = valueOfCard(card, foilOnly, values).valueHuf;
        if (value === null) unpriced += 1;
        else total += value;
      } else {
        copies += 1;
        const value = valueOfCard(card, foilOnly, values).valueHuf;
        if (value === null) unpriced += 1;
        else total += value;
      }
    }

    return { total, copies, unpriced };
  }, [collection, cards, values, mode, foilOnly]);

  if (copies === 0) return null;

  const note = unpriced > 0
    ? ` ${unpriced} ${unpriced === 1 ? 'card has' : 'cards have'} no price yet and are not counted.`
    : '';

  return (
    <div
      className="flex items-center justify-center gap-2 px-3 h-10 sm:h-9 rounded-xl border bg-[var(--bg-input)] border-[var(--border)] shrink-0 w-full sm:w-auto"
      title={`${DESCRIPTIONS[mode]}${note}`}
    >
      <svg className="w-4 h-4 shrink-0 text-[var(--positive)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="6" rx="8" ry="3" />
        <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
        <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
      </svg>
      <div className="leading-tight text-center">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: 'var(--text-tertiary)' }}>{LABELS[mode]}</div>
        <div className="text-sm font-black font-mono text-[var(--positive)] text-center">~{formatPrice(total)}</div>
      </div>
    </div>
  );
}
