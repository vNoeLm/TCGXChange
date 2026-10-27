import React, { useEffect } from 'react';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import type { GenericCartItem } from '../../lib/genericCart';
import { cardThumbProps } from '../../lib/supabase';

export interface GenericCartSellerGroup<T = any> {
  sellerId: string;
  sellerName: string;
  subtotal: number;
  items: GenericCartItem[];
  meta?: T;
}

export interface GenericCartDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  totalCount: number;
  onClear?: () => void;
  items?: GenericCartItem[];
  onUpdateQuantity?: (id: string, nextQty: number) => void;
  onRemoveItem?: (id: string) => void;

  // Multi-seller support
  groupBySeller?: boolean;
  sellerGroups?: GenericCartSellerGroup[];
  renderSellerHeader?: (group: GenericCartSellerGroup) => React.ReactNode;
  renderSellerControls?: (group: GenericCartSellerGroup) => React.ReactNode;

  // Empty state customisation
  emptyTitle?: string;
  emptySubtitle?: string;
  emptyAction?: { label: string; href?: string; onClick?: () => void };

  // Slots
  topBanner?: React.ReactNode;
  extraContent?: React.ReactNode;
  results?: React.ReactNode;

  // Footer / Pricing
  subtotalHuf: number;
  shippingFeeHuf?: number;
  shippingFeeLabel?: string;
  shippingMethodSelector?: React.ReactNode;
  grandTotalHuf?: number;
  disclaimer?: React.ReactNode;
  checkoutButton?: React.ReactNode;

  // Floating trigger button
  floatingButton?: boolean;
  onOpen?: () => void;
  bumpKey?: number;
}

