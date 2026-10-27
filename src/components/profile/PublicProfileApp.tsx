import React, { useState, useEffect } from 'react';
import { cardThumbProps, supabase } from '../../lib/supabase';
import { fetchSellerRatingSummary, fetchReputation } from '../../lib/reviews';
import { ReputationBreakdown, ReviewCard, Stars } from '../reviews/ReviewParts';
import { getSellerTier, BadgeIconSvg, SiteOwnerTag } from '../../lib/badges';
import { BannerContainerBackground } from './AvatarBannerModal';
import { SocialProfileButtons } from './SocialProfileButtons';
import { useSiteTheme } from '../../lib/theme';
import { fetchPublicDecksForUser, type PublicDeckSummary } from '../../lib/publicDecks';
import { STORAGE_KEYS, EVENTS } from '../../lib/constants';
import { getCurrentUser, getCurrentProfile, isProfileAdmin } from '../../lib/auth';
import { ReportModal } from '../common/ReportModal';
import { ProfileQrModal } from './ProfileQrModal';
import type { SellerProfileSummary, UserReputation, UserSocialProfiles } from '../../types';

const DOMAIN_COLORS: Record<string, string> = {
  fury: '#ef4444', calm: '#22c55e', mind: '#3b82f6',
  body: '#f97316', chaos: '#a855f7', order: '#eab308', colorless: '#94a3b8',
};

