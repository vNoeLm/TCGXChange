import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase, getCardImageUrl } from '../../lib/supabase';
import { getCurrentUser } from '../../lib/auth';
import { STORAGE_KEYS } from '../../lib/constants';
import { useExitTransition } from '../../lib/useExitTransition';
import { compressImages } from '../../lib/imageCompression';
import { getSellerHandoverMethods, type DynamicHandoverMethod } from '../../lib/shipping';
import { fetchShippingSettings } from '../../lib/shippingClient';
import type { CatalogCard } from '../../types';

interface CreateAuctionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  embedded?: boolean;
}

const CONDITIONS = [
  'Mint',
  'Near Mint',
  'Lightly Played',
  'Moderately Played',
  'Heavily Played',
  'Damaged',
];

const DURATION_PRESETS = [
  { label: '1 Hour', mins: 60 },
  { label: '6 Hours', mins: 360 },
  { label: '12 Hours', mins: 720 },
  { label: '24 Hours', mins: 1440 },
  { label: '3 Days', mins: 4320 },
  { label: '7 Days', mins: 10080 },
];

export function CreateAuctionModal({ isOpen, onClose, onSuccess, embedded = false }: CreateAuctionModalProps) {
  const [activeGame, setActiveGame] = useState('riftbound');
  const [selectedCard, setSelectedCard] = useState<CatalogCard | null>(null);
  const [cardSearch, setCardSearch] = useState('');
  const [cardResults, setCardResults] = useState<CatalogCard[]>([]);
  const [searchingCard, setSearchingCard] = useState(false);

  const [customTitle, setCustomTitle] = useState('');
  const [condition, setCondition] = useState('Near Mint');
  const [isFoil, setIsFoil] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [photos, setPhotos] = useState<string[]>([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // Auction Pricing & Minute Rules
  const [basePriceHuf, setBasePriceHuf] = useState('500');
  const [bidStepHuf, setBidStepHuf] = useState('50');
  const [extensionMinutes, setExtensionMinutes] = useState('5');
  const [durationMinutes, setDurationMinutes] = useState(1440);

  const [allowedHandovers, setAllowedHandovers] = useState<string[]>(['personal', 'foxpost', 'packeta', 'other']);
  const [availableHandovers, setAvailableHandovers] = useState<DynamicHandoverMethod[]>([]);
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { rendered, state } = useExitTransition(isOpen, 220);

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
    }
  }, [isOpen]);

  useEffect(() => {
    const clean = cardSearch.trim().replace(/[,()%]/g, '');
    if (!isOpen || selectedCard || clean.length < 2) {
      setCardResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingCard(true);
      try {
        const { data } = await supabase
          .from('cards')
          .select('id, card_number, name, rarity, card_type, cost, image_path, game, sets(id, name, code)')
          .eq('game', activeGame)
          .or(`name.ilike.%${clean}%,card_number.ilike.%${clean}%`)
          .limit(8);
        setCardResults((data as any[]) || []);
      } catch {
        setCardResults([]);
      } finally {
        setSearchingCard(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [cardSearch, activeGame, isOpen, selectedCard]);

  if (!rendered) return null;

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsUploadingPhoto(true);
    setErrorMsg(null);

    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error('Please sign in to upload photos.');

      const compressed = await compressImages(files);
      const uploadedUrls: string[] = [];

      for (const file of compressed) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/marketplace/upload-image', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Failed to upload image.');
        }
        uploadedUrls.push(json.url);
      }

      setPhotos((prev) => [...prev, ...uploadedUrls].slice(0, 5));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error uploading photo.');
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleHandover = (id: string) => {
    setAllowedHandovers((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selectedCard && !customTitle.trim()) {
      setErrorMsg('Please select a card or enter an auction title.');
      return;
    }

    const basePrice = parseInt(basePriceHuf, 10);
    const bidStep = parseInt(bidStepHuf, 10);
    const extMins = parseInt(extensionMinutes, 10);

    if (!basePrice || basePrice <= 0) {
      setErrorMsg('Base starting price must be greater than 0.');
      return;
    }
    if (!bidStep || bidStep <= 0) {
      setErrorMsg('Bid step must be greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error('Please sign in first.');

      const res = await fetch('/api/marketplace/auctions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'create',
          card_id: selectedCard?.id || null,
          title: customTitle.trim() || selectedCard?.name || 'Card Auction',
          game: selectedCard?.game || activeGame,
          condition,
          is_foil: isFoil,
          quantity,
          images: photos,
          base_price_huf: basePrice,
          bid_step_huf: bidStep,
          extension_minutes: isNaN(extMins) ? 5 : Math.max(0, extMins),
          duration_minutes: durationMinutes,
          handover_methods: allowedHandovers,
          description: description.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to create auction.');
      }

      setSelectedCard(null);
      setCustomTitle('');
      setPhotos([]);
      setDescription('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error creating auction.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!embedded && !rendered) return null;
  const modalState = embedded ? 'open' : state;

  const formElement = (
    <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-bold">
              {errorMsg}
            </div>
          )}

          {/* 1. Select Catalog Card or Custom Title */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
              1. Card / Item Being Auctioned
            </label>
            {selectedCard ? (
              <div className="flex items-center justify-between p-3 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-3">
                  {selectedCard.image_path && (
                    <img
                      src={getCardImageUrl(selectedCard.image_path)}
                      alt={selectedCard.name}
                      className="w-12 h-16 object-contain rounded-md bg-black/30"
                    />
                  )}
                  <div>
                    <div className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>{selectedCard.name}</div>
                    <div className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                      #{selectedCard.card_number} · {selectedCard.rarity}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCard(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search catalog card by name or number..."
                    value={cardSearch}
                    onChange={(e) => setCardSearch(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs font-bold border outline-none"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                  {searchingCard && (
                    <span className="absolute right-3 top-2.5 text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>
                      Searching...
                    </span>
                  )}
                  {cardResults.length > 0 && (
                    <div
                      className="absolute left-0 right-0 top-full mt-1 rounded-xl border shadow-2xl z-30 max-h-56 overflow-y-auto"
                      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
                    >
                      {cardResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedCard(c);
                            setCardSearch('');
                            setCardResults([]);
                          }}
                          className="w-full px-3.5 py-2 flex items-center gap-3 text-left hover:bg-white/5 transition cursor-pointer border-b last:border-b-0"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          {c.image_path && (
                            <img src={getCardImageUrl(c.image_path)} alt={c.name} className="w-8 h-11 object-contain rounded bg-black/30 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
                            <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                              #{c.card_number} · {c.rarity}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Or enter custom auction title (optional if card selected)..."
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl text-xs font-bold border outline-none"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
            )}
          </div>

          {/* 2. Base Price, Step, and Minute Rule */}
          <div className="p-4 rounded-xl border space-y-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
            <div className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              2. Auction Pricing & Minute Extension Rules
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Base Price (Ft) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={basePriceHuf}
                  onChange={(e) => setBasePriceHuf(e.target.value)}
                  placeholder="500"
                  className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Bid Step (Ft) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={bidStepHuf}
                  onChange={(e) => setBidStepHuf(e.target.value)}
                  placeholder="50"
                  className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Minute Rule (+Mins / Bid)
                </label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={extensionMinutes}
                  onChange={(e) => setExtensionMinutes(e.target.value)}
                  placeholder="5"
                  className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Every bid placed must increase by at least <strong>{bidStepHuf || 50} Ft</strong> and automatically extends the auction end time by <strong>+{extensionMinutes || 0} minutes</strong>.
            </p>
          </div>

          {/* 3. Duration */}
          <div>
            <label className="block text-xs font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
              Initial Auction Duration
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.mins}
                  type="button"
                  onClick={() => setDurationMinutes(p.mins)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition ${
                    durationMinutes === p.mins
                      ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                      : 'border-[var(--border)] text-[var(--text-secondary)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Condition, Foil & Custom Photos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                Condition
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                Quantity
              </label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex items-center pt-5">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isFoil}
                  onChange={(e) => setIsFoil(e.target.checked)}
                  className="w-4 h-4 rounded accent-amber-500"
                />
                <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  Foil / Holo Finish
                </span>
              </label>
            </div>
          </div>

          {/* Custom Photos */}
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Photos (optional if catalog card selected)
            </label>
            <div className="flex flex-wrap gap-2.5">
              {photos.map((url, idx) => (
                <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/80 text-white text-xs flex items-center justify-center cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingPhoto}
                  className="w-20 h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                >
                  <span className="text-[10px] font-bold">{isUploadingPhoto ? '...' : '+ Photo'}</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
            </div>
          </div>

          {/* Handover Options */}
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Handover & Shipping Methods
            </label>
            <div className="flex flex-wrap gap-2">
              {(availableHandovers.length > 0
                ? availableHandovers
                : [
                    { id: 'personal', label: 'In Person', kind: 'personal', enabled: true, costHuf: 0 },
                    { id: 'foxpost', label: 'FoxPost', kind: 'domestic', enabled: true, costHuf: null },
                    { id: 'packeta', label: 'Packeta', kind: 'domestic', enabled: true, costHuf: null },
                    { id: 'other', label: 'Other', kind: 'custom', enabled: true, costHuf: null },
                  ]
              ).map((m) => {
                const active = allowedHandovers.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleHandover(m.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition ${
                      active
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400'
                        : 'border-[var(--border)] text-[var(--text-tertiary)] opacity-60'
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cancellation Penalty Policy Notice */}
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5">
            <svg className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-[11px] leading-relaxed text-amber-200/90 font-medium">
              <strong>Auction Honor Rule:</strong> When the auction ends, the winning bidder automatically receives a message and hold request. You can still cancel if you feel the final price is too low, <strong>but cancelling an auction with a winning bidder will automatically record a 1-star system review on your profile</strong> stating you did not honor the auction price.
            </p>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold border cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !isSignedIn}
              className="px-6 py-2.5 rounded-xl text-xs font-black bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer transition disabled:opacity-50"
            >
              {submitting ? 'Starting Auction...' : 'Start Auction'}
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
      className="tv-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div
        data-state={modalState}
        className="tv-modal relative w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
                Create Card Auction
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Set base price, bid steps, and automatic minute extension rules
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center border cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
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
