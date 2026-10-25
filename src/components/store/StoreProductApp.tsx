import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoreProduct } from '../../types';
import { STORE_CATEGORIES, STORE_GAMES, STORE_PUBLIC_LAUNCH, STORE_VARIANT_KINDS } from '../../lib/storeConstants';
import { useCurrency } from '../../lib/currency';
import { translateStoreCategory, useLanguage } from '../../lib/i18n';
import { gameOf, isScheduledForFuture, isSoldOut, languageOf, msrpOf, releaseAtOf, subcategoryOf } from '../../lib/storeProducts';
import { addToStoreCart, effectiveMaxQuantity, useStoreCart } from '../../lib/storeCart';
import { StoreCartDrawer } from './StoreCartDrawer';
import { StoreProductForm } from './StoreProductForm';
import { StoreClosed, StoreSpinner } from './StoreStates';
import { storeApi, useStoreAuth } from './storeClient';

const slugFromUrl = () => new URLSearchParams(window.location.search).get('slug');

function Spec({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
      <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
      <dd className="font-semibold text-right" style={{ color: 'var(--text-primary)' }}>{value}</dd>
    </div>
  );
}

/**
 * One product at /store/product?slug=... Products that share a variant_group (colours, sets, sizes)
 * show a switcher: picking one swaps the page in place from the siblings already loaded, so there is
 * no reload and no trip back to the list.
 */
