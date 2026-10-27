import React, { useState, useEffect } from 'react';
import { useExitTransition } from '../../lib/useExitTransition';
import { MAX_LISTING_DESCRIPTION } from '../../lib/sellerNotes';
import { supabase } from '../../lib/supabase';
import { getCurrentProfile } from '../../lib/auth';
import { STORAGE_KEYS, EVENTS } from '../../lib/constants';
import { adjustLocalCollection } from '../../lib/collectionClient';
import { getEurToHuf, fetchSiteListingPrices } from '../../lib/prices';
import { DEFAULT_EUR_TO_HUF, eurToHuf, roundHuf, suggestPrice } from '../../lib/priceSuggestion';
import { marketEurOf } from '../../lib/cardValues';
import type { CatalogCard, InventoryCard, UserProfile } from '../../types';
import { useCurrency, formatCurrencyPrice } from '../../lib/currency';
import { LISTING_CONDITIONS } from '../../lib/collectionDefaults';
import { getSellerHandoverMethods, type DynamicHandoverMethod } from '../../lib/shipping';
import { fetchShippingSettings } from '../../lib/shippingClient';

import { ListingPhotoUploader } from './ListingPhotoUploader';
import { ListingHandoverSelector } from './ListingHandoverSelector';
import { AuctionSettingsForm } from './AuctionSettingsForm';
import { CardSearchAutocomplete } from './CardSearchAutocomplete';

interface ListCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCard?: CatalogCard | InventoryCard | null;
  onSuccess?: (type?: 'single' | 'auction') => void;
  embedded?: boolean;
  initialIsAuction?: boolean;
}

const CONDITIONS = LISTING_CONDITIONS;

