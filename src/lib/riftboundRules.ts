/**
 * Riftbound deck rules that hang off individual cards rather than the general format.
 */

import { isToken } from './cardVariants';

interface RuleCard {
  card_type?: string | null;
  card_number?: string | null;
  domain?: string | null;
  ability?: string | null;
  text?: string | null;
  effect?: string | null;
  subtype?: string | null;
  tags?: any;
  rarity?: string | null;
  name?: string | null;
  metadata?: Record<string, any> | null;
}

const MAIN_DECK_TYPES = ['unit', 'spell', 'gear'];

/** Tokens (VEN-T03 Mech, RAD-T02 Bomb...) are created in play, never put in a deck. */
export const isTokenCard = (card: RuleCard): boolean => isToken(card as any);

/**
 * A Neutral card - Neeko, Blending In is the first - has no domain and can go in a deck of any
 * domain. The card data stores it as "Colorless", which battlefields and tokens also use, so
 * Neutral means: colorless, and a card that actually goes in the main deck.
 */
export function isNeutralCard(card: RuleCard | null | undefined): boolean {
  if (!card) return false;
  const domain = (card.domain || '').trim().toLowerCase();
  if (domain && domain !== 'colorless' && domain !== 'neutral') return false;
  return MAIN_DECK_TYPES.includes((card.card_type || '').toLowerCase()) && !isTokenCard(card);
}

/** "Neutral" for a Neutral card, otherwise the stored domain (e.g. "Colorless" on a battlefield). */
export function domainLabel(card: RuleCard): string {
  return isNeutralCard(card) ? 'Neutral' : (card.domain || 'Colorless');
}

/**
 * How many legends a card makes you choose besides your starting legend - Neeko, Blending In:
 * "If Neeko is in your deck, choose 3 different legends in addition to your starting legend."
 * 0 for every other card.
 */
export function extraLegendsRequired(card: RuleCard | null | undefined): number {
  if (!card) return 0;
  const text = [card.ability, card.text, card.effect].filter(Boolean).join(' ');
  const match = text.match(/choose (\d+) different legends in addition to your starting legend/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * A legend's name for "different legends" (Neeko): printings of one legend are the same legend,
 * so the bracketed printing ("(Origins Release Event Promo)"), a "- Starter" tag and comma-vs-dash
 * spelling are ignored when comparing.
 */
export function legendNameKey(name: string | null | undefined): string {
  return (name || '')
    .toLowerCase()
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s+-\s+starter$/, '')
    .replace(/\s*[-,]\s+/g, ', ')
    .trim();
}
