import { useEffect, useState } from 'react';
import { CARD_CONDITIONS, formatCondition } from '../../lib/collectionDefaults';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { useBodyScrollLock } from '../../lib/scrollLock';
import {
  deleteMarketplacePost,
  updateMarketplacePost,
  type P2PCardInfo,
  type P2PPost,
} from '../../lib/p2pClient';
import { P2P_MAX_POST_IMAGES, P2P_MAX_POST_TAGS } from '../../lib/p2pConstants';
import { cardThumbProps } from '../../lib/supabase';
import { CardAutocomplete, MentionTextarea } from './CardAutocomplete';
import { PhotoUploader } from './PhotoUploader';

interface EditableTag {
  key: string;
  id?: string;
  card: P2PCardInfo;
  isHighlightOnly: boolean;
  priceHuf: string;
  quantity: number;
  condition: string;
  isFoil: boolean;
  status: 'available' | 'held' | 'sold';
}

interface EditPostModalProps {
  post: P2PPost;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function EditPostModal({ post, onClose, onSaved, onDeleted }: EditPostModalProps) {
  const { lang, t } = useLanguage();
  const { eurHufRate } = useCurrency();
  useBodyScrollLock(true);

  const isBulk = post.post_type === 'bulk';
  const [title, setTitle] = useState(post.title || '');
  const [body, setBody] = useState(post.body || '');
  const [lotPriceHuf, setLotPriceHuf] = useState(post.lot_price_huf != null ? String(post.lot_price_huf) : '');
  const [status, setStatus] = useState<'open' | 'sold_out' | 'closed'>(
    post.status === 'sold_out' ? 'sold_out' : post.status === 'closed' ? 'closed' : 'open'
  );
  const [images, setImages] = useState<string[]>(post.images || []);
  const [tags, setTags] = useState<EditableTag[]>(() =>
    (post.tagged_cards || []).map((tc) => ({
      key: tc.id,
      id: tc.id,
      card: tc.card,
      isHighlightOnly: Boolean(tc.is_highlight_only),
      priceHuf: tc.price_huf != null ? String(tc.price_huf) : '',
      quantity: Math.max(0, tc.quantity),
      condition: tc.condition || 'Near Mint',
      isFoil: Boolean(tc.is_foil),
      status: tc.status === 'sold' ? 'sold' : tc.status === 'held' ? 'held' : 'available',
    }))
  );

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

  const addCardTag = (card: P2PCardInfo) => {
    setTags((prev) => {
      if (prev.length >= P2P_MAX_POST_TAGS) return prev;
      if (prev.some((x) => x.card.id === card.id)) return prev;
      const suggestedEur = card.market_price_eur ?? card.market_price_foil_eur;
      const suggestedPrice = suggestedEur
        ? String(Math.max(100, Math.round((Number(suggestedEur) * (eurHufRate || 395)) / 50) * 50))
        : '';
      return [
        ...prev,
        {
          key: `new_${card.id}_${Date.now()}`,
          card,
          isHighlightOnly: !suggestedPrice,
          priceHuf: suggestedPrice,
          quantity: 1,
          condition: 'Near Mint',
          isFoil: false,
          status: 'available',
        },
      ];
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (images.length === 0) {
      setError(t('Please keep at least 1 photo.', 'Legalább 1 fotó szükséges.'));
      return;
    }

    const parsedLotPrice = lotPriceHuf.trim() ? Math.round(Number(lotPriceHuf)) : null;
    if (parsedLotPrice !== null && (!Number.isFinite(parsedLotPrice) || parsedLotPrice < 1)) {
      setError(t('Enter a valid lot price in HUF.', 'Adj meg érvényes csomagárat forintban.'));
      return;
    }

    setSaving(true);
    try {
      await updateMarketplacePost({
        id: post.id,
        title: title.trim(),
        body,
        status,
        images,
        lot_price_huf: parsedLotPrice,
        tagged_cards: tags.map((tc) => {
          const parsed = tc.priceHuf.trim() ? Math.round(Number(tc.priceHuf)) : null;
          const isHighlight = tc.isHighlightOnly || parsed === null || !Number.isFinite(parsed) || parsed <= 0;
          return {
            ...(tc.id ? { id: tc.id } : {}),
            card_id: tc.card.id,
            is_highlight_only: isHighlight,
            condition: tc.condition,
            is_foil: tc.isFoil,
            price_huf: isHighlight ? null : parsed,
            quantity: isHighlight ? 1 : Math.max(0, tc.quantity),
            status: tc.status,
          };
        }),
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message || t('Failed to save changes.', 'Nem sikerült menteni a módosításokat.'));
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
      await deleteMarketplacePost(post.id);
      onDeleted();
    } catch (err: any) {
      setError(err?.message || t('Failed to delete post.', 'Sikertelen törlés.'));
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-3.5 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
            {t('Edit Post / Lot', 'Poszt / csomag módosítása')}
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={isBulk ? 'sm:col-span-2' : 'sm:col-span-2'}>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Title', 'Cím')}
              </label>
              <input
                type="text"
                maxLength={180}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isBulk ? t('Bulk Card Lot', 'Bulk csomag') : t('Photo Post title', 'Poszt címe')}
                className="w-full h-10 px-3 rounded-xl border text-xs outline-none focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Post Status', 'Poszt állapota')}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'open' | 'sold_out' | 'closed')}
                className="w-full h-10 px-3 rounded-xl border text-xs font-semibold outline-none focus:border-[var(--accent)]"
                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <option value="open">{t('Open', 'Elérhető')}</option>
                <option value="sold_out">{t('Sold Out', 'Eladva')}</option>
                <option value="closed">{t('Closed', 'Lezárva')}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Lot Price (HUF, optional)', 'Teljes csomag ára (Ft, opcionális)')}
            </label>
            <input
              type="number"
              min={1}
              max={50000000}
              value={lotPriceHuf}
              onChange={(e) => setLotPriceHuf(e.target.value)}
              placeholder={t('Leave blank for per-card / chat', 'Üres = laponként vagy egyeztetés')}
              className="w-full sm:w-64 h-10 px-3 rounded-xl border text-sm font-black outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Description (type @card to tag)', 'Leírás (írd be: @kártyanév a jelöléshez)')}
            </label>
            <MentionTextarea
              rows={3}
              value={body}
              onChange={setBody}
              onTagCard={addCardTag}
              placeholder={t(
                'Describe your post or lot, and type @card to tag cards...',
                'Írd le a posztod vagy csomagod, és írd be: @kártyanév a lapok megjelöléséhez...'
              )}
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              {t('Photos', 'Fotók')}
            </label>
            <PhotoUploader
              images={images}
              maxImages={P2P_MAX_POST_IMAGES}
              onChange={setImages}
              required
            />
          </div>

          {/* Tagged Cards Manager */}
          <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                {isBulk ? t('Highlighted Cards', 'Kiemelt lapok') : t('Tagged Cards', 'Megjelölt lapok')} ({tags.length}/{P2P_MAX_POST_TAGS})
              </span>
            </div>

            <CardAutocomplete
              clearOnSelect
              onSelect={addCardTag}
              placeholder={t('Search & add a card...', 'Keresés és kártya hozzáadása...')}
            />

            {tags.length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                {tags.map((tc) => {
                  const thumb = tc.card?.image_path ? cardThumbProps(tc.card.image_path, 'avatar') : null;
                  const isSold = tc.status === 'sold';
                  return (
                    <div
                      key={tc.key}
                      className="p-2.5 rounded-xl border flex flex-col gap-2"
                      style={{
                        background: 'var(--bg-surface-2)',
                        borderColor: isSold ? 'rgba(244, 63, 94, 0.35)' : 'var(--border)',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {thumb && (
                            <img src={thumb.src} alt={tc.card.name} className="w-8 h-11 rounded object-cover shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className={`text-xs font-bold truncate ${isSold ? 'line-through opacity-65' : ''}`} style={{ color: 'var(--text-primary)' }}>
                              {tc.card.name}
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                              {tc.card.card_number}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <div
                            className="inline-flex rounded-lg border p-0.5 gap-0.5"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setTags((prev) =>
                                  prev.map((x) => (x.key === tc.key ? { ...x, status: 'available' } : x))
                                )
                              }
                              className={`px-2 py-1 rounded-md text-[11px] font-bold cursor-pointer transition ${
                                !isSold
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                              }`}
                            >
                              {t('Available', 'Elérhető')}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setTags((prev) =>
                                  prev.map((x) => (x.key === tc.key ? { ...x, status: 'sold' } : x))
                                )
                              }
                              className={`px-2 py-1 rounded-md text-[11px] font-bold cursor-pointer transition ${
                                isSold
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                              }`}
                            >
                              {t('Sold', 'Eladva')}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setTags((prev) => prev.filter((x) => x.key !== tc.key))}
                            title={t('Remove', 'Eltávolítás')}
                            className="w-7 h-7 rounded-lg border flex items-center justify-center text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1.5 border-t items-center" style={{ borderColor: 'var(--border-subtle)' }}>
                          <input
                            type="number"
                            min={1}
                            value={tc.priceHuf}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTags((prev) =>
                                prev.map((x) =>
                                  x.key === tc.key ? { ...x, priceHuf: val, isHighlightOnly: !val.trim() } : x
                                )
                              );
                            }}
                            placeholder={t('Price Ft (blank = ask)', 'Ár Ft (üres = egyeztetés)')}
                            className="h-8 px-2.5 rounded-lg border text-xs outline-none"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                          />
                          <input
                            type="number"
                            min={0}
                            max={99}
                            value={tc.quantity}
                            onChange={(e) => {
                              const q = Math.max(0, Math.min(99, Number(e.target.value) || 0));
                              setTags((prev) => prev.map((x) => (x.key === tc.key ? { ...x, quantity: q } : x)));
                            }}
                            className="h-8 px-2.5 rounded-lg border text-xs outline-none"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                          />
                          <select
                            value={tc.condition}
                            onChange={(e) => {
                              const c = e.target.value;
                              setTags((prev) => prev.map((x) => (x.key === tc.key ? { ...x, condition: c } : x)));
                            }}
                            className="h-8 px-2 rounded-lg border text-xs outline-none"
                            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                          >
                            {CARD_CONDITIONS.map((cond) => (
                              <option key={cond.id} value={cond.id}>
                                {formatCondition(cond.id, lang)}
                              </option>
                            ))}
                          </select>
                          <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                            <input
                              type="checkbox"
                              checked={tc.isFoil}
                              onChange={(e) => {
                                const f = e.target.checked;
                                setTags((prev) => prev.map((x) => (x.key === tc.key ? { ...x, isFoil: f } : x)));
                              }}
                              className="w-3.5 h-3.5 accent-amber-500"
                            />
                            <span>Foil</span>
                          </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="px-3.5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-300">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                confirmDelete
                  ? 'bg-rose-600 border-rose-500 text-white'
                  : 'border-rose-500/40 text-rose-400 hover:bg-rose-500/10'
              }`}
            >
              {deleting
                ? t('Deleting...', 'Törlés...')
                : confirmDelete
                ? t('Confirm Delete', 'Biztos törlöd?')
                : t('Delete', 'Törlés')}
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
                disabled={saving}
                className="px-5 py-2 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
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
