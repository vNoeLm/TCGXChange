import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useCurrency } from '../../lib/currency';
import { useLanguage } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';
import { getCurrentProfile, onSignedInUserChange } from '../../lib/auth';
import {
  updateCartItemQuantity,
  removeFromCart,
  removeSellerFromCart,
  clearCart,
  cartTotalHuf,
  cartItemCount,
  CART_OPEN_EVENT,
  type MarketplaceCartItem,
} from '../../lib/marketplaceCart';
import { useCart } from '../../lib/useCart';
import { marketplaceToGenericItem } from '../../lib/genericCart';
import {
  handoverMethod,
  sharedHandoverIds,
  missingDeliveryFields,
  formatHandoverDetails,
  EMPTY_DELIVERY,
  type DeliveryDetails,
  type HandoverMethodId,
} from '../../lib/handover';
import { AuthModal } from '../auth/AuthModal';
import { methodAvailability, internationalRate, type MethodAvailability, type ShippingSettings } from '../../lib/shipping';
import { fetchShippingSettings } from '../../lib/shippingClient';
import { getCountry } from '../../lib/countries';
import type { UserProfile } from '../../types';
import { GenericCartDrawer } from '../cart/GenericCartDrawer';

const fmt = (n: number) =>
  new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n);

const DELIVERY_KEY = 'tcg_checkout_delivery';

function loadDelivery(): DeliveryDetails {
  try {
    const raw = localStorage.getItem(DELIVERY_KEY);
    return raw ? { ...EMPTY_DELIVERY, ...JSON.parse(raw) } : EMPTY_DELIVERY;
  } catch {
    return EMPTY_DELIVERY;
  }
}

function saveDelivery(d: DeliveryDetails) {
  try {
    localStorage.setItem(DELIVERY_KEY, JSON.stringify(d));
  } catch {}
}

const KIND_HINT: Record<string, string> = {
  personal: 'Meet up',
  locker: 'Parcel locker',
  address: 'Home delivery',
  custom: 'Describe it',
  international: 'Cross-border delivery',
};

interface SellerGroup {
  sellerId: string;
  sellerName: string;
  items: MarketplaceCartItem[];
  options: MethodAvailability[];
  methods: HandoverMethodId[];
  subtotal: number;
  sellerCountry: string;
  isCountryMismatch: boolean;
  hasSharedHandover: boolean;
}

interface SellerChoice {
  method: HandoverMethodId | null;
  custom: string;
  message: string;
}

interface SendResult {
  sellerId: string;
  sellerName: string;
  copies: number;
  ok: boolean;
  method: HandoverMethodId;
  error?: string;
  conversationId?: string | null;
}

