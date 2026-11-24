import React, { useMemo, useState } from 'react';
import type { SellerStats } from '../../lib/badges';
import { useLanguage } from '../../lib/i18n';
import { categoriesFor, type ReviewDirection } from '../../lib/reviewCategories';
import { supabase } from '../../lib/supabase';
import { resolveAvatarImageStyle } from './AvatarBannerModal';

export interface ProfileReviewItem {
  id: string;
  order_number: string;
  direction: ReviewDirection;
  rating: number;
  scores: Record<string, number> | null;
  comment: string | null;
  reviewer_name: string | null;
  reviewer_avatar: string | null;
  created_at: string;
}

interface ProfileReviewsTabProps {
  reviews: ProfileReviewItem[];
  sellerStats: SellerStats | null;
  direction: ReviewDirection;
  onDirectionChange: (dir: ReviewDirection) => void;
  displayName: string;
  isAdmin?: boolean;
  onReviewUpdated?: (updated: ProfileReviewItem) => void;
  onReviewDeleted?: (reviewId: string) => void;
  onToast?: (msg: string) => void;
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  const filled = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5 text-amber-400" aria-label={`${rating.toFixed(1)} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={i <= filled ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={1.8}
          className={i <= filled ? 'text-amber-400' : 'text-zinc-600'}
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  );
}

