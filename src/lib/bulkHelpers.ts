import { formatCurrencyPrice } from './currency';

/**
 * Helper utilities for bulk lots & bulk auctions:
 * - Card count labels
 * - Price per card calculation with '~' indicator for approximate counts
 * - Dynamic currency formatting (HUF / EUR)
 */

export function formatPricePerCard(
  totalPriceHuf: number,
  exactCount?: number | null,
  approxCount?: number | null,
  formatPriceFn?: (amountHuf: number) => string
): string | null {
  const count = exactCount || approxCount;
  if (!count || count <= 0 || !totalPriceHuf || totalPriceHuf <= 0) return null;

  const perCardHuf = totalPriceHuf / count;
  const isApprox = Boolean(approxCount);

  let formattedPrice: string;
  if (formatPriceFn) {
    formattedPrice = formatPriceFn(perCardHuf);
  } else {
    formattedPrice = formatCurrencyPrice(perCardHuf);
  }

  // Replace non-breaking spaces from Intl.NumberFormat with standard spaces
  formattedPrice = formattedPrice.replace(/\u00a0/g, ' ');

  return `${isApprox ? '~' : ''}${formattedPrice} / card`;
}

export function getBulkCountLabel(
  exactCount?: number | null,
  approxCount?: number | null
): string {
  if (exactCount && approxCount) {
    return `${exactCount} Cards (Exact) / ~${approxCount}`;
  }
  if (exactCount) {
    return `${exactCount} Cards`;
  }
  return `~${approxCount || 0} Cards`;
}

export interface AuctionBulkInfo {
  isBulk: boolean;
  exactCount?: number | null;
  approxCount?: number | null;
  countLabel: string;
}

export function extractAuctionBulkInfo(auction: {
  exact_card_count?: number | null;
  approx_card_count?: number | null;
  is_bulk?: boolean;
  description?: string | null;
}): AuctionBulkInfo {
  let exact = auction.exact_card_count;
  let approx = auction.approx_card_count;
  let isBulk = Boolean(auction.is_bulk || exact || approx);

  if (!isBulk && auction.description) {
    const match = auction.description.match(/Lot Card Count:\s*(~?\d+)\s*cards?(?:\s*\((exact|approx)\))?/i);
    if (match) {
      isBulk = true;
      const numStr = match[1].replace('~', '');
      const num = parseInt(numStr, 10);
      if (match[1].startsWith('~') || match[2]?.toLowerCase() === 'approx') {
        approx = num;
      } else {
        exact = num;
      }
    }
  }

  return {
    isBulk,
    exactCount: exact ?? null,
    approxCount: approx ?? null,
    countLabel: isBulk ? getBulkCountLabel(exact, approx) : '',
  };
}
