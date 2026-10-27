import React, { useEffect, useState, useRef } from 'react';
import { supabase, getCardImageUrl, cardThumbProps } from '../../lib/supabase';
import { updateProfile, uploadCustomAvatar } from '../../lib/auth';
import { COUNTRIES, getCountry } from '../../lib/countries';
import { CountryFlag } from '../CountryFlag';
import type { UserSocialProfiles } from '../../types';
import { FacebookIcon, DiscordIcon, InstagramIcon } from './SocialProfileButtons';

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

/** Parse composite banner value into clean URL/preset and blur percentage (0-100) */
export function parseBannerValue(bannerValue?: string | null): { url: string | null; blur: number } {
  if (!bannerValue) return { url: null, blur: 0 };
  const hashIdx = bannerValue.indexOf('#blur=');
  if (hashIdx !== -1) {
    const clean = bannerValue.slice(0, hashIdx).trim();
    const parsed = parseInt(bannerValue.slice(hashIdx + 6), 10);
    return {
      url: clean || null,
      blur: isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed)),
    };
  }
  return { url: bannerValue.trim(), blur: 0 };
}

/** Formats clean URL/preset with blur percentage into composite string */
export function formatBannerValue(cleanUrl: string | null | undefined, blurPercent: number): string | null {
  if (!cleanUrl) return null;
  const base = cleanUrl.split('#')[0].trim();
  if (!base) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(blurPercent)));
  return clamped > 0 ? `${base}#blur=${clamped}` : base;
}

