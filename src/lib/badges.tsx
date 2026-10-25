import React from 'react';

export type BadgeIconType = 'sparkle' | 'crown' | 'gem' | 'award' | 'shield' | 'star' | 'verified' | 'leaf';

import { OWNER_ID } from './constants';

export interface CollectorTier {
  tier: number;
  game: string;
  gameTitle: string;
  nameEn: string;
  icon: string;
  iconType: BadgeIconType;
  percentage: number;
  ownedCount: number;
  totalCount: number;
  minPercentage: number;
  nextTierMin: number;
  color: string;
  bg: string;
  border: string;
  badgeStyle: React.CSSProperties;
}

export interface SellerTier {
  tier: number;
  nameEn: string;
  icon: string;
  iconType: BadgeIconType;
  /** Number of completed, distinct sales transactions (not total units/cards sold). */
  salesCount: number;
  minSales: number;
  nextTierSales: number;
  ratingAvg: number | null;
  isOwner: boolean;
  color: string;
  bg: string;
  border: string;
  badgeStyle: React.CSSProperties;
}

export function formatGameTitle(game: string): string {
  const g = (game || 'riftbound').toLowerCase();
  if (g === 'riftbound') return 'Riftbound';
  if (g === 'mtg') return 'MTG';
  if (g === 'onepiece') return 'One Piece';
  if (g === 'lorcana') return 'Disney Lorcana';
  if (g === 'starwars') return 'Star Wars: Unlimited';
  if (g === 'fab') return 'Flesh and Blood';
  return g.charAt(0).toUpperCase() + g.slice(1);
}

/**
 * How much each rarity counts toward a collector's completion percentage - not by raw card count,
 * by roughly how hard that card actually is to get. A Common and a Showcase both count as "1 card"
 * toward a flat owned/total ratio, despite one going for a few forints and the other for tens of
 * thousands - which made the last stretch to 100% no harder, by the numbers, than the first. This
 * weighting means the first 40-50% comes from cheap, plentiful staples (roughly half of any set),
 * and the top tiers genuinely require the expensive rare-and-up cards, matching how it actually
 * feels to chase a set.
 */
export const RARITY_DIFFICULTY_WEIGHT: Record<string, number> = {
  common: 1,
  uncommon: 1,
  rare: 2,
  epic: 3,
  showcase: 4,
  secret: 4,
  'nova rare': 6,
  // Magic: The Gathering
  mythic: 4,
  special: 3,
  bonus: 3,
  // One Piece Card Game
  leader: 2,
  promo: 2,
  'super rare': 3,
  'secret rare': 4,
  'treasure rare': 5,
  // Disney Lorcana
  legendary: 4,
  enchanted: 5,
  // Flesh and Blood
  majestic: 3,
  fabled: 6,
  token: 1,
};
/** A rarity this table doesn't name (a new one added later, or another game entirely) is treated
 * as moderately hard rather than silently as free (0) or as hard as the rarest known tier. */
const DEFAULT_RARITY_WEIGHT = 2;

export function weightForRarity(rarity: string | null | undefined): number {
  return RARITY_DIFFICULTY_WEIGHT[(rarity || '').trim().toLowerCase()] ?? DEFAULT_RARITY_WEIGHT;
}

/**
 * The rarity-weighted completion percentage for one game: each card in `cards` contributes its
 * rarity's weight to the total, and to the owned sum too if `ownedIds` has it. Shared by the
 * collector badge wherever it's computed - the profile page (from the local collection) and the
 * public-profile API route (from the synced cloud one) must weigh cards identically or the same
 * collector would see two different tiers depending on which page they're on.
 */
export function weightedCollectorPercentage(
  cards: { id: string; rarity: string | null }[],
  ownedIds: Set<string>
): number {
  let ownedWeight = 0;
  let totalWeight = 0;
  for (const c of cards) {
    const w = weightForRarity(c.rarity);
    totalWeight += w;
    if (ownedIds.has(c.id)) ownedWeight += w;
  }
  if (totalWeight <= 0) return 0;
  return Math.min(100, (ownedWeight / totalWeight) * 100);
}

/**
 * Calculates a game-specific collector tier based on unique cards owned in that game.
 *
 * `ownedInGameCount`/`totalInGameCount` are the plain card counts shown on the badge (e.g.
 * "612/1424 cards"). Which *tier* that lands in is decided by `weightedPercentage` when the
 * caller has it (rarity-weighted completion, 0-100) - callers that can't compute it (no rarity
 * breakdown at hand) fall back to the flat owned/total ratio.
 */
