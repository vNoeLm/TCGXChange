import { useState } from 'react';
import { CARD_CONDITIONS, formatCondition } from '../../lib/collectionDefaults';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { getActiveGame } from '../../lib/theme';
import { cardThumbProps } from '../../lib/supabase';
import {
  createMarketplacePost,
  createSingleListing,
  type P2PCardInfo,
} from '../../lib/p2pClient';
import { P2P_MAX_POST_TAGS } from '../../lib/p2pConstants';
import { CardAutocomplete, MentionTextarea } from './CardAutocomplete';
import { PhotoUploader } from './PhotoUploader';
import { Modal } from '../ui/Modal';

export type SellModeTab = 'single' | 'post';

interface TaggedDraft {
  key: string;
  card: P2PCardInfo;
  isHighlightOnly: boolean;
  priceHuf: string;
  quantity: number;
  condition: string;
  isFoil: boolean;
}

interface SellModalProps {
  initialTab?: SellModeTab | 'photo_post' | 'bulk';
  game?: string;
  onTabChange?: (tab: SellModeTab) => void;
  onClose: () => void;
  onSuccess: (createdType: SellModeTab) => void;
  onOpenBulkAdder?: () => void;
}

export function SellModal({ initialTab = 'single', game, onTabChange, onClose, onSuccess, onOpenBulkAdder }: SellModalProps) {
  const { lang, t } = useLanguage();
  const { formatPrice, eurHufRate } = useCurrency();

  const [tab, setTab] = useState<SellModeTab>(() => (initialTab === 'single' ? 'single' : 'post'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab 1: Single Card listing
  const [selectedCard, setSelectedCard] = useState<P2PCardInfo | null>(null);
  const [singlePriceHuf, setSinglePriceHuf] = useState('');
  const [singleQty, setSingleQty] = useState(1);
  const [singleCondition, setSingleCondition] = useState('Near Mint');
  const [singleFoil, setSingleFoil] = useState(false);
  const [singleDesc, setSingleDesc] = useState('');
  const [singleImages, setSingleImages] = useState<string[]>([]);

  // Tab 2 & Tab 3 shared Post fields
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postImages, setPostImages] = useState<string[]>([]);
  const [bulkPriceHuf, setBulkPriceHuf] = useState('');
  const [taggedCards, setTaggedCards] = useState<TaggedDraft[]>([]);

  const appendTagCard = (card: P2PCardInfo) => {
    setTaggedCards((prev) => {
      if (prev.length >= P2P_MAX_POST_TAGS) return prev;
      if (prev.some((p) => p.card.id === card.id)) return prev;
      const suggestedEur = card.market_price_eur ?? card.market_price_foil_eur;
      const suggestedPrice = suggestedEur
        ? String(Math.max(100, Math.round((Number(suggestedEur) * (eurHufRate || 395)) / 50) * 50))
        : '';
      return [
        ...prev,
        {
          key: `${card.id}_${Date.now()}`,
          card,
          isHighlightOnly: !suggestedPrice,
          priceHuf: suggestedPrice,
          quantity: 1,
          condition: 'Near Mint',
          isFoil: false,
        },
      ];
    });
  };

  const suggestedMarketHuf = (() => {
    if (!selectedCard) return null;
    const eur = singleFoil
      ? selectedCard.market_price_foil_eur ?? selectedCard.market_price_eur
      : selectedCard.market_price_eur;
    if (eur == null || !Number.isFinite(Number(eur))) return null;
    return Math.round(Number(eur) * (eurHufRate || 395));
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (tab === 'single') {
        if (!selectedCard) {
          throw new Error(t('Please select a card first.', 'Először válassz ki egy kártyát.'));
        }
        const priceNum = Math.round(Number(singlePriceHuf));
        if (!Number.isFinite(priceNum) || priceNum < 1) {
          throw new Error(t('Enter a valid price in HUF.', 'Adj meg egy érvényes árat forintban.'));
        }
        await createSingleListing({
          card_id: selectedCard.id,
          price_huf: priceNum,
          quantity: Math.max(1, singleQty),
          condition: singleCondition,
          is_foil: singleFoil,
          description: singleDesc.trim() || undefined,
          images: singleImages,
        });
      } else {
        if (postImages.length === 0) {
          throw new Error(t('Please upload at least 1 real photo.', 'Tölts fel legalább 1 valódi fotót.'));
        }
        const lotPrice = bulkPriceHuf.trim() ? Math.round(Number(bulkPriceHuf)) : null;
        if (lotPrice !== null && (!Number.isFinite(lotPrice) || lotPrice < 1)) {
          throw new Error(t('Enter a valid lot price in HUF.', 'Adj meg érvényes csomagárat forintban.'));
        }
        if (lotPrice === null && !postBody.trim() && taggedCards.length === 0 && !postTitle.trim()) {
          throw new Error(
            t(
              'Add a lot price, description, or tag at least one card.',
              'Adj meg csomagárat, írj leírást, vagy jelölj meg legalább egy lapot.'
            )
          );
        }
        const preparedTags = taggedCards.map((tc) => {
          const parsed = tc.priceHuf.trim() ? Math.round(Number(tc.priceHuf)) : null;
          const isHighlight = tc.isHighlightOnly || parsed === null || !Number.isFinite(parsed) || parsed <= 0;
          return {
            card_id: tc.card.id,
            is_highlight_only: isHighlight,
            condition: tc.condition,
            is_foil: tc.isFoil,
            price_huf: isHighlight ? null : parsed,
            quantity: isHighlight ? 1 : Math.max(1, tc.quantity),
          };
        });
        const hasPricedTag = preparedTags.some((tc) => !tc.is_highlight_only);

        await createMarketplacePost({
          post_type: lotPrice !== null && !hasPricedTag ? 'bulk' : 'photo_post',
          title: postTitle.trim() || undefined,
          body: postBody,
          lot_price_huf: lotPrice,
          images: postImages,
          tagged_cards: preparedTags,
        });
      }
      onSuccess(tab);
    } catch (err: any) {
      setError(err?.message || t('Could not publish.', 'Nem sikerült közzétenni.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      closeDisabled={submitting}
      maxWidth="max-w-2xl"
      zIndexClass="z-[2000]"
      bare
      ariaLabel={t('New Listing', 'Új hirdetés')}
      className="max-h-[92dvh] flex flex-col"
    >
        {/* Header */}
        <div
          className="px-5 py-3.5 border-b flex items-center justify-between gap-2 shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <h2 className="text-base font-black" style={{ color: 'var(--text-primary)' }}>
            {t('New Listing', 'Új hirdetés')}
          </h2>
          <div className="flex items-center gap-2">
            {onOpenBulkAdder && (
              <button
                type="button"
                onClick={onOpenBulkAdder}
                className="px-3 py-1.5 rounded-xl border text-xs font-bold transition hover:border-[var(--accent)] cursor-pointer"
                style={{
                  background: 'var(--bg-surface-2)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-accent)',
                }}
              >
                {t('Bulk Add Singles', 'Kártyák tömeges hozzáadása')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('Close modal', 'Bezárás')}
              className="w-8 h-8 rounded-xl border flex items-center justify-center transition hover:bg-[var(--bg-raised)] cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* 2 Mode Tabs */}
        <div
          className="px-5 pt-3 pb-2 border-b grid grid-cols-2 gap-1.5 shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          {[
            { id: 'single' as const, label: t('Single Card', 'Egyedi lap') },
            { id: 'post' as const, label: t('Post / Lot', 'Poszt / Csomag') },
          ].map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setError(null);
                  onTabChange?.(item.id);
                }}
                className="py-2 px-3 rounded-xl text-xs font-bold border transition cursor-pointer"
                style={
                  active
                    ? {
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent)',
                        color: 'var(--text-accent)',
                      }
                    : {
                        background: 'var(--bg-surface)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)',
                      }
                }
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {tab === 'single' ? (
            <>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {t('Card *', 'Kártya *')}
                </label>
                <CardAutocomplete
                  game={game || getActiveGame()}
                  onSelect={(c) => {
                    setSelectedCard(c);
                    if (!singlePriceHuf && c.market_price_eur) {
                      const approx = Math.max(100, Math.round((Number(c.market_price_eur) * (eurHufRate || 395)) / 50) * 50);
                      setSinglePriceHuf(String(approx));
                    }
                  }}
                />
                {selectedCard && (
                  <div
                    className="mt-2 p-2.5 rounded-xl border flex items-center gap-3"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                  >
                    {selectedCard.image_path && (
                      <img
                        src={cardThumbProps(selectedCard.image_path, 'avatar').src}
                        alt={selectedCard.name}
                        className="w-10 h-14 rounded object-cover border shrink-0"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>
                        {selectedCard.name}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {selectedCard.card_number} {selectedCard.sets?.name ? `· ${selectedCard.sets.name}` : ''}
                      </div>
                      {suggestedMarketHuf !== null && (
                        <div className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-accent)' }}>
                          {t('Market reference:', 'Piaci referencia:')} ~{formatPrice(suggestedMarketHuf)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {t('Price (HUF) *', 'Ár (Ft) *')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50000000}
                    required
                    value={singlePriceHuf}
                    onChange={(e) => setSinglePriceHuf(e.target.value)}
                    placeholder="2500"
                    className="w-full px-3 py-2 rounded-xl border text-xs font-bold outline-none focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {t('Quantity', 'Mennyiség')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={singleQty}
                    onChange={(e) => setSingleQty(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-3 py-2 rounded-xl border text-xs font-bold outline-none focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {t('Condition', 'Állapot')}
                  </label>
                  <select
                    value={singleCondition}
                    onChange={(e) => setSingleCondition(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-xs font-semibold outline-none focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    {CARD_CONDITIONS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatCondition(c.id, lang)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer self-start">
                <input
                  type="checkbox"
                  checked={singleFoil}
                  onChange={(e) => setSingleFoil(e.target.checked)}
                  className="rounded accent-[var(--accent)]"
                />
                <span style={{ color: 'var(--text-primary)' }}>{t('Foil / Holo version', 'Foil / Holo verzió')}</span>
              </label>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {t('Notes (Optional)', 'Megjegyzés (opcionális)')}
                </label>
                <textarea
                  rows={2}
                  value={singleDesc}
                  onChange={(e) => setSingleDesc(e.target.value)}
                  placeholder={t('E.g. Budapest meetup or Foxpost agreed in chat...', 'Pl. Budapest személyes átvétel vagy posta üzenetben...')}
                  className="w-full px-3 py-2 rounded-xl border text-xs outline-none focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
              </div>

              <PhotoUploader images={singleImages} onChange={setSingleImages} />
            </>
          ) : (
            <>
              <PhotoUploader images={postImages} onChange={setPostImages} required />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {t('Title (Optional)', 'Cím (opcionális)')}
                  </label>
                  <input
                    type="text"
                    maxLength={180}
                    value={postTitle}
                    onChange={(e) => setPostTitle(e.target.value)}
                    placeholder={t('E.g. Binder page hits or 2 boxes...', 'Pl. Mappás lapok vagy 2 doboz...')}
                    className="w-full px-3 py-2 rounded-xl border text-xs font-semibold outline-none focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {t('Lot Price (HUF, optional)', 'Csomagár egyben (Ft, opcionális)')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50000000}
                    value={bulkPriceHuf}
                    onChange={(e) => setBulkPriceHuf(e.target.value)}
                    placeholder={t('Leave blank for per-card / chat', 'Üres = laponként vagy egyeztetés')}
                    className="w-full px-3 py-2 rounded-xl border text-xs font-bold outline-none focus:border-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {t('Description (type @card to tag)', 'Leírás (írd be: @kártyanév a jelöléshez)')}
                </label>
                <MentionTextarea
                  value={postBody}
                  onChange={setPostBody}
                  onTagCard={appendTagCard}
                  game={game || getActiveGame()}
                  placeholder={t(
                    'Describe your cards or lot (counts, condition, meetup)... Type @card to tag cards.',
                    'Írd le a képen lévő lapokat vagy csomagot... Írd be: @kártyanév a lapok megjelöléséhez!'
                  )}
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  {t('Tag Cards (Optional)', 'Kártyák megjelölése (opcionális)')}
                </label>
                <CardAutocomplete
                  clearOnSelect
                  game={game || getActiveGame()}
                  onSelect={appendTagCard}
                  placeholder={t('Search & attach a card...', 'Keresés és kártya hozzáadása...')}
                />
              </div>

              {taggedCards.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    {t('Tagged Cards', 'Megjelölt kártyák')} ({taggedCards.length}/{P2P_MAX_POST_TAGS})
                  </div>
                  <div className="flex flex-col gap-2">
                    {taggedCards.map((item) => {
                      const thumb = item.card.image_path ? cardThumbProps(item.card.image_path, 'avatar') : null;
                      return (
                        <div
                          key={item.key}
                          className="p-2.5 rounded-xl border flex flex-col gap-2"
                          style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
                        >
                          <div className="flex items-center gap-2.5">
                            {thumb && (
                              <img src={thumb.src} alt={item.card.name} className="w-8 h-11 rounded object-cover shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                                {item.card.name}
                              </div>
                              <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                {item.card.card_number}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setTaggedCards((prev) => prev.filter((x) => x.key !== item.key))}
                              className="text-[11px] font-bold text-rose-400 hover:text-rose-300 px-2 py-1 rounded cursor-pointer"
                            >
                              {t('Remove', 'Eltávolítás')}
                            </button>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1.5 border-t items-center" style={{ borderColor: 'var(--border-subtle)' }}>
                              <input
                                type="number"
                                min={1}
                                value={item.priceHuf}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setTaggedCards((prev) =>
                                    prev.map((x) =>
                                      x.key === item.key
                                        ? { ...x, priceHuf: val, isHighlightOnly: !val.trim() }
                                        : x
                                    )
                                  );
                                }}
                                placeholder={t('Price Ft (opt.)', 'Ár Ft (opc.)')}
                                className="px-2.5 py-1.5 rounded-lg border text-[11px] font-bold outline-none focus:border-[var(--accent)]"
                                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                              />
                              <input
                                type="number"
                                min={1}
                                max={99}
                                value={item.quantity}
                                onChange={(e) => {
                                  const q = Math.max(1, Math.min(99, Number(e.target.value) || 1));
                                  setTaggedCards((prev) => prev.map((x) => (x.key === item.key ? { ...x, quantity: q } : x)));
                                }}
                                title={t('Quantity', 'Darab')}
                                className="px-2.5 py-1.5 rounded-lg border text-[11px] font-bold outline-none"
                                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                              />
                              <select
                                value={item.condition}
                                onChange={(e) => {
                                  const cond = e.target.value;
                                  setTaggedCards((prev) => prev.map((x) => (x.key === item.key ? { ...x, condition: cond } : x)));
                                }}
                                className="px-2 py-1.5 rounded-lg border text-[11px] font-semibold outline-none"
                                style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                              >
                                {CARD_CONDITIONS.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.id}
                                  </option>
                                ))}
                              </select>
                              <label className="inline-flex items-center gap-1.5 text-[11px] font-bold cursor-pointer justify-end">
                                <input
                                  type="checkbox"
                                  checked={item.isFoil}
                                  onChange={(e) => {
                                    const foil = e.target.checked;
                                    setTaggedCards((prev) => prev.map((x) => (x.key === item.key ? { ...x, isFoil: foil } : x)));
                                  }}
                                  className="rounded accent-[var(--accent)]"
                                />
                                <span style={{ color: 'var(--text-secondary)' }}>Foil</span>
                              </label>
                            </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="px-3.5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs font-semibold text-rose-300">
              {error}
            </div>
          )}

          <div
            className="pt-3 border-t flex items-center justify-end gap-2.5 shrink-0"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border text-xs font-bold transition hover:bg-[var(--bg-raised)] cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              {t('Cancel', 'Mégse')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl text-xs font-black transition cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
            >
              {submitting ? t('Publishing...', 'Közzététel...') : t('Publish Post', 'Közzététel')}
            </button>
          </div>
        </form>
    </Modal>
  );
}