export function ListCardModal({
  isOpen,
  onClose,
  initialCard = null,
  onSuccess,
  embedded = false,
  initialIsAuction = false,
}: ListCardModalProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeGame, setActiveGame] = useState('riftbound');
  const [selectedCard, setSelectedCard] = useState<CatalogCard | InventoryCard | null>(initialCard);

  // Form State
  const [isAuction, setIsAuction] = useState<boolean>(initialIsAuction);
  const [auctionBasePrice, setAuctionBasePrice] = useState<string>('500');
  const [auctionBidStep, setAuctionBidStep] = useState<string>('50');
  const [auctionDuration, setAuctionDuration] = useState<number>(1440);
  const [auctionExtension, setAuctionExtension] = useState<string>('5');

  const [condition, setCondition] = useState('Near Mint');
  const [isFoil, setIsFoil] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const { currency, formatPrice, eurHufRate, isEur } = useCurrency();
  const effectiveRate = eurHufRate > 0 ? eurHufRate : DEFAULT_EUR_TO_HUF;
  const [priceHuf, setPriceHuf] = useState<number>(500);
  const [priceInput, setPriceInput] = useState<string>('500');
  // Until the seller types a price themselves, the price box follows the suggestion as it firms up
  // (the listings on the site arrive a moment after the card is picked).
  const [priceTouched, setPriceTouched] = useState(false);
  const [eurHuf, setEurHuf] = useState<number>(DEFAULT_EUR_TO_HUF);
  const [sitePrices, setSitePrices] = useState<number[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [allowedHandovers, setAllowedHandovers] = useState<string[]>([
    'personal',
    'foxpost',
    'packeta',
    'other',
  ]);
  const [availableHandovers, setAvailableHandovers] = useState<DynamicHandoverMethod[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME) || 'riftbound';
      setActiveGame(saved);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsAuction(Boolean(initialIsAuction));
      getCurrentProfile().then(p => {
        setProfile(p);
        if (p?.id) {
          fetchShippingSettings([p.id]).then((map) => {
            const settings = map[p.id];
            const methods = getSellerHandoverMethods(settings);
            setAvailableHandovers(methods);
            setAllowedHandovers(methods.map((m) => m.id));
          });
        }
      });
      setErrorMsg(null);
      setSuccessMsg(null);
      setPhotos([]);
      setDescription('');

      if (initialCard) {
        setSelectedCard(initialCard);
        const initialFoil = (initialCard as any).is_foil || false;
        setIsFoil(initialFoil);
        setPriceHuf(500);
        setPriceInput(isEur ? (500 / effectiveRate).toFixed(2) : '500');
        setPriceTouched(false);
      } else {
        setSelectedCard(null);
        setPriceHuf(500);
        setPriceInput(isEur ? (500 / effectiveRate).toFixed(2) : '500');
        setPriceTouched(false);
      }
    }
  }, [isOpen, initialCard, initialIsAuction]);

  const cardData: any = selectedCard ? ((selectedCard as any).cards || selectedCard) : null;
  const selectedCardId: string | null = selectedCard ? ((selectedCard as any).card_id || cardData?.id || null) : null;

  useEffect(() => {
    if (isOpen) getEurToHuf().then(setEurHuf);
  }, [isOpen]);

  // What other sellers on the site are asking for this card in this finish.
  useEffect(() => {
    if (!isOpen || !selectedCardId) {
      setSitePrices([]);
      return;
    }
    let cancelled = false;
    fetchSiteListingPrices(selectedCardId, isFoil, profile?.id).then((prices) => {
      if (!cancelled) setSitePrices(prices);
    });
    return () => { cancelled = true; };
  }, [isOpen, selectedCardId, isFoil, profile?.id]);

  // A card printed in only one finish has a single price whichever finish is selected here.
  const marketEur: number | null = cardData ? marketEurOf(cardData, isFoil) : null;
  const suggestion = suggestPrice({
    referenceHuf: marketEur ? eurToHuf(marketEur, eurHuf) : null,
    sitePrices,
  });
  const suggestedHuf = suggestion.suggestedHuf;

  useEffect(() => {
    if (!priceTouched && suggestedHuf) {
      setPriceHuf(suggestedHuf);
      setPriceInput(isEur ? (suggestedHuf / effectiveRate).toFixed(2) : String(suggestedHuf));
    }
  }, [priceTouched, suggestedHuf, isEur, effectiveRate]);

  useEffect(() => {
    if (priceHuf > 0) {
      setPriceInput(isEur ? (priceHuf / effectiveRate).toFixed(2) : String(priceHuf));
    }
  }, [currency, effectiveRate]);

  const { rendered, state } = useExitTransition(isOpen, 250);
  if (!embedded && !rendered) return null;
  const modalState = embedded ? 'open' : state;

  const handleSelectCard = (card: CatalogCard) => {
    setSelectedCard(card);
    setPriceHuf(500);
    setPriceInput(isEur ? (500 / effectiveRate).toFixed(2) : '500');
    setPriceTouched(false);
  };

  const handleFoilToggle = (foil: boolean) => {
    setIsFoil(foil);
    // A different finish is a different price, so the suggestion takes over again.
    setPriceTouched(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) {
      setErrorMsg('Please select a card to list.');
      return;
    }
    if (!profile) {
      setErrorMsg('You must be signed in to list cards.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session?.access_token) {
        throw new Error('No active user session. Please sign in again.');
      }

      const cardId = (selectedCard as any).card_id || (selectedCard as any).id;

      if (isAuction) {
        const baseHuf = Math.round(Number(auctionBasePrice));
        const stepHuf = Math.round(Number(auctionBidStep));
        const extMins = Math.round(Number(auctionExtension));

        if (isNaN(baseHuf) || baseHuf <= 0) {
          throw new Error('Please enter a valid starting base price.');
        }
        if (isNaN(stepHuf) || stepHuf <= 0) {
          throw new Error('Please enter a valid bid increment step.');
        }

        const res = await fetch('/api/marketplace/auctions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            card_id: cardId,
            condition,
            is_foil: isFoil,
            quantity: Math.max(1, quantity),
            images: photos,
            base_price_huf: baseHuf,
            bid_step_huf: stepHuf,
            duration_minutes: auctionDuration,
            extension_minutes: isNaN(extMins) ? 5 : extMins,
            handover_methods: allowedHandovers,
            description: description.trim(),
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Failed to start auction.');
        }

        setSuccessMsg('Auction successfully created on the marketplace!');
      } else {
        const res = await fetch('/api/marketplace/listings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            card_id: cardId,
            quantity: Math.max(1, quantity),
            price_huf: Math.max(1, priceHuf),
            condition,
            is_foil: isFoil,
            images: photos,
            handover_methods: allowedHandovers,
            description: description.trim(),
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Failed to publish marketplace listing.');
        }

        setSuccessMsg('Card successfully listed on the marketplace!');
      }

      // The listed copies just left the collection server-side; mirror that locally
      // so the "owned" count updates immediately instead of on next full reload.
      adjustLocalCollection(cardId, isFoil, -Math.max(1, quantity));

      // Dispatch change events
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(EVENTS.STORE_INVENTORY_CHANGE));
        window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      }

      setTimeout(() => {
        if (onSuccess) onSuccess(isAuction ? 'auction' : 'single');
        onClose();
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error publishing listing.');
    } finally {
      setSubmitting(false);
    }
  };

  const bodyContent = (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Scrollable Form Body */}
      <div className="overflow-y-auto pr-0.5 space-y-3.5 flex-1 p-4 sm:p-6">
          {/* Feedback Messages */}
          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-300 flex items-start gap-2">
              <svg className="w-4 h-4 shrink-0 text-red-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="flex-1">{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-[var(--positive)] flex items-center gap-2">
              <svg className="w-3.5 h-3.5 shrink-0 text-[var(--positive)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{successMsg}</span>
            </div>
          )}

          <form id="marketplace-list-form" onSubmit={handleSubmit} className="space-y-3.5">
            {/* 1. Card Selection */}
            <div>
              <CardSearchAutocomplete
                label="1. Select Card"
                activeGame={activeGame}
                selectedCard={selectedCard ? (cardData || (selectedCard as CatalogCard)) : null}
                onSelect={handleSelectCard}
                onClearSelected={() => setSelectedCard(null)}
                placeholder="Search name or card number…"
              />
            </div>

            {/* Listing Format Toggle: Fixed Price vs. Auction */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                Listing Format
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsAuction(false)}
                  className={`py-2 px-3 text-xs font-bold rounded-xl transition border cursor-pointer flex items-center justify-center gap-2 ${
                    !isAuction
                      ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-xs'
                      : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:bg-[var(--bg-raised)]'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <span>Fixed Price</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAuction(true)}
                  className={`py-2 px-3 text-xs font-bold rounded-xl transition border cursor-pointer flex items-center justify-center gap-2 ${
                    isAuction
                      ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-xs'
                      : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:bg-[var(--bg-raised)]'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M14 13l-4 4-5-5 4-4 5 5z" />
                    <path d="M16 8l3-3 2 2-3 3" />
                    <path d="M21 21l-3-3" />
                  </svg>
                  <span>Auction (Bidding)</span>
                </button>
              </div>
            </div>

            {/* 2. Condition & Foil (2 columns) */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Condition
                </label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl text-xs font-semibold border focus:outline-none focus:border-indigo-500 transition cursor-pointer"
                  style={{
                    background: 'var(--bg-input)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {CONDITIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Finish
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleFoilToggle(false)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition border cursor-pointer ${
                      !isFoil
                        ? 'bg-[var(--bg-raised)] border-[var(--border-hover)] text-[var(--text-primary)] shadow-sm'
                        : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:bg-[var(--bg-raised)]'
                    }`}
                  >
                    Regular
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFoilToggle(true)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition border cursor-pointer ${
                      isFoil
                        ? 'bg-[var(--accent-muted)] border-[var(--accent-border)] text-[var(--text-accent)] shadow-sm'
                        : 'bg-transparent border-[var(--border)] text-[var(--text-tertiary)] hover:bg-[var(--bg-raised)]'
                    }`}
                  >
                    <span className="inline-flex items-center justify-center gap-1">
                      <svg className="w-3 h-3 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      Foil
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Quantity & Price OR Auction Settings */}
            {isAuction ? (
              <div className="space-y-3.5">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Quantity in Lot
                  </label>
                  <div className="flex items-center gap-1.5 max-w-[160px]">
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] cursor-pointer border-[var(--border)]"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full text-center py-1 text-xs font-bold rounded-lg border focus:outline-none"
                      style={{
                        background: 'var(--bg-input)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(quantity + 1)}
                      className="w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] cursor-pointer border-[var(--border)]"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      +
                    </button>
                  </div>
                </div>

                <AuctionSettingsForm
                  basePriceHuf={auctionBasePrice}
                  onBasePriceHufChange={setAuctionBasePrice}
                  bidStepHuf={auctionBidStep}
                  onBidStepHufChange={setAuctionBidStep}
                  durationMinutes={auctionDuration}
                  onDurationMinutesChange={setAuctionDuration}
                  extensionMinutes={auctionExtension}
                  onExtensionMinutesChange={setAuctionExtension}
                />
              </div>
            ) : (
              <div className="space-y-3.5">
                {/* 3. Quantity & Selling Price (2 columns) */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Quantity
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                        className="w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] cursor-pointer border-[var(--border)]"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={quantity}
                        onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full text-center py-1 text-xs font-bold rounded-lg border focus:outline-none"
                        style={{
                          background: 'var(--bg-input)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-primary)',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setQuantity(quantity + 1)}
                        className="w-8 h-8 rounded-lg border flex items-center justify-center text-xs font-bold bg-[var(--bg-raised)] hover:brightness-110 text-[var(--text-secondary)] cursor-pointer border-[var(--border)]"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Unit Price ({currency})
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step={isEur ? "0.01" : "1"}
                        min={isEur ? "0.01" : "1"}
                        value={priceInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPriceInput(val);
                          setPriceTouched(true);
                          const parsed = parseFloat(val);
                          if (!isNaN(parsed) && parsed > 0) {
                            if (isEur) {
                              setPriceHuf(Math.max(1, Math.round(parsed * effectiveRate)));
                            } else {
                              setPriceHuf(Math.max(1, Math.round(parsed)));
                            }
                          }
                        }}
                        onBlur={() => {
                          const parsed = parseFloat(priceInput);
                          if (isNaN(parsed) || parsed <= 0) {
                            const fallback = 1;
                            setPriceHuf(fallback);
                            setPriceInput(isEur ? (fallback / effectiveRate).toFixed(2) : String(fallback));
                          } else if (isEur) {
                            setPriceInput(parsed.toFixed(2));
                          }
                        }}
                        className="w-full pl-3 pr-8 py-1.5 rounded-xl text-xs font-black border focus:outline-none focus:border-[var(--accent)] transition font-mono"
                        style={{
                          background: 'var(--bg-input)',
                          borderColor: 'var(--border)',
                          color: 'var(--positive)',
                        }}
                      />
                      <span className="absolute right-2.5 top-1.5 text-xs font-bold text-[var(--text-tertiary)] pointer-events-none">
                        {isEur ? '€' : 'Ft'}
                      </span>
                    </div>
                    <div className="text-[10px] mt-1 font-mono text-[var(--text-tertiary)]">
                      {isEur ? `≈ ${priceHuf.toLocaleString()} Ft` : `≈ ${formatCurrencyPrice(priceHuf, 'EUR', effectiveRate)}`}
                    </div>
                  </div>
                </div>

                {/* Price Helper & Dynamic Total */}
                <div className="space-y-2">
                  {suggestion.basis !== 'none' && suggestedHuf ? (
                    <div
                      className="rounded-xl border p-3.5 space-y-2.5"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Suggested price</div>
                          <div className="text-2xl font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
                            {formatPrice(suggestedHuf)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPriceTouched(false);
                            setPriceHuf(suggestedHuf);
                            setPriceInput(isEur ? (suggestedHuf / effectiveRate).toFixed(2) : String(suggestedHuf));
                          }}
                          disabled={priceHuf === suggestedHuf}
                          className="px-3.5 py-2 rounded-lg text-sm font-bold border transition cursor-pointer disabled:opacity-40 disabled:cursor-default"
                          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                        >
                          {priceHuf === suggestedHuf ? 'In use' : 'Use this price'}
                        </button>
                      </div>

                      {/* Where the suggestion comes from */}
                      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{suggestion.reason}</p>

                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm pt-2.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <div>
                          <dt className="text-xs text-[var(--text-muted)]">Market reference</dt>
                          <dd className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {suggestion.referenceHuf ? `~${formatPrice(roundHuf(suggestion.referenceHuf))}` : 'none'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-[var(--text-muted)]">Others selling here</dt>
                          <dd className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {suggestion.site
                              ? `${suggestion.site.count} from ${formatPrice(roundHuf(suggestion.site.lowest))}`
                              : 'nobody yet'}
                          </dd>
                        </div>
                      </dl>
                      {suggestion.referenceHuf && (
                        <p className="text-xs text-[var(--text-muted)]">The market reference is Cardmarket's price for this card, updated daily.</p>
                      )}
                    </div>
                  ) : null}

                  {quantity > 1 && (
                    <div className="text-sm font-semibold text-[var(--positive)] text-right">
                      {`Total: ${formatPrice(quantity * priceHuf)}`}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Short note buyers see next to the listing, such as a scuff or that it is from a sealed pack */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="listing-description" className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Description <span className="normal-case font-medium text-[var(--text-muted)]">(optional)</span>
                </label>
                <span className="text-[10px] text-[var(--text-muted)]">{description.length}/{MAX_LISTING_DESCRIPTION}</span>
              </div>
              <input
                id="listing-description"
                type="text"
                value={description}
                maxLength={MAX_LISTING_DESCRIPTION}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Pulled from a pack, tiny edge whitening"
                className="w-full px-3 py-1.5 rounded-xl text-xs border focus:outline-none focus:border-[var(--accent)] transition"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>

            {/* 4. Physical Condition Photos Uploader */}
            <div className="p-3 rounded-xl border border-dashed" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <ListingPhotoUploader
                photos={photos}
                onPhotosChange={setPhotos}
                maxPhotos={5}
                label="Condition Photos"
                subtitle="(optional, reassures buyers)"
              />
            </div>

            {/* 5. Supported Handover Methods Selector */}
            <div className="p-3 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
              <ListingHandoverSelector
                allowedHandovers={allowedHandovers}
                onChange={setAllowedHandovers}
                availableMethods={availableHandovers}
                sellerId={profile?.id}
              />
            </div>
          </form>
        </div>

        {/* Footer Buttons */}
        <div className="pt-3 border-t shrink-0 flex items-center gap-2.5 px-4 sm:px-6 pb-4 sm:pb-6" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <button
            type="button"
            onClick={onClose}
            className="w-1/3 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 border-rose-500/30"
          >
            Cancel
          </button>

          <button
            type="submit"
            form="marketplace-list-form"
            disabled={submitting || !selectedCard}
            className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition shadow-lg flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-contrast, #000)',
              boxShadow: '0 4px 14px var(--accent-muted, rgba(0,0,0,0.2))',
            }}
          >
            {submitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
                <span>{isAuction ? 'Creating Auction…' : 'Publishing…'}</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{isAuction ? 'Start Auction' : 'Publish Listing'}</span>
              </>
            )}
          </button>
        </div>
      </div>
  );

  if (embedded) {
    return bodyContent;
  }

  return (
    <div data-state={modalState} className="tv-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div
        data-state={modalState}
        className="tv-modal-panel relative w-full max-w-[540px] rounded-2xl border shadow-2xl my-auto max-h-[92vh] flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 pb-3 border-b shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-[var(--positive)] shrink-0">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <circle cx="7" cy="7" r="1" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black truncate" style={{ color: 'var(--text-primary)' }}>
                List Card on Marketplace
              </h2>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                Sell your card at your own price
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            type="button"
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:brightness-110 transition cursor-pointer text-xs shrink-0" style={{ background: 'var(--bg-raised)', color: 'var(--text-tertiary)' }}
            aria-label="Close"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {bodyContent}
      </div>
    </div>
  );
}
