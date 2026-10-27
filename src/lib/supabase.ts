import { createClient } from '@supabase/supabase-js';
import type { SyntheticEvent } from 'react';

// Fallbacks for local dev and CI/CD builds so Astro builds without missing env vars
const supabaseUrl =
  import.meta.env.PUBLIC_SUPABASE_URL ||
  (typeof process !== 'undefined' ? process.env?.PUBLIC_SUPABASE_URL : '') ||
  'https://xtyfzkqubmzrsvduvzcl.supabase.co';

const supabaseAnonKey =
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY ||
  (typeof process !== 'undefined' ? process.env?.PUBLIC_SUPABASE_ANON_KEY : '') ||
  'sb_publishable_TqJ7KlZZFfTouv3xkudHQg_QcY2frPO';

const imageCdnUrl =
  import.meta.env.PUBLIC_IMAGE_CDN_URL ||
  (typeof process !== 'undefined' ? process.env?.PUBLIC_IMAGE_CDN_URL : '') ||
  'https://pub-fc12cf26538b49798ca89e43c2bf3c4a.r2.dev';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function getCardImageUrl(imagePath?: string | null): string {
  if (!imagePath) return '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  if (imageCdnUrl) {
    const base = imageCdnUrl.replace(/\/+$/, '');
    const clean = imagePath.replace(/^\/+/, '');
    return `${base}/${clean}`;
  }
  const { data } = supabase.storage.from('card-images').getPublicUrl(imagePath);
  return data.publicUrl;
}

/**
 * Small copies of the card images, for anywhere a card is shown as a tile or an avatar.
 *
 * The originals are 70-400KB each and a catalog page shows dozens at ~200px wide, so almost all of
 * the egress was pixels nobody could see. scripts/build_card_thumbnails.mjs writes these.
 *
 * The version is part of the path, which is what makes the year-long cache on them safe: if the
 * thumbnails ever have to be regenerated, bump this and every URL changes with it.
 */
export const THUMB_VERSION = 'v1';
const THUMB_WIDTHS = [240, 360, 480] as const;

/**
 * What each kind of tile tells the browser about how wide it will be drawn, so it picks a size.
 * The grid ones follow lib/gridSize.ts: columns of at least 140 / 190 / 260px, which on a desktop
 * come out a little wider than that. Saying more than a tile really gets made the browser fetch the
 * 360px thumbnail for ~185px tiles (Lighthouse: "image larger than it needs to be").
 */
const THUMB_SIZES = {
  /** Catalog and marketplace grid, Small: three across on a phone. */
  gridSmall: '(max-width: 640px) 31vw, 160px',
  /** Catalog and marketplace grid, Normal: two across on a phone. */
  grid: '(max-width: 640px) 46vw, 210px',
  /** Catalog and marketplace grid, Large: one across on a phone. */
  gridLarge: '(max-width: 640px) 92vw, 300px',
  /** Smaller tiles: the deck builder's card grid, deck previews. */
  tile: '160px',
  /** Icon-sized thumbnails beside a name. */
  avatar: '64px',
} as const;

const isAbsoluteUrl = (path: string) => path.startsWith('http://') || path.startsWith('https://');

export function getCardThumbUrl(imagePath?: string | null, width: (typeof THUMB_WIDTHS)[number] = 240): string {
  if (!imagePath) return '';
  if (isAbsoluteUrl(imagePath)) return imagePath;
  return getCardImageUrl(`thumbs/${THUMB_VERSION}/${width}/${imagePath}`);
}

/**
 * Props for an <img> showing a card at thumbnail size: `<img {...cardThumbProps(path, 'grid')} alt="" />`.
 *
 * A card added before the thumbnail script has run has no thumbnail yet, so a failed load falls back
 * to the full image, once, rather than leaving a broken tile.
 */
/** The thumbnail size for a catalog or marketplace grid at the viewer's chosen grid size. */
export function gridThumbSize(gridSize: 'small' | 'normal' | 'large' = 'normal'): keyof typeof THUMB_SIZES {
  return gridSize === 'small' ? 'gridSmall' : gridSize === 'large' ? 'gridLarge' : 'grid';
}

/**
 * `priority`: one of the first cards on the page, likely the largest thing on screen when it loads -
 * fetched straight away instead of waiting to be scrolled near.
 */
export function cardThumbProps(imagePath?: string | null, size: keyof typeof THUMB_SIZES = 'grid', priority = false) {
  if (!imagePath) return {};
  if (isAbsoluteUrl(imagePath)) {
    return {
      src: imagePath,
      loading: priority ? ('eager' as const) : ('lazy' as const),
      fetchPriority: priority ? ('high' as const) : undefined,
      decoding: 'async' as const,
    };
  }

  const full = getCardImageUrl(imagePath);
  return {
    src: getCardThumbUrl(imagePath, 240),
    srcSet: THUMB_WIDTHS.map((w) => `${getCardThumbUrl(imagePath, w)} ${w}w`).join(', '),
    sizes: THUMB_SIZES[size],
    loading: priority ? ('eager' as const) : ('lazy' as const),
    fetchPriority: priority ? ('high' as const) : undefined,
    decoding: 'async' as const,
    onError: (e: SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (img.dataset.fullFallback) return;
      img.dataset.fullFallback = '1';
      img.removeAttribute('srcset');
      img.src = full;
    },
  };
}