export function ProfileReviewsTab({
  reviews,
  sellerStats,
  direction,
  onDirectionChange,
  displayName,
  isAdmin = false,
  onReviewUpdated,
  onReviewDeleted,
  onToast,
}: ProfileReviewsTabProps) {
  const { t, lang } = useLanguage();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editComment, setEditComment] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleSaveEdit = async (reviewId: string) => {
    setBusyId(reviewId);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error(t('Please sign in first.', 'Kérlek jelentkezz be előbb.'));
      const res = await fetch('/api/reviews/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'edit', review_id: reviewId, comment: editComment }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || t('Failed to update review.', 'Nem sikerült módosítani az értékelést.'));
      }
      onReviewUpdated?.(json.review);
      setEditingId(null);
      setEditComment('');
      onToast?.(t('Review updated.', 'Értékelés módosítva.'));
    } catch (err: any) {
      onToast?.(err?.message || t('Failed to update review.', 'Nem sikerült módosítani az értékelést.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!confirm(t('Delete this review permanently?', 'Véglegesen törlöd ezt az értékelést?'))) return;
    setBusyId(reviewId);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error(t('Please sign in first.', 'Kérlek jelentkezz be előbb.'));
      const res = await fetch('/api/reviews/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete', review_id: reviewId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || t('Failed to delete review.', 'Nem sikerült törölni az értékelést.'));
      }
      if (editingId === reviewId) {
        setEditingId(null);
        setEditComment('');
      }
      onReviewDeleted?.(reviewId);
      onToast?.(t('Review deleted.', 'Értékelés törölve.'));
    } catch (err: any) {
      onToast?.(err?.message || t('Failed to delete review.', 'Nem sikerült törölni az értékelést.'));
    } finally {
      setBusyId(null);
    }
  };

  const sellerReviews = useMemo(
    () => reviews.filter((r) => r.direction === 'buyer_to_seller'),
    [reviews]
  );
  const buyerReviews = useMemo(
    () => reviews.filter((r) => r.direction === 'seller_to_buyer'),
    [reviews]
  );

  const activeList = direction === 'buyer_to_seller' ? sellerReviews : buyerReviews;
  const activeAvg =
    direction === 'buyer_to_seller'
      ? sellerStats?.seller_rating_avg ?? null
      : sellerStats?.buyer_rating_avg ?? null;
  const activeCount =
    direction === 'buyer_to_seller'
      ? sellerStats?.seller_rating_count ?? sellerReviews.length
      : sellerStats?.buyer_rating_count ?? buyerReviews.length;

  const categories = useMemo(() => categoriesFor(direction, lang), [direction, lang]);

  const categoryAverages = useMemo(() => {
    const out: Record<string, { avg: number; count: number }> = {};
    for (const cat of categories) {
      let sum = 0;
      let count = 0;
      for (const rev of activeList) {
        const val = Number(rev.scores?.[cat.key]);
        if (Number.isFinite(val) && val >= 1 && val <= 5) {
          sum += val;
          count += 1;
        }
      }
      if (count > 0) {
        out[cat.key] = { avg: Math.round((sum / count) * 10) / 10, count };
      }
    }
    return out;
  }, [categories, activeList]);

  return (
    <div className="mb-8 space-y-4">
      {/* Direction Segmented Switcher: Seller Ratings vs Buyer Ratings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onDirectionChange('buyer_to_seller')}
          className="p-4 rounded-2xl border text-left cursor-pointer transition flex items-center justify-between gap-3"
          style={
            direction === 'buyer_to_seller'
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)' }
              : { background: 'var(--bg-surface)', borderColor: 'var(--border)' }
          }
        >
          <div>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: direction === 'buyer_to_seller' ? 'var(--text-accent)' : 'var(--text-tertiary)' }}>
              {t('As Seller', 'Eladói értékelés')}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xl font-black font-mono" style={{ color: 'var(--text-primary)' }}>
                {sellerStats?.seller_rating_avg != null ? sellerStats.seller_rating_avg.toFixed(1) : '—'}
              </span>
              {sellerStats?.seller_rating_avg != null && <StarRow rating={sellerStats.seller_rating_avg} size={13} />}
            </div>
          </div>
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-bold border"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            {sellerStats?.seller_rating_count ?? sellerReviews.length} {t('reviews', 'értékelés')}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onDirectionChange('seller_to_buyer')}
          className="p-4 rounded-2xl border text-left cursor-pointer transition flex items-center justify-between gap-3"
          style={
            direction === 'seller_to_buyer'
              ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)' }
              : { background: 'var(--bg-surface)', borderColor: 'var(--border)' }
          }
        >
          <div>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: direction === 'seller_to_buyer' ? 'var(--text-accent)' : 'var(--text-tertiary)' }}>
              {t('As Buyer', 'Vevői értékelés')}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xl font-black font-mono" style={{ color: 'var(--text-primary)' }}>
                {sellerStats?.buyer_rating_avg != null ? sellerStats.buyer_rating_avg.toFixed(1) : '—'}
              </span>
              {sellerStats?.buyer_rating_avg != null && <StarRow rating={sellerStats.buyer_rating_avg} size={13} />}
            </div>
          </div>
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-bold border"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            {sellerStats?.buyer_rating_count ?? buyerReviews.length} {t('reviews', 'értékelés')}
          </span>
        </button>
      </div>

      {/* Category Breakdown */}
      {Object.keys(categoryAverages).length > 0 && (
        <div
          className="p-4 rounded-2xl border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          {categories.map((cat) => {
            const stat = categoryAverages[cat.key];
            if (!stat) return null;
            const pct = Math.min(100, Math.round((stat.avg / 5) * 100));
            return (
              <div key={cat.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {cat.label}
                  </span>
                  <span className="font-mono font-black text-amber-400 shrink-0">{stat.avg.toFixed(1)}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-surface-2)' }}>
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Individual Reviews List */}
      {activeList.length === 0 ? (
        <div
          className="p-10 text-center rounded-2xl border"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {direction === 'buyer_to_seller'
              ? lang === 'hu'
                ? `${displayName} még nem kapott eladói értékelést.`
                : `${displayName} has no seller reviews yet.`
              : lang === 'hu'
              ? `${displayName} még nem kapott vevői értékelést.`
              : `${displayName} has no buyer reviews yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeAvg !== null && (
            <div className="text-xs font-bold px-1" style={{ color: 'var(--text-tertiary)' }}>
              {lang === 'hu'
                ? `${activeCount} értékelés (átlag: ${activeAvg.toFixed(1)} / 5.0)`
                : `${activeCount} review${activeCount === 1 ? '' : 's'} (average: ${activeAvg.toFixed(1)} / 5.0)`}
            </div>
          )}
          {activeList.map((rev) => (
            <div
              key={rev.id}
              className="p-4 rounded-2xl border space-y-2.5"
              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                  {rev.reviewer_avatar ? (
                    <img
                      src={rev.reviewer_avatar}
                      alt={rev.reviewer_name || 'Reviewer'}
                      className="w-7 h-7 rounded-full object-cover border shrink-0"
                      style={{ borderColor: 'var(--border)', ...resolveAvatarImageStyle(rev.reviewer_avatar) }}
                    />
                  ) : (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black border shrink-0"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      {(rev.reviewer_name || 'C').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {rev.reviewer_name || t('Collector', 'Gyűjtő')}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(rev.created_at).toLocaleDateString(lang === 'hu' ? 'hu-HU' : 'en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <StarRow rating={rev.rating} size={13} />
                    <span className="text-xs font-black font-mono text-amber-400">{rev.rating.toFixed(1)}</span>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1.5 ml-1 pl-2 border-l" style={{ borderColor: 'var(--border-subtle)' }}>
                      <button
                        type="button"
                        disabled={busyId === rev.id}
                        onClick={() => {
                          setEditingId(rev.id);
                          setEditComment(rev.comment || '');
                        }}
                        className="px-2 py-1 rounded-md border text-[11px] font-bold cursor-pointer hover:brightness-110 disabled:opacity-40"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        {t('Edit', 'Szerkesztés')}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === rev.id}
                        onClick={() => handleDeleteReview(rev.id)}
                        className="px-2 py-1 rounded-md border text-[11px] font-bold cursor-pointer hover:bg-rose-500/15 disabled:opacity-40 text-rose-400 border-rose-500/35"
                      >
                        {t('Delete', 'Törlés')}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {rev.scores && (
                <div className="flex items-center gap-2 flex-wrap">
                  {categories.map((cat) => {
                    const val = rev.scores?.[cat.key];
                    if (val == null) return null;
                    return (
                      <span
                        key={cat.key}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md border"
                        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      >
                        {cat.label}: <span className="text-amber-400 font-mono">{val}/5</span>
                      </span>
                    );
                  })}
                </div>
              )}

              {editingId === rev.id ? (
                <div className="space-y-2 pt-1">
                  <textarea
                    rows={3}
                    value={editComment}
                    onChange={(e) => setEditComment(e.target.value)}
                    placeholder={t('Review comment (leave empty to clear text)...', 'Értékelés szövege (üresen hagyva törli a megjegyzést)...')}
                    className="w-full px-3 py-2 rounded-lg border text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={busyId === rev.id}
                      onClick={() => {
                        setEditingId(null);
                        setEditComment('');
                      }}
                      className="px-3 py-1 rounded-lg border text-xs font-bold cursor-pointer"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      {t('Cancel', 'Mégse')}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === rev.id}
                      onClick={() => handleSaveEdit(rev.id)}
                      className="px-3.5 py-1 rounded-lg text-xs font-black cursor-pointer disabled:opacity-50"
                      style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                    >
                      {busyId === rev.id ? t('Saving...', 'Mentés...') : t('Save', 'Mentés')}
                    </button>
                  </div>
                </div>
              ) : (
                rev.comment && (
                  <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-primary)' }}>
                    {rev.comment}
                  </p>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
