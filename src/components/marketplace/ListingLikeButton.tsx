import React, { useState, useEffect } from 'react';
import { isListingLiked, isTradeLiked, toggleListingLike, toggleTradeLike, getEffectiveLikeCount, EVENTS } from '../../lib/marketplaceInteractions';

interface ListingLikeButtonProps {
  id: string;
  type?: 'listing' | 'trade';
  initialCount?: number;
  size?: 'sm' | 'md';
  alwaysShowCount?: boolean;
  showLabel?: boolean;
  variant?: 'overlay' | 'surface';
  className?: string;
}

export function ListingLikeButton({
  id,
  type = 'listing',
  initialCount = 0,
  size = 'md',
  alwaysShowCount = true,
  showLabel = false,
  variant = 'overlay',
  className = '',
}: ListingLikeButtonProps) {
  const isTrade = type === 'trade';
  const [liked, setLiked] = useState(() => (isTrade ? isTradeLiked(id) : isListingLiked(id)));
  const [count, setCount] = useState(() => getEffectiveLikeCount(id, type, initialCount));
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    setLiked(isTrade ? isTradeLiked(id) : isListingLiked(id));
    setCount(getEffectiveLikeCount(id, type, initialCount));
  }, [id, isTrade, initialCount]);

  useEffect(() => {
    const handleLikeEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.sync) {
        setLiked(isTrade ? isTradeLiked(id) : isListingLiked(id));
        setCount(getEffectiveLikeCount(id, type, initialCount));
        return;
      }
      if (isTrade && detail.tradeId === id) {
        setLiked(detail.liked);
        setCount(detail.count);
      } else if (!isTrade && detail.listingId === id) {
        setLiked(detail.liked);
        setCount(detail.count);
      }
    };

    const eventName = isTrade ? EVENTS.TRADE_LIKED : EVENTS.LISTING_LIKED;
    window.addEventListener(eventName, handleLikeEvent);
    return () => window.removeEventListener(eventName, handleLikeEvent);
  }, [id, isTrade, initialCount]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setAnimating(true);
    setTimeout(() => setAnimating(false), 300);

    if (isTrade) {
      const res = await toggleTradeLike(id, count);
      setLiked(res.liked);
      setCount(res.count);
    } else {
      const res = await toggleListingLike(id, count);
      setLiked(res.liked);
      setCount(res.count);
    }
  };

  const isSmall = size === 'sm';
  const shouldShowNumber = alwaysShowCount || showLabel || count > 0;

  const styleClasses = variant === 'surface'
    ? (liked
        ? 'bg-rose-500/15 border-rose-500/40 text-rose-500 shadow-xs'
        : 'border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]')
    : (liked
        ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 shadow-xs'
        : 'bg-black/50 hover:bg-black/70 border-white/15 hover:border-white/30 text-zinc-300 hover:text-white');

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={liked ? 'Unlike listing' : 'Like listing'}
      title={liked ? 'Unlike' : 'Like'}
      className={`group/like inline-flex items-center gap-1.5 rounded-full cursor-pointer transition-all duration-150 backdrop-blur-md select-none border ${styleClasses} ${
        isSmall ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      } ${animating ? 'scale-110' : 'scale-100'} ${className}`}
    >
      <svg
        className={`${isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 transition-transform duration-200 group-hover/like:scale-110 ${
          liked ? 'fill-rose-500 text-rose-500' : 'fill-none text-current'
        }`}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={liked ? 0 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {shouldShowNumber && (
        <span
          className={`font-bold tabular-nums leading-none ${
            liked ? 'text-rose-500' : variant === 'surface' ? 'text-[var(--text-secondary)]' : 'text-zinc-300'
          }`}
        >
          {showLabel ? `${count} ${count === 1 ? 'like' : 'likes'}` : count}
        </span>
      )}
    </button>
  );
}
