import React from 'react';
import type { MarketplaceTrade } from '../../types';
import { CountryFlag } from '../CountryFlag';
import { ListingLikeButton } from './ListingLikeButton';
import { useCurrentUserId } from '../../lib/useCurrentUserId';
import { useCurrency } from '../../lib/currency';
import { getCardImageUrl } from '../../lib/supabase';

interface TradeCardProps {
  trade: MarketplaceTrade;
  onClick: (tradeId: string) => void;
  priority?: boolean;
}

export function TradeCard({ trade, onClick, priority = false }: TradeCardProps) {
  const currentUserId = useCurrentUserId();
  const isOwnTrade = Boolean(currentUserId && trade.trader_id === currentUserId);
  const { formatPrice } = useCurrency();

  const offered = trade.offered_card;
  const wanted = trade.wanted_card;

  const timeAgo = (dateStr: string) => {
    try {
      const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
      if (diffSec < 60) return 'Just now';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return `${Math.floor(diffSec / 86400)}d ago`;
    } catch {
      return '';
    }
  };

  return (
    <div
      onClick={() => onClick(trade.id)}
      className="rounded-2xl overflow-hidden flex flex-col h-full cursor-pointer transition-all duration-200 border group/trade hover:-translate-y-1 shadow-md hover:shadow-xl relative"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      {trade.status === 'on_hold' && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 py-1.5 px-2 bg-black/90 border-y border-amber-500/70 shadow-[0_0_20px_rgba(245,158,11,0.5)] flex items-center justify-center gap-1.5 z-20 pointer-events-none">
          <svg className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="text-[11px] font-black tracking-widest uppercase" style={{ color: 'var(--text-accent)' }}>
            ON HOLD
          </span>
        </div>
      )}
      {/* Trader Header */}
      <div
        className="px-3.5 py-2.5 flex items-center justify-between gap-2 border-b"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {trade.trader_avatar ? (
            <img
              src={trade.trader_avatar}
              alt={trade.trader_name}
              className="w-6 h-6 rounded-full object-cover shrink-0 border border-white/10"
            />
          ) : (
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-white"
              style={{ background: 'var(--accent-strong)' }}
            >
              {(trade.trader_name || 'T')[0].toUpperCase()}
            </div>
          )}
          <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            {trade.trader_name}
          </span>
          {trade.trader_country && (
            <CountryFlag countryCode={trade.trader_country} className="w-3.5 h-2.5 shrink-0 rounded-xs" />
          )}
          {trade.status === 'on_hold' && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
              Hold
            </span>
          )}
        </div>
        <span className="text-[11px] font-semibold shrink-0" style={{ color: 'var(--text-tertiary)' }}>
          {timeAgo(trade.created_at)}
        </span>
      </div>

      {/* Trade Main Visual: Offered Card <-> Wanted Card */}
      <div className="p-3.5 flex-1 flex flex-col">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-3">
          {/* Offering (Card X) */}
          <div className="flex flex-col items-center text-center min-w-0">
            <span className="text-[10px] uppercase font-black tracking-wider mb-1 text-emerald-400">
              Offering
            </span>
            <div
              className="w-full aspect-[63/88] rounded-xl overflow-hidden relative border shadow-sm"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}
            >
              {offered?.image_path ? (
                <img
                  src={getCardImageUrl(offered.image_path)}
                  alt={offered.name}
                  loading={priority ? 'eager' : 'lazy'}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover/trade:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-2 text-center text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>
                  {offered?.name || 'Card X'}
                </div>
              )}
              {trade.offered_is_foil && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-400 text-zinc-950 shadow-xs">
                  Foil
                </span>
              )}
              {trade.offered_quantity > 1 && (
                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-black bg-black/80 text-white border border-white/20">
                  {trade.offered_quantity}x
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs font-bold truncate w-full" style={{ color: 'var(--text-primary)' }} title={offered?.name}>
              {offered?.name || 'Card X'}
            </p>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              {trade.offered_condition}
            </span>
          </div>

          {/* Trade Direction Divider */}
          <div className="flex flex-col items-center justify-center px-1">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center border shadow-xs"
              style={{
                background: 'var(--accent-muted)',
                borderColor: 'var(--accent)',
                color: 'var(--text-accent)',
              }}
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
            {trade.cash_difference_huf !== 0 ? (
              <span
                className={`mt-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums whitespace-nowrap ${
                  trade.cash_difference_huf > 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {trade.cash_difference_huf > 0 ? `+${formatPrice(trade.cash_difference_huf)}` : formatPrice(trade.cash_difference_huf)}
              </span>
            ) : (
              <span className="mt-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                1:1 Trade
              </span>
            )}
          </div>

          {/* Wanting (Card Y) */}
          <div className="flex flex-col items-center text-center min-w-0">
            <span className="text-[10px] uppercase font-black tracking-wider mb-1 text-sky-400">
              Wanted
            </span>
            <div
              className="w-full aspect-[63/88] rounded-xl overflow-hidden relative border shadow-sm"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}
            >
              {wanted?.image_path ? (
                <img
                  src={getCardImageUrl(wanted.image_path)}
                  alt={wanted.name}
                  loading={priority ? 'eager' : 'lazy'}
                  className="w-full h-full object-cover transition-transform duration-200 group-hover/trade:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-2 text-center text-xs font-bold" style={{ color: 'var(--text-tertiary)' }}>
                  {wanted?.name || 'Card Y'}
                </div>
              )}
              {trade.wanted_is_foil === true && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-400 text-zinc-950 shadow-xs">
                  Foil
                </span>
              )}
              {trade.wanted_quantity > 1 && (
                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[9px] font-black bg-black/80 text-white border border-white/20">
                  {trade.wanted_quantity}x
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs font-bold truncate w-full" style={{ color: 'var(--text-primary)' }} title={wanted?.name}>
              {wanted?.name || 'Card Y'}
            </p>
            <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              {trade.wanted_min_condition}+
            </span>
          </div>
        </div>

        {/* Description / Notes snippet if present */}
        {trade.description && (
          <p
            className="text-xs line-clamp-2 mb-3 p-2 rounded-lg italic border text-[var(--text-secondary)]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
          >
            "{trade.description}"
          </p>
        )}

        {/* Handover method tags */}
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {trade.handover_methods.slice(0, 3).map((m) => (
            <span
              key={m}
              className="px-2 py-0.5 rounded text-[10px] font-semibold capitalize border"
              style={{
                background: 'var(--bg-surface-2)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              {m}
            </span>
          ))}
          {trade.handover_methods.length > 3 && (
            <span className="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>
              +{trade.handover_methods.length - 3}
            </span>
          )}
        </div>

        {/* Footer: Likes, Saves & Action Button */}
        <div className="mt-auto pt-2.5 flex items-center justify-between gap-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-1.5">
            <ListingLikeButton id={trade.id} type="trade" initialCount={trade.likes_count} alwaysShowCount size="sm" variant="surface" />
          </div>

          {isOwnTrade ? (
            <span
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg border text-center"
              style={{
                background: 'var(--bg-surface-2)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-tertiary)',
              }}
            >
              Your Trade
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClick(trade.id);
              }}
              className="px-3 py-1 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer flex items-center gap-1 hover:brightness-110 shadow-xs"
              style={{
                background: 'var(--accent-strong)',
                color: 'var(--text-on-accent, #000)',
              }}
            >
              <span>View Trade</span>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