/** Resolves background styling for banner image/preset */
export function resolveBannerBackgroundStyle(cleanUrl?: string | null): React.CSSProperties {
  if (!cleanUrl) return { background: 'var(--bg-surface)' };
  const preset = PRESET_BANNERS.find((p) => p.value === cleanUrl);
  if (preset) return preset.previewStyle;
  return {
    backgroundImage: `url("${cleanUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center 22%',
  };
}

/** Backward compatibility helper */
export function resolveBannerStyle(bannerUrl?: string | null): React.CSSProperties | null {
  if (!bannerUrl) return null;
  const { url } = parseBannerValue(bannerUrl);
  if (!url) return null;
  const preset = PRESET_BANNERS.find((p) => p.value === url);
  if (preset) return preset.previewStyle;
  return {
    backgroundImage: `linear-gradient(to bottom, rgba(9, 9, 11, 0.25) 0%, rgba(9, 9, 11, 0.78) 100%), url("${url}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center 22%',
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
  const { url, blur } = parseBannerValue(bannerUrl);
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
  const bgStyle = resolveBannerBackgroundStyle(url);

  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}>
      {/* Blurred artwork layer with overflow margin to prevent faded border halos */}
      <div
        className="absolute inset-[-24px] bg-cover bg-center transition-all duration-200"
        style={{
          ...bgStyle,
          filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
          transform: blurPx > 0 ? 'scale(1.08)' : undefined,
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentAvatarUrl);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [blurPercent, setBlurPercent] = useState<number>(0);
  const [facebookUrl, setFacebookUrl] = useState(initialSocialProfiles?.facebook_url || '');
  const [discordTag, setDiscordTag] = useState(initialSocialProfiles?.discord_tag || '');
  const [instagramUrl, setInstagramUrl] = useState(initialSocialProfiles?.instagram_url || '');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'Champion' | 'all'>('Champion');
  const [cards, setCards] = useState<CardChoice[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(displayName);
      setCountry(currentCountry || 'HU');
      setAvatarUrl(currentAvatarUrl);
      const parsed = parseBannerValue(currentBannerUrl);
      setBannerUrl(parsed.url);
      setBlurPercent(parsed.blur);
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
          .select('id, name, card_number, card_type, rarity, image_path')
          .not('image_path', 'is', null)
          .limit(60);

        if (search.trim()) {
          query = query.ilike('name', `%${search.trim()}%`);
        } else if (typeFilter === 'Champion') {
          query = query.ilike('card_type', '%Champion%');
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
  }, [open, search, typeFilter]);

  if (!open) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError('Please choose an image smaller than 8 MB.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { avatar_url } = await uploadCustomAvatar(file);
      setAvatarUrl(avatar_url);
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Display name cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const finalBanner = formatBannerValue(bannerUrl, blurPercent);
      const nextSocial: UserSocialProfiles = {
        ...(initialSocialProfiles || {}),
        facebook_url: facebookUrl.trim() || null,
        discord_tag: discordTag.trim() || null,
        instagram_url: instagramUrl.trim() || null,
      };
      await updateProfile({
        display_name: trimmed,
        country,
        avatar_url: avatarUrl,
        banner_url: finalBanner,
        social_profiles: nextSocial,
      });
      onSaved({
        display_name: trimmed,
        country,
        avatar_url: avatarUrl,
        banner_url: finalBanner,
        social_profiles: nextSocial,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not save profile settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
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
              <span>Profile Settings</span>
            </h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Customize your display name, country, profile picture, and container banner in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition hover:bg-[var(--bg-surface-2)]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            aria-label="Close"
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
                Display Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter display name"
                maxLength={50}
                className="w-full h-9 px-3 rounded-lg text-xs font-bold border outline-none focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label className="text-xs font-bold block mb-1.5" style={{ color: 'var(--text-primary)' }}>
                Country / Region
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
            <BannerContainerBackground bannerUrl={bannerUrl} blurOverride={blurPercent} />

            <div className="relative z-10 flex items-center gap-3.5 w-full">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={name || 'User'}
                  className="w-16 h-16 rounded-2xl object-cover border-2 shrink-0 shadow-md bg-zinc-950"
                  style={{ borderColor: 'var(--accent)' }}
                />
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
                    {name.trim() || 'Valued Collector'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <CountryFlag countryCode={country} className="w-3.5 h-2.5 rounded-[2px]" />
                    <span>{getCountry(country).name}</span>
                  </span>
                </div>
                <div className="text-[11px] font-semibold flex items-center gap-2 flex-wrap mt-1" style={{ color: 'var(--text-secondary)' }}>
                  <span>Live Preview</span>
                  {bannerUrl && (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}>
                      Blur: {blurPercent}%
                    </span>
                  )}
                  {(facebookUrl.trim() || discordTag.trim() || instagramUrl.trim()) && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      {facebookUrl.trim() && <span className="text-[#1877F2]" title="Facebook configured"><FacebookIcon className="w-3.5 h-3.5" /></span>}
                      {discordTag.trim() && <span className="text-[#5865F2]" title="Discord configured"><DiscordIcon className="w-3.5 h-3.5" /></span>}
                      {instagramUrl.trim() && <span className="text-[#E4405F]" title="Instagram configured"><InstagramIcon className="w-3.5 h-3.5" /></span>}
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
              1. Profile Picture (PFP)
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
              2. Container Banner &amp; Blur
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
              3. Social Links
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
                  <span>{uploading ? 'Compressing…' : 'Upload custom PFP (~8 KB)'}</span>
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    className="h-8 px-2.5 rounded-lg border text-xs font-semibold cursor-pointer"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                  >
                    Reset PFP
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
                Remove Banner
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
                      Container Banner Blur
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
                    { label: '0% Sharp', val: 0 },
                    { label: '20% Subtle', val: 20 },
                    { label: '40% Balanced', val: 40 },
                    { label: '65% Smooth', val: 65 },
                    { label: '90% Frosted', val: 90 },
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
                  Blurs the background artwork on your profile container so your name, email, badges, and buttons remain easy to read.
                </p>
              </div>

              {/* Preset Gradients */}
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Domain Gradient Banners
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PRESET_BANNERS.map((preset) => {
                    const selected = bannerUrl === preset.value;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setBannerUrl(preset.value)}
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
                Add your social profile links and tags. Clickable icons will appear on your public profile so other collectors can easily reach you.
              </div>

              {/* Facebook */}
              <div className="p-3.5 rounded-xl border flex flex-col gap-1.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[#1877F2]">
                    <FacebookIcon className="w-4 h-4" />
                  </span>
                  <label className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    Facebook Profile
                  </label>
                </div>
                <input
                  type="text"
                  value={facebookUrl}
                  onChange={(e) => setFacebookUrl(e.target.value)}
                  placeholder="https://facebook.com/your.profile or username"
                  className="w-full h-9 px-3 rounded-lg text-xs border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Direct link to your personal Facebook profile or group presence.
                </p>
              </div>

              {/* Discord */}
              <div className="p-3.5 rounded-xl border flex flex-col gap-1.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[#5865F2]">
                    <DiscordIcon className="w-4 h-4" />
                  </span>
                  <label className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    Discord Tag / Username
                  </label>
                </div>
                <input
                  type="text"
                  value={discordTag}
                  onChange={(e) => setDiscordTag(e.target.value)}
                  placeholder="e.g. noel_tcg or Noel#1234"
                  className="w-full h-9 px-3 rounded-lg text-xs border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Collectors can copy your Discord handle with one click to chat or trade.
                </p>
              </div>

              {/* Instagram */}
              <div className="p-3.5 rounded-xl border flex flex-col gap-1.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[#E4405F]">
                    <InstagramIcon className="w-4 h-4" />
                  </span>
                  <label className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    Instagram Profile
                  </label>
                </div>
                <input
                  type="text"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  placeholder="@yourhandle or https://instagram.com/yourhandle"
                  className="w-full h-9 px-3 rounded-lg text-xs border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Link to your Instagram profile or card collecting account.
                </p>
              </div>
            </div>
          )}

          {tab !== 'socials' && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  {tab === 'avatar' ? 'Choose Card Artwork as PFP' : 'Or Choose Card Artwork as Container Banner'}
                </span>
                <div className="flex items-center gap-1.5">
                  {(['Champion', 'all'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setTypeFilter(f)}
                      className="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer"
                      style={
                        typeFilter === f
                          ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                          : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }
                      }
                    >
                      {f === 'Champion' ? 'Champions' : 'All Cards'}
                    </button>
                  ))}
                </div>
              </div>

              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search champion or card name (e.g. Jinx, Yasuo, Ahri, Viktor)…"
                className="w-full h-9 rounded-xl px-3 text-xs font-semibold border outline-none mb-2.5"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />

              {loadingCards ? (
                <div className="py-8 text-center text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                  Loading card artworks…
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
                          if (tab === 'avatar') setAvatarUrl(fullUrl);
                          else setBannerUrl(fullUrl);
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
              Delete account
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-xl border text-xs font-bold cursor-pointer"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading || !name.trim()}
            className="h-9 px-5 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
