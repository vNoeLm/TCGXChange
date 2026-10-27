import { useEffect, useMemo, useState } from 'react';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { storeToGenericItem } from '../../lib/genericCart';
import {
  calculateStoreShippingFee,
  useStoreCart,
  useStoreShippingMethods,
} from '../../lib/storeCart';
import { GenericCartDrawer } from '../cart/GenericCartDrawer';

export interface StoreCartDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
}

export function StoreCartDrawer({ open, onClose, onOpen }: StoreCartDrawerProps) {
  const { items, totalItems, subtotalHuf, setQuantity, removeItem, clear } = useStoreCart();
  const { methods: shippingMethods } = useStoreShippingMethods();
  const { formatPrice } = useCurrency();
  const { t } = useLanguage();
  const [shippingId, setShippingId] = useState<string>('foxpost');

  useEffect(() => {
    if (shippingMethods.length > 0 && !shippingMethods.some((m) => m.id === shippingId)) {
      setShippingId(shippingMethods[0].id);
    }
  }, [shippingMethods, shippingId]);

  const selectedMethod = shippingMethods.find((m) => m.id === shippingId) || shippingMethods[0];
  const shippingFeeHuf = calculateStoreShippingFee(subtotalHuf, selectedMethod?.id || '', shippingMethods);
  const remainingForFree =
    selectedMethod?.freeAboveHuf && selectedMethod.freeAboveHuf > 0 && subtotalHuf < selectedMethod.freeAboveHuf
      ? selectedMethod.freeAboveHuf - subtotalHuf
      : 0;

  const genericItems = useMemo(() => items.map(storeToGenericItem), [items]);

  const topBanner =
    items.length > 0 && selectedMethod?.freeAboveHuf !== null && (selectedMethod?.freeAboveHuf ?? 0) > 0 ? (
      <div
        className="px-5 py-2.5 border-b text-xs shrink-0"
        style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}
      >
        {remainingForFree > 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>
            {t(
              <>
                Add <strong style={{ color: 'var(--text-accent)' }}>{formatPrice(remainingForFree)}</strong> more for <strong>free {selectedMethod.label}</strong> shipping!
              </>,
              <>
                Tegyél még a kosárba <strong style={{ color: 'var(--text-accent)' }}>{formatPrice(remainingForFree)}</strong> értékben az <strong>ingyenes {selectedMethod.label}</strong> szállításhoz!
              </>
            )}
          </p>
        ) : (
          <p className="font-bold" style={{ color: 'var(--positive)' }}>
            {t(
              `You unlocked free ${selectedMethod.label} shipping!`,
              `Elérted az ingyenes ${selectedMethod.label} szállítási értékhatárt!`
            )}
          </p>
        )}
      </div>
    ) : null;

  const shippingSelector = (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
        {t('Shipping method', 'Szállítási mód')}
      </label>
      <select
        value={selectedMethod?.id || ''}
        onChange={(e) => setShippingId(e.target.value)}
        className="w-full px-3 py-2 text-xs rounded-xl border cursor-pointer focus:outline-none"
        style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
      >
        {shippingMethods.map((m) => {
          const fee = calculateStoreShippingFee(subtotalHuf, m.id, shippingMethods);
          return (
            <option key={m.id} value={m.id}>
              {m.label} ({fee === 0 ? t('FREE', 'INGYENES') : formatPrice(fee)})
            </option>
          );
        })}
      </select>
      {selectedMethod?.description && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
          {selectedMethod.description}
        </p>
      )}
    </div>
  );

  const disclaimer = (
    <div
      className="p-2.5 rounded-lg border text-[10px] leading-relaxed flex items-start gap-2"
      style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
    >
      <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <div>
        <strong style={{ color: 'var(--text-secondary)' }}>{t('Currency & Settlement:', 'Pénznem és elszámolás:')}</strong>{' '}
        {t(
          'All transactions are settled in Hungarian Forint (HUF). EUR prices are strictly informational estimates; your bank or card provider may apply differing exchange rates or conversion fees.',
          'Minden hivatalos Store tranzakció elszámolása magyar forintban (HUF) történik. Az eurós (EUR) árak tájékoztató jellegűek; a számlavezető bankod eltérő átváltási árfolyamot vagy konverziós díjat alkalmazhat.'
        )}
      </div>
    </div>
  );

  const checkoutBtn = (
    <button
      type="button"
      disabled
      className="w-full py-3 rounded-xl text-xs font-bold opacity-60 cursor-not-allowed"
      style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
    >
      {t('Checkout opens at launch', 'A pénztár az induláskor nyílik')}
    </button>
  );

  return (
    <GenericCartDrawer
      open={open}
      onClose={onClose}
      onOpen={onOpen}
      title={t('Store Cart', 'Bolti kosár')}
      subtitle={t('Official sealed products & TCG supplies', 'Hivatalos bontatlan termékek és TCG kiegészítők')}
      totalCount={totalItems}
      items={genericItems}
      onClear={clear}
      onUpdateQuantity={setQuantity}
      onRemoveItem={removeItem}
      topBanner={topBanner}
      subtotalHuf={subtotalHuf}
      shippingFeeHuf={shippingFeeHuf}
      shippingFeeLabel={`${t('Shipping', 'Szállítás')} (${selectedMethod?.label || t('Delivery', 'Kiszállítás')})`}
      shippingMethodSelector={shippingSelector}
      disclaimer={disclaimer}
      checkoutButton={checkoutBtn}
      emptyTitle={t('Your store cart is empty', 'A kosarad jelenleg üres')}
      emptySubtitle={t(
        'Browse displays, starter decks, sleeves and deck boxes to add items.',
        'Válogass a bontatlan csomagok, kártyavédők, albumok és paklitartók között.'
      )}
    />
  );
}
