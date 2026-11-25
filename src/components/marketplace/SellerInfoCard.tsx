import React from 'react';
import {
  BadgeIconSvg,
  getSellerTier,
  ModeratorTags,
  SiteOwnerTag,
} from '../../lib/badges';
import { OWNER_ID } from '../../lib/constants';
import { useLanguage } from '../../lib/i18n';
import type { P2PSellerInfo } from '../../lib/p2pClient';
import { getProfileUrl } from '../../lib/profileUrl';
import { resolveAvatarImageStyle } from '../profile/AvatarBannerModal';

interface SellerInfoCardProps {
  seller: P2PSellerInfo;
}

/**
 * Full-card clickable seller summary:
 * [Avatar] [Name / Country + Rating] | [Role & Seller Tier Badges] ... [Profile ->]
 */
export function SellerInfoCard({ seller }: SellerInfoCardProps) {
  const { lang, t } = useLanguage();
  const isOwner = Boolean(seller.is_owner || seller.id === OWNER_ID);
  const sellerTier = getSellerTier(
    seller.completed_sales ?? 0,
    seller.rating_count > 0 ? seller.rating_avg : null,
    isOwner
  );
  const tierLabel = lang === 'hu' ? sellerTier.nameHu : sellerTier.nameEn;

  return (
    <a
      href={getProfileUrl(seller)}
      className="p-3.5 rounded-xl border flex items-center justify-between gap-3 hover:border-[var(--accent)] transition group"
      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          {seller.avatar_url ? (
            <img
              src={seller.avatar_url}
              alt={seller.display_name}
              className="w-10 h-10 rounded-full object-cover border shrink-0"
              style={{ borderColor: 'var(--border)', ...resolveAvatarImageStyle(seller.avatar_url) }}
            />
          ) : (
            <div
              className="w-10 h-10 rounded-full border flex items-center justify-center text-sm font-black shrink-0"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--accent)' }}
            >
              {seller.display_name[0]?.toUpperCase() || 'U'}
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black truncate group-hover:underline" style={{ color: 'var(--text-primary)' }}>
                {seller.display_name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              <span>{seller.country}</span>
              {seller.rating_count > 0 && (
                <span className="inline-flex items-center gap-0.5 font-bold text-amber-400">
                  <span>·</span>
                  <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <span>{seller.rating_avg.toFixed(1)}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>({seller.rating_count})</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className="hidden sm:block w-px h-7 shrink-0"
          style={{ background: 'var(--border-subtle)' }}
        />

        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {isOwner && <SiteOwnerTag />}
          <ModeratorTags games={seller.moderator_games} lang={lang} />
          <span
            className="text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider inline-flex items-center gap-1 border"
            style={sellerTier.badgeStyle}
            title={tierLabel}
          >
            <BadgeIconSvg iconType={sellerTier.iconType} className="w-3 h-3" />
            <span>
              {sellerTier.tier > 0 ? `Tier ${sellerTier.tier} · ${tierLabel}` : tierLabel}
            </span>
          </span>
        </div>
      </div>

      <span className="text-xs font-bold shrink-0 group-hover:underline" style={{ color: 'var(--text-accent)' }}>
        {t('Profile →', 'Profil →')}
      </span>
    </a>
  );
}