export function getCollectorTier(
  ownedInGameCount: number,
  totalInGameCount: number,
  game: string = 'riftbound',
  /** Ivory Parchment needs a darker shade of each tier's own color to stay readable on white. */
  isLight: boolean = false,
  weightedPercentage?: number
): CollectorTier {
  const gameTitle = formatGameTitle(game);
  const total = Math.max(1, totalInGameCount);
  const owned = Math.max(0, ownedInGameCount);
  const percentage = Math.min(100, Math.max(0, Math.round((owned / total) * 100)));

  if (percentage >= 100) {
    return {
      tier: 6,
      game,
      gameTitle,
      nameEn: `Mythic ${gameTitle} Completionist`,
      icon: '★',
      iconType: 'sparkle',
      percentage,
      ownedCount: owned,
      totalCount: total,
      minPercentage: 100,
      nextTierMin: 100,
      color: '#e879f9',
      bg: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(236, 72, 153, 0.25) 100%)',
      border: 'rgba(232, 121, 249, 0.6)',
      badgeStyle: {
        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(236, 72, 153, 0.25) 100%)',
        borderColor: 'rgba(232, 121, 249, 0.6)',
        color: isLight ? '#86198f' : '#f0abfc',
        boxShadow: '0 0 16px rgba(217, 70, 239, 0.35)',
      },
    };
  }

  if (percentage >= 90) {
    return {
      tier: 5,
      game,
      gameTitle,
      nameEn: `Master ${gameTitle} Collector`,
      icon: '★',
      iconType: 'crown',
      percentage,
      ownedCount: owned,
      totalCount: total,
      minPercentage: 90,
      nextTierMin: 100,
      color: '#fbbf24',
      bg: isLight ? '#18181b' : 'rgba(245, 158, 11, 0.2)',
      border: isLight ? '#f59e0b' : 'rgba(245, 158, 11, 0.5)',
      badgeStyle: {
        background: isLight ? '#18181b' : 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(234, 179, 8, 0.2) 100%)',
        borderColor: isLight ? '#f59e0b' : 'rgba(245, 158, 11, 0.5)',
        color: '#fde047',
        boxShadow: '0 0 14px rgba(245, 158, 11, 0.25)',
      },
    };
  }

  if (percentage >= 75) {
    return {
      tier: 4,
      game,
      gameTitle,
      nameEn: `Diamond ${gameTitle} Collector`,
      icon: '★',
      iconType: 'gem',
      percentage,
      ownedCount: owned,
      totalCount: total,
      minPercentage: 75,
      nextTierMin: 90,
      color: '#38bdf8',
      bg: 'rgba(56, 189, 248, 0.18)',
      border: 'rgba(56, 189, 248, 0.45)',
      badgeStyle: {
        background: 'rgba(56, 189, 248, 0.18)',
        borderColor: 'rgba(56, 189, 248, 0.45)',
        color: isLight ? '#0369a1' : '#7dd3fc',
        boxShadow: '0 0 12px rgba(56, 189, 248, 0.25)',
      },
    };
  }

  if (percentage >= 50) {
    return {
      tier: 3,
      game,
      gameTitle,
      nameEn: `Gold ${gameTitle} Collector`,
      icon: '★',
      iconType: 'award',
      percentage,
      ownedCount: owned,
      totalCount: total,
      minPercentage: 50,
      nextTierMin: 75,
      color: '#facc15',
      bg: isLight ? '#18181b' : 'rgba(250, 204, 21, 0.15)',
      border: isLight ? '#eab308' : 'rgba(250, 204, 21, 0.4)',
      badgeStyle: {
        background: isLight ? '#18181b' : 'rgba(250, 204, 21, 0.15)',
        borderColor: isLight ? '#eab308' : 'rgba(250, 204, 21, 0.4)',
        color: '#fde047',
      },
    };
  }

  if (percentage >= 25) {
    return {
      tier: 2,
      game,
      gameTitle,
      nameEn: `Silver ${gameTitle} Collector`,
      icon: '★',
      iconType: 'shield',
      percentage,
      ownedCount: owned,
      totalCount: total,
      minPercentage: 25,
      nextTierMin: 50,
      color: '#e2e8f0',
      bg: 'rgba(226, 232, 240, 0.12)',
      border: 'rgba(226, 232, 240, 0.35)',
      badgeStyle: {
        background: 'rgba(226, 232, 240, 0.12)',
        borderColor: 'rgba(226, 232, 240, 0.35)',
        color: isLight ? '#334155' : '#f1f5f9',
      },
    };
  }

  if (percentage >= 10) {
    return {
      tier: 1,
      game,
      gameTitle,
      nameEn: `Bronze ${gameTitle} Collector`,
      icon: '★',
      iconType: 'star',
      percentage,
      ownedCount: owned,
      totalCount: total,
      minPercentage: 10,
      nextTierMin: 25,
      color: '#fdba74',
      bg: 'rgba(251, 146, 60, 0.12)',
      border: 'rgba(251, 146, 60, 0.35)',
      badgeStyle: {
        background: 'rgba(251, 146, 60, 0.12)',
        borderColor: 'rgba(251, 146, 60, 0.35)',
        color: isLight ? '#c2410c' : '#fed7aa',
      },
    };
  }

  return {
    tier: 0,
    game,
    gameTitle,
    nameEn: `Novice ${gameTitle} Collector`,
    icon: '★',
    iconType: 'leaf',
    percentage,
    ownedCount: owned,
    totalCount: total,
    minPercentage: 0,
    nextTierMin: 10,
    color: '#a1a1aa',
    bg: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.15)',
    badgeStyle: {
      background: 'rgba(255, 255, 255, 0.06)',
      borderColor: 'rgba(255, 255, 255, 0.15)',
      color: isLight ? '#52525b' : '#d4d4d8',
    },
  };
}