/** Reusable line item component used across Store and Marketplace drawers. */
export function GenericCartLineItem({
  item,
  onUpdateQuantity,
  onRemoveItem,
}: {
  item: GenericCartItem;
  onUpdateQuantity?: (id: string, nextQty: number) => void;
  onRemoveItem?: (id: string) => void;
}) {
  const { formatPrice } = useCurrency();
  const { t } = useLanguage();
  const atLimit = item.quantity >= item.maxQuantity;
  const atMin = item.quantity <= 1;
  const thumb = item.imagePath ? cardThumbProps(item.imagePath, 'avatar') : null;
  const renderThumbnail = () => {
    if (thumb) {
      return <img {...thumb} alt={item.name} className="w-full h-full object-contain p-1" />;
    }
    if (item.image) {
      return <img src={item.image} alt={item.name} className="w-full h-full object-contain p-1" />;
    }
    return (
      <svg className="w-6 h-6 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      </svg>
    );
  };

  return (
    <div
      key={item.id}
      className="flex gap-3 p-3 rounded-xl border transition-colors"
      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)' }}
    >
      {/* Thumbnail */}
      {item.url ? (
        <a
          href={item.url}
          className="w-16 h-16 rounded-lg border shrink-0 overflow-hidden flex items-center justify-center transition hover:opacity-90"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          {renderThumbnail()}
        </a>
      ) : (
        <div
          className="w-16 h-16 rounded-lg border shrink-0 overflow-hidden flex items-center justify-center"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        >
          {renderThumbnail()}
        </div>
      )}

      {/* Item info & actions */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          {item.url ? (
            <a
              href={item.url}
              className="text-xs font-bold line-clamp-2 hover:underline"
              style={{ color: 'var(--text-primary)' }}
            >
              {item.name}
            </a>
          ) : (
            <span className="text-xs font-bold line-clamp-2" style={{ color: 'var(--text-primary)' }}>
              {item.name}
            </span>
          )}

          {onRemoveItem && (
            <button
              type="button"
              onClick={() => onRemoveItem(item.id)}
              aria-label={`Remove ${item.name}`}
              className="p-1 rounded hover:bg-[var(--bg-raised)] cursor-pointer shrink-0 transition text-[var(--text-muted)] hover:text-[var(--negative)]"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {item.subtitle && (
          <span className="inline-block text-[10px] font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {item.subtitle}
          </span>
        )}

        {item.badge && (
          <span className="block text-[10px] font-bold mt-0.5" style={{ color: 'var(--text-accent)' }}>
            {item.badge}
          </span>
        )}

        {/* Stepper + Total */}
        <div className="flex items-center justify-between gap-2 mt-2">
          {onUpdateQuantity && (
            <div
              className="inline-flex items-center rounded-lg border overflow-hidden"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
            >
              <button
                type="button"
                disabled={atMin}
                onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                className="w-7 h-7 flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)] disabled:opacity-40 disabled:cursor-not-allowed transition"
                style={{ color: 'var(--text-secondary)' }}
                aria-label="Decrease quantity"
              >
                -
              </button>
              <span className="px-2.5 text-xs font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {item.quantity}
              </span>
              <button
                type="button"
                disabled={atLimit}
                onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                className="w-7 h-7 flex items-center justify-center text-xs font-bold cursor-pointer hover:bg-[var(--bg-raised)] disabled:opacity-40 disabled:cursor-not-allowed transition"
                style={{ color: 'var(--text-secondary)' }}
                title={
                  atLimit
                    ? t(`Maximum ${item.maxQuantity} available`, `Legfeljebb ${item.maxQuantity} db érhető el`)
                    : t('Increase quantity', 'Mennyiség növelése')
                }
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
          )}

          <span className="text-xs font-black tabular-nums" style={{ color: 'var(--positive)' }}>
            {formatPrice(item.priceHuf * item.quantity)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Generic Cart Drawer supporting both the official B2C webstore and
 * the peer-to-peer C2C marketplace.
 */
export function GenericCartDrawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  totalCount,
  onClear,
  items = [],
  onUpdateQuantity,
  onRemoveItem,
  groupBySeller = false,
  sellerGroups = [],
  renderSellerHeader,
  renderSellerControls,
  emptyTitle,
  emptySubtitle,
  emptyAction,
  topBanner,
  extraContent,
  results,
  subtotalHuf,
  shippingFeeHuf = 0,
  shippingFeeLabel,
  shippingMethodSelector,
  grandTotalHuf,
  disclaimer,
  checkoutButton,
  floatingButton = false,
  onOpen,
  bumpKey = 0,
}: GenericCartDrawerProps) {
  const { formatPrice } = useCurrency();
  const { t } = useLanguage();

  // Close on Escape key press
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Lock background scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const resolvedGrandTotal = grandTotalHuf !== undefined ? grandTotalHuf : subtotalHuf + shippingFeeHuf;
  const hasItems = totalCount > 0 || items.length > 0;

  return (
    <>
      {/* Optional Floating Trigger Button */}
      {floatingButton && !open && hasItems && onOpen && (
        <button
          type="button"
          key={bumpKey}
          onClick={onOpen}
          className={`${bumpKey > 0 ? 'tv-bump ' : ''}fixed bottom-24 right-4 z-40 flex items-center gap-2 px-4 py-3 rounded-full shadow-2xl cursor-pointer transition active:scale-95 border`}
          style={{ background: 'var(--accent-strong)', borderColor: 'var(--accent)', color: 'var(--text-on-accent, #000)' }}
          aria-label={t('Open cart', 'Kosár megnyitása')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          <span className="text-xs font-black">
            {totalCount} {totalCount === 1 ? t('item', 'tétel') : t('items', 'tétel')} · {formatPrice(subtotalHuf)}
          </span>
        </button>
      )}

      {/* Drawer Overlay */}
      {open && (
        <div className="fixed inset-0 z-[150] flex justify-end">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-label={title || t('Cart', 'Kosár')}
            className="relative z-10 w-full max-w-md h-full flex flex-col border-l shadow-2xl animate-in slide-in-from-right duration-200"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 border-b shrink-0"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2.5">
                {icon || (
                  <svg
                    className="w-5 h-5 shrink-0"
                    style={{ color: 'var(--text-accent)' }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                  </svg>
                )}
                <div>
                  <h2 className="text-sm font-black flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                    <span>{title || t('Cart', 'Kosár')}</span>
                    {totalCount > 0 && (
                      <span
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-black"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {totalCount}
                      </span>
                    )}
                  </h2>
                  {subtitle && (
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {hasItems && onClear && (
                  <button
                    type="button"
                    onClick={onClear}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer hover:bg-[var(--bg-raised)] transition"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    {t('Clear', 'Ürítés')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('Close cart', 'Kosár bezárása')}
                  className="p-2 rounded-xl border cursor-pointer hover:bg-[var(--bg-raised)] transition"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Optional Top Banner (e.g. Free shipping progress) */}
            {topBanner}

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {results}

              {!hasItems && !results ? (
                /* Empty state */
                <div className="py-16 text-center">
                  <svg
                    className="w-12 h-12 mx-auto mb-3 opacity-30"
                    style={{ color: 'var(--text-muted)' }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                  </svg>
                  <p className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                    {emptyTitle || t('Your cart is empty', 'A kosarad jelenleg üres')}
                  </p>
                  <p className="text-xs mb-6 max-w-xs mx-auto" style={{ color: 'var(--text-muted)' }}>
                    {emptySubtitle || t('Browse products or cards to add items to your cart.', 'Böngéssz a termékek és kártyák között tételek hozzáadásához.')}
                  </p>
                  {emptyAction && (
                    <a
                      href={emptyAction.href || '#'}
                      onClick={emptyAction.onClick}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition hover:border-[var(--accent)]"
                      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    >
                      {emptyAction.label}
                    </a>
                  )}
                </div>
              ) : groupBySeller && sellerGroups.length > 0 ? (
                /* Grouped by Seller (Marketplace) */
                <div className="space-y-4">
                  {sellerGroups.map((group) => (
                    <div
                      key={group.sellerId}
                      className="rounded-2xl border p-3.5 space-y-3"
                      style={{
                        background: 'color-mix(in srgb, var(--bg-surface-2) 65%, transparent)',
                        borderColor: 'var(--border-subtle)',
                      }}
                    >
                      {/* Seller header */}
                      {renderSellerHeader ? (
                        renderSellerHeader(group)
                      ) : (
                        <div className="flex items-center justify-between px-0.5">
                          <a
                            href={`/user?id=${encodeURIComponent(group.sellerId)}`}
                            className="text-xs font-black uppercase tracking-wider hover:underline"
                            style={{ color: 'var(--text-accent)' }}
                          >
                            {group.sellerName}
                          </a>
                          <span className="text-xs font-black text-[var(--positive)]">
                            {formatPrice(group.subtotal)}
                          </span>
                        </div>
                      )}

                      {/* Items */}
                      <div className="space-y-2.5">
                        {group.items.map((item) => (
                          <GenericCartLineItem
                            key={item.id}
                            item={item}
                            onUpdateQuantity={onUpdateQuantity}
                            onRemoveItem={onRemoveItem}
                          />
                        ))}
                      </div>

                      {/* Controls slot per seller (e.g. Handover selection, message) */}
                      {renderSellerControls?.(group)}
                    </div>
                  ))}
                </div>
              ) : (
                /* Flat Item List (Store) */
                <div className="space-y-3">
                  {items.map((item) => (
                    <GenericCartLineItem
                      key={item.id}
                      item={item}
                      onUpdateQuantity={onUpdateQuantity}
                      onRemoveItem={onRemoveItem}
                    />
                  ))}
                </div>
              )}

              {/* Extra Middle Content (e.g. Delivery Details form) */}
              {extraContent}
            </div>

            {/* Footer */}
            {hasItems && (
              <div
                className="p-5 border-t shrink-0 space-y-3"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
              >
                {/* Shipping selector slot if provided */}
                {shippingMethodSelector}

                {/* Subtotal, Shipping, Total */}
                <div className="space-y-1.5 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                    <span>{t('Items subtotal', 'Termékek részösszege')}</span>
                    <span className="font-semibold tabular-nums">{formatPrice(subtotalHuf)}</span>
                  </div>

                  <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                    <span>{shippingFeeLabel || t('Shipping', 'Szállítás')}</span>
                    <span className="font-semibold tabular-nums">
                      {shippingFeeHuf === 0 ? t('Free', 'Ingyenes') : formatPrice(shippingFeeHuf)}
                    </span>
                  </div>

                  <div
                    className="flex justify-between text-sm font-black pt-1.5 border-t"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  >
                    <span>{t('Estimated Total', 'Végösszeg')}</span>
                    <span className="tabular-nums text-[var(--positive)]">{formatPrice(resolvedGrandTotal)}</span>
                  </div>
                </div>

                {/* Disclaimer card */}
                {disclaimer}

                {/* Primary Action Button */}
                {checkoutButton}
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