export function PublicProfileApp() {
  const [userId, setUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SellerProfileSummary | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [reputation, setReputation] = useState<UserReputation | null>(null);
  const [reviewTab, setReviewTab] = useState<'buyer_to_seller' | 'seller_to_buyer'>('buyer_to_seller');
  const [decks, setDecks] = useState<PublicDeckSummary[]>([]);
  const [socialProfiles, setSocialProfiles] = useState<UserSocialProfiles | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentTab, setContentTab] = useState<'sale' | 'decks'>('sale');
  const isLightTheme = useSiteTheme().theme === 'light';
  // Viewing your own profile: say so, with a way back to the editable one.
  const [isMe, setIsMe] = useState(false);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) getCurrentUser().then(u => setIsMe(Boolean(u && u.id === id)));
    getCurrentProfile()
      .then(p => setViewerIsAdmin(isProfileAdmin(p)))
      .catch(() => {});
  }, []);

  const [displayedBadges, setDisplayedBadges] = useState<string[]>(['riftbound']);
  const [collectionStatsByGame, setCollectionStatsByGame] = useState<Record<string, { owned: number; total: number; weightedPercentage: number }>>({});

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    setUserId(id);
    if (!id) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const getJson = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
        const [sum, revs, publicDecks, listingsJson, statsJson, profileJson] = await Promise.all([
          fetchSellerRatingSummary(id),
          fetchReputation(id),
          fetchPublicDecksForUser(id),
          getJson(`/api/marketplace/listings?seller_id=${id}`),
          getJson(`/api/profile/collection-stats?user_id=${id}`),
          getJson(`/api/profile?id=${encodeURIComponent(id)}`),
        ]);
        setSummary(sum);
        if (profileJson?.banner_url) setBannerUrl(profileJson.banner_url);
        if (Array.isArray(profileJson?.displayed_badges)) setDisplayedBadges(profileJson.displayed_badges);
        if (profileJson?.social_profiles) setSocialProfiles(profileJson.social_profiles);
        setReputation(revs);
        // Open on whichever side they've actually been rated in.
        if (revs.as_seller.count === 0 && revs.as_buyer.count > 0) setReviewTab('seller_to_buyer');
        setDecks(publicDecks);
        if (listingsJson) setListings((listingsJson.data || []).filter((l: any) => l.status !== 'Sold'));
        if (statsJson?.success) setCollectionStatsByGame(statsJson.data);
      } catch (e) {
        console.warn('Failed to load profile:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="font-bold text-base animate-pulse" style={{ color: 'var(--text-accent)' }}>
          Loading profile…
        </span>
      </div>
    );
  }

  if (!userId || !summary) {
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,3vw,32px)' }}>
        <div
          className="max-w-md mx-auto my-12 p-8 text-center rounded-2xl border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>
            Collector not found
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
            This profile doesn't exist or is no longer available.
          </p>
          <a
            href="/marketplace"
            className="inline-block px-5 py-2.5 rounded-xl font-black text-xs cursor-pointer"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            Browse Marketplace
          </a>
        </div>
      </div>
    );
  }

  const isOwner = Boolean(summary.is_owner || summary.role === 'owner');
  const tier = getSellerTier(summary.sales_count || 0, summary.rating_avg, isOwner, isLightTheme);
  const displayName = summary.display_name || 'Collector';
  const memberSince = summary.created_at
    ? new Date(summary.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    : null;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'clamp(16px,3vw,32px) clamp(16px,3vw,24px)' }}>
      {isMe && (
        <div
          className="rounded-xl border px-4 py-2.5 mb-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent-border)' }}
        >
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            This is how other collectors see your profile.
          </span>
          <a
            href="/profile"
            className="h-8 px-3 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Edit profile
          </a>
        </div>
      )}

      {/* Identity */}
      <div
        className="relative rounded-2xl mb-6 border overflow-hidden"
        style={{ borderColor: 'var(--border)', boxShadow: 'var(--shadow-card)' }}
      >
        <BannerContainerBackground bannerUrl={bannerUrl} isLightTheme={isLightTheme} />
        <div className="relative z-10 p-4 sm:p-7 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 sm:gap-5 flex-wrap min-w-0">
            {summary.avatar_url ? (
              <img
                src={summary.avatar_url}
                alt={displayName}
                className="w-16 h-16 rounded-2xl object-cover border-2 shrink-0 bg-zinc-950 shadow-md"
                style={{ borderColor: tier.color }}
              />
            ) : (
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black border-2 shrink-0 shadow-md"
                style={{ background: 'var(--bg-surface-2)', borderColor: tier.color, color: 'var(--accent)' }}
              >
                {displayName[0].toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black truncate" style={{ color: 'var(--text-primary)' }}>
                  {displayName}
                </h1>
                {isOwner && <SiteOwnerTag />}
                <span
                  className="text-[10px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider inline-flex items-center gap-1"
                  style={tier.badgeStyle}
                >
                  <BadgeIconSvg iconType={tier.iconType} className="w-3 h-3" />
                  <span>{tier.nameEn}</span>
                </span>
                              </div>

              <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  {summary.rating_count > 0 && summary.rating_avg !== null ? (
                    <>
                      <Stars value={summary.rating_avg} size={11} />
                      <span style={{ color: 'var(--text-primary)' }}>{summary.rating_avg.toFixed(1)}</span>
                      <span>as seller ({summary.rating_count})</span>
                    </>
                  ) : (
                    'No seller ratings yet'
                  )}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  {summary.buyer_rating_count && summary.buyer_rating_avg != null ? (
                    <>
                      <Stars value={summary.buyer_rating_avg} size={11} />
                      <span style={{ color: 'var(--text-primary)' }}>{summary.buyer_rating_avg.toFixed(1)}</span>
                      <span>as buyer ({summary.buyer_rating_count})</span>
                    </>
                  ) : (
                    'No buyer ratings yet'
                  )}
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border text-[var(--positive)]"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                >
                  Sold {summary.items_sold || 0} card{summary.items_sold === 1 ? '' : 's'} ({summary.sales_count || 0} sale{summary.sales_count === 1 ? '' : 's'})
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  title="Completed purchases from other collectors"
                >
                  Bought {summary.items_bought || 0} card{summary.items_bought === 1 ? '' : 's'} ({summary.purchases_count || 0} purchase{summary.purchases_count === 1 ? '' : 's'})
                </span>
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border text-indigo-300"
                  style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
                >
                  {listings.length} listed now
                </span>
                {memberSince && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                  >
                    Member since {memberSince}
                  </span>
                )}
                <SocialProfileButtons socialProfiles={socialProfiles} size="sm" />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="h-8 px-3 rounded-lg text-xs font-bold border inline-flex items-center gap-1.5 cursor-pointer transition"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              title="Show QR code for in-person trade sharing"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
              </svg>
              <span>Share QR</span>
            </button>
            {!isMe && (
              <button
                type="button"
                onClick={() => setShowReportModal(true)}
                className="h-8 px-3 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                title="Report this collector to moderators"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
                <span>Report profile</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cards for sale / Decks - tabs, opening on the cards. Decks matter less, so they stay tucked away. */}
      <div className="flex items-center gap-1.5 mb-4" role="tablist" aria-label="Profile content">
        {([
          ['sale', 'Cards for sale', listings.length],
          ['decks', 'Decks', decks.length],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={contentTab === key}
            onClick={() => setContentTab(key)}
            className="h-9 px-4 rounded-xl text-xs font-black border cursor-pointer transition inline-flex items-center gap-2"
            style={contentTab === key
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              : { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <span>{label}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>{count}</span>
          </button>
        ))}
      </div>

      {contentTab === 'sale' && (
      <>
      {listings.length === 0 ? (
        <div
          className="p-10 text-center rounded-2xl border mb-8"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {displayName} has no cards listed right now.
          </p>
        </div>
      ) : (
        <a
          href={`/marketplace?seller_id=${userId}`}
          className="rounded-2xl border p-4 mb-8 flex items-center gap-4 transition hover:-translate-y-0.5 cursor-pointer"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex -space-x-6 shrink-0">
            {listings.slice(0, 3).map((l, i) => (
              <div
                key={l.inventory_id}
                className="w-14 h-20 rounded-lg overflow-hidden border-2 bg-zinc-950 flex items-center justify-center shrink-0"
                style={{ borderColor: 'var(--bg-surface)', zIndex: 3 - i }}
              >
                {l.image_path ? (
                  <img {...cardThumbProps(l.image_path, 'avatar')} alt={l.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[9px] font-mono text-zinc-500">TCG</span>
                )}
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
              {listings.length} card{listings.length === 1 ? '' : 's'} for sale
            </div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Browse {displayName}'s listings in the Marketplace
            </div>
          </div>
          <svg
            className="w-5 h-5 shrink-0"
            style={{ color: 'var(--text-tertiary)' }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>
      )}
      </>
      )}

      {contentTab === 'decks' && (
      <>
      {decks.length === 0 ? (
        <div
          className="p-10 text-center rounded-2xl border mb-8"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {displayName} hasn't published any decks yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
          {decks.map(d => {
            const domains = d.legend_card?.domain ? d.legend_card.domain.split(',').map(x => x.trim().toLowerCase()) : [];
            return (
              <a
                key={d.id}
                href={`/decks/view?deck=${d.id}`}
                className="rounded-xl border overflow-hidden transition hover:-translate-y-0.5 cursor-pointer flex flex-col"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex w-full" style={{ aspectRatio: '3 / 4', background: '#09090b' }}>
                  <div className="flex-1 h-full min-w-0">
                    {d.legend_card?.image_path && (
                      <img {...cardThumbProps(d.legend_card.image_path, 'tile')} alt={d.legend_card.name} className="w-full h-full object-cover" />
                    )}
                  </div>
                  {d.champion_card?.image_path && (
                    <div className="flex-1 h-full min-w-0 border-l" style={{ borderColor: 'var(--border)' }}>
                      <img {...cardThumbProps(d.champion_card.image_path, 'tile')} alt={d.champion_card.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <div className="text-xs font-bold truncate mb-0.5" style={{ color: 'var(--text-primary)' }}>{d.name}</div>
                  <div className="flex items-center gap-1">
                    {domains.map(dom => (
                      <div key={dom} className="w-2 h-2 rounded-full" style={{ background: DOMAIN_COLORS[dom] || '#94a3b8' }} title={dom} />
                    ))}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
      </>
      )}

      {/* Social & Community Links */}
      {(() => {
        const hasFb = Boolean(socialProfiles?.facebook_url);
        const hasDiscord = Boolean(socialProfiles?.discord_tag);
        const hasInsta = Boolean(socialProfiles?.instagram_url);
        const hasAnySocial = hasFb || hasDiscord || hasInsta;

        if (!hasAnySocial) return null;

        return (
          <div className="mb-8">
            <h2 className="text-sm font-black uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              <svg className="w-4 h-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>Social &amp; Community Links</span>
            </h2>

            <div
              className="rounded-2xl border p-4 sm:p-5 flex items-center gap-3 flex-wrap"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <SocialProfileButtons socialProfiles={socialProfiles} size="md" />
            </div>
          </div>
        );
      })()}

      {/* Reviews - how sellers rated them as a buyer, and buyers rated them as a seller */}
      <h2 className="text-sm font-black uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
        Reputation
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {([
          ['buyer_to_seller', 'As a seller', reputation?.as_seller, 'No ratings as a seller yet.'],
          ['seller_to_buyer', 'As a buyer', reputation?.as_buyer, 'No ratings as a buyer yet.'],
        ] as const).map(([direction, title, rep, empty]) => (
          <div key={direction} className="rounded-2xl p-4 border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <div className="text-xs font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>{title}</div>
            {rep ? <ReputationBreakdown direction={direction} rep={rep} emptyText={empty} /> : null}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mb-3" role="tablist" aria-label="Reviews">
        {([
          ['buyer_to_seller', 'From buyers', reputation?.as_seller.count || 0],
          ['seller_to_buyer', 'From sellers', reputation?.as_buyer.count || 0],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={reviewTab === key}
            onClick={() => setReviewTab(key)}
            className="h-8 px-3 rounded-lg text-xs font-bold border cursor-pointer transition"
            style={reviewTab === key
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
              : { background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {label} ({count})
          </button>
        ))}
      </div>
      {(() => {
        const list = (reputation?.reviews || []).filter(r => r.direction === reviewTab);
        if (list.length === 0) {
          return (
            <div className="p-10 text-center rounded-2xl border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No reviews yet.</p>
            </div>
          );
        }
        const handleDeleteReview = viewerIsAdmin
          ? async (reviewId: string) => {
              if (!window.confirm('Delete this review permanently?')) return;
              try {
                const token = (await supabase.auth.getSession()).data.session?.access_token;
                const res = await fetch(`/api/reviews?id=${encodeURIComponent(reviewId)}`, {
                  method: 'DELETE',
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (res.ok && userId) {
                  const [sum, revs] = await Promise.all([
                    fetchSellerRatingSummary(userId),
                    fetchReputation(userId, true),
                  ]);
                  if (sum) setSummary(sum);
                  setReputation(revs);
                }
              } catch {
                // ignore
              }
            }
          : undefined;
        return <div className="space-y-3">{list.map(rev => <ReviewCard key={rev.id} review={rev} onDelete={handleDeleteReview} />)}</div>;
      })()}

      <ReportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        type="profile"
        targetId={userId || ''}
        targetName={displayName}
        targetLink={typeof window !== 'undefined' ? window.location.href : `/user?id=${userId}`}
      />
      {showQrModal && userId && (
        <ProfileQrModal
          userId={userId}
          displayName={displayName}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </div>
  );
}
