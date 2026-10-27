import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { getCurrentUser } from '../../lib/auth';
import { STORAGE_KEYS } from '../../lib/constants';
import { useExitTransition } from '../../lib/useExitTransition';
import { useCurrency } from '../../lib/currency';
import { LISTING_CONDITIONS } from '../../lib/collectionDefaults';
import { getSellerHandoverMethods, type DynamicHandoverMethod } from '../../lib/shipping';
import { fetchShippingSettings } from '../../lib/shippingClient';
import { ListingPhotoUploader } from './ListingPhotoUploader';
import { ListingHandoverSelector } from './ListingHandoverSelector';
import { CardSearchAutocomplete } from './CardSearchAutocomplete';
import type { CatalogCard } from '../../types';

interface CreateTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (type?: 'trade') => void;
  initialCard?: CatalogCard | null;
  embedded?: boolean;
}

const CONDITIONS = LISTING_CONDITIONS;

export function CreateTradeModal({
  isOpen,
  onClose,
  onSuccess,
  initialCard = null,
  embedded = false,
}: CreateTradeModalProps) {
  const { formatPrice } = useCurrency();
  const [activeGame, setActiveGame] = useState('riftbound');

  // Offered Card (Card X)
  const [offeredCard, setOfferedCard] = useState<CatalogCard | null>(initialCard);
  const [offeredCondition, setOfferedCondition] = useState('Near Mint');
  const [offeredIsFoil, setOfferedIsFoil] = useState(false);
  const [offeredQty, setOfferedQty] = useState(1);
  const [offeredPhotos, setOfferedPhotos] = useState<string[]>([]);

  // Wanted Card (Card Y)
  const [wantedCard, setWantedCard] = useState<CatalogCard | null>(null);
  const [wantedCondition, setWantedCondition] = useState('Near Mint');
  const [wantedFoilPref, setWantedFoilPref] = useState<'any' | 'foil' | 'non_foil'>('any');
  const [wantedQty, setWantedQty] = useState(1);

  // Trade Terms & Handover
  const [cashDiffType, setCashDiffType] = useState<'even' | 'give' | 'request'>('even');
  const [cashDiffAmount, setCashDiffAmount] = useState('0');
  const [allowedHandovers, setAllowedHandovers] = useState<string[]>(['personal', 'foxpost', 'packeta', 'other']);
  const [availableHandovers, setAvailableHandovers] = useState<DynamicHandoverMethod[]>([]);
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME) || 'riftbound';
      setActiveGame(saved);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      getCurrentUser().then((u) => {
        setIsSignedIn(Boolean(u));
        if (u?.id) {
          fetchShippingSettings([u.id]).then((map) => {
            const settings = map[u.id];
            const methods = getSellerHandoverMethods(settings);
            setAvailableHandovers(methods);
            setAllowedHandovers(methods.map((m) => m.id));
          });
        }
      });
      setErrorMsg(null);
      if (initialCard) {
        setOfferedCard(initialCard);
      }
    }
  }, [isOpen, initialCard]);

  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offeredCard) {
      setErrorMsg('Please select the card you are offering (Card X).');
      return;
    }
    if (!wantedCard) {
      setErrorMsg('Please select the card you want in return (Card Y).');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        setErrorMsg('You must be signed in to create a trade listing.');
        setSubmitting(false);
        return;
      }

      let diffNum = 0;
      if (cashDiffType === 'give') {
        diffNum = Math.abs(parseInt(cashDiffAmount, 10) || 0);
      } else if (cashDiffType === 'request') {
        diffNum = -Math.abs(parseInt(cashDiffAmount, 10) || 0);
      }

      const res = await fetch('/api/marketplace/trades', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          offered_card_id: offeredCard.id,
          offered_condition: offeredCondition,
          offered_is_foil: offeredIsFoil,
          offered_quantity: offeredQty,
          offered_images: offeredPhotos,
          wanted_card_id: wantedCard.id,
          wanted_min_condition: wantedCondition,
          wanted_is_foil: wantedFoilPref === 'any' ? null : wantedFoilPref === 'foil',
          wanted_quantity: wantedQty,
          cash_difference_huf: diffNum,
          handover_methods: allowedHandovers,
          description,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to create trade listing.');
      }

      onSuccess('trade');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while creating the trade.');
    } finally {
      setSubmitting(false);
    }
  };

  const { rendered, state } = useExitTransition(isOpen, 250);
  if (!embedded && !rendered) return null;
  const modalState = embedded ? 'open' : state;

  const formElement = (
    <form onSubmit={handleSubmit} className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {errorMsg && (
            <div
              className="p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2"
              style={{
                background: 'var(--negative-muted)',
                borderColor: 'var(--negative-border)',
                color: 'var(--negative)',
              }}
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{errorMsg}</span>
            </div>
          )}

          {!isSignedIn && (
            <div
              className="p-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3"
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
            >
              <span>You need to be logged in to create a trade listing.</span>
              <a
                href="/login"
                className="px-3 py-1 rounded-lg text-xs font-bold border transition hover:brightness-110"
                style={{ borderColor: 'var(--accent)', background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
              >
                Sign in
              </a>
            </div>
          )}

          {/* Side by side: Card You Have vs Card You Want */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ── CARD 1: OFFERED (CARD X) ── */}
            <div
              className="p-4 rounded-2xl border flex flex-col gap-3"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-[var(--text-accent)] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                  1. Card You Offer (Card X)
                </span>
              </div>

              <CardSearchAutocomplete
                label=""
                activeGame={activeGame}
                selectedCard={offeredCard}
                onSelect={setOfferedCard}
                onClearSelected={() => setOfferedCard(null)}
                placeholder="Search card by name or number..."
              />

              {/* Condition & Foil */}
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    Condition
                  </label>
                  <select
                    value={offeredCondition}
                    onChange={(e) => setOfferedCondition(e.target.value)}
                    className="w-full h-8 px-2 rounded-lg text-xs border outline-none font-semibold cursor-pointer"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    Finish
                  </label>
                  <button
                    type="button"
                    onClick={() => setOfferedIsFoil((prev) => !prev)}
                    className={`w-full h-8 px-2 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      offeredIsFoil ? 'bg-amber-400/20 text-amber-300 border-amber-400/40' : 'border-[var(--border)] text-[var(--text-secondary)]'
                    }`}
                    style={offeredIsFoil ? undefined : { background: 'var(--bg-surface)' }}
                  >
                    {offeredIsFoil ? 'Foil Finish' : 'Normal Finish'}
                  </button>
                </div>
              </div>

              {/* Quantity */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Quantity offered:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOfferedQty((q) => Math.max(1, q - 1))}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
                  >
                    -
                  </button>
                  <span className="text-xs font-bold tabular-nums w-5 text-center">{offeredQty}</span>
                  <button
                    type="button"
                    onClick={() => setOfferedQty((q) => Math.min(10, q + 1))}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Photos upload */}
              <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <ListingPhotoUploader
                  photos={offeredPhotos}
                  onPhotosChange={setOfferedPhotos}
                  maxPhotos={4}
                  label="Condition Photos"
                  subtitle="(optional)"
                />
              </div>
            </div>

            {/* ── CARD 2: WANTED (CARD Y) ── */}
            <div
              className="p-4 rounded-2xl border flex flex-col gap-3"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--text-secondary)]" />
                  2. Card You Want (Card Y)
                </span>
              </div>

              <CardSearchAutocomplete
                label=""
                activeGame={activeGame}
                selectedCard={wantedCard}
                onSelect={setWantedCard}
                onClearSelected={() => setWantedCard(null)}
                placeholder="Search wanted card name or number..."
              />

              {/* Min Condition & Foil Pref */}
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    Minimum Condition
                  </label>
                  <select
                    value={wantedCondition}
                    onChange={(e) => setWantedCondition(e.target.value)}
                    className="w-full h-8 px-2 rounded-lg text-xs border outline-none font-semibold cursor-pointer"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>{c} or better</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-tertiary)' }}>
                    Finish Preference
                  </label>
                  <select
                    value={wantedFoilPref}
                    onChange={(e) => setWantedFoilPref(e.target.value as any)}
                    className="w-full h-8 px-2 rounded-lg text-xs border outline-none font-semibold cursor-pointer"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    <option value="any">Any finish</option>
                    <option value="non_foil">Non-foil only</option>
                    <option value="foil">Foil only</option>
                  </select>
                </div>
              </div>

              {/* Quantity */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Quantity wanted:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setWantedQty((q) => Math.max(1, q - 1))}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
                  >
                    -
                  </button>
                  <span className="text-xs font-bold tabular-nums w-5 text-center">{wantedQty}</span>
                  <button
                    type="button"
                    onClick={() => setWantedQty((q) => Math.min(10, q + 1))}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)]"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── 3. TERMS & HANDOVER ── */}
          <div className="p-4 rounded-2xl border space-y-4" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}>
            <span className="text-xs font-black uppercase tracking-wider block" style={{ color: 'var(--text-tertiary)' }}>
              3. Trade Terms & Handover
            </span>

            {/* Cash Difference */}
            <div>
              <label className="text-xs font-bold block mb-2" style={{ color: 'var(--text-secondary)' }}>
                Cash adjustment (optional):
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {[
                  { id: 'even', label: 'Even trade (1 for 1)' },
                  { id: 'give', label: 'I will add cash (+ HUF)' },
                  { id: 'request', label: 'I request cash difference (- HUF)' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setCashDiffType(opt.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                      cashDiffType === opt.id
                        ? 'bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-accent)]'
                        : 'border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                    }`}
                    style={cashDiffType === opt.id ? undefined : { background: 'var(--bg-surface)' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {cashDiffType !== 'even' && (
                <div className="flex items-center gap-2 max-w-xs mt-2">
                  <input
                    type="number"
                    min="100"
                    step="100"
                    placeholder="Amount in HUF"
                    value={cashDiffAmount}
                    onChange={(e) => setCashDiffAmount(e.target.value)}
                    className="w-full h-9 rounded-xl px-3 text-xs outline-none border font-bold"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                  <span className="text-xs font-bold shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                    HUF
                  </span>
                </div>
              )}
            </div>

            {/* Handover Methods */}
            <div className="p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <ListingHandoverSelector
                allowedHandovers={allowedHandovers}
                onChange={setAllowedHandovers}
                availableMethods={availableHandovers}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-bold block mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Trade notes / description (optional):
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Can meet in Budapest near Nyugati, or send via Foxpost locker. Looking for near mint copies!"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl p-2.5 text-xs outline-none border transition focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold border transition cursor-pointer hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !isSignedIn}
              className="px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-md flex items-center gap-2 hover:brightness-110 disabled:opacity-50"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-contrast, #000)',
                boxShadow: '0 4px 14px var(--accent-muted, rgba(0,0,0,0.2))',
              }}
            >
              {submitting ? (
                <span>Publishing trade...</span>
              ) : (
                <>
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Post Trade Listing</span>
                </>
              )}
            </button>
          </div>
        </form>
  );

  if (embedded) {
    return <div className="flex flex-col flex-1 overflow-hidden">{formElement}</div>;
  }

  const content = (
    <div
      data-state={modalState}
      className="tv-overlay fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-state={modalState}
        onClick={(e) => e.stopPropagation()}
        className="tv-modal-panel w-full max-w-3xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col my-auto max-h-[90vh]"
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
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center border shadow-xs"
              style={{
                background: 'var(--accent-muted)',
                borderColor: 'var(--accent)',
                color: 'var(--text-accent)',
              }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">Set Up Card Trade</h2>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Offer Card X in exchange for Card Y
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border flex items-center justify-center transition cursor-pointer hover:brightness-110"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {formElement}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