/**
 * Calculates a seller tier based on the number of completed, distinct sales
 * (orders), not total units/cards sold — a buyer purchasing many cards in a
 * single order should not by itself vault a seller to the top tier.
 * Sellers with >= 1 completed sale receive a "Tier X Seller" badge.
 *
 * The site owner earns tiers the same way everyone else does; `isOwner` is
 * carried through only so the UI can render a separate "Site Owner" tag.
 */
export function getSellerTier(
  salesCount: number = 0,
  ratingAvg: number | null = null,
  isOwner: boolean = false,
  /** Ivory Parchment needs a darker shade of each tier's own color to stay readable on white. */
  isLight: boolean = false
): SellerTier {
  const sold = Math.max(0, salesCount);

  if (sold === 0) {
    return {
      tier: 0,
      nameEn: 'New Seller',
      icon: '★',
      iconType: 'leaf',
      salesCount: 0,
      minSales: 0,
      nextTierSales: 1,
      ratingAvg,
      isOwner,
      color: 'var(--text-secondary)',
      bg: 'var(--bg-surface-2)',
      border: 'var(--border-subtle)',
      badgeStyle: {
        background: 'var(--bg-surface-2)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-secondary)',
        backdropFilter: 'blur(8px)',
      },
    };
  }

  const baseThresholds = [1, 5, 15, 50, 150, 500, 1500, 5000];
  let tierNumber = 1;
  let minSales = 1;
  let nextTierSales = 5;

  if (sold >= baseThresholds[baseThresholds.length - 1]) {
    let currentMin = baseThresholds[baseThresholds.length - 1];
    tierNumber = baseThresholds.length;
    while (sold >= currentMin * 3) {
      currentMin *= 3;
      tierNumber++;
    }
    minSales = currentMin;
    nextTierSales = currentMin * 3;
  } else {
    for (let i = 0; i < baseThresholds.length; i++) {
      if (sold >= baseThresholds[i]) {
        tierNumber = i + 1;
        minSales = baseThresholds[i];
        nextTierSales = baseThresholds[i + 1] || minSales * 3;
      } else {
        break;
      }
    }
  }

  // Tier appearance palettes - use dynamic theme accent variables for readability and active customization
  const icons: BadgeIconType[] = ['verified', 'star', 'shield', 'award', 'gem', 'crown'];
  const iconType = icons[(tierNumber - 1) % icons.length];

  return {
    tier: tierNumber,
    nameEn: `Tier ${tierNumber} Seller`,
    icon: '★',
    iconType,
    salesCount: sold,
    minSales,
    nextTierSales,
    ratingAvg,
    isOwner,
    color: 'var(--text-accent)',
    bg: 'var(--accent-muted)',
    border: 'var(--accent-border)',
    badgeStyle: {
      background: 'var(--accent-muted)',
      borderColor: 'var(--accent-border)',
      color: 'var(--text-accent)',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 0 10px var(--accent-glow, rgba(0, 0, 0, 0.15))',
    },
  };
}

