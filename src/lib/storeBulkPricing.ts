import { marketEurOf } from './cardValues';
import type { CardConditionInfo } from './collectionDefaults';
import { DEFAULT_EUR_TO_HUF, eurToHuf, roundHuf } from './priceSuggestion';

export type CardCondition = CardConditionInfo['id'];
export type BulkPriceMode = 'market' | 'rarity_fixed' | 'fixed';
export type BulkRoundStep = 'auto' | 10 | 50 | 100;

export const STORE_BULK_SETTINGS_KEY = 'tcg_store_bulk_pricing_prefs_v1';

export const BULK_RARITY_KEYS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase', 'default'] as const;

export interface BulkPricingSettings {
  defaultCondition: CardCondition;
  priceMode: BulkPriceMode;
  marketPercent: number;
  roundStep: BulkRoundStep;
  foilFloorMultiplier: number;
  fixedPriceHuf: number;
  unpricedMode: 'floor' | 'fixed';
  unpricedFallbackHuf: number;
  rarityFloors: Record<string, number>;
  rarityFixed: Record<string, number>;
  targetStockCount: number;
  mergeExisting: boolean;
  updateExistingPrice: boolean;
  targetStatus: 'active' | 'draft';
}

export const DEFAULT_RARITY_FLOORS: Record<string, number> = {
  Common: 20,
  Uncommon: 40,
  Rare: 150,
  Epic: 400,
  Showcase: 1500,
  default: 20,
};

export const DEFAULT_RARITY_FIXED: Record<string, number> = {
  Common: 30,
  Uncommon: 60,
  Rare: 250,
  Epic: 600,
  Showcase: 2500,
  default: 30,
};

export const DEFAULT_BULK_PRICING_SETTINGS: BulkPricingSettings = {
  defaultCondition: 'Pack Fresh',
  priceMode: 'market',
  marketPercent: 0,
  roundStep: 'auto',
  foilFloorMultiplier: 2,
  fixedPriceHuf: 50,
  unpricedMode: 'floor',
  unpricedFallbackHuf: 100,
  rarityFloors: { ...DEFAULT_RARITY_FLOORS },
  rarityFixed: { ...DEFAULT_RARITY_FIXED },
  targetStockCount: 3,
  mergeExisting: true,
  updateExistingPrice: false,
  targetStatus: 'active',
};

export const BULK_FLOOR_PRESETS: {
  id: string;
  labelEn: string;
  labelHu: string;
  floors: Record<string, number>;
  foilMultiplier: number;
}[] = [
  {
    id: 'shop',
    labelEn: 'Shop Standard',
    labelHu: 'Webshop alap',
    floors: { Common: 20, Uncommon: 40, Rare: 150, Epic: 400, Showcase: 1500, default: 20 },
    foilMultiplier: 2,
  },
  {
    id: 'budget',
    labelEn: 'Budget / Bulk',
    labelHu: 'Bulk / Olcsó',
    floors: { Common: 10, Uncommon: 20, Rare: 80, Epic: 250, Showcase: 900, default: 10 },
    foilMultiplier: 1.5,
  },
  {
    id: 'premium',
    labelEn: 'Margin Protect',
    labelHu: 'Magasabb minimum',
    floors: { Common: 30, Uncommon: 60, Rare: 200, Epic: 500, Showcase: 2000, default: 30 },
    foilMultiplier: 2,
  },
  {
    id: 'flat10',
    labelEn: 'Flat 10 Ft',
    labelHu: 'Minimum (10 Ft)',
    floors: { Common: 10, Uncommon: 10, Rare: 10, Epic: 10, Showcase: 10, default: 10 },
    foilMultiplier: 1,
  },
];

export function mapRarityKey(rarity?: string | null): string {
  const r = (rarity || '').trim().toLowerCase();
  if (!r) return 'default';
  if (r === 'common' || r === 'c' || r === 'token') return 'Common';
  if (r === 'uncommon' || r === 'u' || r === 'uc') return 'Uncommon';
  if (r === 'rare' || r === 'r' || r === 'promo' || r === 'leader') return 'Rare';
  if (r === 'epic' || r === 'super rare' || r === 'sr' || r === 'mythic' || r === 'legendary' || r === 'majestic') return 'Epic';
  if (r === 'showcase' || r === 'secret rare' || r === 'sec' || r === 'enchanted' || r === 'treasure rare' || r === 'fabled') return 'Showcase';
  return 'default';
}

