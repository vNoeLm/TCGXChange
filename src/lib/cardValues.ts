import { useEffect, useSyncExternalStore } from 'react';
import { fetchAllSitePrices, getEurToHuf, siteKey } from './prices';
import { DEFAULT_EUR_TO_HUF, eurToHuf, estimateValue, type ValueEstimate } from './priceSuggestion';
import { hasFoilVariant } from './cardVariants';

/**
 * The exchange rate and every asking price on the site, loaded once and shared, so a catalog
 * page showing sixty cards makes two requests rather than one hundred and twenty.
 */
export interface CardValueData {
  ready: boolean;
  eurHuf: number;
  site: Map<string, number[]>;
}

const EMPTY: CardValueData = { ready: false, eurHuf: DEFAULT_EUR_TO_HUF, site: new Map() };
const REFRESH_AFTER_MS = 5 * 60 * 1000;

let data: CardValueData = EMPTY;
let loadedAt = 0;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  if (loading) return loading;
  if (data.ready && Date.now() - loadedAt < REFRESH_AFTER_MS) return Promise.resolve();

  loading = Promise.all([getEurToHuf(), fetchAllSitePrices()])
    .then(([eurHuf, site]) => {
      data = { ready: true, eurHuf, site };
      loadedAt = Date.now();
      listeners.forEach((notify) => notify());
    })
    .catch(() => {
      // Without the listings the value simply falls back to the market reference.
      data = { ...data, ready: true };
      listeners.forEach((notify) => notify());
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The same data for code that is not a component: waits for it to load, then returns it. */
export async function loadCardValueData(): Promise<CardValueData> {
  await load();
  return data;
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

/** Re-renders when the rate and listings arrive, and starts loading them if nothing has yet. */
export function useCardValueData(): CardValueData {
  const snapshot = useSyncExternalStore(subscribe, () => data, () => EMPTY);
  useEffect(() => {
    load();
  }, []);
  return snapshot;
}

interface PricedCard {
  id: string;
  rarity?: string | null;
  market_price_eur?: number | null;
  market_price_foil_eur?: number | null;
}

/**
 * The market reference (EUR) for one finish. A card printed in only one finish has a single price,
 * stored in whichever column the source filled: Riftbound Rare and above come with only a foil
 * price, while e.g. One Piece Super Rares come with only a normal one. Prefer the normal column so
 * a game that stores two different figures there keeps the one it always showed.
 */
export function marketEurOf(card: PricedCard, isFoil: boolean): number | null {
  if (!hasFoilVariant(card)) return card.market_price_eur ?? card.market_price_foil_eur ?? null;
  return (isFoil ? (card.market_price_foil_eur ?? card.market_price_eur) : card.market_price_eur) ?? null;
}

/** The value of one finish of a card. */
export function valueOfCard(card: PricedCard, isFoil: boolean, values: CardValueData): ValueEstimate {
  const eur = marketEurOf(card, isFoil);

  // A card printed in only one finish is one entry in the catalog, so a listing counts whichever
  // finish it was entered as; cards with a normal and a foil print keep the two apart.
  const sitePrices = hasFoilVariant(card)
    ? values.site.get(siteKey(card.id, isFoil)) ?? []
    : [...(values.site.get(siteKey(card.id, false)) ?? []), ...(values.site.get(siteKey(card.id, true)) ?? [])];

  return estimateValue({
    referenceHuf: eur ? eurToHuf(eur, values.eurHuf) : null,
    sitePrices,
  });
}
