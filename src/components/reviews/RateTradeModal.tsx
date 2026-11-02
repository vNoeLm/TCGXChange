import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useExitTransition } from '../../lib/useExitTransition';
import { categoriesFor, overallOf, type ReviewDirection } from '../../lib/reviewCategories';
import { submitTradeReview } from '../../lib/reviews';
import { useLanguage } from '../../lib/i18n';
import { backdropCloseProps } from '../../lib/modalBackdrop';
import type { TradeReview } from '../../types';
import { StarInput, Stars } from './ReviewParts';

/**
 * Rate the other side of a completed trade, category by category. The overall score is the average
 * of the categories, so it can't disagree with them.
 */
export function RateTradeModal({ open, onClose, orderNumber, direction, counterpartName, onDone }: {
  open: boolean;
  onClose: () => void;
  orderNumber: string;
  direction: ReviewDirection;
  counterpartName?: string | null;
  onDone: (review: TradeReview) => void;
}) {
  const { t, lang } = useLanguage();
  const anim = useExitTransition(open, 250);
  const categories = categoriesFor(direction, lang);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setScores({});
    setComment('');
    setError('');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderNumber, direction]);

  if (!anim.rendered || typeof document === 'undefined') return null;

  const complete = categories.every((c) => scores[c.key]);
  const titleText =
    direction === 'buyer_to_seller'
      ? t('Rate the seller', 'Eladó értékelése')
      : t('Rate the buyer', 'Vevő értékelése');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    setError('');
    const { review, error: err } = await submitTradeReview({ orderNumber, direction, scores, comment });
    setSaving(false);
    if (err || !review) {
      setError(err || t('Could not save the review.', 'Az értékelés mentése nem sikerült.'));
      return;
    }
    onDone(review);
    onClose();
  };

  return createPortal(
    <div
      data-state={anim.state}
      className="tv-overlay fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      {...backdropCloseProps(onClose, { disabled: saving })}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        data-state={anim.state}
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        className="tv-modal-panel relative w-full max-w-md rounded-2xl p-5 sm:p-6 border my-8 flex flex-col gap-4"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-card)' }}
      >
        <div>
          <h3 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>
            {titleText}{counterpartName ? `: ${counterpartName}` : ''}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {t('Order', 'Rendelés')} #{orderNumber}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {categories.map((c) => (
            <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{c.label}</div>
                <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{c.hint}</div>
              </div>
              <StarInput label={c.label} value={scores[c.key] || 0} onChange={(v) => setScores((s) => ({ ...s, [c.key]: v }))} />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-xl px-3 py-2 border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            {t('Overall', 'Összesített')}
          </span>
          {complete ? (
            <span className="inline-flex items-center gap-2">
              <Stars value={overallOf(scores)} size={14} />
              <span className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>{overallOf(scores).toFixed(1)}</span>
            </span>
          ) : (
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('Rate every category', 'Értékeld az összes szempontot')}
            </span>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
            {t('Comment (optional)', 'Megjegyzés (opcionális)')}
          </span>
          <textarea
            rows={3}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              direction === 'buyer_to_seller'
                ? t('E.g. well packed, arrived in two days', 'Pl. gondos csomagolás, két nap alatt megérkezett')
                : t('E.g. paid right away, easy meetup', 'Pl. azonnal utalt, rugalmas találkozó')
            }
            className="w-full text-xs rounded-xl p-3 border outline-none focus:border-[var(--accent)]"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </label>

        {error && <p className="text-xs font-semibold" style={{ color: 'var(--negative)' }}>{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 h-10 rounded-xl text-xs font-bold border cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {t('Cancel', 'Mégse')}
          </button>
          <button
            type="submit"
            disabled={!complete || saving}
            className="flex-1 h-10 rounded-xl text-xs font-black cursor-pointer disabled:opacity-50 disabled:cursor-default"
            style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
          >
            {saving ? t('Saving…', 'Mentés…') : t('Submit rating', 'Értékelés küldése')}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
