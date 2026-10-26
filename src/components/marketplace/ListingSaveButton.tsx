import React, { useState, useEffect } from 'react';
import { isListingSaved, isTradeSaved, toggleListingSave, toggleTradeSave, EVENTS } from '../../lib/marketplaceInteractions';

interface ListingSaveButtonProps {
  id: string;
  type?: 'listing' | 'trade';
  size?: 'sm' | 'md';
  showLabel?: boolean;
  variant?: 'overlay' | 'surface';
  className?: string;
}

export function ListingSaveButton({
  id,
  type = 'listing',
  size = 'md',
  showLabel = false,
  variant = 'overlay',
  className = '',
}: ListingSaveButtonProps) {
  const isTrade = type === 'trade';
  const [saved, setSaved] = useState(() => (isTrade ? isTradeSaved(id) : isListingSaved(id)));
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    setSaved(isTrade ? isTradeSaved(id) : isListingSaved(id));
  }, [id, isTrade]);

  useEffect(() => {
    const handleSaveEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (isTrade && detail.tradeId === id) {
        setSaved(detail.saved);
      } else if (!isTrade && detail.listingId === id) {
        setSaved(detail.saved);
      }
    };

    const eventName = isTrade ? EVENTS.TRADE_SAVED : EVENTS.LISTING_SAVED;
    window.addEventListener(eventName, handleSaveEvent);
    return () => window.removeEventListener(eventName, handleSaveEvent);
  }, [id, isTrade]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setAnimating(true);
    setTimeout(() => setAnimating(false), 300);

    if (isTrade) {
      const res = await toggleTradeSave(id);
      setSaved(res.saved);
    } else {
      const res = await toggleListingSave(id);
      setSaved(res.saved);
    }
  };

  const isSmall = size === 'sm';

  const styleClasses = variant === 'surface'
    ? (saved
        ? 'bg-amber-400/20 border-amber-400/50 text-amber-500 shadow-xs'
        : 'border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]')
    : (saved
        ? 'bg-amber-400/20 border-amber-400/50 text-amber-300 shadow-xs'
        : 'bg-black/50 hover:bg-black/70 border-white/15 hover:border-white/30 text-zinc-300 hover:text-white');

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={saved ? 'Remove from saved' : 'Save listing for later'}
      title={saved ? 'Saved (click to unsave)' : 'Save listing'}
      className={`group/save inline-flex items-center gap-1 rounded-full cursor-pointer transition-all duration-150 backdrop-blur-md select-none border ${styleClasses} ${
        isSmall ? 'p-1 text-[10px]' : 'px-2 py-1 text-xs'
      } ${animating ? 'scale-110' : 'scale-100'} ${className}`}
    >
      <svg
        className={`${isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 transition-transform duration-200 group-hover/save:scale-110 ${
          saved ? 'fill-amber-400 text-amber-400' : 'fill-none text-current'
        }`}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={saved ? 0 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {showLabel && (
        <span
          className={`font-semibold ${
            saved ? 'text-amber-500' : variant === 'surface' ? 'text-[var(--text-secondary)]' : 'text-zinc-300'
          }`}
        >
          {saved ? 'Saved' : 'Save'}
        </span>
      )}
    </button>
  );
}