const inputCls = 'w-full rounded-xl px-3 py-2.5 text-xs outline-none transition border focus:border-[var(--accent)]';
const inputStyle = { background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' };

export function MarketplaceCartDrawer() {
  const { formatPrice } = useCurrency();
  const { t } = useLanguage();
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const [choices, setChoices] = useState<Record<string, SellerChoice>>({});
  const [delivery, setDelivery] = useState<DeliveryDetails>(EMPTY_DELIVERY);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<SendResult[]>([]);
  const [shippingBySeller, setShippingBySeller] = useState<Record<string, ShippingSettings | null>>({});

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(CART_OPEN_EVENT, handleOpen);
    setDelivery(loadDelivery());
    getCurrentProfile().then(setProfile);
    const unsubscribeAuth = onSignedInUserChange((session) => {
      if (session) getCurrentProfile().then(setProfile);
      else setProfile(null);
    });
    return () => {
      window.removeEventListener(CART_OPEN_EVENT, handleOpen);
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    setDelivery((d) => ({ ...d, country: (profile?.country || 'HU').toUpperCase() }));
  }, [profile?.country]);

  const groups: SellerGroup[] = useMemo(() => {
    const bySeller = new Map<string, Pick<SellerGroup, 'sellerId' | 'sellerName' | 'items'>>();
    cart.forEach((item) => {
      let g = bySeller.get(item.sellerId);
      if (!g) {
        g = { sellerId: item.sellerId, sellerName: item.sellerName || 'Seller', items: [] };
        bySeller.set(item.sellerId, g);
      }
      g.items.push(item);
    });
    const buyerCountry = (profile?.country || 'HU').toUpperCase();
    return Array.from(bySeller.values()).map((g) => {
      const subtotal = cartTotalHuf(g.items);
      const settings = shippingBySeller[g.sellerId];
      const sellerCountry = (g.items[0]?.sellerCountry || 'HU').toUpperCase();
      const crossBorder = buyerCountry !== sellerCountry;
      const sharedMethods = sharedHandoverIds(g.items.map((i) => i.handoverMethods));

      let options: MethodAvailability[];
      if (crossBorder) {
        const rate = internationalRate(settings, buyerCountry);
        options = rate === null ? [] : [{ id: 'international', offered: true, price: rate, min: 0, short: 0 }];
      } else {
        const builtInOptions = sharedMethods
          .map((id) => methodAvailability(settings, id, subtotal))
          .filter((o) => o.offered);
        const customOptions = (settings?.custom_methods || [])
          .filter((cm) => cm.enabled)
          .map((cm) => methodAvailability(settings, cm.id, subtotal))
          .filter((o) => o.offered);
        options = [...builtInOptions, ...customOptions];
      }

      return {
        ...g,
        subtotal,
        options,
        methods: options.filter((o) => o.short === 0).map((o) => o.id),
        sellerCountry,
        isCountryMismatch: crossBorder && options.length === 0,
        hasSharedHandover: !crossBorder && sharedMethods.length > 0,
      };
    });
  }, [cart, shippingBySeller, profile?.country]);

  const sellerKey = groups.map((g) => g.sellerId).join(',');
  useEffect(() => {
    if (!sellerKey) return;
    fetchShippingSettings(sellerKey.split(',')).then((map) => setShippingBySeller((prev) => ({ ...prev, ...map })));
  }, [sellerKey]);

  const cardCount = cartItemCount(cart);
  const [bumpKey, setBumpKey] = useState(0);
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (prevCount.current !== null && cardCount > prevCount.current) setBumpKey((k) => k + 1);
    prevCount.current = cardCount;
  }, [cardCount]);

  const shippingFor = (group: SellerGroup) => {
    const method = choiceFor(group).method;
    return group.options.find((o) => o.id === method)?.price || 0;
  };
  const itemsTotal = cartTotalHuf(cart);

  const choiceFor = (group: SellerGroup): SellerChoice => {
    const stored = choices[group.sellerId];
    const method =
      stored?.method && group.methods.includes(stored.method)
        ? stored.method
        : group.methods.length === 1
          ? group.methods[0]
          : null;
    return { custom: stored?.custom ?? '', message: stored?.message ?? '', method };
  };
  const setChoice = (group: SellerGroup, patch: Partial<SellerChoice>) =>
    setChoices((prev) => ({ ...prev, [group.sellerId]: { ...choiceFor(group), ...patch } }));

  const shippingTotal = groups.reduce((s, g) => s + shippingFor(g), 0);
  const total = itemsTotal + shippingTotal;
  const chosen = groups.map((g) => choiceFor(g).method).filter(Boolean) as HandoverMethodId[];
  const shipsAny = chosen.some((m) => ['locker', 'address'].includes(handoverMethod(m)?.kind || ''));
  const needs = (id: HandoverMethodId) => chosen.includes(id);

  const validate = (): string | null => {
    for (const group of groups) {
      const c = choiceFor(group);
      if (group.options.length === 0) {
        return `The cards from ${group.sellerName} don't share an enabled handover method - remove one to send the rest.`;
      }
      if (group.methods.length === 0) {
        return `Your order from ${group.sellerName} is below the minimum for their delivery options - add a card or two.`;
      }
      if (!c.method) return `Choose how to get the cards from ${group.sellerName}.`;
      const hm = handoverMethod(c.method);
      if (hm?.kind === 'custom' && !c.custom.trim()) {
        return `Describe how you want to arrange the handover with ${group.sellerName}.`;
      }
      if (hm?.id.startsWith('custom:') && hm?.kind === 'locker' && !c.custom.trim()) {
        return `Enter the ${hm.label} locker or pickup point for ${group.sellerName}.`;
      }
      const missing = missingDeliveryFields(c.method, delivery);
      if (missing && missing.length > 0) return `Add your ${missing.join(', ')} for ${handoverMethod(c.method)?.label}.`;
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!profile) {
      setShowAuth(true);
      return;
    }
    const problem = validate();
    if (problem) {
      setErrorMsg(problem);
      return;
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      if (shipsAny) saveDelivery(delivery);

      const sent: SendResult[] = await Promise.all(
        groups.map(async (group) => {
          const c = choiceFor(group);
          const method = c.method!;
          const ships = missingDeliveryFields(method, delivery) !== null;
          const copies = group.items.reduce((s, i) => s + i.quantity, 0);
          try {
            const res = await fetch('/api/marketplace/hold-request', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                seller_id: group.sellerId,
                buyer_phone: ships ? delivery.phone.trim() : undefined,
                buyer_country: (profile?.country || delivery.country || 'HU').toUpperCase(),
                preferred_handover: method,
                handover_details: formatHandoverDetails(method, delivery, c.custom) || undefined,
                message: c.message.trim() || undefined,
                items: group.items.map((i) => ({
                  inventory_id: i.inventoryId,
                  card_name: i.cardName,
                  card_number: i.cardNumber,
                  image_path: i.imagePath,
                  price_huf: i.priceHuf,
                  is_foil: i.isFoil,
                  condition: i.condition,
                  quantity: i.quantity,
                })),
              }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to submit request');
            removeSellerFromCart(group.sellerId);
            return {
              sellerId: group.sellerId,
              sellerName: group.sellerName,
              copies,
              ok: true,
              method,
              conversationId: data.data?.conversation_id,
            };
          } catch (err: any) {
            return {
              sellerId: group.sellerId,
              sellerName: group.sellerName,
              copies,
              ok: false,
              method,
              error: err.message || 'Error sending request',
            };
          }
        })
      );
      window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));

      const only = sent.length === 1 ? sent[0] : null;
      if (only?.ok && only.method === 'personal' && only.conversationId) {
        window.location.href = `/messages?conversation_id=${only.conversationId}`;
        return;
      }
      setResults(sent);
    } finally {
      setSubmitting(false);
    }
  };

  const isOnStorePage = typeof window !== 'undefined' && window.location.pathname.startsWith('/store');

  // Convert seller groups to generic format
  const genericSellerGroups = useMemo(
    () =>
      groups.map((group) => ({
        sellerId: group.sellerId,
        sellerName: group.sellerName,
        subtotal: group.subtotal,
        items: group.items.map(marketplaceToGenericItem),
        meta: group,
      })),
    [groups]
  );

  // Render per-seller handover options and message textarea
  const renderSellerControls = (genericGroup: { sellerId: string; meta?: SellerGroup }) => {
    const group = genericGroup.meta || groups.find((g) => g.sellerId === genericGroup.sellerId);
    if (!group) return null;

    const c = choiceFor(group);
    const m = handoverMethod(c.method);
    const shipping = shippingFor(group);

    return (
      <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          {t('Handover method', 'Átvételi mód')}
        </div>

        {group.options.length === 0 ? (
          <p
            className="text-[11px] leading-relaxed p-2.5 rounded-lg border"
            style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
          >
            {group.isCountryMismatch
              ? `This seller doesn't ship to ${getCountry(profile?.country || 'HU').name}.`
              : group.hasSharedHandover
                ? 'No enabled handover method meets the minimum order amount for this seller.'
                : "These cards were listed with different handover methods, so one request can't cover them all. Remove one to send the rest."}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {group.options.map((opt) => {
              const hm = handoverMethod(opt.id);
              if (!hm) return null;
              const active = c.method === hm.id;
              const locked = opt.short > 0;
              return (
                <button
                  type="button"
                  key={hm.id}
                  aria-pressed={active}
                  disabled={locked}
                  onClick={() => setChoice(group, { method: hm.id })}
                  title={
                    locked
                      ? `${hm.label} is available from ${fmt(opt.min)} - add ${fmt(opt.short)} more from ${group.sellerName}`
                      : undefined
                  }
                  className={`p-2 rounded-lg border text-left transition ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${
                    active ? 'bg-[var(--accent-muted)] border-[var(--accent-border)]' : 'border-[var(--border)]'
                  }`}
                  style={active ? undefined : { background: 'var(--bg-input)' }}
                >
                  <span className={`block text-[11px] font-bold ${active ? 'text-[var(--text-accent)]' : 'text-[var(--text-secondary)]'}`}>
                    {hm.label}
                  </span>
                  <span className="block text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {opt.price > 0 ? formatPrice(opt.price) : t('Free', 'Ingyenes')}
                  </span>
                  <span className="block text-[9px]" style={{ color: 'var(--text-muted)' }}>
                    {locked ? `Add ${fmt(opt.short)} more` : hm.id === 'international' ? 'Cross-border' : KIND_HINT[hm.kind]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {shipping > 0 && (
          <div className="flex items-center justify-between text-[11px] px-0.5" style={{ color: 'var(--text-secondary)' }}>
            <span>{t('Shipping', 'Szállítás')} ({handoverMethod(c.method)?.label})</span>
            <span className="font-bold">{formatPrice(shipping)}</span>
          </div>
        )}

        {m?.kind === 'personal' && (
          <div className="p-2.5 rounded-lg border text-[11px] leading-relaxed space-y-1" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            {shippingBySeller[group.sellerId]?.in_person_location && (
              <div style={{ color: 'var(--text-secondary)' }}>
                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{t('Pickup area:', 'Átvétel helye:')}</span>{' '}
                {shippingBySeller[group.sellerId]?.in_person_location}
              </div>
            )}
            <p style={{ color: 'var(--text-tertiary)' }}>
              {t(
                `You'll agree on a time and place with ${group.sellerName} in Messages.`,
                `Az időpontot és a helyszínt a belső üzenetekben tudod egyeztetni ${group.sellerName} eladóval.`
              )}
            </p>
          </div>
        )}

        {(m?.kind === 'locker' || m?.kind === 'address') && (
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
            {t(
              `Ships to the ${m.kind === 'address' ? 'address' : m.id === 'foxpost' ? 'Foxpost locker' : m.id === 'packeta' ? 'Packeta pickup point' : `${m.label} point`} in your delivery details below.`,
              `Kézbesítés a megadott címre vagy csomagautomatába történik.`
            )}
          </p>
        )}

        {m?.id.startsWith('custom:') && m?.kind === 'locker' && (
          <input
            type="text"
            value={c.custom}
            onChange={(e) => setChoice(group, { custom: e.target.value })}
            placeholder={`${m.label} locker name or pickup point address *`}
            className={inputCls}
            style={inputStyle}
          />
        )}

        {m?.kind === 'custom' && (
          <textarea
            rows={2}
            value={c.custom}
            onChange={(e) => setChoice(group, { custom: e.target.value })}
            placeholder={t('How do you want to arrange the handover?', 'Hogyan szeretnéd az átvételt intézni?')}
            className={`${inputCls} resize-none`}
            style={inputStyle}
          />
        )}

        <div>
          <label className="block text-[11px] font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
            {t(`Message to ${group.sellerName}`, `Üzenet ${group.sellerName} eladónak`)}{' '}
            <span className="font-normal" style={{ color: 'var(--text-muted)' }}>({t('optional', 'opcionális')})</span>
          </label>
          <textarea
            rows={2}
            value={c.message}
            onChange={(e) => setChoice(group, { message: e.target.value })}
            placeholder={m?.kind === 'personal' ? t('When and where suits you?', 'Mikor és hol felelne meg?') : t('Anything the seller should know', 'Bármilyen megjegyzés az eladónak')}
            className={`${inputCls} resize-none`}
            style={inputStyle}
          />
        </div>
      </div>
    );
  };

  // Delivery details form (rendered in extraContent when any shipping method needs details)
  const deliveryForm = shipsAny ? (
    <div className="rounded-2xl border p-3.5 space-y-2.5" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
      <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        {t('Delivery details', 'Szállítási adatok')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          autoComplete="name"
          value={delivery.recipientName}
          onChange={(e) => setDelivery({ ...delivery, recipientName: e.target.value })}
          placeholder={t('Full name *', 'Teljes név *')}
          className={inputCls}
          style={inputStyle}
        />
        <input
          type="tel"
          autoComplete="tel"
          value={delivery.phone}
          onChange={(e) => setDelivery({ ...delivery, phone: e.target.value })}
          placeholder={t('Phone *', 'Telefonszám *')}
          className={inputCls}
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
          {t('Delivery Destination', 'Célország')}
        </label>
        <div
          className="flex items-center gap-2 h-9 px-3 rounded-lg border text-xs font-semibold"
          style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          <span>{getCountry(profile?.country || 'HU').name} ({getCountry(profile?.country || 'HU').localName})</span>
        </div>
      </div>

      {needs('foxpost') && (
        <div>
          <input
            type="text"
            value={delivery.foxpostLocker}
            onChange={(e) => setDelivery({ ...delivery, foxpostLocker: e.target.value })}
            placeholder={t('Foxpost locker name or ID *', 'Foxpost automata neve vagy azonosítója *')}
            className={inputCls}
            style={inputStyle}
          />
          <a
            href={handoverMethod('foxpost')?.finderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-semibold hover:underline mt-1 inline-block"
            style={{ color: 'var(--text-accent)' }}
          >
            {t('Find a Foxpost locker', 'Foxpost automata kereső')}
          </a>
        </div>
      )}

      {needs('packeta') && (
        <div>
          <input
            type="text"
            value={delivery.packetaPoint}
            onChange={(e) => setDelivery({ ...delivery, packetaPoint: e.target.value })}
            placeholder={t('Packeta pickup point name or ID *', 'Packeta átvevőhely neve vagy azonosítója *')}
            className={inputCls}
            style={inputStyle}
          />
          <a
            href={handoverMethod('packeta')?.finderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-semibold hover:underline mt-1 inline-block"
            style={{ color: 'var(--text-accent)' }}
          >
            {t('Find a Packeta pickup point', 'Packeta átvevőhely kereső')}
          </a>
        </div>
      )}

      {chosen.some((id) => handoverMethod(id)?.kind === 'address') && (
        <>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              value={delivery.postalCode}
              onChange={(e) => setDelivery({ ...delivery, postalCode: e.target.value })}
              placeholder={t('Postcode *', 'Irányítószám *')}
              className={inputCls}
              style={inputStyle}
            />
            <input
              type="text"
              autoComplete="address-level2"
              value={delivery.city}
              onChange={(e) => setDelivery({ ...delivery, city: e.target.value })}
              placeholder={t('City *', 'Város *')}
              className={inputCls}
              style={inputStyle}
            />
          </div>
          <input
            type="text"
            autoComplete="street-address"
            value={delivery.street}
            onChange={(e) => setDelivery({ ...delivery, street: e.target.value })}
            placeholder={t('Street, house number *', 'Utca, házszám *')}
            className={inputCls}
            style={inputStyle}
          />
        </>
      )}

      <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {t('Only sent to the seller you are shipping with. Remembered on this device.', 'Kizárólag a kiválasztott eladónak kerül továbbításra.')}
      </p>
    </div>
  ) : null;

  // Results display (when hold requests have been sent)
  const resultsView =
    results.length > 0 ? (
      <div className="space-y-2 mb-3">
        {results.map((r) =>
          r.ok ? (
            <div
              key={r.sellerId}
              className="p-3.5 rounded-xl border text-xs font-semibold space-y-2"
              style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>
                  {t(
                    `Hold request for ${r.copies} card${r.copies === 1 ? '' : 's'} sent to ${r.sellerName}.`,
                    `A foglalási kérelem (${r.copies} db) elküldve ${r.sellerName} eladónak.`
                  )}
                </span>
              </div>
              {r.conversationId && (
                <a
                  href={`/messages?conversation_id=${r.conversationId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-black transition hover:brightness-105"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                >
                  <span>
                    {r.method === 'personal'
                      ? t(`Agree where and when with ${r.sellerName}`, `Egyeztetés ${r.sellerName} eladóval`)
                      : t(`Open chat with ${r.sellerName}`, `Üzenetváltás megnyitása`)}
                  </span>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </a>
              )}
            </div>
          ) : (
            <div
              key={r.sellerId}
              className="p-3.5 rounded-xl border text-xs font-semibold"
              style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
            >
              {t(
                `Couldn't send the request to ${r.sellerName}: ${r.error}. Those cards remain in your cart.`,
                `Nem sikerült a kérelmet elküldeni ${r.sellerName} részére: ${r.error}. A kártyák a kosárban maradtak.`
              )}
            </div>
          )
        )}
      </div>
    ) : null;

  // Disclaimer card for Marketplace P2P
  const disclaimer = (
    <div className="space-y-2">
      {errorMsg && (
        <div
          role="alert"
          className="p-2.5 rounded-lg border text-xs font-semibold"
          style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}
        >
          {errorMsg}
        </div>
      )}

      <div
        className="p-2.5 rounded-lg border text-[10px] leading-relaxed flex items-start gap-2"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <div>
          <strong style={{ color: 'var(--text-secondary)' }}>{t('Currency & Bank Transfers:', 'Pénznem és banki átutalás:')}</strong>{' '}
          {t(
            'Displayed HUF and EUR amounts are reference prices. Payments are settled directly with the seller; actual currency depends on their account.',
            'A megjelenített árak tájékoztató jellegűek. A fizetés közvetlenül az eladóval történik, a számlájának megfelelő pénznemben.'
          )}
        </div>
      </div>

      <div
        className="p-2.5 rounded-lg border text-[10px] leading-relaxed"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        <strong style={{ color: 'var(--text-secondary)' }}>{t('Peer-to-peer trade (Magánszemélyek közötti adásvétel):', 'Magánszemélyek közötti adásvétel:')}</strong>{' '}
        {t(
          'Marketplace sellers are private individuals. Your agreement is formed directly with the seller. Statutory 14-day consumer rights do not apply to private sales.',
          'A piactéri eladók magánszemélyek. A megállapodás közvetlenül köztetek jön létre, a 14 napos fogyasztói elállási jog magáneladásra nem érvényes.'
        )}{' '}
        <a href="/legal/terms" className="underline font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {t('Terms (ÁSZF)', 'ÁSZF')}
        </a>
      </div>
    </div>
  );

  // Submit button
  const submitButton = (
    <form onSubmit={handleSubmit}>
      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 rounded-xl font-black text-xs transition cursor-pointer shadow-lg active:scale-95 disabled:opacity-50"
        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
      >
        {!profile
          ? t('Sign in to send your request', 'Jelentkezz be a kérelem küldéséhez')
          : submitting
            ? t('Sending…', 'Küldés folyamatban…')
            : groups.length > 1
              ? t(`Request Holds from ${groups.length} Sellers (${cardCount} Cards)`, `Foglalás kérése ${groups.length} eladótól (${cardCount} db)`)
              : t(`Request Hold on ${cardCount} Card${cardCount === 1 ? '' : 's'}`, `Foglalás kérése (${cardCount} db kártya)`)}
      </button>
      {profile && (
        <p className="text-[10px] text-center mt-2" style={{ color: 'var(--text-muted)' }}>
          {t('Sending as', 'Küldés mint:')} {profile.display_name}{profile.email ? ` (${profile.email})` : ''}
        </p>
      )}
    </form>
  );

  return (
    <>
      <GenericCartDrawer
        open={open}
        onClose={() => {
          setOpen(false);
          if (cart.length === 0) setResults([]);
        }}
        onOpen={() => setOpen(true)}
        title={t('Marketplace Cart', 'Piactéri kosár')}
        subtitle={t('Peer-to-peer card requests & holds', 'Közvetlen eladói kártyafoglalások')}
        totalCount={cardCount}
        onClear={clearCart}
        groupBySeller={true}
        sellerGroups={genericSellerGroups}
        renderSellerControls={renderSellerControls}
        extraContent={deliveryForm}
        results={resultsView}
        onUpdateQuantity={updateCartItemQuantity}
        onRemoveItem={removeFromCart}
        subtotalHuf={itemsTotal}
        shippingFeeHuf={shippingTotal}
        shippingFeeLabel={t('Handover & Shipping', 'Átadás és szállítás')}
        grandTotalHuf={total}
        disclaimer={disclaimer}
        checkoutButton={submitButton}
        floatingButton={!isOnStorePage}
        bumpKey={bumpKey}
        emptyTitle={t('Your marketplace cart is empty', 'A piactéri kosarad jelenleg üres')}
        emptySubtitle={t(
          'Browse cards and add listings to request holds from sellers.',
          'Válogass a piactéren meghirdetett kártyák közül és küldj foglalási kérelmet az eladóknak.'
        )}
        emptyAction={{
          label: t('Browse Marketplace', 'Piactér megnyitása'),
          href: '/marketplace',
        }}
      />

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => {
            setShowAuth(false);
            getCurrentProfile().then(setProfile);
          }}
        />
      )}
    </>
  );
}
