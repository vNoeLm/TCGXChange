import { useState } from 'react';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { useBodyScrollLock } from '../../lib/scrollLock';
import { createHoldRequest } from '../../lib/p2pClient';

export interface HoldTarget {
  mode: 'listing' | 'post_card' | 'bulk_lot';
  title: string;
  subtitle?: string;
  sellerName: string;
  priceHuf: number;
  maxQuantity: number;
  listingId?: string;
  postId?: string;
  postCardId?: string;
  imageUrl?: string | null;
}

interface HoldConfirmModalProps {
  target: HoldTarget;
  onClose: () => void;
  onSuccess: (conversationId: string) => void;
}

export function HoldConfirmModal({ target, onClose, onSuccess }: HoldConfirmModalProps) {
  const { t } = useLanguage();
  const { formatPrice } = useCurrency();
  useBodyScrollLock(true);

  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitHold = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await createHoldRequest({
        mode: target.mode,
        listing_id: target.listingId,
        post_id: target.postId,
        post_card_id: target.postCardId,
        quantity: target.mode === 'bulk_lot' ? 1 : quantity,
        note: note.trim() || undefined,
      });
      onSuccess(res.conversation_id);
    } catch (err: any) {
      setError(err?.message || t('Failed to send hold request.', 'Sikertelen félretételi kérelem.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <h3 className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
            {t('Request Hold', 'Félretétel kérése')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-raised)] cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={submitHold} className="p-5 flex flex-col gap-4">
          <div
            className="p-3 rounded-xl border flex items-center gap-3"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
          >
            {target.imageUrl && (
              <img
                src={target.imageUrl}
                alt={target.title}
                className="w-11 h-14 rounded-lg object-cover shrink-0 border"
                style={{ borderColor: 'var(--border-subtle)' }}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>
                {target.title}
              </div>
              {target.subtitle && (
                <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {target.subtitle}
                </div>
              )}
              <div className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {t('Seller:', 'Eladó:')} {target.sellerName}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-black" style={{ color: 'var(--text-accent)' }}>
                {formatPrice(target.priceHuf * (target.mode === 'bulk_lot' ? 1 : quantity))}
              </div>
            </div>
          </div>

          {target.mode !== 'bulk_lot' && target.maxQuantity > 1 && (
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                {t('Quantity', 'Mennyiség')} ({t('max', 'max')} {target.maxQuantity})
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="w-7 h-7 rounded-lg border text-xs font-bold cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  -
                </button>
                <span className="text-xs font-black min-w-[20px] text-center" style={{ color: 'var(--text-primary)' }}>
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(target.maxQuantity, q + 1))}
                  className="w-7 h-7 rounded-lg border text-xs font-bold cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  +
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              {t('Message (Optional)', 'Üzenet (opcionális)')}
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t(
                'Meetup / shipping note...',
                'Átvétel vagy posta megjegyzés...'
              )}
              className="w-full px-3 py-2 rounded-xl border text-xs outline-none focus:border-[var(--accent)]"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
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
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
            >
              {submitting ? t('Sending...', 'Küldés...') : t('Send Hold Request', 'Félretétel küldése')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
