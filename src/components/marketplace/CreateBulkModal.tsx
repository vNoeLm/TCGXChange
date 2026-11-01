import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { getCurrentUser } from '../../lib/auth';
import { STORAGE_KEYS, GAMES } from '../../lib/constants';
import { useExitTransition } from '../../lib/useExitTransition';
import { useLanguage } from '../../lib/i18n';
import { formatCondition } from '../../lib/collectionDefaults';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { getSellerHandoverMethods, type DynamicHandoverMethod } from '../../lib/shipping';
import { fetchShippingSettings } from '../../lib/shippingClient';
import { ListingPhotoUploader } from './ListingPhotoUploader';
import { ListingHandoverSelector } from './ListingHandoverSelector';
import { AuctionSettingsForm } from './AuctionSettingsForm';

interface CreateBulkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (type?: 'bulk' | 'auction') => void;
  embedded?: boolean;
  initialIsAuction?: boolean;
}

const BULK_CONDITIONS = [
  'Mixed',
  'Near Mint',
  'Lightly Played',
  'Moderately Played',
  'Heavily Played',
];



export function CreateBulkModal({
  isOpen,
  onClose,
  onSuccess,
  embedded = false,
  initialIsAuction = false,
}: CreateBulkModalProps) {
  const { t, lang } = useLanguage();
  const [title, setTitle] = useState('');
  const [game, setGame] = useState('riftbound');
  const [exactCount, setExactCount] = useState('');
  const [approxCount, setApproxCount] = useState('');
  const [condition, setCondition] = useState('Mixed');
  const [includesFoil, setIncludesFoil] = useState(false);
  const [priceHuf, setPriceHuf] = useState('5000');

  // Auction State
  const [isAuction, setIsAuction] = useState<boolean>(initialIsAuction);
  const [auctionBasePrice, setAuctionBasePrice] = useState('2000');
  const [auctionBidStep, setAuctionBidStep] = useState('200');
  const [auctionDuration, setAuctionDuration] = useState(1440);
  const [auctionExtension, setAuctionExtension] = useState('5');
  const [auctionSnipeTrigger, setAuctionSnipeTrigger] = useState('10');

  const [photos, setPhotos] = useState<string[]>([]);
  const [allowedHandovers, setAllowedHandovers] = useState<string[]>(['personal', 'foxpost', 'packeta', 'other']);
  const [availableHandovers, setAvailableHandovers] = useState<DynamicHandoverMethod[]>([]);
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(true);

  const { rendered, state } = useExitTransition(isOpen, 220);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_GAME) || 'riftbound';
      setGame(saved);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setIsAuction(Boolean(initialIsAuction));
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
  }, [isOpen, initialIsAuction]);

  useBodyScrollLock(isOpen);

  if (!rendered) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const exactVal = exactCount.trim() ? parseInt(exactCount.trim(), 10) : null;
    const approxVal = approxCount.trim() ? parseInt(approxCount.trim(), 10) : null;

    if ((!exactVal || exactVal <= 0) && (!approxVal || approxVal <= 0)) {
      setErrorMsg('Please enter either an Exact Card Count or an Approximate Card Count (at least one is required).');
      return;
    }

    if (photos.length === 0) {
      setErrorMsg('Please upload at least one photo of the bulk card lot.');
      return;
    }

    if (isAuction) {
      const baseHuf = Math.round(Number(auctionBasePrice));
      const stepHuf = Math.round(Number(auctionBidStep));
      const extMins = Math.round(Number(auctionExtension));

      if (isNaN(baseHuf) || baseHuf <= 0) {
        setErrorMsg('Please enter a valid starting base price.');
        return;
      }
      if (isNaN(stepHuf) || stepHuf <= 0) {
        setErrorMsg('Please enter a valid bid increment step.');
        return;
      }

      setSubmitting(true);
      try {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session) throw new Error('Please sign in first.');

        const lotLabel = exactVal ? `${exactVal} cards (exact)` : `~${approxVal} cards (approx)`;
        const autoTitle = title.trim() || `${exactVal || approxVal} Cards Bulk Lot (${game.toUpperCase()})`;
        const fullDesc = description.trim() 
          ? `${description.trim()}\n\nLot Card Count: ${lotLabel}`
          : `Lot Card Count: ${lotLabel}`;

        const res = await fetch('/api/marketplace/auctions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            title: autoTitle,
            game,
            condition,
            is_foil: includesFoil,
            quantity: 1,
            exact_card_count: exactVal ? Number(exactVal) : null,
            approx_card_count: approxVal ? Number(approxVal) : null,
            is_bulk: true,
            images: photos,
            base_price_huf: baseHuf,
            bid_step_huf: stepHuf,
            duration_minutes: auctionDuration,
            extension_minutes: isNaN(extMins) ? 5 : extMins,
            anti_snipe_trigger_minutes: isNaN(parseInt(auctionSnipeTrigger, 10)) ? 10 : Math.max(0, parseInt(auctionSnipeTrigger, 10)),
            handover_methods: allowedHandovers,
            description: fullDesc,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Failed to start bulk auction.');
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
        }

        setTitle('');
        setExactCount('');
        setApproxCount('');
        setPhotos([]);
        setDescription('');
        onSuccess('auction');
        onClose();
      } catch (err: any) {
        setErrorMsg(err?.message || 'Error creating bulk auction.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Fixed price bulk lot
    const parsedPrice = parseInt(priceHuf, 10);
    if (!parsedPrice || parsedPrice <= 0) {
      setErrorMsg('Please enter a valid price in HUF.');
      return;
    }

    setSubmitting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error('Please sign in first.');

      const res = await fetch('/api/marketplace/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          game,
          exact_card_count: exactVal,
          approx_card_count: approxVal,
          condition,
          includes_foil: includesFoil,
          price_huf: parsedPrice,
          handover_methods: allowedHandovers,
          description: description.trim(),
          images: photos,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to create bulk listing.');
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));
      }

      setTitle('');
      setExactCount('');
      setApproxCount('');
      setPhotos([]);
      setDescription('');
      onSuccess('bulk');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error creating bulk listing.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!embedded && !rendered) return null;
  const modalState = embedded ? 'open' : state;

  const formElement = (
    <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 flex-1">
          {!isSignedIn && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold">
              Please sign in to list bulk cards on the marketplace.
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-bold">
              {errorMsg}
            </div>
          )}

          {/* 1. Photo Upload (Required) */}
          <div className="p-3.5 rounded-xl border border-dashed" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
            <ListingPhotoUploader
              photos={photos}
              onPhotosChange={setPhotos}
              maxPhotos={6}
              label={t('1. Bulk Lot Photos', '1. Bulk csomag fotók')}
              required={true}
              subtitle={t('(show stacks, boxes, or representative cards)', '(mutass kupacokat, dobozokat vagy reprezentatív lapokat)')}
            />
          </div>

          {/* 2. Card Count (Exact or Approximate — at least one required) */}
          <div className="p-4 rounded-xl border space-y-3" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                {t('2. Card Count', '2. Kártyák darabszáma')} <span className="text-rose-400">*</span>
              </span>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                {t('Provide exact OR approximate count (at least one required)', 'Add meg a pontos VAGY becsült darabszámot (legalább egy kitöltendő)')}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t('Exact Card Count', 'Pontos darabszám')}
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 250"
                  value={exactCount}
                  onChange={(e) => setExactCount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t('Approximate Card Count (~)', 'Becsült darabszám (~)')}
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 300"
                  value={approxCount}
                  onChange={(e) => setApproxCount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs font-bold border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>
          </div>

          {/* 3. Listing Format Toggle: Fixed Price vs. Auction */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
              {t('3. Listing Format', '3. Hirdetés formátuma')}
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
                <span>{t('Fixed Price Bulk', 'Fix áras Bulk')}</span>
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
                <span>{t('Auction (Bidding)', 'Aukció (licitálás)')}</span>
              </button>
            </div>
          </div>

          {/* Auction Settings Form (when isAuction) */}
          {isAuction && (
            <AuctionSettingsForm
              basePriceHuf={auctionBasePrice}
              onBasePriceHufChange={setAuctionBasePrice}
              bidStepHuf={auctionBidStep}
              onBidStepHufChange={setAuctionBidStep}
              durationMinutes={auctionDuration}
              onDurationMinutesChange={setAuctionDuration}
              extensionMinutes={auctionExtension}
              onExtensionMinutesChange={setAuctionExtension}
              antiSnipeTriggerMinutes={auctionSnipeTrigger}
              onAntiSnipeTriggerMinutesChange={setAuctionSnipeTrigger}
            />
          )}

          {/* 4. Title, Game, Condition & (if fixed) Price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Lot Title (optional)', 'Csomag címe (opcionális)')}
              </label>
              <input
                type="text"
                placeholder="e.g. Riftbound Mixed Bulk Lot + Commons/Uncommons"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-xs font-bold border outline-none focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Game', 'Játék')}
              </label>
              <select
                value={game}
                onChange={(e) => setGame(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border outline-none cursor-pointer focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {GAMES.map((g) => (
                  <option key={g.id} value={g.id} disabled={g.active === false}>{g.name}{g.active === false ? ' (Soon)' : ''}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Overall Condition', 'Általános állapot')}
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-xs font-bold border outline-none cursor-pointer focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {BULK_CONDITIONS.map((c) => (
                  <option key={c} value={c}>{formatCondition(c, lang)}</option>
                ))}
              </select>
            </div>

            {!isAuction && (
              <div>
                <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t('Total Price (HUF)', 'Csomag ára összesen (Ft)')} <span className="text-rose-400">*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={priceHuf}
                  onChange={(e) => setPriceHuf(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-xs font-bold border outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
            )}

            <div className="flex items-center pt-2">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includesFoil}
                  onChange={(e) => setIncludesFoil(e.target.checked)}
                  className="w-4 h-4 rounded accent-[var(--accent)] cursor-pointer"
                />
                <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  {t('Includes Foil / Holo Cards', 'Tartalmaz fóliás lapokat')}
                </span>
              </label>
            </div>
          </div>

          {/* 5. Shipping / Handover Options */}
          <div className="p-3.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
            <ListingHandoverSelector
              allowedHandovers={allowedHandovers}
              onChange={setAllowedHandovers}
              availableMethods={availableHandovers}
            />
          </div>

          {/* 6. Description */}
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Description / Breakdown (optional)', 'Leírás / Részletek (opcionális)')}
            </label>
            <textarea
              rows={3}
              placeholder={t('Describe sets included, rarity breakdown, or any extra details...', 'Add meg a csomagban lévő kiadásokat, ritkaságok megoszlását vagy egyéb részleteket...')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl text-xs font-medium border outline-none resize-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold border cursor-pointer hover:bg-[var(--bg-raised)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              {t('Cancel', 'Mégse')}
            </button>
            <button
              type="submit"
              disabled={submitting || !isSignedIn}
              className="px-6 py-2.5 rounded-xl text-xs font-black cursor-pointer transition disabled:opacity-50"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-contrast, #000)',
                boxShadow: '0 4px 14px var(--accent-muted, rgba(0,0,0,0.2))',
              }}
            >
              {submitting
                ? (isAuction ? t('Starting Auction…', 'Aukció indítása folyamatban…') : t('Creating Bulk Lot…', 'Bulk hirdetés létrehozása…'))
                : (isAuction ? t('Start Auction', 'Aukció indítása') : t('Publish Bulk Listing', 'Bulk hirdetés közzététele'))}
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
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center border shadow-xs"
              style={{
                background: 'var(--accent-muted)',
                borderColor: 'var(--accent-border)',
                color: 'var(--text-accent)',
              }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
                List Bulk Card Lot
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Upload photos and provide exact or approximate card count
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center border cursor-pointer hover:bg-white/5 transition"
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
