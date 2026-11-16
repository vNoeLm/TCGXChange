import React, { useEffect, useRef, useState } from 'react';
import { getConditionDescription, normalizeCardCondition } from '../../lib/collectionDefaults';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { CardPreviewOverlay } from '../CardPreviewOverlay';
import { ImageViewer } from '../CardImageViewer';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface ProductSpecItem {
  label: string;
  value?: string | null;
}

export interface UnifiedProductDetailProps {
  topBanner?: React.ReactNode;
  breadcrumbs: BreadcrumbItem[];
  topRightActions?: React.ReactNode;

  images: string[];
  alt: string;
  soldOut?: boolean;
  fallbackLabel?: string;
  imageTopLeftBadges?: React.ReactNode;

  adminBanner?: React.ReactNode;
  eyebrow?: string | null;
  title: string;

  priceHuf: number | null;
  pricePrefix?: string | null;
  priceFallbackText?: string | null;
  originalPriceHuf?: number | null;
  msrpLabel?: string | null;
  stockText: string;
  stockTone?: 'positive' | 'low' | 'negative';
  priceRightSlot?: React.ReactNode;

  cardDetailsId?: string | null;
  cardDetailsHref?: string | null;
  condition?: string | null;

  /** Variant switcher (Store) or Seller card (Marketplace). */
  middleSlot?: React.ReactNode;
  actions: React.ReactNode;
  afterActionsSlot?: React.ReactNode;

  description?: string | null;
  specs: ProductSpecItem[];
  belowSection?: React.ReactNode;
  children?: React.ReactNode;
}

function SpecRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
      <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="font-semibold text-right" style={{ color: 'var(--text-primary)' }}>{value}</dd>
    </div>
  );
}

