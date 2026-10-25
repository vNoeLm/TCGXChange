import React, { useState } from 'react';
import type { UserSocialProfiles } from '../../types';

export function FacebookIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export function DiscordIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export function InstagramIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function resolveUrl(raw: string, platform: 'facebook' | 'instagram' | 'discord'): { url?: string; text: string; isLink: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: '', isLink: false };

  if (platform === 'facebook') {
    if (/^https?:\/\//i.test(trimmed)) {
      return { url: trimmed, text: trimmed.replace(/^https?:\/\/(www\.)?facebook\.com\/?/i, '@') || 'Facebook', isLink: true };
    }
    const handle = trimmed.replace(/^@/, '');
    return { url: `https://facebook.com/${encodeURIComponent(handle)}`, text: `@${handle}`, isLink: true };
  }

  if (platform === 'instagram') {
    if (/^https?:\/\//i.test(trimmed)) {
      return { url: trimmed, text: trimmed.replace(/^https?:\/\/(www\.)?instagram\.com\/?/i, '@') || 'Instagram', isLink: true };
    }
    const handle = trimmed.replace(/^@/, '');
    return { url: `https://instagram.com/${encodeURIComponent(handle)}`, text: `@${handle}`, isLink: true };
  }

  // Discord
  if (/^https?:\/\/(discord\.gg|discord\.com\/invite)/i.test(trimmed)) {
    return { url: trimmed, text: 'Discord Server', isLink: true };
  }
  return { text: trimmed, isLink: false };
}

interface SocialProfileButtonsProps {
  socialProfiles?: UserSocialProfiles | null;
  className?: string;
  size?: 'sm' | 'md';
}

export function SocialProfileButtons({ socialProfiles, className = '', size = 'md' }: SocialProfileButtonsProps) {
  const [copiedDiscord, setCopiedDiscord] = useState(false);

  if (!socialProfiles) return null;

  const fb = socialProfiles.facebook_url ? resolveUrl(socialProfiles.facebook_url, 'facebook') : null;
  const insta = socialProfiles.instagram_url ? resolveUrl(socialProfiles.instagram_url, 'instagram') : null;
  const discord = socialProfiles.discord_tag ? resolveUrl(socialProfiles.discord_tag, 'discord') : null;

  if (!fb && !insta && !discord) return null;

  const btnClass = size === 'sm'
    ? 'h-7 px-2 text-[11px] gap-1.5'
    : 'h-8 px-2.5 text-xs gap-1.5';
  const iconClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  const handleCopyDiscord = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!discord) return;
    if (discord.isLink && discord.url) {
      window.open(discord.url, '_blank', 'noopener,noreferrer');
      return;
    }
    navigator.clipboard.writeText(discord.text);
    setCopiedDiscord(true);
    setTimeout(() => setCopiedDiscord(false), 2000);
  };

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {fb && fb.url && (
        <a
          href={fb.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`${btnClass} rounded-lg border font-bold inline-flex items-center transition cursor-pointer hover:bg-blue-600/10 hover:border-blue-500/40 hover:text-blue-500`}
          style={{
            background: 'var(--bg-surface-2)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
          title={`Facebook: ${fb.text}`}
        >
          <span className="text-[#1877F2] shrink-0">
            <FacebookIcon className={iconClass} />
          </span>
          <span className="truncate max-w-[120px]">{fb.text}</span>
        </a>
      )}

      {discord && (
        <button
          type="button"
          onClick={handleCopyDiscord}
          className={`${btnClass} rounded-lg border font-bold inline-flex items-center transition cursor-pointer hover:bg-indigo-600/10 hover:border-indigo-500/40 hover:text-indigo-400`}
          style={{
            background: 'var(--bg-surface-2)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
          title={discord.isLink ? 'Open Discord server' : `Click to copy Discord tag: ${discord.text}`}
        >
          <span className="text-[#5865F2] shrink-0">
            <DiscordIcon className={iconClass} />
          </span>
          <span className="truncate max-w-[120px]">{copiedDiscord ? 'Copied!' : discord.text}</span>
        </button>
      )}

      {insta && insta.url && (
        <a
          href={insta.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`${btnClass} rounded-lg border font-bold inline-flex items-center transition cursor-pointer hover:bg-pink-600/10 hover:border-pink-500/40 hover:text-pink-400`}
          style={{
            background: 'var(--bg-surface-2)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
          title={`Instagram: ${insta.text}`}
        >
          <span className="text-[#E4405F] shrink-0">
            <InstagramIcon className={iconClass} />
          </span>
          <span className="truncate max-w-[120px]">{insta.text}</span>
        </a>
      )}
    </div>
  );
}
