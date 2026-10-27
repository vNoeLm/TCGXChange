import { useEffect, useRef, useState } from 'react';
import { useExitTransition } from '../../lib/useExitTransition';
import { supabase, getCardImageUrl } from '../../lib/supabase';
import { HANDOVER_METHODS, listingHandoverIds, type HandoverMethodId } from '../../lib/handover';
import { LISTING_CONDITIONS } from '../../lib/collectionDefaults';
import { getListingDescription, MAX_LISTING_DESCRIPTION } from '../../lib/sellerNotes';
import { useCurrency, formatCurrencyPrice } from '../../lib/currency';
import { getSellerHandoverMethods, type DynamicHandoverMethod } from '../../lib/shipping';
import { fetchShippingSettings } from '../../lib/shippingClient';
import { ListingPhotoUploader } from '../marketplace/ListingPhotoUploader';
import { useLanguage } from '../../lib/i18n';

const labelCls = 'block text-[11px] font-bold uppercase tracking-wider mb-1';
const inputCls = 'w-full px-3 py-2 rounded-xl text-xs font-semibold outline-none border focus:border-[var(--accent)]';
const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

/**
 * Everything about a listing a seller can change after putting it up: price, stock, condition,
 * description, delivery methods and photos. (The card and its finish stay - that's a different
 * listing.) `collectionNote` explains when the stock is tied to an always-list collection.
 */