export function getTierBadgeLabel(badge: CollectorTier | SellerTier): string {
  return badge.nameEn;
}

/**
 * Resolves a unified SellerTier for any listing or seller object across the application.
 * Ensures marketplace listings, modal views, and user profiles all compute and render
 * the exact same tier and styling from the seller's sales record.
 */
export function resolveSellerTier(
  seller: {
    seller_sales_count?: number;
    seller_tier?: number;
    seller_badge?: string;
    seller_rating_avg?: number | null;
    seller_id?: string;
    seller_role?: string;
    is_owner?: boolean;
    sales_count?: number;
    rating_avg?: number | null;
  },
  isLight: boolean = false
): SellerTier {
  const isOwner = Boolean(
    seller.is_owner ||
    seller.seller_role === 'owner' ||
    seller.seller_badge === 'Owner' ||
    (seller.seller_id && seller.seller_id === OWNER_ID)
  );

  let sales: number | undefined = undefined;
  if (typeof seller.seller_sales_count === 'number') {
    sales = seller.seller_sales_count;
  } else if (typeof seller.sales_count === 'number') {
    sales = seller.sales_count;
  } else if (typeof seller.seller_tier === 'number') {
    sales = seller.seller_tier > 0 ? (seller.seller_tier === 1 ? 1 : 5 * Math.pow(3, seller.seller_tier - 2)) : 0;
  } else if (seller.seller_badge) {
    const match = seller.seller_badge.match(/Tier\s*(\d+)/i);
    if (match) {
      const t = parseInt(match[1], 10);
      sales = t > 0 ? (t === 1 ? 1 : 5 * Math.pow(3, t - 2)) : 0;
    } else if (seller.seller_badge.toLowerCase().includes('new seller')) {
      sales = 0;
    } else {
      sales = 0;
    }
  } else {
    sales = 0;
  }

  const rating = seller.seller_rating_avg !== undefined ? seller.seller_rating_avg : (seller.rating_avg ?? null);
  return getSellerTier(sales, rating, isOwner, isLight);
}

/**
 * Normalizes seller tier string for badge display.
 */
export function formatSellerTierBadge(badge?: string, tier?: number): string {
  if (typeof tier === 'number') {
    if (tier === 0) return 'New Seller';
    return `Tier ${tier} Seller`;
  }
  if (!badge) return '';
  const cleaned = badge.replace(/\bActive\b/gi, '').replace(/\s+/g, ' ').trim();
  if (cleaned.toLowerCase() === 'new seller') {
    return 'New Seller';
  }
  if (cleaned.toLowerCase() === 'seller') {
    return 'Tier 1 Seller';
  }
  const match = cleaned.match(/Tier\s*\d+\s*Seller/i);
  if (match) return match[0];
  return cleaned;
}

/**
 * Identity tag marking the account that runs the site. Separate from seller
 * tiers, which the owner earns through sales like anyone else.
 */
export function SiteOwnerTag({ className = '' }: { className?: string }) {
  return (
    <span
      className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider inline-flex items-center gap-1 border shadow-sm backdrop-blur-md ${className}`}
      style={{
        background: 'var(--accent-muted)',
        borderColor: 'var(--accent-border)',
        color: 'var(--text-accent)',
      }}
      title="Owner"
    >
      <BadgeIconSvg iconType="crown" className="w-3 h-3" />
      <span>Owner</span>
    </span>
  );
}

/**
 * Renders an inline SVG icon for badge tiers without Unicode emojis.
 */
export function BadgeIconSvg({ iconType, className = 'w-4 h-4' }: { iconType?: BadgeIconType; className?: string }) {
  switch (iconType) {
    case 'crown':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
        </svg>
      );
    case 'gem':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="6 3 18 3 22 9 12 22 2 9 6 3" />
          <line x1="11" y1="3" x2="8" y2="9" />
          <line x1="13" y1="3" x2="16" y2="9" />
          <line x1="2" y1="9" x2="22" y2="9" />
          <line x1="12" y1="22" x2="8" y2="9" />
          <line x1="12" y1="22" x2="16" y2="9" />
        </svg>
      );
    case 'award':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="6" />
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
        </svg>
      );
    case 'shield':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case 'verified':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'leaf':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
        </svg>
      );
    case 'star':
    default:
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
  }
}
