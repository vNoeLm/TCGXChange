import { useEffect, useState } from 'react';
import { fetchReputation, TRADE_REVIEWED_EVENT } from '../../lib/reviews';
import { categoriesFor, type ReviewDirection } from '../../lib/reviewCategories';
import type { Reputation, TradeReview, UserReputation, UserSocialProfiles } from '../../types';

const STAR = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';
const GOLD = '#f59e0b';

/** Read-only stars; a fractional value fills the last star partway. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} out of 5`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id={`s${i}-${Math.round(fill * 100)}`}>
                <stop offset={`${fill * 100}%`} stopColor={GOLD} />
                <stop offset={`${fill * 100}%`} stopColor="transparent" />
              </linearGradient>
            </defs>
            <path d={STAR} fill={`url(#s${i}-${Math.round(fill * 100)})`} stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" />
          </svg>
        );
      })}
    </span>
  );
}

/** 1-5 star picker. */
export function StarInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span className="inline-flex items-center gap-0.5" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          className="p-0.5 cursor-pointer"
        >
          <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden="true">
            <path d={STAR} fill={n <= shown ? GOLD : 'transparent'} stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </span>
  );
}

/** Overall score plus one bar per category. */
export function ReputationBreakdown({ direction, rep, emptyText }: { direction: ReviewDirection; rep: Reputation; emptyText: string }) {
  if (rep.count === 0 || rep.avg === null) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{emptyText}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>{rep.avg.toFixed(1)}</span>
        <Stars value={rep.avg} size={16} />
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>({rep.count} rating{rep.count === 1 ? '' : 's'})</span>
      </div>
      {categoriesFor(direction).map((c) => {
        const cat = rep.categories[c.key];
        if (!cat) return null;
        return (
          <div key={c.key} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-2 text-xs">
            <span className="truncate font-semibold" style={{ color: 'var(--text-secondary)' }}>{c.label}</span>
            <span className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
              <span className="block h-full rounded-full" style={{ width: `${(cat.avg / 5) * 100}%`, background: GOLD }} />
            </span>
            <span className="text-right font-bold" style={{ color: 'var(--text-primary)' }}>{cat.avg.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewCard({ review, onDelete }: { review: TradeReview; onDelete?: (id: string) => void }) {
  const cats = review.scores ? categoriesFor(review.direction).filter((c) => review.scores?.[c.key]) : [];
  return (
    <div className="rounded-xl p-3 sm:p-4 border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <a href={`/user?id=${review.reviewer_id}`} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition">
          {review.reviewer_avatar ? (
            <img src={review.reviewer_avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 border" style={{ borderColor: 'var(--border)' }} />
          ) : (
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}>
              {review.reviewer_name?.[0]?.toUpperCase() || 'U'}
            </span>
          )}
          <span className="text-xs sm:text-sm font-bold truncate" style={{ color: 'var(--text-secondary)' }}>
            {review.reviewer_name || (review.direction === 'buyer_to_seller' ? 'Buyer' : 'Seller')}
          </span>
        </a>
        <div className="flex items-center gap-2">
          <Stars value={review.rating} size={13} />
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(review.id)}
              title="Delete review"
              className="px-2 py-0.5 rounded-md text-[10px] font-bold border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 cursor-pointer transition"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      {cats.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {cats.map((c) => (
            <span key={c.key} className="text-[10px] font-semibold px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}>
              {c.label} {review.scores![c.key]}/5
            </span>
          ))}
        </div>
      )}
      {review.comment && (
        <p className="text-xs sm:text-sm italic mb-1" style={{ color: 'var(--text-primary)' }}>"{review.comment}"</p>
      )}
      <div className="text-[10px] text-right" style={{ color: 'var(--text-tertiary)' }}>
        {new Date(review.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
      </div>
    </div>
  );
}

/** Loads and keeps up to date one person's reputation. */
export function useReputation(userId: string | null | undefined): UserReputation | null {
  const [rep, setRep] = useState<UserReputation | null>(null);
  useEffect(() => {
    if (!userId) { setRep(null); return; }
    let live = true;
    fetchReputation(userId).then((r) => { if (live) setRep(r); });
    const onReviewed = (e: Event) => {
      if ((e as CustomEvent).detail?.review?.reviewee_id === userId) {
        fetchReputation(userId, true).then((r) => { if (live) setRep(r); });
      }
    };
    window.addEventListener(TRADE_REVIEWED_EVENT, onReviewed);
    return () => { live = false; window.removeEventListener(TRADE_REVIEWED_EVENT, onReviewed); };
  }, [userId]);
  return rep;
}

/**
 * One line a seller reads before trusting a buyer: what they've bought here and how sellers have
 * rated them.
 */
export function BuyerTrustLine({ buyerId, className = '' }: { buyerId: string | null | undefined; className?: string }) {
  const rep = useReputation(buyerId);
  if (!buyerId) {
    return <span className={`text-[11px] ${className}`} style={{ color: 'var(--text-tertiary)' }}>Guest buyer - no account history</span>;
  }
  if (!rep) return null;
  const { itemsBought, purchasesCount } = rep.stats;
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap text-[11px] ${className}`} style={{ color: 'var(--text-secondary)' }}>
      <span className="font-semibold">
        {purchasesCount === 0
          ? 'First purchase here'
          : `Bought ${itemsBought} card${itemsBought === 1 ? '' : 's'} in ${purchasesCount} purchase${purchasesCount === 1 ? '' : 's'}`}
      </span>
      <span aria-hidden="true">·</span>
      {rep.as_buyer.avg !== null ? (
        <span className="inline-flex items-center gap-1">
          <Stars value={rep.as_buyer.avg} size={11} />
          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{rep.as_buyer.avg.toFixed(1)}</span>
          <span>as buyer ({rep.as_buyer.count})</span>
        </span>
      ) : (
        <span>No buyer ratings yet</span>
      )}
    </span>
  );
}

/**
 * One line a buyer reads before sending payment to a seller:
 * their internal Vault track record plus external trust (Cardmarket / Facebook) and anti-scam notice.
 */
export function SellerTrustLine({ sellerId, className = '' }: { sellerId: string | null | undefined; className?: string }) {
  const rep = useReputation(sellerId);
  const [social, setSocial] = useState<UserSocialProfiles | null>(null);

  useEffect(() => {
    if (!sellerId) return;
    fetch(`/api/profile?id=${encodeURIComponent(sellerId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.social_profiles) setSocial(j.social_profiles);
      })
      .catch(() => {});
  }, [sellerId]);

  if (!sellerId) return null;

  const hasExternal = Boolean(social?.cardmarket_username || social?.facebook_url);

  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap text-[11px] ${className}`} style={{ color: 'var(--text-secondary)' }}>
      {rep && rep.as_seller.count > 0 ? (
        <span className="inline-flex items-center gap-1">
          <Stars value={rep.as_seller.avg || 5} size={11} />
          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{rep.as_seller.avg?.toFixed(1)}</span>
          <span>({rep.as_seller.count} on Vault)</span>
        </span>
      ) : (
        <span>New seller on Vault</span>
      )}
      {hasExternal && (
        <>
          <span aria-hidden="true">&middot;</span>
          <a
            href={`/user?id=${sellerId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] hover:underline"
            title="View verified external reputation & anti-scam challenge code"
          >
            <svg className="w-3 h-3 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {social?.cardmarket_username
              ? `Cardmarket (${social.cardmarket_sales ? `${social.cardmarket_sales}+ orders` : 'linked'})`
              : 'Facebook verified'}
          </a>
        </>
      )}
    </span>
  );
}