export function roundBulkHuf(huf: number, step: BulkRoundStep): number {
  const safe = Math.max(10, Number.isFinite(huf) ? huf : 10);
  if (step === 'auto') return roundHuf(safe);
  return Math.max(10, Math.round(safe / step) * step);
}

export interface ComputedSinglePrice {
  priceHuf: number;
  rawMarketHuf: number | null;
  floorApplied: number;
  hitFloor: boolean;
  unpriced: boolean;
}

export function computeBulkSinglePrice(
  card: {
    id: string;
    rarity?: string | null;
    game?: string | null;
    card_type?: string | null;
    card_number?: string | null;
    subtype?: string | null;
    tags?: any;
    name?: string | null;
    market_price_eur?: number | null;
    market_price_foil_eur?: number | null;
  },
  isFoil: boolean,
  settings: BulkPricingSettings,
  eurRate: number = DEFAULT_EUR_TO_HUF
): ComputedSinglePrice {
  const rarityKey = mapRarityKey(card.rarity);
  const baseFloor = Math.max(10, Math.round(settings.rarityFloors[rarityKey] ?? settings.rarityFloors.default ?? 20));
  const foilMult = isFoil ? Math.max(1, Number(settings.foilFloorMultiplier || 1)) : 1;
  const floorForFinish = roundBulkHuf(baseFloor * foilMult, settings.roundStep);

  if (settings.priceMode === 'fixed') {
    const fixed = roundBulkHuf(settings.fixedPriceHuf || 10, settings.roundStep);
    return {
      priceHuf: fixed,
      rawMarketHuf: null,
      floorApplied: floorForFinish,
      hitFloor: false,
      unpriced: false,
    };
  }

  if (settings.priceMode === 'rarity_fixed') {
    const baseFixed = Math.max(10, Math.round(settings.rarityFixed[rarityKey] ?? settings.rarityFixed.default ?? 30));
    const fixed = roundBulkHuf(baseFixed * foilMult, settings.roundStep);
    return {
      priceHuf: fixed,
      rawMarketHuf: null,
      floorApplied: floorForFinish,
      hitFloor: false,
      unpriced: false,
    };
  }

  const rawEur = marketEurOf(card, isFoil);
  const eurNum = Number(rawEur);
  const rawMarketHuf = rawEur !== null && Number.isFinite(eurNum) && eurNum > 0 ? roundHuf(eurToHuf(eurNum, eurRate)) : null;

  if (rawMarketHuf === null) {
    const fallbackRaw =
      settings.unpricedMode === 'fixed'
        ? roundBulkHuf(settings.unpricedFallbackHuf || 50, settings.roundStep)
        : floorForFinish;
    const finalPrice = Math.max(floorForFinish, fallbackRaw);
    return {
      priceHuf: finalPrice,
      rawMarketHuf: null,
      floorApplied: floorForFinish,
      hitFloor: true,
      unpriced: true,
    };
  }

  const scaled = eurToHuf(eurNum, eurRate) * (1 + (Number(settings.marketPercent) || 0) / 100);
  const rounded = roundBulkHuf(scaled, settings.roundStep);
  const hitFloor = rounded < floorForFinish;
  return {
    priceHuf: Math.max(floorForFinish, rounded),
    rawMarketHuf,
    floorApplied: floorForFinish,
    hitFloor,
    unpriced: false,
  };
}

export function loadBulkPricingSettings(): BulkPricingSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_BULK_PRICING_SETTINGS };
  try {
    const raw = localStorage.getItem(STORE_BULK_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_BULK_PRICING_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_BULK_PRICING_SETTINGS,
      ...parsed,
      rarityFloors: { ...DEFAULT_RARITY_FLOORS, ...(parsed?.rarityFloors || {}) },
      rarityFixed: { ...DEFAULT_RARITY_FIXED, ...(parsed?.rarityFixed || {}) },
    };
  } catch {
    return { ...DEFAULT_BULK_PRICING_SETTINGS };
  }
}

export function saveBulkPricingSettings(settings: BulkPricingSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORE_BULK_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}
