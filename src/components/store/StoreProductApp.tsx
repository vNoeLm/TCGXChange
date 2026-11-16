import { useCallback, useEffect, useState } from 'react';
import type { StoreProduct } from '../../types';
import { STORE_CATEGORIES, STORE_GAMES, STORE_PUBLIC_LAUNCH, STORE_VARIANT_KINDS } from '../../lib/storeConstants';
import { useCurrency } from '../../lib/currency';
import { translateStoreCategory, useLanguage } from '../../lib/i18n';
import { dedupeSingleSku, isScheduledForFuture, isSoldOut, languageOf, msrpOf, releaseAtOf, subcategoryOf } from '../../lib/storeProducts';
import { formatCondition } from '../../lib/collectionDefaults';
import { addToStoreCart, effectiveMaxQuantity, useStoreCart } from '../../lib/storeCart';
import { customerLimitFor, orderCapFor } from '../../lib/purchaseLimits';
import { UnifiedProductDetail, type BreadcrumbItem } from '../product/UnifiedProductDetail';
import { StoreCartDrawer } from './StoreCartDrawer';
import { StoreProductForm } from './StoreProductForm';
import { StoreClosed, StorePreviewBanner, StoreSpinner } from './StoreStates';
import { storeApi, useStoreAuth } from './storeClient';

const slugFromUrl = () => new URLSearchParams(window.location.search).get('slug');