export function UnifiedProductDetail({
  topBanner,
  breadcrumbs,
  topRightActions,
  images,
  alt,
  soldOut = false,
  fallbackLabel = 'TCG',
  imageTopLeftBadges,
  adminBanner,
  eyebrow,
  title,
  priceHuf,
  pricePrefix,
  priceFallbackText,
  originalPriceHuf,
  msrpLabel,
  stockText,
  stockTone = 'positive',
  priceRightSlot,
  cardDetailsId,
  cardDetailsHref,
  condition,
  middleSlot,
  actions,
  afterActionsSlot,
  description,
  specs,
  belowSection,
  children,
}: UnifiedProductDetailProps) {
  const { lang, t } = useLanguage();
  const { formatPrice } = useCurrency();

  const [imageIndex, setImageIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [expandedDesc, setExpandedDesc] = useState(false);
  const [canExpandDesc, setCanExpandDesc] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setImageIndex(0);
    setFailedImages({});
  }, [images.join('|')]);

  useEffect(() => {
    setExpandedDesc(false);
    const check = () => {
      const el = descRef.current;
      if (!el) return;
      setCanExpandDesc(el.scrollHeight > el.clientHeight + 1);
    };
    const id = requestAnimationFrame(check);
    window.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', check);
    };
  }, [title, description]);

  const prevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (images.length <= 1) return;
    setImageIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  };

  const nextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (images.length <= 1) return;
    setImageIndex((i) => (i < images.length - 1 ? i + 1 : 0));
  };

  const conditionDesc = condition ? getConditionDescription(condition, lang) : '';
  const stockColor =
    stockTone === 'negative'
      ? 'var(--negative)'
      : stockTone === 'low'
      ? '#f59e0b'
      : 'var(--positive)';

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8">
      {topBanner}

      {/* Top Breadcrumb + Utility Actions */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={`${crumb.label}-${idx}`}>
              {idx > 0 && <span>/</span>}
              {crumb.href ? (
                <a href={crumb.href} className="hover:underline cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                  {crumb.label}
                </a>
              ) : (
                <span className="font-semibold truncate max-w-[200px] sm:max-w-[280px]" style={{ color: 'var(--text-secondary)' }}>
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </nav>

        {topRightActions && <div className="flex items-center gap-2">{topRightActions}</div>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10 items-start">
        {/* Left: Artwork / Photo Gallery */}
        <div>
          <div
            className={`relative group aspect-square w-full rounded-2xl border overflow-hidden flex items-center justify-center ${
              images.length > 0 ? 'cursor-zoom-in' : ''
            } ${soldOut ? 'store-sold-out-frame' : ''}`}
            onClick={() => images.length > 0 && !failedImages[images[imageIndex]] && setLightboxOpen(true)}
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
          >
            {images[imageIndex] && !failedImages[images[imageIndex]] ? (
              <img
                src={images[imageIndex]}
                alt={alt}
                onError={() => setFailedImages((prev) => ({ ...prev, [images[imageIndex]]: true }))}
                className={`w-full h-full object-contain p-4 transition duration-300 ${soldOut ? 'store-sold-out-img' : ''}`}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none">
                <span className="text-xs font-semibold tracking-wide uppercase opacity-60" style={{ color: 'var(--text-muted)' }}>
                  {fallbackLabel}
                </span>
              </div>
            )}

            {imageTopLeftBadges && (
              <div className="absolute top-3 left-3 flex flex-col gap-1 items-start pointer-events-none">
                {imageTopLeftBadges}
              </div>
            )}

            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={prevImage}
                  aria-label={t('Previous image', 'Előző kép')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full border flex items-center justify-center transition opacity-80 hover:opacity-100 hover:scale-105 cursor-pointer shadow-md"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={nextImage}
                  aria-label={t('Next image', 'Következő kép')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full border flex items-center justify-center transition opacity-80 hover:opacity-100 hover:scale-105 cursor-pointer shadow-md"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <span
                  className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-full text-[10px] font-bold pointer-events-none"
                  style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}
                >
                  {imageIndex + 1} / {images.length}
                </span>
              </>
            )}
          </div>

          {images.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {images.map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  className="w-16 h-16 shrink-0 rounded-lg border overflow-hidden cursor-pointer"
                  style={{ borderColor: i === imageIndex ? 'var(--accent)' : 'var(--border)', background: 'var(--bg-surface-2)' }}
                >
                  <img
                    src={src}
                    alt=""
                    onError={() => setFailedImages((prev) => ({ ...prev, [src]: true }))}
                    className="w-full h-full object-contain p-1"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Unified Product Info Column */}
        <div className="min-w-0 flex flex-col gap-4">
          {adminBanner}

          {/* Store-style Eyebrow Kicker + Title */}
          <div>
            {eyebrow && (
              <p className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: 'var(--text-accent)' }}>
                {eyebrow}
              </p>
            )}
            <h1 className="text-2xl sm:text-3xl font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h1>
          </div>

          {/* Marketplace-style Big Price Box + Stock Count Under It + Card Details Button */}
          <div
            className="p-4 rounded-2xl border flex items-center justify-between gap-3 flex-wrap"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <div>
              <div className="flex items-baseline gap-2.5 flex-wrap">
                {pricePrefix && priceHuf != null && (
                  <span className="text-sm font-bold" style={{ color: 'var(--text-tertiary)' }}>
                    {pricePrefix}
                  </span>
                )}
                <span className={`${priceHuf != null ? 'text-3xl font-mono text-emerald-400' : 'text-lg text-[var(--text-primary)]'} font-black`}>
                  {priceHuf != null ? formatPrice(priceHuf) : (priceFallbackText || '-')}
                </span>
                {originalPriceHuf != null && originalPriceHuf > (priceHuf ?? 0) && (
                  <span className="text-base line-through" style={{ color: 'var(--text-placeholder)' }}>
                    {formatPrice(originalPriceHuf)}
                  </span>
                )}
                {msrpLabel && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-md border"
                    style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    {msrpLabel}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs font-bold mt-1" style={{ color: stockColor }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stockColor }} />
                <span>{stockText}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {cardDetailsId ? (
                <button
                  type="button"
                  onClick={() => setPreviewCardId(cardDetailsId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition hover:border-[var(--accent)] hover:brightness-110 cursor-pointer"
                  style={{ borderColor: 'var(--accent-border)', background: 'var(--accent-muted)', color: 'var(--text-accent)' }}
                >
                  <span>{t('Card Details', 'Kártya adatlap')}</span>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
              ) : cardDetailsHref ? (
                <a
                  href={cardDetailsHref}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition hover:border-[var(--accent)] hover:brightness-110"
                  style={{ borderColor: 'var(--accent-border)', background: 'var(--accent-muted)', color: 'var(--text-accent)' }}
                >
                  <span>{t('Card Details', 'Kártya adatlap')}</span>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </a>
              ) : null}
              {priceRightSlot}
            </div>
          </div>

          {/* Condition Explanation Box (from Store) */}
          {condition && conditionDesc && (
            <div
              className="p-3 rounded-xl border text-xs leading-relaxed"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                {normalizeCardCondition(condition)}:
              </span>{' '}
              {conditionDesc}
            </div>
          )}

          {middleSlot}

          {description && (
            <div
              className="p-3.5 rounded-xl border"
              style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
            >
              <div
                className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {t('Description', 'Leírás')}
              </div>
              <p
                ref={descRef}
                className={`text-xs sm:text-sm leading-relaxed whitespace-pre-line ${expandedDesc ? '' : 'line-clamp-3'}`}
                style={{ color: 'var(--text-secondary)' }}
              >
                {description}
              </p>
              {canExpandDesc && (
                <button
                  type="button"
                  onClick={() => setExpandedDesc((prev) => !prev)}
                  className="text-xs font-bold mt-1.5 underline underline-offset-2 cursor-pointer hover:opacity-80 block"
                  style={{ color: 'var(--text-accent)' }}
                >
                  {expandedDesc ? t('Show less', 'Kevesebb') : t('Read more', 'Bővebben')}
                </button>
              )}
            </div>
          )}

          {actions}
          {afterActionsSlot}

          {/* Unified Spec Sheet */}
          {specs.some((s) => Boolean(s.value)) && (
            <dl className="mt-1">
              {specs.map((s) => (
                <SpecRow key={s.label} label={s.label} value={s.value} />
              ))}
            </dl>
          )}
        </div>
      </div>

      {belowSection}

      {lightboxOpen && images[imageIndex] && (
        <ImageViewer
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          src={images[imageIndex]}
          alt={alt}
          images={images}
          currentIndex={imageIndex}
          onIndexChange={setImageIndex}
        />
      )}

      <CardPreviewOverlay cardId={previewCardId} onClose={() => setPreviewCardId(null)} />
      {children}
    </div>
  );
}
