import { useEffect, useState } from 'react';
import { CARD_CONDITIONS, formatCondition } from '../../lib/collectionDefaults';
import { useLanguage } from '../../lib/i18n';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { deleteListing, updateListing, type P2PListing } from '../../lib/p2pClient';
import { cardThumbProps } from '../../lib/supabase';
import { PhotoUploader } from './PhotoUploader';

interface EditListingModalProps {
  listing: P2PListing;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function EditListingModal({ listing, onClose, onSaved, onDeleted }: EditListingModalProps) {
  const { lang, t } = useLanguage();
  useBodyScrollLock(true);

  const [priceHuf, setPriceHuf] = useState(String(listing.price_huf));
  const [quantity, setQuantity] = useState(listing.quantity);
  const [condition, setCondition] = useState(listing.condition);
  const [isFoil, setIsFoil] = useState(listing.is_foil);
  const [status, setStatus] = useState<'In Stock' | 'Paused'>(
    listing.status === 'Paused' ? 'Paused' : 'In Stock'
  );
  const [description, setDescription] = useState(listing.description || '');
  const [images, setImages] = useState<string[]>(listing.images || []);

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedPrice = Math.round(Number(priceHuf));
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1) {
      setError(t('Enter a valid price in HUF.', 'Adj meg érvényes árat forintban.'));
      return;
    }

    setSaving(true);
    try {
      await updateListing({
        id: listing.id,
        price_huf: parsedPrice,
        quantity: Math.max(0, quantity),
        condition,
        is_foil: isFoil,
        status,
        description: description.trim(),
        images,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message || t('Failed to update listing.', 'Sikertelen mentés.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteListing(listing.id);
      onDeleted();
    } catch (err: any) {
      setError(err?.message || t('Failed to delete listing.', 'Sikertelen törlés.'));
      setDeleting(false);
    }
  };

  const thumb = listing.card.image_path ? cardThumbProps(listing.card.image_path, 'avatar').src : null;

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-xl max-h-[92vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-3.5 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
            {t('Edit Listing', 'Hirdetés módosítása')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close', 'Bezárás')}
            className="w-8 h-8 rounded-xl border flex items-center justify-center hover:bg-[var(--bg-raised)] cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div
            className="p-2.5 rounded-xl border flex items-center gap-3"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
          >
            {thumb && (
              <img src={thumb} alt={listing.card.name} className="w-9 h-12 rounded object-cover shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>
                {listing.card.name}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {listing.card.card_number} {listing.card.sets?.name ? `· ${listing.card.sets.name}` : ''}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Price (HUF)', 'Ár (Ft)')}
              </label>
              <input
                type="number"
                min={1}
                max={50000000}
                required
                value={priceHuf}
                onChange={(e) => setPriceHuf(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border text-xs font-bold outline-none focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Quantity', 'Mennyiség')}
              </label>
              <input
                type="number"
                min={0}
                max={500}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(0, Number(e.target.value) || 0))}
                className="w-full px-3 py-2 rounded-xl border text-xs font-bold outline-none focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Condition', 'Állapot')}
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl border text-xs font-semibold outline-none"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                {CARD_CONDITIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatCondition(c.id, lang)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Status', 'Állapot')}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value === 'Paused' ? 'Paused' : 'In Stock')}
                className="w-full px-2.5 py-2 rounded-xl border text-xs font-semibold outline-none"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <option value="In Stock">{t('In Stock', 'Aktív')}</option>
                <option value="Paused">{t('Paused', 'Szüneteltetve')}</option>
              </select>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer self-start">
            <input
              type="checkbox"
              checked={isFoil}
              onChange={(e) => setIsFoil(e.target.checked)}
              className="rounded accent-[var(--accent)]"
            />
            <span style={{ color: 'var(--text-primary)' }}>{t('Foil / Holo', 'Foil / Holo')}</span>
          </label>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Notes', 'Megjegyzés')}
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-xs outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <PhotoUploader images={images} onChange={setImages} />

          {error && (
            <div className="px-3 py-2 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-300">
              {error}
            </div>
          )}

          <div
            className="pt-3 border-t flex flex-wrap items-center justify-between gap-2 shrink-0"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <button
              type="button"
              disabled={deleting || saving}
              onClick={handleDelete}
              className="px-3.5 py-2 rounded-xl border text-xs font-bold transition cursor-pointer disabled:opacity-50"
              style={
                confirmDelete
                  ? { background: '#e11d48', borderColor: '#fda4af', color: '#ffffff' }
                  : { background: 'rgba(244, 63, 94, 0.1)', borderColor: 'rgba(244, 63, 94, 0.35)', color: '#fb7185' }
              }
            >
              {deleting
                ? t('Deleting...', 'Törlés...')
                : confirmDelete
                ? t('Confirm Delete', 'Biztosan törlöm')
                : t('Delete Listing', 'Hirdetés törlése')}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {t('Cancel', 'Mégse')}
              </button>
              <button
                type="submit"
                disabled={saving || deleting}
                className="px-4 py-2 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
              >
                {saving ? t('Saving...', 'Mentés...') : t('Save Changes', 'Mentés')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
