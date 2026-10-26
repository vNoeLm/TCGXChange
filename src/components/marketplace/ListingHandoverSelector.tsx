import React, { useEffect, useState } from 'react';
import { useCurrency } from '../../lib/currency';
import { getCurrentUser } from '../../lib/auth';
import { getSellerHandoverMethods, type DynamicHandoverMethod } from '../../lib/shipping';
import { fetchShippingSettings } from '../../lib/shippingClient';

export interface ListingHandoverSelectorProps {
  allowedHandovers: string[];
  onChange: (methods: string[]) => void;
  availableMethods?: DynamicHandoverMethod[];
  sellerId?: string | null;
}

const DEFAULT_FALLBACK_METHODS: DynamicHandoverMethod[] = [
  { id: 'personal', label: 'In person', desc: 'In person', price_huf: 0, min_order_huf: 0 },
  { id: 'foxpost', label: 'Foxpost', desc: 'Parcel locker', price_huf: 0, min_order_huf: 0 },
  { id: 'packeta', label: 'Packeta', desc: 'Pickup point', price_huf: 0, min_order_huf: 0 },
  { id: 'other', label: 'Other', desc: 'Delivery', price_huf: 0, min_order_huf: 0 },
];

export function ListingHandoverSelector({
  allowedHandovers,
  onChange,
  availableMethods,
  sellerId,
}: ListingHandoverSelectorProps) {
  const { formatPrice } = useCurrency();
  const [methods, setMethods] = useState<DynamicHandoverMethod[]>(availableMethods || []);
  const [loading, setLoading] = useState(!availableMethods || availableMethods.length === 0);

  useEffect(() => {
    if (availableMethods && availableMethods.length > 0) {
      setMethods(availableMethods);
      setLoading(false);
      return;
    }

    let active = true;
    const loadMethods = async () => {
      let targetId = sellerId;
      if (!targetId) {
        const u = await getCurrentUser().catch(() => null);
        targetId = u?.id || null;
      }
      if (!targetId) {
        if (active) {
          setMethods(DEFAULT_FALLBACK_METHODS);
          setLoading(false);
        }
        return;
      }

      try {
        const map = await fetchShippingSettings([targetId]);
        const settings = map[targetId];
        const dynamic = getSellerHandoverMethods(settings);
        if (active) {
          setMethods(dynamic.length > 0 ? dynamic : DEFAULT_FALLBACK_METHODS);
          setLoading(false);
        }
      } catch {
        if (active) {
          setMethods(DEFAULT_FALLBACK_METHODS);
          setLoading(false);
        }
      }
    };

    loadMethods();

    return () => {
      active = false;
    };
  }, [availableMethods, sellerId]);

  const toggleMethod = (id: string) => {
    const isSelected = allowedHandovers.includes(id);
    if (isSelected) {
      if (allowedHandovers.length > 1) {
        onChange(allowedHandovers.filter((m) => m !== id));
      }
    } else {
      onChange([...allowedHandovers, id]);
    }
  };

  const listToRender = methods.length > 0 ? methods : DEFAULT_FALLBACK_METHODS;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-bold block" style={{ color: 'var(--text-secondary)' }}>
          Allowed handover methods ({allowedHandovers.length} selected):
        </label>
        <a
          href="/seller"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold hover:underline"
          style={{ color: 'var(--text-accent)' }}
        >
          Seller Hub Shipping
        </a>
      </div>

      {loading ? (
        <div className="text-[11px] p-2 rounded-xl border border-dashed text-center" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
          Loading shipping options…
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {listToRender.map((m) => {
            const active = allowedHandovers.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMethod(m.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer flex items-center gap-1.5 select-none ${
                  active
                    ? 'shadow-xs'
                    : 'hover:brightness-105'
                }`}
                style={
                  active
                    ? {
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent-border)',
                        color: 'var(--text-accent)',
                      }
                    : {
                        background: 'var(--bg-surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text-tertiary)',
                      }
                }
              >
                <span>{m.label}</span>
                {m.price_huf > 0 && (
                  <span className="text-[10px] font-semibold opacity-75">
                    ({formatPrice(m.price_huf)})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