export function StoreProductApp() {
  const { loading: authLoading, isAdmin } = useStoreAuth();
  const { formatPrice } = useCurrency();
  const { lang, t } = useLanguage();
  const { totalItems: cartCount } = useStoreCart();

  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [siblings, setSiblings] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);

  const [alertEmail, setAlertEmail] = useState('');
  const [alertSubmitting, setAlertSubmitting] = useState(false);
  const [alertStatus, setAlertStatus] = useState<{ ok: boolean; msg: string } | null>(null);

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
      setError({ status: res.status, message: res.data.error || t('Product not found.', 'A termék nem található.') });
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    if (authLoading || !canView) return;
    const slug = slugFromUrl();
    if (!slug) {
      setError({ status: 404, message: t('No product selected.', 'Nincs kiválasztott termék.') });
      setLoading(false);
      return;
    }
    load(slug);
  }, [authLoading, canView, load, t]);

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
  const isRealGame = Boolean(product.game && product.game !== 'universal');
  const gameLabel = isRealGame ? (STORE_GAMES.find((g) => g.id === product.game)?.name || product.game) : null;
  const hasBrand = Boolean(product.brand && product.brand.trim() && product.brand !== 'None' && product.brand !== 'Default' && product.brand !== 'Other');
  const isLanguageVariant = product.variant_kind === 'language' || (product.variant_kind === 'other' && Boolean(product.attributes?.language));
  const kindDef = isLanguageVariant
    ? { id: 'language', label: 'Language' }
    : STORE_VARIANT_KINDS.find((k) => k.id === (product.variant_kind || 'other'));
  const kind =
    product.category === 'singles' && kindDef?.id === 'other'
      ? t('Edition / Version', 'Kiadás / Változat')
      : t(
          kindDef?.label || 'Option',
          kindDef?.id === 'language' ? 'Nyelv' :
          kindDef?.id === 'color' ? 'Szín' :
          kindDef?.id === 'size' ? 'Méret' :
          kindDef?.id === 'set' ? 'Kiadás' :
          'Változat'
        );
  const hasVariants = siblings.length > 1 && Boolean(product.variant_group);
  const orderedSiblings =
    product.category === 'singles' && siblings.length > 1
      ? [...siblings].sort((a, b) => Number(isSoldOut(a)) - Number(isSoldOut(b)) || a.price_huf - b.price_huf)
      : siblings;
  const orderCap = orderCapFor(product.attributes);
  const { maxPerCustomer, windowDays: limitWindowDays } = customerLimitFor(product.attributes);
  const maxOrderable = effectiveMaxQuantity(product.stock_quantity, orderCap);
  const customerLimitText = maxPerCustomer
    ? limitWindowDays > 0
      ? t(`Max ${maxPerCustomer} per customer / ${limitWindowDays} days`, `Max. ${maxPerCustomer} db / vásárló / ${limitWindowDays} nap`)
      : t(`Max ${maxPerCustomer} per customer`, `Max. ${maxPerCustomer} db / vásárló`)
    : null;

  const handleAddToCart = () => {
    const res = addToStoreCart(product, qty);
    if (res.added > 0) {
      if (res.cappedByLimit) {
        setCartFeedback(
          res.capReason === 'customer_limit'
            ? t(`Added to cart (maximum ${maxOrderable}).`, `Kosárba téve (max. ${maxOrderable} db).`)
            : t(`Added to cart (maximum available stock: ${maxOrderable} in cart).`, `Kosárba téve (összes elérhető készlet: ${maxOrderable} db a kosárban).`)
        );
      } else {
        setCartFeedback(t(`Added ${res.added} to store cart.`, `${res.added} db a kosárba került.`));
      }
    } else if (res.cappedByLimit) {
      setCartFeedback(
        res.capReason === 'customer_limit'
          ? t(`You already have the maximum allowed (${maxOrderable}) in your cart.`, `Már elérted a maximális mennyiséget (${maxOrderable} db) a kosárban.`)
          : t(`You already have all available stock (${maxOrderable} in stock) in your cart.`, `Már az összes elérhető raktárkészlet (${maxOrderable} db) a kosaradban van.`)
      );
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
            : t('We will email you as soon as this product is back in stock!', 'E-mailben értesítünk, amint újra raktáron lesz!'),
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

  const breadcrumbs: BreadcrumbItem[] = [
    { label: t('Store', 'Bolt'), href: '/store' },
    { label: category, href: `/store?category=${encodeURIComponent(product.category)}` },
    ...(isRealGame && gameLabel
      ? [{ label: gameLabel, href: `/store?category=${encodeURIComponent(product.category)}&game=${encodeURIComponent(product.game!)}` }]
      : []),
    ...(subcat
      ? [{ label: subcat, href: `/store?category=${encodeURIComponent(product.category)}&subcategory=${encodeURIComponent(subcat)}` }]
      : []),
    ...(hasBrand && product.category !== 'singles' && product.brand !== subcat
      ? [{ label: product.brand, href: `/store?brand=${encodeURIComponent(product.brand)}` }]
      : []),
    { label: product.name },
  ];

  const eyebrow =
    product.category === 'singles'
      ? [product.attributes?.set_name, product.attributes?.card_number].filter(Boolean).join(' · ') || null
      : hasBrand
      ? product.brand
      : null;

  return (
    <UnifiedProductDetail
      topBanner={!STORE_PUBLIC_LAUNCH && isAdmin ? <StorePreviewBanner /> : undefined}
      breadcrumbs={breadcrumbs}
      topRightActions={
        <>
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
              <span>{t('Edit product', 'Termék szerkesztése')}</span>
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
        </>
      }
      images={product.images || []}
      alt={product.name}
      soldOut={soldOut}
      fallbackLabel={product.brand && product.brand !== 'Default' && product.brand !== 'None' ? product.brand : (product.category || t('Product', 'Termék'))}
      imageTopLeftBadges={
        <>
          {onSale && (
            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-md shadow-xs" style={{ background: 'var(--negative)', color: '#fff' }}>
              {t('SALE', 'AKCIÓ')}
            </span>
          )}
          {soldOut && (
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-md border shadow-xs backdrop-blur-md" style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
              {t('Sold out', 'Elfogyott')}
            </span>
          )}
        </>
      }
      adminBanner={
        (product.status === 'draft' || scheduled) ? (
          <div className="p-3 rounded-xl border flex items-center justify-between gap-3 text-xs flex-wrap" style={{ background: 'rgba(234, 179, 8, 0.15)', borderColor: 'rgba(234, 179, 8, 0.45)', color: 'var(--text-primary)' }}>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider text-black bg-amber-400">
                {scheduled ? t('SCHEDULED', 'IDŐZÍTETT') : t('DRAFT', 'VÁZLAT')}
              </span>
              <span className="font-bold">
                {scheduled && releaseAt
                  ? t(`Timed release: ${new Date(releaseAt).toLocaleString()}`, `Időzített megjelenés: ${new Date(releaseAt).toLocaleString()}`)
                  : t('Admin preview only', 'Csak admin előnézet')}
              </span>
            </div>
            <button type="button" onClick={() => setEditModalOpen(true)} className="underline font-bold cursor-pointer">
              {t('Edit now', 'Szerkesztés')}
            </button>
          </div>
        ) : undefined
      }
      eyebrow={eyebrow}
      title={product.name}
      priceHuf={product.price_huf}
      originalPriceHuf={product.original_price_huf}
      msrpLabel={msrpHuf ? `${t('MSRP', 'Ajánlott fogy. ár')}: ${formatPrice(msrpHuf)}` : null}
      stockText={
        soldOut
          ? t('Out of stock', 'Elfogyott')
          : t(`${product.stock_quantity} in stock`, `${product.stock_quantity} db raktáron`) + (customerLimitText ? ` · ${customerLimitText}` : '')
      }
      stockTone={soldOut ? 'negative' : product.stock_quantity <= 3 ? 'low' : 'positive'}
      cardDetailsId={product.category === 'singles' && product.attributes?.card_id ? String(product.attributes.card_id) : null}
      cardDetailsHref={product.category === 'singles' && !product.attributes?.card_id ? `/cards?q=${encodeURIComponent(product.name)}` : null}
      condition={product.category === 'singles' && product.attributes?.condition ? String(product.attributes.condition) : null}
      middleSlot={
        hasVariants ? (
          <div>
            <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
              {kind}: <span style={{ color: 'var(--text-primary)' }}>{product.variant_label}</span>
            </p>
            <div className="flex flex-wrap gap-2" role="group">
              {orderedSiblings.map((s) => {
                const selected = s.id === product.id;
                const out = isSoldOut(s);
                const isSingle = s.category === 'singles';
                const thumb = isSingle ? s.images?.[0] : undefined;
                return (
                  <a
                    key={s.id}
                    href={`/store/product?slug=${encodeURIComponent(s.slug)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      switchTo(s);
                    }}
                    aria-current={selected ? 'true' : undefined}
                    className={`inline-flex items-center gap-2 rounded-xl border text-xs font-bold transition cursor-pointer hover:border-[var(--border-hover)] ${
                      thumb ? 'pl-1.5 pr-3 py-1.5' : 'px-3.5 py-2'
                    }`}
                    style={
                      selected
                        ? { background: 'var(--accent-muted)', borderColor: 'var(--accent)', color: 'var(--text-accent)' }
                        : { background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: out ? 'var(--text-placeholder)' : 'var(--text-secondary)', textDecoration: out ? 'line-through' : 'none' }
                    }
                  >
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        className={`w-6 h-8 rounded object-cover shrink-0 border ${out ? 'opacity-45 grayscale' : ''}`}
                        style={{ borderColor: 'var(--border-subtle)' }}
                      />
                    )}
                    <span>{s.variant_label}</span>
                    {isSingle && (
                      <span
                        className="text-[11px] font-black tabular-nums opacity-85"
                        style={{ color: selected ? 'var(--text-accent)' : out ? 'var(--text-placeholder)' : 'var(--positive)' }}
                      >
                        {formatPrice(s.price_huf)}
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          </div>
        ) : undefined
      }
      actions={
        !soldOut && maxOrderable > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <div
                className="inline-flex items-center rounded-xl border overflow-hidden"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-surface-2)' }}
              >
                <button
                  type="button"
                  disabled={qty <= 1}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-10 h-11 flex items-center justify-center text-sm font-black cursor-pointer hover:bg-[var(--bg-raised)] disabled:opacity-40"
                  style={{ color: 'var(--text-primary)' }}
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
                  className="w-10 h-11 flex items-center justify-center text-sm font-black cursor-pointer hover:bg-[var(--bg-raised)] disabled:opacity-40"
                  style={{ color: 'var(--text-primary)' }}
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
              {alertStatus && (
                <p className="text-xs font-semibold" style={{ color: alertStatus.ok ? 'var(--positive)' : 'var(--negative)' }}>
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
        )
      }
      description={product.description}
      specs={[
        { label: t('Category', 'Kategória'), value: category },
        { label: t('Game', 'Játék'), value: isRealGame ? gameLabel : null },
        {
          label: product.category === 'singles' ? t('Set', 'Kiadás') : t('Product type', 'Terméktípus'),
          value: product.category === 'singles' ? (product.attributes?.set_name ? String(product.attributes.set_name) : null) : subcat,
        },
        { label: t('Card Number', 'Kártyaszám'), value: product.category === 'singles' ? (product.attributes?.card_number ? String(product.attributes.card_number) : null) : null },
        { label: t('Rarity', 'Ritkaság'), value: product.category === 'singles' ? (product.attributes?.rarity ? String(product.attributes.rarity) : null) : null },
        { label: t('Condition', 'Állapot'), value: product.category === 'singles' && product.attributes?.condition ? formatCondition(String(product.attributes.condition), lang) : null },
        { label: t('Finish', 'Kivitel'), value: product.category === 'singles' ? (product.attributes?.is_foil ? 'Foil' : t('Normal', 'Normál')) : null },
        { label: t('Brand', 'Márka'), value: hasBrand && product.category !== 'singles' && product.brand !== subcat ? product.brand : null },
        { label: t('MSRP', 'Ajánlott fogy. ár'), value: msrpHuf ? formatPrice(msrpHuf) : null },
        { label: t('Stock', 'Készlet'), value: soldOut ? t('0 units (out of stock)', '0 db (elfogyott)') : t(`${product.stock_quantity} units available`, `${product.stock_quantity} db elérhető`) },
        { label: t('Customer limit', 'Vásárlói limit'), value: customerLimitText },
        { label: t('Size', 'Méret'), value: product.attributes?.size ? String(product.attributes.size) : null },
        { label: t('Color', 'Szín'), value: product.attributes?.color ? String(product.attributes.color) : null },
        { label: t('Language', 'Nyelv'), value: languageOf(product) },
        { label: t('SKU', 'Cikkszám'), value: dedupeSingleSku(product.sku) || product.sku },
        { label: t('EAN', 'Vonalkód (EAN)'), value: product.ean },
      ]}
    >
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
    </UnifiedProductDetail>
  );
}