export function StoreProductApp() {
  const { loading: authLoading, isAdmin } = useStoreAuth();
  const { formatPrice } = useCurrency();
  const { lang, t } = useLanguage();
  const { totalItems: cartCount } = useStoreCart();
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [siblings, setSiblings] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [expandedDesc, setExpandedDesc] = useState(false);
  const [canExpandDesc, setCanExpandDesc] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // Admin inline edit modal
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Quantity stepper & Store Cart drawer
  const [qty, setQty] = useState(1);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);

  // Back-in-stock email notification subscription
  const [alertEmail, setAlertEmail] = useState('');
  const [alertSubmitting, setAlertSubmitting] = useState(false);
  const [alertStatus, setAlertStatus] = useState<{ ok: boolean; msg: string } | null>(null);

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
  }, [product?.id, product?.description]);

  const images = product?.images || [];

  const prevImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (images.length <= 1) return;
    setImageIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  };

  const nextImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (images.length <= 1) return;
    setImageIndex((i) => (i < images.length - 1 ? i + 1 : 0));
  };

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      else if (e.key === 'ArrowLeft') prevImage();
      else if (e.key === 'ArrowRight') nextImage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen, images.length]);

  const canView = STORE_PUBLIC_LAUNCH || isAdmin;

  const load = useCallback(async (slug: string) => {
    setLoading(true);
    const res = await storeApi<{ product?: StoreProduct; siblings?: StoreProduct[]; error?: string }>(
      `/api/store/products?slug=${encodeURIComponent(slug)}`
    );
    if (res.ok && res.data.product) {
      setProduct(res.data.product);
      setSiblings(res.data.siblings || []);
      setError(null);
    } else {
      setError({ status: res.status, message: res.data.error || 'Product not found.' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading || !canView) return;
    const slug = slugFromUrl();
    if (!slug) {
      setError({ status: 404, message: 'No product selected.' });
      setLoading(false);
      return;
    }
    load(slug);
  }, [authLoading, canView, load]);

  // Browser back/forward after switching variants.
  useEffect(() => {
    const onPop = () => {
      const slug = slugFromUrl();
      if (!slug) return;
      const known = siblings.find((s) => s.slug === slug);
      if (known) setProduct(known);
      else load(slug);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [siblings, load]);

  useEffect(() => {
    setImageIndex(0);
    setQty(1);
    setCartFeedback(null);
    setAlertStatus(null);
  }, [product?.id]);

  useEffect(() => {
    if (product) document.title = `${product.name} | Store | TCG XChange`;
  }, [product]);

  const switchTo = (next: StoreProduct) => {
    if (next.id === product?.id) return;
    setProduct(next);
    window.history.pushState({}, '', `/store/product?slug=${encodeURIComponent(next.slug)}`);
  };

  if (authLoading || (canView && loading)) return <StoreSpinner label={t('Loading product...', 'Termék betöltése...')} />;
  if (!canView || error?.status === 403) return <StoreClosed />;

  if (error || !product) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-black mb-2" style={{ color: 'var(--text-primary)' }}>{t('Product not found', 'A termék nem található')}</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>{error?.message}</p>
        <a href="/store" className="px-5 py-2.5 rounded-xl text-sm font-bold" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>
          {t('Back to the store', 'Vissza a bolthoz')}
        </a>
      </div>
    );
  }

  const soldOut = isSoldOut(product);
  const onSale = Boolean(product.original_price_huf && product.original_price_huf > product.price_huf);
  const rawCategory = STORE_CATEGORIES.find((c) => c.id === product.category)?.label || product.category;
  const category = translateStoreCategory(product.category, rawCategory, lang);
  const subcat = subcategoryOf(product);
  const msrpHuf = msrpOf(product);
  const scheduled = isScheduledForFuture(product);
  const releaseAt = releaseAtOf(product);
  const game = gameOf(product);
  const isRealGame = Boolean(product.game && product.game !== 'universal');
  const gameLabel = isRealGame ? (STORE_GAMES.find((g) => g.id === product.game)?.name || product.game) : null;
  const hasBrand = Boolean(product.brand && product.brand.trim() && product.brand !== 'None' && product.brand !== 'Default' && product.brand !== 'Other');
  const isLanguageVariant = product.variant_kind === 'language' || (product.variant_kind === 'other' && Boolean(product.attributes?.language));
  const kindDef = isLanguageVariant
    ? { id: 'language', label: 'Language' }
    : STORE_VARIANT_KINDS.find((k) => k.id === (product.variant_kind || 'other'));
  const kind = t(
    kindDef?.label || 'Option',
    kindDef?.id === 'language' ? 'Nyelv' :
    kindDef?.id === 'color' ? 'Szín' :
    kindDef?.id === 'size' ? 'Méret' :
    kindDef?.id === 'set' ? 'Kiadás' :
    'Változat'
  );
  const hasVariants = siblings.length > 1 && Boolean(product.variant_group);
  const maxPerOrder = product.attributes?.max_per_order ? Number(product.attributes.max_per_order) : null;
  const maxOrderable = effectiveMaxQuantity(product.stock_quantity, maxPerOrder);

  const handleAddToCart = () => {
    const res = addToStoreCart(product, qty);
    if (res.added > 0) {
      setCartFeedback(
        res.cappedByLimit
          ? t(`Added to cart (capped at max ${maxOrderable} per order).`, `Kosárba téve (max. ${maxOrderable} db / rendelés).`)
          : t(`Added ${res.added} to store cart.`, `${res.added} db a kosárba került.`)
      );
      setCartOpen(true);
    } else if (res.cappedByLimit) {
      setCartFeedback(
        t(
          `You already have the maximum allowed (${maxOrderable}) in your cart.`,
          `Már elérted a rendelhető maximális mennyiséget (${maxOrderable} db) a kosárban.`
        )
      );
      setCartOpen(true);
    }
  };

  const handleSubscribeBackInStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertEmail.trim()) return;
    setAlertSubmitting(true);
    setAlertStatus(null);
    try {
      const res = await fetch('/api/store/stock-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: alertEmail.trim(),
          product_id: product.id,
          product_name: product.name,
          product_slug: product.slug,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAlertStatus({
          ok: true,
          msg: data.alreadySubscribed
            ? t('You are already subscribed for back-in-stock alerts on this product.', 'Már feliratkoztál erre a termékre.')
            : t('We will email you as soon as this product is back in stock!', 'E-mailben értesítünk, amint a termék újra raktáron lesz!'),
        });
        setAlertEmail('');
      } else {
        setAlertStatus({ ok: false, msg: data.error || t('Could not subscribe.', 'Nem sikerült a feliratkozás.') });
      }
    } catch {
      setAlertStatus({ ok: false, msg: t('Network error subscribing to alert.', 'Hálózati hiba történt.') });
    } finally {
      setAlertSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8">

      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
          <a href="/store" className="hover:underline cursor-pointer" style={{ color: 'var(--text-muted)' }}>{t('Store', 'Bolt')}</a>
          <span>/</span>
          <a href={`/store?category=${encodeURIComponent(product.category)}`} className="hover:underline cursor-pointer" style={{ color: 'var(--text-muted)' }}>
            {category}
          </a>
          {subcat && (
            <>
              <span>/</span>
              <a href={`/store?category=${encodeURIComponent(product.category)}&subcategory=${encodeURIComponent(subcat)}`} className="hover:underline cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                {subcat}
              </a>
            </>
          )}
          {isRealGame && gameLabel && (
            <>
              <span>/</span>
              <a href={`/store?category=${encodeURIComponent(product.category)}&game=${encodeURIComponent(product.game!)}`} className="hover:underline cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                {gameLabel}
              </a>
            </>
          )}
          {hasBrand && (
            <>
              <span>/</span>
              <a href={`/store?brand=${encodeURIComponent(product.brand)}`} className="hover:underline cursor-pointer font-semibold" style={{ color: 'var(--text-secondary)' }}>
                {product.brand}
              </a>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition hover:brightness-110"
              style={{ background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              <span>Edit product</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition hover:border-[var(--border-hover)]"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          >
            <svg className="w-3.5 h-3.5" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            <span>{t('Cart', 'Kosár')} ({cartCount})</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-10">
        {/* Gallery */}
        <div>
          <div
            className={`relative group aspect-square w-full rounded-2xl border overflow-hidden flex items-center justify-center ${images.length > 0 ? 'cursor-zoom-in' : ''} ${soldOut ? 'store-sold-out-frame' : ''}`}
            onClick={() => images.length > 0 && setLightboxOpen(true)}
            style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
            title={images.length > 0 ? t('Click to view fullscreen', 'Kattints a teljes képernyős nézethez') : undefined}
          >
            {images[imageIndex] ? (
              <img src={images[imageIndex]} alt={product.name} className={`w-full h-full object-contain p-4 transition duration-300 ${soldOut ? 'store-sold-out-img' : ''}`} />
            ) : (
              <svg className="w-16 h-16 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            )}
            <div className="absolute top-3 left-3 flex flex-col gap-1 items-start pointer-events-none">
              {onSale && (
                <span className="text-[11px] font-black px-2.5 py-0.5 rounded-md shadow-xs" style={{ background: 'var(--negative)', color: '#fff' }}>
                  {t('SALE', 'AKCIÓ')}
                </span>
              )}
              {soldOut && (
                <span
                  className="text-[11px] font-bold px-2.5 py-0.5 rounded-md border shadow-xs backdrop-blur-md"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
                >
                  {t('Sold out', 'Elfogyott')}
                </span>
              )}
            </div>

            {/* Gallery Navigation Arrows */}
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={prevImage}
                  aria-label="Previous image"
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
                  aria-label="Next image"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full border flex items-center justify-center transition opacity-80 hover:opacity-100 hover:scale-105 cursor-pointer shadow-md"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <span className="absolute bottom-2.5 right-2.5 text-[10px] font-bold px-2 py-0.5 rounded-full border backdrop-blur-xs" style={{ background: 'rgba(0,0,0,0.6)', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}>
                  {imageIndex + 1} / {images.length}
                </span>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {images.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setImageIndex(i)}
                  aria-label={`Show image ${i + 1}`}
                  aria-current={i === imageIndex}
                  className="w-16 h-16 shrink-0 rounded-lg border overflow-hidden cursor-pointer"
                  style={{ borderColor: i === imageIndex ? 'var(--accent)' : 'var(--border)', background: 'var(--bg-surface-2)' }}
                >
                  <img src={src} alt="" className="w-full h-full object-contain p-1" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="min-w-0">
          {(product.status === 'draft' || scheduled) && (
            <div className="mb-4 p-3 rounded-xl border flex items-center justify-between gap-3 text-xs flex-wrap" style={{ background: 'rgba(234, 179, 8, 0.15)', borderColor: 'rgba(234, 179, 8, 0.45)', color: 'var(--text-primary)' }}>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider text-black bg-amber-400">
                  {scheduled ? 'SCHEDULED' : 'DRAFT'}
                </span>
                <span className="font-bold">
                  {scheduled && releaseAt
                    ? `Timed release: goes live on ${new Date(releaseAt).toLocaleString()}`
                    : 'Admin preview only · Hidden from shoppers'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="underline font-bold hover:opacity-80 cursor-pointer"
              >
                Edit now
              </button>
            </div>
          )}
          {hasBrand && (
            <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-accent)' }}>{product.brand}</p>
          )}
          <h1 className="text-2xl sm:text-3xl font-black leading-tight mb-3" style={{ color: 'var(--text-primary)' }}>{product.name}</h1>

          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <span className="text-3xl font-black text-[var(--positive)]">{formatPrice(product.price_huf)}</span>
            {onSale && <span className="text-base line-through" style={{ color: 'var(--text-placeholder)' }}>{formatPrice(product.original_price_huf!)}</span>}
            {msrpHuf && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                MSRP: {formatPrice(msrpHuf)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border"
              style={
                soldOut
                  ? { borderColor: 'var(--negative-border)', background: 'var(--negative-muted)', color: 'var(--negative)' }
                  : product.stock_quantity <= 3
                  ? { borderColor: 'rgba(217, 119, 6, 0.45)', background: 'rgba(245, 158, 11, 0.16)', color: 'var(--text-primary)' }
                  : { borderColor: 'var(--positive-border)', background: 'var(--positive-muted)', color: 'var(--positive)' }
              }
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: soldOut ? 'var(--negative)' : product.stock_quantity <= 3 ? '#d97706' : 'var(--positive)' }} />
              {soldOut ? t('Out of stock', 'Elfogyott') : t(`${product.stock_quantity} in stock`, `${product.stock_quantity} db raktáron`)}
            </span>
            {maxPerOrder && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border"
                style={{ borderColor: 'var(--accent-border)', background: 'var(--accent-muted)', color: 'var(--text-primary)' }}
              >
                {t(`Limit: Max ${maxPerOrder} per customer`, `Limit: max. ${maxPerOrder} db / rendelés`)}
              </span>
            )}
          </div>

          {hasVariants && (
            <div className="mb-6">
              <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
                {kind}: <span style={{ color: 'var(--text-primary)' }}>{product.variant_label}</span>
              </p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Choose ${kind.toLowerCase()}`}>
                {siblings.map((s) => {
                  const selected = s.id === product.id;
                  const out = isSoldOut(s);
                  return (
                    <a
                      key={s.id}
                      href={`/store/product?slug=${encodeURIComponent(s.slug)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        switchTo(s);
                      }}
                      aria-current={selected ? 'true' : undefined}
                      className="px-3.5 py-2 rounded-xl border text-xs font-bold transition cursor-pointer hover:border-[var(--border-hover)]"
                      style={
                        selected
                          ? { background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }
                          : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: out ? 'var(--text-placeholder)' : 'var(--text-secondary)', textDecoration: out ? 'line-through' : 'none' }
                      }
                      title={out ? `${s.variant_label} - ${t('sold out', 'elfogyott')}` : s.variant_label || undefined}
                    >
                      {s.variant_label}
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {!soldOut && maxOrderable > 0 ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-3 flex-wrap">
                <div
                  className="inline-flex items-center rounded-xl border overflow-hidden"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}
                  aria-label="Quantity selector"
                >
                  <button
                    type="button"
                    disabled={qty <= 1}
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="w-10 h-11 flex items-center justify-center text-sm font-black cursor-pointer hover:bg-[var(--bg-raised)] disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: 'var(--text-primary)' }}
                    aria-label="Decrease quantity"
                  >
                    -
                  </button>
                  <span className="px-4 text-sm font-black tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {qty}
                  </span>
                  <button
                    type="button"
                    disabled={qty >= maxOrderable}
                    onClick={() => setQty((q) => Math.min(maxOrderable, q + 1))}
                    className="w-10 h-11 flex items-center justify-center text-sm font-black cursor-pointer hover:bg-[var(--bg-raised)] disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: 'var(--text-primary)' }}
                    title={
                      qty >= maxOrderable
                        ? maxPerOrder && maxOrderable === maxPerOrder
                          ? t(`Limited to maximum ${maxPerOrder} per customer`, `Maximum ${maxPerOrder} db rendelhető`)
                          : t(`Maximum ${product.stock_quantity} in stock`, `Maximum ${product.stock_quantity} db van raktáron`)
                        : t('Increase quantity', 'Mennyiség növelése')
                    }
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleAddToCart}
                  className="flex-1 sm:flex-initial px-6 py-3 rounded-xl text-sm font-bold cursor-pointer transition hover:brightness-110 shadow-sm"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  {t('Add to Store Cart', 'Kosárba teszem')}
                </button>
              </div>
              {cartFeedback && (
                <p className="text-xs font-semibold" style={{ color: 'var(--text-accent)' }}>
                  {cartFeedback}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                disabled
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold opacity-60 cursor-not-allowed"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                {t('Currently Out of Stock', 'Jelenleg nincs raktáron')}
              </button>

              {/* Back-in-Stock Email Notification Subscription Box */}
              <div className="p-4 rounded-2xl border space-y-2.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0" style={{ color: 'var(--text-accent)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {t('Notify me when back in stock', 'Értesítést kérek, ha újra raktáron van')}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    'Enter your email to receive an automatic alert as soon as new inventory arrives.',
                    'Add meg az e-mail címed, és automatikusan értesítünk, amint újra érkezik készlet.'
                  )}
                </p>
                {alertStatus && (
                  <p
                    className="text-xs font-semibold"
                    style={{ color: alertStatus.ok ? 'var(--positive)' : 'var(--negative)' }}
                  >
                    {alertStatus.msg}
                  </p>
                )}
                <form onSubmit={handleSubscribeBackInStock} className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <input
                    type="email"
                    required
                    value={alertEmail}
                    onChange={(e) => setAlertEmail(e.target.value)}
                    placeholder="you@example.com"
                    aria-label="Email for back-in-stock notification"
                    className="flex-1 min-w-0 px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                  <button
                    type="submit"
                    disabled={alertSubmitting}
                    className="px-4 py-2 rounded-xl text-xs font-bold cursor-pointer shrink-0 disabled:opacity-50"
                    style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                  >
                    {alertSubmitting ? t('Saving...', 'Mentés...') : t('Notify me', 'Értesítést kérek')}
                  </button>
                </form>
              </div>
            </div>
          )}

          {product.description && (
            <div className="mt-6">
              <p
                ref={descRef}
                className={`text-sm leading-relaxed whitespace-pre-line ${expandedDesc ? '' : 'line-clamp-3'}`}
                style={{ color: 'var(--text-secondary)' }}
              >
                {product.description}
              </p>
              {canExpandDesc && (
                <button
                  type="button"
                  onClick={() => setExpandedDesc((prev) => !prev)}
                  className="text-xs font-bold mt-2 underline underline-offset-2 cursor-pointer hover:opacity-80 block"
                  style={{ color: 'var(--text-accent)' }}
                >
                  {expandedDesc ? t('Show less', 'Kevesebb') : t('Read more', 'Bővebben')}
                </button>
              )}
            </div>
          )}

          <dl className="mt-6">
            <Spec label={t('Category', 'Kategória')} value={category} />
            {subcat && <Spec label={t('Product type', 'Terméktípus')} value={subcat} />}
            {isRealGame && gameLabel && <Spec label={t('Game', 'Játék')} value={gameLabel} />}
            {hasBrand && <Spec label={t('Brand', 'Márka')} value={product.brand} />}
            {msrpHuf && <Spec label={t('MSRP', 'Ajánlott fogy. ár')} value={formatPrice(msrpHuf)} />}
            <Spec label={t('Stock', 'Készlet')} value={soldOut ? t('0 units (out of stock)', '0 db (elfogyott)') : t(`${product.stock_quantity} units available`, `${product.stock_quantity} db elérhető`)} />
            {maxPerOrder && <Spec label={t('Order limit', 'Rendelési limit')} value={t(`Max ${maxPerOrder} per customer`, `Max. ${maxPerOrder} db / rendelés`)} />}
            <Spec label={t('Size', 'Méret')} value={product.attributes?.size} />
            <Spec label={t('Color', 'Szín')} value={product.attributes?.color} />
            <Spec label={t('Language', 'Nyelv')} value={languageOf(product)} />
            <Spec label={t('SKU', 'Cikkszám')} value={product.sku} />
            <Spec label={t('EAN', 'Vonalkód (EAN)')} value={product.ean} />
          </dl>

        </div>
      </div>

      <StoreCartDrawer open={cartOpen} onClose={() => setCartOpen(false)} onOpen={() => setCartOpen(true)} />

      {isAdmin && editModalOpen && (
        <StoreProductForm
          product={product}
          existingGroups={product.variant_group ? [product.variant_group] : []}
          existingBrands={product.brand ? [product.brand] : []}
          onClose={() => setEditModalOpen(false)}
          onSaved={() => {
            setEditModalOpen(false);
            load(product.slug);
          }}
        />
      )}

      {/* Lightbox Fullscreen Modal */}
      {lightboxOpen && images[imageIndex] && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close fullscreen view"
            className="absolute top-4 right-4 p-2.5 rounded-full border cursor-pointer hover:bg-white/10 text-white z-10 transition"
            style={{ borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.5)' }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div className="relative max-w-4xl max-h-[85vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img src={images[imageIndex]} alt={product.name} className="max-w-full max-h-[85vh] object-contain rounded-xl select-none" />
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={prevImage}
                  aria-label="Previous image"
                  className="absolute left-2 sm:-left-12 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full border flex items-center justify-center transition hover:scale-110 cursor-pointer text-white shadow-xl"
                  style={{ background: 'rgba(0,0,0,0.7)', borderColor: 'rgba(255,255,255,0.2)' }}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={nextImage}
                  aria-label="Next image"
                  className="absolute right-2 sm:-right-12 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full border flex items-center justify-center transition hover:scale-110 cursor-pointer text-white shadow-xl"
                  style={{ background: 'rgba(0,0,0,0.7)', borderColor: 'rgba(255,255,255,0.2)' }}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