export function EditListingModal({
  listing,
  collectionNote,
  onClose,
  onSaved,
}: {
  listing: any | null;
  collectionNote?: string | null;
  onClose: () => void;
  /** The server's answer to the save (listing, collection changes). */
  onSaved: (json: any) => void;
}) {
  const { t } = useLanguage();
  const anim = useExitTransition(Boolean(listing), 250);
  const last = useRef<any>(null);
  if (listing) last.current = listing;
  const item = last.current;

  const { currency, eurHufRate, isEur } = useCurrency();
  const effectiveRate = eurHufRate > 0 ? eurHufRate : 400;

  const [price, setPrice] = useState(0);
  const [priceInput, setPriceInput] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState('Near Mint');
  const [description, setDescription] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [availableMethods, setAvailableMethods] = useState<DynamicHandoverMethod[]>([]);

  useEffect(() => {
    if (!listing) return;
    const p = Number(listing.price_huf) || 0;
    setPrice(p);
    setPriceInput(isEur ? (p / effectiveRate).toFixed(2) : String(p));
    setQuantity(Number(listing.quantity) || 1);
    setCondition(listing.condition || 'Near Mint');
    setDescription(getListingDescription(listing.notes) || '');
    setMethods(listingHandoverIds(listing.handover_methods));
    setPhotos((listing.inventory_images || []).map((i: any) => i.image_path).filter(Boolean));
    setError('');

    const sellerId = listing.seller_id;
    if (sellerId) {
      fetchShippingSettings([sellerId]).then((map) => {
        const settings = map[sellerId];
        setAvailableMethods(getSellerHandoverMethods(settings));
      });
    }
  }, [listing]);

  useEffect(() => {
    if (price > 0) {
      setPriceInput(isEur ? (price / effectiveRate).toFixed(2) : String(price));
    }
  }, [currency, effectiveRate]);

  useEffect(() => {
    if (!listing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listing, saving, onClose]);

  if (!anim.rendered || !item) return null;

  const token = async () => {
    const sessionToken = (await supabase.auth.getSession()).data.session?.access_token;
    if (!sessionToken) throw new Error(t('Please sign in again.', 'Kérjük, jelentkezz be újra.'));
    return sessionToken;
  };

  const save = async () => {
    if (methods.length === 0) {
      setError(t('Offer at least one delivery method.', 'Válassz legalább egy átvételi / szállítási módot.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/marketplace/listings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          id: item.inventory_id,
          price_huf: Math.max(1, Math.round(price)),
          quantity: Math.max(1, Math.round(quantity)),
          condition,
          description,
          handover_methods: methods,
          images: photos,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || t('Could not save the listing.', 'Nem sikerült menteni a hirdetést.'));
      onSaved(json);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const cardImage = item.card_image_path || item.image_path;

  return (
    <div
      data-state={anim.state}
      className="tv-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Edit listing', 'Hirdetés szerkesztése')}
        data-state={anim.state}
        className="tv-modal-panel w-full max-w-lg rounded-2xl p-5 border shadow-2xl my-8"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3 mb-4">
          {cardImage && <img src={getCardImageUrl(cardImage)} alt="" className="w-10 h-14 rounded-md object-cover border shrink-0" style={{ borderColor: 'var(--border)' }} />}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black truncate" style={{ color: 'var(--text-primary)' }}>
              {t('Edit listing:', 'Hirdetés szerkesztése:')} {item.name}
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{item.card_number}{item.is_foil ? ' · Foil' : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close', 'Bezárás')} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {collectionNote && (
          <p className="text-[11px] mb-3 p-2.5 rounded-lg border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            {collectionNote}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label>
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Price', 'Ár')} ({currency === 'EUR' ? 'EUR €' : 'HUF Ft'})</span>
            <input
              type="number"
              step={isEur ? "0.01" : "1"}
              min={isEur ? "0.01" : "1"}
              value={priceInput}
              onChange={(e) => {
                const val = e.target.value;
                setPriceInput(val);
                const parsed = parseFloat(val);
                if (!isNaN(parsed) && parsed > 0) {
                  setPrice(isEur ? Math.max(1, Math.round(parsed * effectiveRate)) : Math.max(1, Math.round(parsed)));
                }
              }}
              onBlur={() => {
                const parsed = parseFloat(priceInput);
                if (isNaN(parsed) || parsed <= 0) {
                  setPrice(1);
                  setPriceInput(isEur ? (1 / effectiveRate).toFixed(2) : '1');
                } else if (isEur) {
                  setPriceInput(parsed.toFixed(2));
                }
              }}
              className={`${inputCls} font-mono`}
              style={inputStyle}
            />
            <div className="text-[10px] mt-1 font-mono text-[var(--text-tertiary)]">
              {isEur ? `≈ ${price.toLocaleString()} Ft` : `≈ ${formatCurrencyPrice(price, 'EUR', effectiveRate)}`}
            </div>
          </label>
          <label>
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('In stock', 'Készleten')}</span>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label={t('One fewer', 'Eggyel kevesebb')} onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded-lg border text-sm font-bold cursor-pointer shrink-0" style={inputStyle}>-</button>
              <input type="number" min={1} value={quantity} aria-label={t('Quantity in stock', 'Készletmennyiség')} onChange={(e) => setQuantity(Math.max(1, Math.round(Number(e.target.value) || 1)))} className={`${inputCls} font-mono text-center`} style={inputStyle} />
              <button type="button" aria-label={t('One more', 'Eggyel több')} onClick={() => setQuantity((q) => q + 1)} className="w-9 h-9 rounded-lg border text-sm font-bold cursor-pointer shrink-0" style={inputStyle}>+</button>
            </div>
          </label>
          <label>
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Condition', 'Állapot')}</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)} className={inputCls} style={inputStyle}>
              {LISTING_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Description', 'Leírás')}</span>
            <input value={description} maxLength={MAX_LISTING_DESCRIPTION} onChange={(e) => setDescription(e.target.value)} placeholder={t('Shown to buyers', 'Látható a vásárlóknak')} className={inputCls} style={inputStyle} />
          </label>
        </div>

        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className={labelCls} style={{ color: 'var(--text-tertiary)' }}>{t('Delivery methods', 'Átvételi / szállítási módok')}</span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t('From your Seller Hub shipping', 'Az eladói szállítási beállításaidból')}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(availableMethods.length > 0 ? availableMethods : HANDOVER_METHODS).map((m) => {
              const on = methods.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMethods((ms) => (on ? ms.filter((x) => x !== m.id) : [...ms, m.id]))}
                  className="h-8 px-2.5 rounded-lg border text-[11px] font-bold cursor-pointer flex items-center gap-1.5"
                  style={on
                    ? { background: 'var(--accent-muted)', borderColor: 'var(--accent-border)', color: 'var(--text-accent)' }
                    : { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <span>{m.label}</span>
                  {('price_huf' in m && (m as any).price_huf > 0) && (
                    <span className="text-[10px] font-normal opacity-75">
                      ({formatCurrencyPrice((m as any).price_huf, currency, effectiveRate)})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-4">
          <ListingPhotoUploader
            photos={photos}
            onPhotosChange={setPhotos}
            maxPhotos={8}
            label={t('Photos', 'Fényképek')}
          />
        </div>

        {error && <p className="text-xs font-semibold mb-3" style={{ color: 'var(--negative)' }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 h-9 rounded-xl text-xs font-semibold cursor-pointer border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            {t('Cancel', 'Mégse')}
          </button>
          <button type="button" onClick={save} disabled={saving} className="px-5 h-9 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
            {saving ? t('Saving…', 'Mentés…') : t('Save changes', 'Módosítások mentése')}
          </button>
        </div>
      </div>
    </div>
  );
}
