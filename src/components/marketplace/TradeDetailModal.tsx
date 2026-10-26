import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { MarketplaceTrade } from '../../types';
import { CountryFlag } from '../CountryFlag';
import { ListingLikeButton } from './ListingLikeButton';
import { useCurrentUserId } from '../../lib/useCurrentUserId';
import { useCurrency } from '../../lib/currency';
import { useExitTransition } from '../../lib/useExitTransition';
import { supabase, getCardImageUrl } from '../../lib/supabase';
import { ImageViewer } from '../CardImageViewer';

interface TradeDetailModalProps {
  trade: MarketplaceTrade | null;
  onClose: () => void;
  onTradeDeleted?: () => void;
}

export function TradeDetailModal({
  trade: initialTrade,
  onClose,
  onTradeDeleted,
}: TradeDetailModalProps) {
  const lastTradeRef = useRef<MarketplaceTrade | null>(null);
  if (initialTrade) lastTradeRef.current = initialTrade;
  const trade = initialTrade || lastTradeRef.current;

  const { rendered, state } = useExitTransition(Boolean(initialTrade), 250);

  useEffect(() => {
    if (!initialTrade) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [Boolean(initialTrade)]);

  const currentUserId = useCurrentUserId();
  const isOwnTrade = Boolean(currentUserId && trade && trade.trader_id === currentUserId);
  const { formatPrice } = useCurrency();

  const [proposing, setProposing] = useState(false);
  const [proposalMsg, setProposalMsg] = useState('');
  const [sendingProposal, setSendingProposal] = useState(false);
  const [proposalSuccess, setProposalSuccess] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[] | null>(null);
  const [viewerIdx, setViewerIdx] = useState(0);

  const handleUpdateStatus = async (newStatus: 'open' | 'completed') => {
    if (!trade) return;
    setUpdatingStatus(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;
      const res = await fetch('/api/marketplace/trades', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: trade.id, status: newStatus }),
      });
      const json = await res.json();
      if (json.success) {
        trade.status = newStatus;
        if (onTradeDeleted) onTradeDeleted();
        onClose();
      }
    } catch {
      // Ignore
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (!rendered || !trade) return null;

  const offered = trade.offered_card;
  const wanted = trade.wanted_card;

  const handleSendProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendingProposal(true);
    setProposalError(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        setProposalError('Please sign in to send a trade proposal.');
        setSendingProposal(false);
        return;
      }

      const res = await fetch('/api/marketplace/trades/propose', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          trade_id: trade.id,
          message: proposalMsg,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to submit trade proposal.');
      }

      setProposalSuccess(true);
      setTimeout(() => {
        if (json.conversation_id) {
          window.location.href = `/messages?conversation_id=${json.conversation_id}`;
        }
      }, 1200);
    } catch (err: any) {
      setProposalError(err.message || 'Error sending proposal.');
    } finally {
      setSendingProposal(false);
    }
  };

  const handleDeleteTrade = async () => {
    if (!confirm('Are you sure you want to cancel and remove this trade listing?')) return;
    setDeleting(true);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) return;

      const res = await fetch(`/api/marketplace/trades?id=${trade.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (json.success) {
        if (onTradeDeleted) onTradeDeleted();
        onClose();
      }
    } catch {
      // Ignore
    } finally {
      setDeleting(false);
    }
  };

  const content = (
    <>
      <div
        data-state={state}
        className="tv-overlay fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto bg-black/80 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          data-state={state}
          onClick={(e) => e.stopPropagation()}
          className="tv-modal-panel w-full max-w-3xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border)',
            color: 'var(--text-primary)',
          }}
        >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {trade.trader_avatar ? (
              <img
                src={trade.trader_avatar}
                alt={trade.trader_name}
                className="w-9 h-9 rounded-full object-cover border border-white/10 shrink-0"
              />
            ) : (
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ background: 'var(--accent-strong)' }}
              >
                {(trade.trader_name || 'T')[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm sm:text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                  {trade.trader_name}
                </span>
                {trade.trader_country && (
                  <CountryFlag countryCode={trade.trader_country} className="w-4 h-3 rounded-xs shrink-0" />
                )}
                {trade.trader_badge && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                    style={{
                      background: 'var(--accent-muted)',
                      borderColor: 'var(--accent)',
                      color: 'var(--text-accent)',
                    }}
                  >
                    {trade.trader_badge}
                  </span>
                )}
              </div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Card Exchange Listing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ListingLikeButton id={trade.id} type="trade" initialCount={trade.likes_count} alwaysShowCount showLabel variant="surface" />
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full border flex items-center justify-center transition cursor-pointer hover:brightness-110 ml-1"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* Main Visual Side-by-Side: Card X vs Card Y */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-4">
            {/* OFFERED CARD (CARD X) */}
            <div
              className="p-4 rounded-2xl border flex flex-col items-center text-center shadow-sm"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
            >
              <div className="w-full flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase font-black tracking-wider text-emerald-400">
                  Offering (Have)
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  {trade.offered_quantity}x Copies
                </span>
              </div>

              <div
                className={`w-40 aspect-[63/88] rounded-xl overflow-hidden relative border shadow-md my-2 ${
                  offered?.image_path ? 'cursor-zoom-in group' : ''
                }`}
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                onClick={() => {
                  if (offered?.image_path) {
                    setViewerImages([getCardImageUrl(offered.image_path)]);
                    setViewerIdx(0);
                  }
                }}
              >
                {offered?.image_path ? (
                  <img src={getCardImageUrl(offered.image_path)} alt={offered.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-2 text-xs font-bold text-zinc-400">
                    {offered?.name}
                  </div>
                )}
                {trade.offered_is_foil && (
                  <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-400 text-zinc-950 shadow-md">
                    Foil
                  </span>
                )}
              </div>

              <h3 className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
                {offered?.name}
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {offered?.sets?.name} - {offered?.card_number}
              </p>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap justify-center">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                  {offered?.rarity}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Condition: {trade.offered_condition}
                </span>
              </div>
            </div>

            {/* EXCHANGE ARROWS / CASH DIFF */}
            <div className="flex md:flex-col items-center justify-center gap-2 py-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center border shadow-md"
                style={{
                  background: 'var(--accent-muted)',
                  borderColor: 'var(--accent)',
                  color: 'var(--text-accent)',
                }}
              >
                <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </div>
              <div className="text-center">
                {trade.cash_difference_huf !== 0 ? (
                  <div
                    className={`px-3 py-1 rounded-xl text-xs font-bold tabular-nums border ${
                      trade.cash_difference_huf > 0
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}
                  >
                    {trade.cash_difference_huf > 0
                      ? `+${formatPrice(trade.cash_difference_huf)} trader adds`
                      : `${formatPrice(Math.abs(trade.cash_difference_huf))} requested`}
                  </div>
                ) : (
                  <span className="px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    1 for 1 Trade
                  </span>
                )}
              </div>
            </div>

            {/* WANTED CARD (CARD Y) */}
            <div
              className="p-4 rounded-2xl border flex flex-col items-center text-center shadow-sm"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
            >
              <div className="w-full flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase font-black tracking-wider text-sky-400">
                  Wanted (Looking For)
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                  {trade.wanted_quantity}x Copies
                </span>
              </div>

              <div
                className={`w-40 aspect-[63/88] rounded-xl overflow-hidden relative border shadow-md my-2 ${
                  wanted?.image_path ? 'cursor-zoom-in group' : ''
                }`}
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                onClick={() => {
                  if (wanted?.image_path) {
                    setViewerImages([getCardImageUrl(wanted.image_path)]);
                    setViewerIdx(0);
                  }
                }}
              >
                {wanted?.image_path ? (
                  <img src={getCardImageUrl(wanted.image_path)} alt={wanted.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-2 text-xs font-bold text-zinc-400">
                    {wanted?.name}
                  </div>
                )}
                {trade.wanted_is_foil === true && (
                  <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-400 text-zinc-950 shadow-md">
                    Foil Only
                  </span>
                )}
              </div>

              <h3 className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
                {wanted?.name}
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {wanted?.sets?.name} - {wanted?.card_number}
              </p>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap justify-center">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                  {wanted?.rarity}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  Min Condition: {trade.wanted_min_condition}+
                </span>
              </div>
            </div>
          </div>

          {/* Condition Photos Gallery if present */}
          {trade.offered_images && trade.offered_images.length > 0 && (
            <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
              <span className="text-xs font-bold uppercase tracking-wider block mb-2" style={{ color: 'var(--text-secondary)' }}>
                Condition Photos of Offered Card:
              </span>
              <div className="flex items-center gap-3 overflow-x-auto pb-1">
                {trade.offered_images.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setViewerImages(trade.offered_images || null);
                      setViewerIdx(i);
                    }}
                    className="w-24 h-24 rounded-xl overflow-hidden border border-white/10 shrink-0 hover:scale-105 transition cursor-zoom-in group"
                  >
                    <img src={img} alt={`Proof ${i + 1}`} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Trade Details & Notes */}
          <div className="p-4 rounded-2xl border space-y-3" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Accepted Handover Options:
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {trade.handover_methods.map((m) => (
                  <span
                    key={m}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold capitalize border"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>

            {trade.description && (
              <div>
                <span className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Trader Notes:
                </span>
                <p className="text-xs italic leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  "{trade.description}"
                </p>
              </div>
            )}
          </div>

          {/* Proposal Action Area */}
          {isOwnTrade ? (
            <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                  This is your trade listing.
                </span>
                {trade.status === 'on_hold' && (
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-500/15 border-amber-500/40 text-amber-400">
                    On Hold
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {trade.status === 'on_hold' && (
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus('open')}
                    disabled={updatingStatus}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 cursor-pointer transition"
                  >
                    {updatingStatus ? 'Updating...' : 'Release Hold (Return to Marketplace)'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleUpdateStatus('completed')}
                  disabled={updatingStatus}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 cursor-pointer transition"
                >
                  Mark Completed
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTrade}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 cursor-pointer transition"
                >
                  {deleting ? 'Removing...' : 'Cancel & Remove Trade'}
                </button>
              </div>
            </div>
          ) : proposalSuccess ? (
            <div
              className="p-4 rounded-2xl border text-center font-bold text-xs bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
            >
              Trade proposal sent! Redirecting to chat conversation...
            </div>
          ) : trade.status === 'on_hold' ? (
            <div className="p-3.5 rounded-2xl border flex items-center justify-between gap-3 bg-amber-500/10 border-amber-500/30 text-amber-300">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span className="text-xs font-bold">This trade is currently on hold while a proposal is in negotiation.</span>
              </div>
              <a
                href="/messages"
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 text-zinc-950 hover:bg-amber-300 transition shrink-0"
              >
                Go to Messages
              </a>
            </div>
          ) : proposing ? (
            <form onSubmit={handleSendProposal} className="p-4 rounded-2xl border space-y-3" style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)' }}>
              <span className="text-xs font-bold block" style={{ color: 'var(--text-accent)' }}>
                Propose this trade to {trade.trader_name}:
              </span>
              <textarea
                rows={3}
                required
                placeholder="Include details about your copy's condition, handover preference, or ask any questions..."
                value={proposalMsg}
                onChange={(e) => setProposalMsg(e.target.value)}
                className="w-full rounded-xl p-3 text-xs outline-none border transition"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
              {proposalError && (
                <p className="text-xs font-semibold text-rose-400">{proposalError}</p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProposing(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingProposal}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-md flex items-center gap-1.5 hover:brightness-110 disabled:opacity-50"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {sendingProposal ? 'Sending...' : 'Send Trade Proposal'}
                </button>
              </div>
            </form>
          ) : (
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setProposing(true)}
                className="px-6 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-md flex items-center gap-2 hover:brightness-110"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                <span>Propose Trade to Trader</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

    {viewerImages && viewerImages.length > 0 && (
      <ImageViewer
        open={Boolean(viewerImages)}
        onClose={() => setViewerImages(null)}
        images={viewerImages}
        currentIndex={viewerIdx}
        onIndexChange={setViewerIdx}
      />
    )}
  </>
);

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
