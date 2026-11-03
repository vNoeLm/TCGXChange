import React, { useEffect, useState, useRef } from 'react';
import { supabase, getCardImageUrl, cardThumbProps } from '../../lib/supabase';
import { updateProfile, uploadCustomAvatar } from '../../lib/auth';
import { COUNTRIES, getCountry } from '../../lib/countries';
import { CountryFlag } from '../CountryFlag';
import type { UserSocialProfiles } from '../../types';
import { FacebookIcon, DiscordIcon, InstagramIcon } from './SocialProfileButtons';
import { useLanguage } from '../../lib/i18n';
import { backdropCloseProps } from '../../lib/modalBackdrop';
import { GAMES } from '../../lib/constants';

export const PRESET_BANNERS: Array<{ id: string; label: string; value: string; previewStyle: React.CSSProperties }> = [
  {
    id: 'fury',
    label: 'Fury Ember',
    value: 'preset:fury',
    previewStyle: { background: 'linear-gradient(135deg, #450a0a 0%, #991b1b 45%, #ea580c 100%)' },
  },
  {
    id: 'mind',
    label: 'Arcane Mind',
    value: 'preset:mind',
    previewStyle: { background: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 50%, #06b6d4 100%)' },
  },
  {
    id: 'chaos',
    label: 'Void Chaos',
    value: 'preset:chaos',
    previewStyle: { background: 'linear-gradient(135deg, #1e1b4b 0%, #6b21a8 50%, #db2777 100%)' },
  },
  {
    id: 'calm',
    label: 'Ionian Calm',
    value: 'preset:calm',
    previewStyle: { background: 'linear-gradient(135deg, #052e16 0%, #15803d 50%, #0d9488 100%)' },
  },
  {
    id: 'order',
    label: 'Radiant Order',
    value: 'preset:order',
    previewStyle: { background: 'linear-gradient(135deg, #422006 0%, #b45309 45%, #facc15 100%)' },
  },
  {
    id: 'body',
    label: 'Titan Body',
    value: 'preset:body',
    previewStyle: { background: 'linear-gradient(135deg, #27272a 0%, #7c2d12 50%, #f97316 100%)' },
  },
];

export interface ImageAdjustments {
  url: string | null;
  x: number;     // 0-100%, default 50%
  y: number;     // 0-100%, default 25% for avatar, 22% for banner
  zoom: number;  // 100-250%, default 140% for card avatar, 100% for banner
  blur: number;  // 0-100%
}

/** Parses image URL and URL hash adjustments (x, y, zoom, blur) */
export function parseImageAdjustments(
  val?: string | null,
  defaults: { x?: number; y?: number; zoom?: number; blur?: number } = {}
): ImageAdjustments {
  if (!val) {
    return {
      url: null,
      x: defaults.x ?? 50,
      y: defaults.y ?? 25,
      zoom: defaults.zoom ?? 100,
      blur: defaults.blur ?? 0,
    };
  }
  const hashIdx = val.indexOf('#');
  if (hashIdx === -1) {
    return {
      url: val.trim(),
      x: defaults.x ?? 50,
      y: defaults.y ?? 25,
      zoom: defaults.zoom ?? 100,
      blur: defaults.blur ?? 0,
    };
  }
  const cleanUrl = val.slice(0, hashIdx).trim();
  const hashStr = val.slice(hashIdx + 1);
  const params = new URLSearchParams(hashStr);
  const blurLegacy = hashStr.startsWith('blur=') ? parseInt(hashStr.slice(5), 10) : NaN;
  const blur = params.has('blur') ? parseInt(params.get('blur')!, 10) : (!isNaN(blurLegacy) ? blurLegacy : (defaults.blur ?? 0));
  const x = params.has('x') ? parseInt(params.get('x')!, 10) : (defaults.x ?? 50);
  const y = params.has('y') ? parseInt(params.get('y')!, 10) : (defaults.y ?? 25);
  const zoom = params.has('z') ? parseInt(params.get('z')!, 10) : (defaults.zoom ?? 100);

  return {
    url: cleanUrl || null,
    x: isNaN(x) ? (defaults.x ?? 50) : Math.max(0, Math.min(100, x)),
    y: isNaN(y) ? (defaults.y ?? 25) : Math.max(0, Math.min(100, y)),
    zoom: isNaN(zoom) ? (defaults.zoom ?? 100) : Math.max(100, Math.min(250, zoom)),
    blur: isNaN(blur) ? (defaults.blur ?? 0) : Math.max(0, Math.min(100, blur)),
  };
}

/** Formats clean image URL with optional position, zoom, and blur into composite hash string */
export function formatImageAdjustments(
  cleanUrl: string | null | undefined,
  opts: { x?: number; y?: number; zoom?: number; blur?: number }
): string | null {
  if (!cleanUrl) return null;
  const base = cleanUrl.split('#')[0].trim();
  if (!base) return null;
  const params: string[] = [];
  if (opts.y !== undefined) params.push(`y=${Math.round(opts.y)}`);
  if (opts.x !== undefined && opts.x !== 50) params.push(`x=${Math.round(opts.x)}`);
  if (opts.zoom !== undefined) params.push(`z=${Math.round(opts.zoom)}`);
  if (opts.blur !== undefined && opts.blur > 0) params.push(`blur=${Math.round(opts.blur)}`);
  return params.length > 0 ? `${base}#${params.join('&')}` : base;
}

/** Resolves CSS properties for avatar img to honor positioning and zoom */
export function resolveAvatarImageStyle(avatarUrl?: string | null): React.CSSProperties {
  if (!avatarUrl) return {};
  const { x, y, zoom } = parseImageAdjustments(avatarUrl, { x: 50, y: 25, zoom: 140 });
  return {
    objectPosition: `${x}% ${y}%`,
    transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
    transformOrigin: `${x}% ${y}%`,
  };
}

/** Parse composite banner value into clean URL/preset and blur percentage (0-100) and position/zoom */
export function parseBannerValue(bannerValue?: string | null): { url: string | null; blur: number; x: number; y: number; zoom: number } {
  const adj = parseImageAdjustments(bannerValue, { x: 50, y: 22, zoom: 100, blur: 0 });
  return {
    url: adj.url,
    blur: adj.blur,
    x: adj.x,
    y: adj.y,
    zoom: adj.zoom,
  };
}

/** Formats clean URL/preset with blur percentage into composite string */
export function formatBannerValue(
  cleanUrl: string | null | undefined,
  blurPercent: number,
  adjustments?: { x?: number; y?: number; zoom?: number }
): string | null {
  return formatImageAdjustments(cleanUrl, {
    blur: blurPercent,
    x: adjustments?.x,
    y: adjustments?.y,
    zoom: adjustments?.zoom,
  });
}

/** Resolves background styling for banner image/preset */
export function resolveBannerBackgroundStyle(cleanUrl?: string | null, adjustments?: { x?: number; y?: number }): React.CSSProperties {
  if (!cleanUrl) return { background: 'var(--bg-surface)' };
  const preset = PRESET_BANNERS.find((p) => p.value === cleanUrl);
  if (preset) return preset.previewStyle;
  const x = adjustments?.x ?? 50;
  const y = adjustments?.y ?? 22;
  return {
    backgroundImage: `url("${cleanUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: `${x}% ${y}%`,
  };
}

/** Backward compatibility helper */
export function resolveBannerStyle(bannerUrl?: string | null): React.CSSProperties | null {
  if (!bannerUrl) return null;
  const { url, x, y } = parseBannerValue(bannerUrl);
  if (!url) return null;
  const preset = PRESET_BANNERS.find((p) => p.value === url);
  if (preset) return preset.previewStyle;
  return {
    backgroundImage: `linear-gradient(to bottom, rgba(9, 9, 11, 0.25) 0%, rgba(9, 9, 11, 0.78) 100%), url("${url}")`,
    backgroundSize: 'cover',
    backgroundPosition: `${x}% ${y}%`,
  };
}

/**
 * Reusable background layer for containers carrying a banner.
 * Supports configurable blur percentage and a contrast overlay so content and text
 * remain 100% legible in both light and dark themes.
 */
export function BannerContainerBackground({
  bannerUrl,
  isLightTheme = false,
  blurOverride,
  className = '',
}: {
  bannerUrl?: string | null;
  isLightTheme?: boolean;
  blurOverride?: number;
  className?: string;
}) {
  const { url, blur, x, y, zoom } = parseBannerValue(bannerUrl);
  if (!url) {
    return (
      <div
        className={`absolute inset-0 pointer-events-none transition-colors duration-200 ${className}`}
        style={{ background: 'var(--bg-surface)' }}
      />
    );
  }

  const effectiveBlur = blurOverride !== undefined ? blurOverride : blur;
  const blurPx = Math.round((Math.max(0, Math.min(100, effectiveBlur)) / 100) * 22);
  const bgStyle = resolveBannerBackgroundStyle(url, { x, y });
  const zoomScale = zoom / 100;

  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}>
      {/* Blurred/Sharp artwork layer */}
      <div
        className={`absolute ${blurPx > 0 ? 'inset-[-18px]' : 'inset-0'} bg-cover transition-all duration-200`}
        style={{
          ...bgStyle,
          backgroundPosition: `${x}% ${y}%`,
          filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
          transform: (zoomScale !== 1 || blurPx > 0) ? `scale(${zoomScale * (blurPx > 0 ? 1.05 : 1)})` : undefined,
          transformOrigin: `${x}% ${y}%`,
        }}
      />
      {/* Legibility contrast overlay */}
      <div
        className="absolute inset-0 transition-colors duration-200"
        style={{
          background: isLightTheme
            ? 'linear-gradient(110deg, rgba(243, 237, 226, 0.62) 0%, rgba(243, 237, 226, 0.28) 52%, rgba(243, 237, 226, 0.38) 100%)'
            : 'var(--banner-overlay, linear-gradient(110deg, rgba(9, 13, 22, 0.72) 0%, rgba(9, 13, 22, 0.50) 52%, rgba(9, 13, 22, 0.68) 100%))',
        }}
      />
    </div>
  );
}

interface InteractiveImageCropperProps {
  mode: 'avatar' | 'banner';
  imageUrl: string;
  x: number;
  y: number;
  zoom: number;
  onChange: (updates: { x?: number; y?: number; zoom?: number }) => void;
  onReset: () => void;
}

/**
 * Interactive direct-manipulation image cropper.
 * Users drag the image directly with pointer/touch and see in real time
 * what stays inside the frame and what gets cut off (via a darkened mask).
 */
export function InteractiveImageCropper({
  mode,
  imageUrl,
  x,
  y,
  zoom,
  onChange,
  onReset,
}: InteractiveImageCropperProps) {
  const { t, lang } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number }>({ w: 300, h: 420 });

  // Cutout dimensions:
  // Avatar: 170px circle
  // Banner: 420px x 72px rounded rectangle (5.83:1 aspect ratio matching the profile banner container)
  const cropW = mode === 'avatar' ? 170 : 420;
  const cropH = mode === 'avatar' ? 170 : 72;

  // Base scale so image fills the crop window at 100% zoom
  const baseScale = Math.max(cropW / (naturalDims.w || 300), cropH / (naturalDims.h || 420));
  const scale = baseScale * (zoom / 100);
  const imgW = (naturalDims.w || 300) * scale;
  const imgH = (naturalDims.h || 420) * scale;

  // Pixel offsets inside the crop window
  const left = (cropW - imgW) * (x / 100);
  const top = (cropH - imgH) * (y / 100);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    pointerStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: x,
      startY: y,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStartRef.current) return;
    const dx = e.clientX - pointerStartRef.current.clientX;
    const dy = e.clientY - pointerStartRef.current.clientY;

    const spanX = imgW - cropW;
    const spanY = imgH - cropH;

    let nextX = pointerStartRef.current.startX;
    let nextY = pointerStartRef.current.startY;

    if (spanX > 0) {
      nextX = Math.max(0, Math.min(100, pointerStartRef.current.startX - (dx / spanX) * 100));
    } else {
      nextX = 50;
    }

    if (spanY > 0) {
      nextY = Math.max(0, Math.min(100, pointerStartRef.current.startY - (dy / spanY) * 100));
    } else {
      nextY = 50;
    }

    onChange({ x: Math.round(nextX), y: Math.round(nextY) });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = null;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -5 : 5;
    const maxZoom = mode === 'avatar' ? 250 : 220;
    const nextZoom = Math.max(100, Math.min(maxZoom, zoom + delta));
    onChange({ zoom: nextZoom });
  };

  return (
    <div className="space-y-2.5">
      {/* Interactive Drag & Crop Viewport */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        className={`relative w-full rounded-2xl bg-zinc-950 border overflow-hidden select-none touch-none ${
          mode === 'avatar' ? 'h-[250px]' : 'h-[180px]'
        } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ borderColor: 'var(--border)' }}
      >
        {/* Centered Crop Stage */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ width: `${cropW}px`, height: `${cropH}px` }}
        >
          {/* Full Image */}
          <img
            src={imageUrl}
            alt="Adjusting"
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget;
              if (naturalWidth && naturalHeight) {
                setNaturalDims({ w: naturalWidth, h: naturalHeight });
              }
            }}
            draggable={false}
            className="max-w-none transition-none"
            style={{
              position: 'absolute',
              width: `${imgW}px`,
              height: `${imgH}px`,
              left: `${left}px`,
              top: `${top}px`,
            }}
          />

          {/* Rule-of-thirds grid while dragging */}
          {isDragging && (
            <div
              className={`absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-white/20 transition-opacity duration-150 ${
                mode === 'avatar' ? 'rounded-full overflow-hidden' : 'rounded-xl'
              }`}
            >
              <div className="border-r border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-b border-white/20" />
              <div className="border-r border-white/20" />
              <div className="border-r border-white/20" />
              <div />
            </div>
          )}
        </div>

        {/* SVG Mask Darkening everything outside the cutout */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none select-none">
          <defs>
            <mask id={`crop-mask-${mode}`}>
              <rect width="100%" height="100%" fill="white" />
              {mode === 'avatar' ? (
                <circle cx="50%" cy="50%" r={cropW / 2} fill="black" />
              ) : (
                <rect
                  x="50%"
                  y="50%"
                  width={cropW}
                  height={cropH}
                  transform={`translate(-${cropW / 2}, -${cropH / 2})`}
                  rx="12"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(9, 13, 22, 0.72)"
            mask={`url(#crop-mask-${mode})`}
          />
          {mode === 'avatar' ? (
            <circle
              cx="50%"
              cy="50%"
              r={cropW / 2}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeDasharray={isDragging ? 'none' : '5 4'}
            />
          ) : (
            <rect
              x="50%"
              y="50%"
              width={cropW}
              height={cropH}
              transform={`translate(-${cropW / 2}, -${cropH / 2})`}
              rx="12"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              strokeDasharray={isDragging ? 'none' : '5 4'}
            />
          )}
        </svg>

        {/* Floating guidance badge */}
        <div
          className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 shadow-md pointer-events-none backdrop-blur-md"
          style={{ background: 'rgba(9, 13, 22, 0.85)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <svg className="w-3.5 h-3.5 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <polyline points="5 9 2 12 5 15" />
            <polyline points="9 5 12 2 15 5" />
            <polyline points="15 19 12 22 9 19" />
            <polyline points="19 9 22 12 19 15" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="12" y1="2" x2="12" y2="22" />
          </svg>
          <span>
            {mode === 'avatar'
              ? t('Drag image to position inside circle', 'Húzd a képet a körön belüli pozicionáláshoz')
              : t('Drag image to position inside banner', 'Húzd a képet a borítón belüli pozicionáláshoz')}
          </span>
        </div>
      </div>

      {/* Zoom Bar & Controls */}
      <div className="p-3 rounded-xl border flex flex-col gap-2.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            <span>{t('Zoom & Scale', 'Nagyítás és méretezés')}</span>
          </div>
          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}>
            {zoom}%
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onChange({ zoom: Math.max(100, zoom - 10) })}
            disabled={zoom <= 100}
            className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition disabled:opacity-40 hover:bg-[var(--bg-surface)] shrink-0"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            title={t('Zoom Out', 'Kicsinyítés')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <input
            type="range"
            min="100"
            max={mode === 'avatar' ? 250 : 220}
            step="5"
            value={zoom}
            onChange={(e) => onChange({ zoom: Number(e.target.value) })}
            className="flex-1 h-2 rounded-lg cursor-pointer appearance-none outline-none accent-[var(--accent)]"
            style={{ background: 'var(--bg-input)' }}
          />

          <button
            type="button"
            onClick={() => onChange({ zoom: Math.min(mode === 'avatar' ? 250 : 220, zoom + 10) })}
            disabled={zoom >= (mode === 'avatar' ? 250 : 220)}
            className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition disabled:opacity-40 hover:bg-[var(--bg-surface)] shrink-0"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            title={t('Zoom In', 'Nagyítás')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onReset}
            className="h-8 px-3 rounded-lg border text-xs font-bold cursor-pointer transition hover:bg-[var(--bg-surface)] shrink-0"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t('Reset', 'Alaphelyzet')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CardChoice {
  id: string;
  name: string;
  card_number: string;
  card_type: string;
  rarity: string;
  image_path: string;
}

export function AvatarBannerModal({

  open,
  onClose,
  currentAvatarUrl,
  currentBannerUrl,
  displayName,
  email,
  currentCountry = 'HU',
  initialSocialProfiles,
  onSaved,
  onDeleteAccount,
}: {
  open: boolean;
  onClose: () => void;
  currentAvatarUrl: string | null;
  currentBannerUrl: string | null;
  displayName: string;
  email?: string | null;
  currentCountry?: string | null;
  initialSocialProfiles?: UserSocialProfiles | null;
  onSaved: (next: {
    display_name: string;
    country: string;
    avatar_url: string | null;
    banner_url: string | null;
    social_profiles?: UserSocialProfiles;
  }) => void;
  /** Jumps to the account deletion card; the owner account does not get one. */
  onDeleteAccount?: () => void;
}) {
  const [tab, setTab] = useState<'avatar' | 'banner' | 'socials'>('avatar');
  const [name, setName] = useState(displayName);
  const [country, setCountry] = useState(currentCountry || 'HU');

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarX, setAvatarX] = useState<number>(50);
  const [avatarY, setAvatarY] = useState<number>(25);
  const [avatarZoom, setAvatarZoom] = useState<number>(140);

  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerX, setBannerX] = useState<number>(50);
  const [bannerY, setBannerY] = useState<number>(22);
  const [bannerZoom, setBannerZoom] = useState<number>(100);
  const [blurPercent, setBlurPercent] = useState<number>(0);

  const [facebookUrl, setFacebookUrl] = useState(initialSocialProfiles?.facebook_url || '');
  const [discordTag, setDiscordTag] = useState(initialSocialProfiles?.discord_tag || '');
  const [instagramUrl, setInstagramUrl] = useState(initialSocialProfiles?.instagram_url || '');
  const [search, setSearch] = useState('');
  const [selectedGame, setSelectedGame] = useState<string>('riftbound');
  const [cards, setCards] = useState<CardChoice[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, lang } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(displayName);
      setCountry(currentCountry || 'HU');

      const parsedAvatar = parseImageAdjustments(currentAvatarUrl, { x: 50, y: 25, zoom: 140 });
      setAvatarUrl(parsedAvatar.url);
      setAvatarX(parsedAvatar.x);
      setAvatarY(parsedAvatar.y);
      setAvatarZoom(parsedAvatar.zoom);

      const parsedBanner = parseBannerValue(currentBannerUrl);
      setBannerUrl(parsedBanner.url);
      setBannerX(parsedBanner.x);
      setBannerY(parsedBanner.y);
      setBannerZoom(parsedBanner.zoom);
      setBlurPercent(parsedBanner.blur);

      setFacebookUrl(initialSocialProfiles?.facebook_url || '');
      setDiscordTag(initialSocialProfiles?.discord_tag || '');
      setInstagramUrl(initialSocialProfiles?.instagram_url || '');
      setError(null);
    }
  }, [open, displayName, currentCountry, currentAvatarUrl, currentBannerUrl, initialSocialProfiles]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingCards(true);
    const timer = setTimeout(async () => {
      try {
        let query = supabase
          .from('cards')
          .select('id, name, card_number, card_type, rarity, image_path, game')
          .eq('game', selectedGame)
          .not('image_path', 'is', null)
          .limit(60);

        if (search.trim()) {
          query = query.ilike('name', `%${search.trim()}%`);
        }

        const { data } = await query;
        if (!cancelled) {
          setCards((data || []).filter((c: any) => Boolean(c.image_path)) as CardChoice[]);
        }
      } catch {} finally {
        if (!cancelled) setLoadingCards(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search, selectedGame]);

  if (!open) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError(t('Please choose an image smaller than 8 MB.', 'Kérjük, válassz 8 MB-nál kisebb képet.'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { avatar_url } = await uploadCustomAvatar(file);
      setAvatarUrl(avatar_url);
      setAvatarX(50);
      setAvatarY(50);
      setAvatarZoom(100);
    } catch (err: any) {
      setError(err.message || t('Failed to upload avatar.', 'Nem sikerült feltölteni a profilképet.'));
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('Display name cannot be empty.', 'A megjelenített név nem lehet üres.'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const finalAvatar = avatarUrl
        ? formatImageAdjustments(avatarUrl, { x: avatarX, y: avatarY, zoom: avatarZoom })
        : null;
      const finalBanner = bannerUrl
        ? formatBannerValue(bannerUrl, blurPercent, { x: bannerX, y: bannerY, zoom: bannerZoom })
        : null;
      const nextSocial: UserSocialProfiles = {
        ...(initialSocialProfiles || {}),
        facebook_url: facebookUrl.trim() || null,
        discord_tag: discordTag.trim() || null,
        instagram_url: instagramUrl.trim() || null,
      };
      await updateProfile({
        display_name: trimmed,
        country,
        avatar_url: finalAvatar,
        banner_url: finalBanner,
        social_profiles: nextSocial,
      });
      onSaved({
        display_name: trimmed,
        country,
        avatar_url: finalAvatar,
        banner_url: finalBanner,
        social_profiles: nextSocial,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || t('Could not save profile settings.', 'Nem sikerült elmenteni a profilbeállításokat.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      {...backdropCloseProps(onClose)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border overflow-hidden flex flex-col max-h-[90vh]"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 border-b flex items-center justify-between gap-3"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div>
            <h3 className="text-base font-black flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>{t('Profile Settings', 'Profil beállítások')}</span>
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {t('Customize your display name, country, profile picture, and container banner in one place.', 'Szabd testre a neved, országod, profilképed és borítóképed egy helyen.')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition hover:bg-[var(--bg-surface-2)]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            aria-label={t('Close', 'Bezárás')}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Name & Country Inputs */}
        <div className="px-5 pt-4 pb-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
            <div>
              <label className="text-xs font-bold block mb-1.5" style={{ color: 'var(--text-primary)' }}>
                {t('Display Name', 'Megjelenített név')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("Enter display name", "Add meg a megjelenített neved")}
                maxLength={50}
                className="w-full h-9 px-3 rounded-lg text-xs font-bold border outline-none focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
              {email && (
                <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono px-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  <span>{t('Email:', 'Email cím:')} <strong className="font-semibold text-[var(--text-secondary)]">{email}</strong></span>
                  <span className="text-[10px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                    {t('Read-only', 'Csak olvasható')}
                  </span>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-bold block mb-1.5" style={{ color: 'var(--text-primary)' }}>
                {t('Country / Region', 'Ország / Régió')}
              </label>
              <div className="relative">
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-lg text-xs font-bold border outline-none cursor-pointer focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <CountryFlag countryCode={country} className="w-4 h-3 rounded-[2px]" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live Preview (Banner ON the container with blur %) */}
        <div className="px-5 pt-3">
          <div
            className="relative rounded-xl border overflow-hidden p-4 flex items-center gap-3.5 min-h-[96px]"
            style={{ borderColor: 'var(--border)', boxShadow: 'var(--shadow-card)' }}
          >
            <BannerContainerBackground
              bannerUrl={bannerUrl ? formatBannerValue(bannerUrl, blurPercent, { x: bannerX, y: bannerY, zoom: bannerZoom }) : null}
              blurOverride={blurPercent}
            />

            <div className="relative z-10 flex items-center gap-3.5 w-full">
              {avatarUrl ? (
                <div
                  className="w-16 h-16 rounded-2xl border-2 shrink-0 shadow-md bg-zinc-950 overflow-hidden relative"
                  style={{ borderColor: 'var(--accent)' }}
                >
                  <img
                    src={avatarUrl}
                    alt={name || 'User'}
                    className="w-full h-full object-cover transition-transform duration-150"
                    style={{
                      objectPosition: `${avatarX}% ${avatarY}%`,
                      transform: avatarZoom !== 100 ? `scale(${avatarZoom / 100})` : undefined,
                      transformOrigin: `${avatarX}% ${avatarY}%`,
                    }}
                  />
                </div>
              ) : (
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black border-2 shrink-0 shadow-md"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
                >
                  {(name.trim() || 'C').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-black truncate" style={{ color: 'var(--text-primary)' }}>
                    {name.trim() || t('Valued Collector', 'Értékes gyűjtő')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <CountryFlag countryCode={country} className="w-3.5 h-2.5 rounded-[2px]" />
                    <span>{getCountry(country).name}</span>
                  </span>
                </div>
                <div className="text-[11px] font-semibold flex items-center gap-2 flex-wrap mt-1" style={{ color: 'var(--text-secondary)' }}>
                  <span>{t('Live Preview', 'Élő előnézet')}</span>
                  {bannerUrl && (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}>
                      Blur: {blurPercent}%
                    </span>
                  )}
                  {avatarUrl && (avatarZoom !== 100 || avatarY !== 25) && (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}>
                      PFP: {avatarZoom}% (Y: {avatarY}%)
                    </span>
                  )}
                  {(facebookUrl.trim() || discordTag.trim() || instagramUrl.trim()) && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      {facebookUrl.trim() && <span className="text-[#1877F2]" title={t('Facebook configured', 'Facebook beállítva')}><FacebookIcon className="w-3.5 h-3.5" /></span>}
                      {discordTag.trim() && <span className="text-[#5865F2]" title={t('Discord configured', 'Discord beállítva')}><DiscordIcon className="w-3.5 h-3.5" /></span>}
                      {instagramUrl.trim() && <span className="text-[#E4405F]" title={t('Instagram configured', 'Instagram beállítva')}><InstagramIcon className="w-3.5 h-3.5" /></span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="px-5 pt-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 p-1 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
            <button
              type="button"
              onClick={() => setTab('avatar')}
              className="px-3.5 py-1.5 rounded-lg text-xs font-black cursor-pointer transition"
              style={
                tab === 'avatar'
                  ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              1. {t('Profile Picture (PFP)', 'Profilkép (PFP)')}
            </button>
            <button
              type="button"
              onClick={() => setTab('banner')}
              className="px-3.5 py-1.5 rounded-lg text-xs font-black cursor-pointer transition"
              style={
                tab === 'banner'
                  ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              2. {t('Container Banner & Blur', 'Borítókép és homályosítás')}
            </button>
            <button
              type="button"
              onClick={() => setTab('socials')}
              className="px-3.5 py-1.5 rounded-lg text-xs font-black cursor-pointer transition"
              style={
                tab === 'socials'
                  ? { background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              3. {t('Social Links', 'Közösségi linkek')}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {tab === 'avatar' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-8 px-3 rounded-lg border text-xs font-bold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>{uploading ? t('Compressing…', 'Tömörítés…') : t('Upload custom PFP (~8 KB)', 'Egyéni PFP feltöltése (~8 KB)')}</span>
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    className="h-8 px-2.5 rounded-lg border text-xs font-semibold cursor-pointer"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                  >
                    {t('Reset PFP', 'PFP visszaállítása')}
                  </button>
                )}
              </>
            )}
            {tab === 'banner' && bannerUrl && (
              <button
                type="button"
                onClick={() => {
                  setBannerUrl(null);
                  setBlurPercent(0);
                }}
                className="h-8 px-2.5 rounded-lg border text-xs font-semibold cursor-pointer"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
              >
                {t('Remove Banner', 'Borítókép eltávolítása')}
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-3 flex-1 overflow-y-auto space-y-4 min-h-0">
          {error && (
            <div className="rounded-xl border px-3 py-2 text-xs font-bold text-red-400 bg-red-500/10 border-red-500/30">
              {error}
            </div>
          )}

          {tab === 'avatar' && avatarUrl && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                  <span>{t('Avatar Framing (Interactive)', 'Profilkép pozicionálása (Interaktív)')}</span>
                </span>
                <span className="text-[11px] font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Drag image directly to frame your PFP', 'Húzd a képet közvetlenül a profilkép beállításához')}
                </span>
              </div>
              <InteractiveImageCropper
                mode="avatar"
                imageUrl={avatarUrl}
                x={avatarX}
                y={avatarY}
                zoom={avatarZoom}
                onChange={({ x: nextX, y: nextY, zoom: nextZoom }) => {
                  if (nextX !== undefined) setAvatarX(nextX);
                  if (nextY !== undefined) setAvatarY(nextY);
                  if (nextZoom !== undefined) setAvatarZoom(nextZoom);
                }}
                onReset={() => {
                  setAvatarX(50);
                  setAvatarY(25);
                  setAvatarZoom(140);
                }}
              />
            </div>
          )}

          {tab === 'banner' && (
            <>
              {/* Blur Option & Percentage Control */}
              <div
                className="rounded-xl border p-3.5 space-y-2.5"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md flex items-center justify-center border border-amber-500/30 bg-amber-500/10 text-amber-400">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                      </svg>
                    </span>
                    <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>
                      {t('Container Banner Blur', 'Borítókép homályosítása')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="px-2 py-0.5 rounded-md text-xs font-mono font-black border"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-accent)' }}
                    >
                      {blurPercent}%
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>0%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={blurPercent}
                    onChange={(e) => setBlurPercent(Number(e.target.value))}
                    className="tv-range-slider flex-1 h-2 rounded-lg cursor-pointer appearance-none outline-none accent-[var(--accent)]"
                    style={{ background: 'var(--bg-input)' }}
                  />
                  <span className="text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>100%</span>
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  {[
                    { label: lang === 'hu' ? '0% Éles' : '0% Sharp', val: 0 },
                    { label: lang === 'hu' ? '20% Finom' : '20% Subtle', val: 20 },
                    { label: lang === 'hu' ? '40% Kiegyensúlyozott' : '40% Balanced', val: 40 },
                    { label: lang === 'hu' ? '65% Sima' : '65% Smooth', val: 65 },
                    { label: lang === 'hu' ? '90% Matt' : '90% Frosted', val: 90 },
                  ].map((p) => {
                    const active = blurPercent === p.val;
                    return (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => setBlurPercent(p.val)}
                        className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition"
                        style={
                          active
                            ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                            : { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                        }
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Blurs the background artwork on your profile container so your name, email, badges, and buttons remain easy to read.', 'Elhomályosítja a profilkeret hátterét, hogy a neved, jelvényeid és gombjaid jól olvashatóak maradjanak.')}
                </p>
              </div>

              {/* Interactive Banner Cropper for Card Artworks */}
              {bannerUrl && !PRESET_BANNERS.some((p) => p.value === bannerUrl) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                      </svg>
                      <span>{t('Banner Framing (Interactive)', 'Borítókép pozicionálása (Interaktív)')}</span>
                    </span>
                    <span className="text-[11px] font-normal" style={{ color: 'var(--text-tertiary)' }}>
                      {t('Drag image directly to position inside banner', 'Húzd a képet közvetlenül a borítóban')}
                    </span>
                  </div>
                  <InteractiveImageCropper
                    mode="banner"
                    imageUrl={bannerUrl}
                    x={bannerX}
                    y={bannerY}
                    zoom={bannerZoom}
                    onChange={({ x: nextX, y: nextY, zoom: nextZoom }) => {
                      if (nextX !== undefined) setBannerX(nextX);
                      if (nextY !== undefined) setBannerY(nextY);
                      if (nextZoom !== undefined) setBannerZoom(nextZoom);
                    }}
                    onReset={() => {
                      setBannerX(50);
                      setBannerY(22);
                      setBannerZoom(100);
                    }}
                  />
                </div>
              )}

              {/* Preset Gradients */}
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Domain Gradient Banners', 'Domén színátmenetes borítóképek')}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PRESET_BANNERS.map((preset) => {
                    const selected = bannerUrl === preset.value;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setBannerUrl(preset.value);
                          setBannerX(50);
                          setBannerY(22);
                          setBannerZoom(100);
                        }}
                        className={`h-11 rounded-xl border px-3 flex items-center justify-between text-xs font-black text-white cursor-pointer transition ${
                          selected ? 'ring-2 ring-[var(--accent)]' : 'opacity-85 hover:opacity-100'
                        }`}
                        style={{ ...preset.previewStyle, borderColor: selected ? 'var(--accent)' : 'rgba(255,255,255,0.18)' }}
                      >
                        <span className="drop-shadow">{preset.label}</span>
                        {selected && (
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {tab === 'socials' && (
            <div className="space-y-3.5 pt-1">
              <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {t('Add your social profile links and tags. Clickable icons will appear on your public profile so other collectors can easily reach you.', 'Add meg a közösségi profiljaid linkjeit vagy felhasználóneved. A nyilvános profilodon kattintható ikonok fognak megjelenni, így más gyűjtők könnyen elérhetnek.')}
              </div>

              {/* Facebook */}
              <div className="p-3.5 rounded-xl border flex flex-col gap-1.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[#1877F2]">
                    <FacebookIcon className="w-4 h-4" />
                  </span>
                  <label className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {t('Facebook Profile', 'Facebook profil')}
                  </label>
                </div>
                <input
                  type="text"
                  value={facebookUrl}
                  onChange={(e) => setFacebookUrl(e.target.value)}
                  placeholder={t("https://facebook.com/your.profile or username", "https://facebook.com/felhasznalonev vagy azonosító")}
                  className="w-full h-9 px-3 rounded-lg text-xs border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Direct link to your personal Facebook profile or group presence.', 'Közvetlen link a Facebook profilodhoz vagy csoportodhoz.')}
                </p>
              </div>

              {/* Discord */}
              <div className="p-3.5 rounded-xl border flex flex-col gap-1.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[#5865F2]">
                    <DiscordIcon className="w-4 h-4" />
                  </span>
                  <label className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {t('Discord Tag / Username', 'Discord azonosító / Felhasználónév')}
                  </label>
                </div>
                <input
                  type="text"
                  value={discordTag}
                  onChange={(e) => setDiscordTag(e.target.value)}
                  placeholder={t("e.g. noel_tcg or Noel#1234", "pl. noel_tcg vagy Noel#1234")}
                  className="w-full h-9 px-3 rounded-lg text-xs border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Collectors can copy your Discord handle with one click to chat or trade.', 'A gyűjtők egyetlen kattintással kimásolhatják a Discord neved beszélgetéshez vagy cseréhez.')}
                </p>
              </div>

              {/* Instagram */}
              <div className="p-3.5 rounded-xl border flex flex-col gap-1.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[#E4405F]">
                    <InstagramIcon className="w-4 h-4" />
                  </span>
                  <label className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {t('Instagram Profile', 'Instagram profil')}
                  </label>
                </div>
                <input
                  type="text"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  placeholder={t("@yourhandle or https://instagram.com/yourhandle", "@felhasznalonev vagy https://instagram.com/felhasznalonev")}
                  className="w-full h-9 px-3 rounded-lg text-xs border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Link to your Instagram profile or card collecting account.', 'Link az Instagram profilodhoz vagy gyűjtői oldaladhoz.')}
                </p>
              </div>
            </div>
          )}

          {tab !== 'socials' && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  {tab === 'avatar' ? t('Choose Card Artwork as PFP', 'Válassz kártyaillusztrációt profilképnek') : t('Or Choose Card Artwork as Container Banner', 'Vagy válassz kártyaillusztrációt borítóképnek')}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>
                    {t('Game:', 'Játék:')}
                  </span>
                  <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                    {GAMES.map((g) => {
                      const isSelected = selectedGame === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setSelectedGame(g.id)}
                          disabled={!g.active}
                          title={!g.active ? t('Coming soon', 'Hamarosan elérhető') : undefined}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed ${
                            isSelected ? 'ring-1 ring-[var(--accent)]' : ''
                          }`}
                          style={
                            isSelected
                              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                              : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }
                          }
                        >
                          {g.name}
                          {!g.active && <span className="ml-1 text-[9px] font-normal opacity-75">({t('Soon', 'Hamarosan')})</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("Search card artwork by name (e.g. Jinx, Yasuo, Ahri, Seraphine)…", "Keresés kártyanév szerint (pl. Jinx, Yasuo, Ahri, Seraphine)…")}
                className="w-full h-9 rounded-xl px-3 text-xs font-semibold border outline-none mb-2.5"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />

              {loadingCards ? (
                <div className="py-8 text-center text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                  {t('Loading card artworks…', 'Kártyaillusztrációk betöltése…')}
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-[260px] overflow-y-auto pr-1">
                  {cards.map((card) => {
                    const fullUrl = getCardImageUrl(card.image_path);
                    const isSelected = tab === 'avatar' ? avatarUrl === fullUrl : bannerUrl === fullUrl;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => {
                          if (tab === 'avatar') {
                            setAvatarUrl(fullUrl);
                            setAvatarX(50);
                            setAvatarY(25);
                            setAvatarZoom(140);
                          } else {
                            setBannerUrl(fullUrl);
                            setBannerX(50);
                            setBannerY(22);
                            setBannerZoom(100);
                          }
                        }}
                        title={`${card.name} (${card.card_number})`}
                        className={`group relative rounded-xl overflow-hidden border aspect-square cursor-pointer bg-zinc-950 ${
                          isSelected ? 'ring-2 ring-[var(--accent)]' : ''
                        }`}
                        style={{ borderColor: isSelected ? 'var(--accent)' : 'var(--border)' }}
                      >
                        <img
                          {...cardThumbProps(card.image_path, 'tile')}
                          alt={card.name}
                          className="w-full h-full object-cover object-top group-hover:scale-105 transition duration-200"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-1.5 py-1">
                          <div className="text-[10px] font-bold text-white truncate">{card.name}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="px-5 py-2 text-xs font-semibold text-red-400 bg-red-500/10 border-t border-red-500/20">
            {error}
          </div>
        )}

        {/* Footer */}
        <div
          className="px-5 py-3.5 border-t flex items-center justify-end gap-2"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          {onDeleteAccount && (
            <button
              type="button"
              onClick={onDeleteAccount}
              className="mr-auto text-xs font-bold cursor-pointer hover:underline"
              style={{ color: 'var(--negative)' }}
            >
              {t('Delete account', 'Fiók törlése')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-xl border text-xs font-bold cursor-pointer"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t('Cancel', 'Mégse')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading || !name.trim()}
            className="h-9 px-5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {saving ? t('Saving…', 'Mentés…') : t('Save Settings', 'Beállítások mentése')}
          </button>
        </div>
      </div>
    </div>
  );
}
