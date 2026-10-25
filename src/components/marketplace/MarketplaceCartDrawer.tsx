import { useCurrency } from '../../lib/currency';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useExitTransition } from '../../lib/useExitTransition';
import { supabase, cardThumbProps } from '../../lib/supabase';
import { getCurrentProfile, onSignedInUserChange } from '../../lib/auth';
import {
  updateCartItemQuantity,
  removeFromCart,
  removeSellerFromCart,
  cartTotalHuf,
  cartItemCount,
  CART_OPEN_EVENT,
  type MarketplaceCartItem,
} from '../../lib/marketplaceCart';
import { useCart } from '../../lib/useCart';
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

const fmt = (n: number) =>
  new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n);

// Remembered between checkouts on this device only - it's the buyer's own address, so it never
// leaves their browser until they send a request with it.
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
  /** Methods every card in this group was listed with and the seller offers, with their price and
   *  minimum for this order - the only ones one request can use. */
  options: MethodAvailability[];
  /** Of those, the ones this order is big enough for. */
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
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const [choices, setChoices] = useState<Record<string, SellerChoice>>({});
  const [delivery, setDelivery] = useState<DeliveryDetails>(EMPTY_DELIVERY);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<SendResult[]>([]);
  // Each seller's shipping options (price and minimum per method).
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
    // The country the buyer is in comes from their profile; it decides domestic vs international
    // handover and is sent with the request for the seller's records.
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

      // Domestic orders use the seller's own handover methods; cross-border orders use the
      // seller's price for the buyer's country, delivered by an arranged courier.
      let options: MethodAvailability[];
      if (crossBorder) {
        const rate = internationalRate(settings, buyerCountry);
        options = rate === null
          ? []
          : [{ id: 'international', offered: true, price: rate, min: 0, short: 0 }];
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

  // The cart button pulses when a card is added - not on page load, when the count just appears.
  const cardCount = cartItemCount(cart);
  const [bumpKey, setBumpKey] = useState(0);
  const prevCount = useRef<number | null>(null);
  useEffect(() => {
    if (prevCount.current !== null && cardCount > prevCount.current) setBumpKey((k) => k + 1);
    prevCount.current = cardCount;
  }, [cardCount]);

  const drawerAnim = useExitTransition(open, 400);

  if (cart.length === 0 && results.length === 0) return null;

  const shippingFor = (group: SellerGroup) => {
    const method = choiceFor(group).method;
    return group.options.find((o) => o.id === method)?.price || 0;
  };
  const itemsTotal = cartTotalHuf(cart);

  const choiceFor = (group: SellerGroup): SellerChoice => {
    const stored = choices[group.sellerId];
    // A choice the group no longer allows (its cards changed) doesn't count; a single allowed
    // method is picked for them.
    const method = stored?.method && group.methods.includes(stored.method)
      ? stored.method
      : group.methods.length === 1 ? group.methods[0] : null;
    return { custom: stored?.custom ?? '', message: stored?.message ?? '', method };
  };
  const setChoice = (group: SellerGroup, patch: Partial<SellerChoice>) =>
    setChoices((prev) => ({ ...prev, [group.sellerId]: { ...choiceFor(group), ...patch } }));

  const total = itemsTotal + groups.reduce((s, g) => s + shippingFor(g), 0);
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

      const sent: SendResult[] = [];
      for (const group of groups) {
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
          sent.push({
            sellerId: group.sellerId, sellerName: group.sellerName, copies, ok: true, method,
            conversationId: data.data?.conversation_id,
          });
        } catch (err: any) {
          sent.push({ sellerId: group.sellerId, sellerName: group.sellerName, copies, ok: false, method, error: err.message || 'Error sending request' });
        }
      }
      window.dispatchEvent(new CustomEvent('tcg-marketplace-changed'));

      // Meeting in person is settled in the chat, so a single in-person request goes straight there.
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

  return (
    <>
      {/* Floating cart button (hidden on /store so it never clashes with the Store cart) */}
      {!open && cart.length > 0 && !isOnStorePage && (
        <button
          type="button"
          key={bumpKey}
          onClick={() => setOpen(true)}
          className={`${bumpKey > 0 ? 'tv-bump ' : ''}fixed bottom-24 right-4 z-40 flex items-center gap-2 px-4 py-3 rounded-full shadow-2xl cursor-pointer transition active:scale-95 border`}
          style={{ background: 'var(--accent-strong)', borderColor: 'var(--accent)', color: 'var(--text-on-accent, #000)' }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
          </svg>
          <span className="text-xs font-black">{cardCount} card{cardCount === 1 ? '' : 's'} · {formatPrice(itemsTotal)}</span>
        </button>
      )}

      {/* Drawer - one step above the card detail overlay (9999), since it can be opened from there. */}
      {drawerAnim.rendered && (
        <div
          data-state={drawerAnim.state}
          className="tv-overlay fixed inset-0 z-[10000] flex items-stretch justify-end bg-black/70 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            data-state={drawerAnim.state}
            className="tv-drawer-right w-full max-w-md h-full overflow-y-auto p-5 sm:p-6 shadow-2xl"
            style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>
                {cart.length > 0 ? 'Your cart' : 'Requests sent'}
              </h2>
              <button
                type="button"
                aria-label="Close cart"
                onClick={() => { setOpen(false); if (cart.length === 0) setResults([]); }}
                className="w-8 h-8 rounded-full flex items-center justify-center border cursor-pointer"
                style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {results.length > 0 && (
              <div className="space-y-2 mb-4">
                {results.map((r) => r.ok ? (
                  <div key={r.sellerId} className="p-3 rounded-xl border text-xs font-semibold space-y-2" style={{ background: 'var(--positive-muted)', borderColor: 'var(--positive-border)', color: 'var(--positive)' }}>
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Hold request for {r.copies} card{r.copies === 1 ? '' : 's'} sent to {r.sellerName}.</span>
                    </div>
                    {r.conversationId && (
                      <a
                        href={`/messages?conversation_id=${r.conversationId}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-black"
                        style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}
                      >
                        {r.method === 'personal' ? `Agree where and when with ${r.sellerName}` : `Open chat with ${r.sellerName}`}
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                      </a>
                    )}
                  </div>
                ) : (
                  <div key={r.sellerId} className="p-3 rounded-xl border text-xs font-semibold" style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}>
                    Couldn't send the request to {r.sellerName}: {r.error} Those cards are still in your cart.
                  </div>
                ))}
              </div>
            )}

            {cart.length > 0 && (
              <form onSubmit={handleSubmit}>
                {groups.map((group) => {
                  const c = choiceFor(group);
                  const m = handoverMethod(c.method);
                  const subtotal = group.subtotal;
                  const shipping = shippingFor(group);
                  return (
                    <div key={group.sellerId} className="mb-5 rounded-2xl border p-3" style={{ background: 'color-mix(in srgb, var(--bg-surface-2) 55%, transparent)', borderColor: 'var(--border-subtle)' }}>
                      <div className="flex items-center justify-between mb-2.5 px-0.5">
                        <a href={`/user?id=${group.sellerId}`} className="text-xs font-black uppercase tracking-wider hover:underline" style={{ color: 'var(--text-accent)' }}>
                          {group.sellerName}
                        </a>
                        <span className="text-xs font-black text-[var(--positive)]">{formatPrice(subtotal)}</span>
                      </div>

                      <div className="space-y-2 mb-3">
                        {group.items.map((item) => (
                          <div key={item.inventoryId} className="flex items-center gap-3 p-2.5 rounded-xl border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)' }}>
                            <div className="w-11 h-15 rounded-lg overflow-hidden shrink-0 flex items-center justify-center border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}>
                              {item.imagePath ? (
                                <img {...cardThumbProps(item.imagePath, 'avatar')} alt={item.cardName} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-[8px] font-mono" style={{ color: 'var(--text-muted)' }}>TCG</span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{item.cardName}</div>
                              <div className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
                                {item.condition}{item.isFoil ? ' • Foil' : ''} · {formatPrice(item.priceHuf)}
                              </div>
                              <div className="flex items-center gap-1.5 mt-1">
                                <button
                                  type="button"
                                  aria-label={`One fewer ${item.cardName}`}
                                  onClick={() => updateCartItemQuantity(item.inventoryId, item.quantity - 1)}
                                  disabled={item.quantity <= 1}
                                  className="w-6 h-6 rounded-md border flex items-center justify-center text-xs font-bold cursor-pointer hover:brightness-110 disabled:opacity-40"
                                  style={{ borderColor: 'var(--border)', background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
                                >
                                  −
                                </button>
                                <span className="text-xs font-bold w-5 text-center" style={{ color: 'var(--text-primary)' }}>{item.quantity}</span>
                                <button
                                  type="button"
                                  aria-label={`One more ${item.cardName}`}
                                  onClick={() => updateCartItemQuantity(item.inventoryId, item.quantity + 1)}
                                  disabled={item.quantity >= item.maxQuantity}
                                  className="w-6 h-6 rounded-md border flex items-center justify-center text-xs font-bold cursor-pointer hover:brightness-110 disabled:opacity-40"
                                  style={{ borderColor: 'var(--border)', background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
                                >
                                  +
                                </button>
                                <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>of {item.maxQuantity}</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <span className="text-xs font-black" style={{ color: 'var(--text-primary)' }}>{formatPrice(item.priceHuf * item.quantity)}</span>
                              <button
                                type="button"
                                onClick={() => removeFromCart(item.inventoryId)}
                                className="text-[10px] font-bold hover:underline cursor-pointer" style={{ color: 'var(--negative)' }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="text-[11px] font-black uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                        Handover
                      </div>
                      {group.options.length === 0 ? (
                        <p className="text-[11px] leading-relaxed p-2.5 rounded-lg border mb-2" style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}>
                          {group.isCountryMismatch
                            ? `This seller doesn't ship to ${getCountry(profile?.country || 'HU').name}.`
                            : group.hasSharedHandover
                              ? 'No enabled handover method meets the minimum order amount for this seller.'
                              : "These cards were listed with different handover methods, so one request can't cover them all. Remove one to send the rest."}
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
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
                                title={locked ? `${hm.label} is available from ${fmt(opt.min)} - add ${fmt(opt.short)} more from ${group.sellerName}` : undefined}
                                className={`p-2 rounded-lg border text-left transition ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${
                                  active ? 'bg-[var(--accent-muted)] border-[var(--accent-border)]' : 'border-[var(--border)]'
                                }`}
                                style={active ? undefined : { background: 'var(--bg-input)' }}
                              >
                                <span className={`block text-[11px] font-bold ${active ? 'text-[var(--text-accent)]' : 'text-[var(--text-secondary)]'}`}>{hm.label}</span>
                                <span className="block text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                  {opt.price > 0 ? formatPrice(opt.price) : 'Free'}
                                </span>
                                <span className="block text-[9px]" style={{ color: 'var(--text-muted)' }}>
                                  {locked ? `Add ${fmt(opt.short)} more` : hm.id === 'international' ? 'Cross-border delivery' : KIND_HINT[hm.kind]}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {shipping > 0 && (
                        <div className="flex items-center justify-between text-[11px] mb-2 px-0.5" style={{ color: 'var(--text-secondary)' }}>
                          <span>Shipping ({handoverMethod(c.method)?.label})</span>
                          <span className="font-bold">{formatPrice(shipping)}</span>
                        </div>
                      )}

                      {m?.kind === 'personal' && (
                        <div className="mb-2">
                          {shippingBySeller[group.sellerId]?.in_person_location && (
                            <div className="text-[11px] p-2 rounded-lg mb-1.5 border" style={{ background: 'var(--bg-surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Pickup area:</span> {shippingBySeller[group.sellerId]?.in_person_location}
                            </div>
                          )}
                          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                            You'll agree on a time and place with {group.sellerName} in Messages. Your message below starts that chat.
                          </p>
                        </div>
                      )}
                      {(m?.kind === 'locker' || m?.kind === 'address') && (
                        <p className="text-[11px] leading-relaxed mb-2" style={{ color: 'var(--text-tertiary)' }}>
                          Ships to the {m.kind === 'address' ? 'address' : m.id === 'foxpost' ? 'Foxpost locker' : m.id === 'packeta' ? 'Packeta pickup point' : `${m.label} locker / pickup point`} in your delivery details below.
                        </p>
                      )}
                      {m?.id.startsWith('custom:') && m?.kind === 'locker' && (
                        <input
                          type="text"
                          value={c.custom}
                          onChange={(e) => setChoice(group, { custom: e.target.value })}
                          placeholder={`${m.label} locker name or pickup point address *`}
                          className={`${inputCls} mb-2`}
                          style={inputStyle}
                        />
                      )}
                      {m?.kind === 'custom' && (
                        <textarea
                          rows={2}
                          value={c.custom}
                          onChange={(e) => setChoice(group, { custom: e.target.value })}
                          placeholder="How do you want to arrange the handover?"
                          className={`${inputCls} resize-none mb-2`}
                          style={inputStyle}
                        />
                      )}

                      <label className="block text-[11px] font-bold mt-1 mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Message to {group.sellerName} <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(optional, goes to your chat)</span>
                      </label>
                      <textarea
                        rows={2}
                        value={c.message}
                        onChange={(e) => setChoice(group, { message: e.target.value })}
                        placeholder={m?.kind === 'personal' ? 'When and where suits you? e.g. weekday evenings near Deák tér' : 'Anything the seller should know'}
                        className={`${inputCls} resize-none`}
                        style={inputStyle}
                      />
                    </div>
                  );
                })}

                {shipsAny && (
                  <div className="mb-5 rounded-2xl border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                      Delivery details
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" autoComplete="name" value={delivery.recipientName} onChange={(e) => setDelivery({ ...delivery, recipientName: e.target.value })} placeholder="Full name *" className={inputCls} style={inputStyle} />
                      <input type="tel" autoComplete="tel" value={delivery.phone} onChange={(e) => setDelivery({ ...delivery, phone: e.target.value })} placeholder="Phone *" className={inputCls} style={inputStyle} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                        Delivery Destination
                      </label>
                      <div className="flex items-center gap-2 h-9 px-3 rounded-lg border text-xs font-semibold" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        <span>{getCountry(profile?.country || 'HU').name} ({getCountry(profile?.country || 'HU').localName})</span>
                      </div>
                    </div>
                    {needs('foxpost') && (
                      <div>
                        <input type="text" value={delivery.foxpostLocker} onChange={(e) => setDelivery({ ...delivery, foxpostLocker: e.target.value })} placeholder="Foxpost locker name or ID *" className={inputCls} style={inputStyle} />
                        <a href={handoverMethod('foxpost')?.finderUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold hover:underline" style={{ color: 'var(--text-accent)' }}>Find a Foxpost locker</a>
                      </div>
                    )}
                    {needs('packeta') && (
                      <div>
                        <input type="text" value={delivery.packetaPoint} onChange={(e) => setDelivery({ ...delivery, packetaPoint: e.target.value })} placeholder="Packeta pickup point name or ID *" className={inputCls} style={inputStyle} />
                        <a href={handoverMethod('packeta')?.finderUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold hover:underline" style={{ color: 'var(--text-accent)' }}>Find a Packeta pickup point</a>
                      </div>
                    )}
                    {chosen.some((id) => handoverMethod(id)?.kind === 'address') && (
                      <>
                        <div className="grid grid-cols-[6rem_1fr] gap-2">
                          <input type="text" inputMode="numeric" autoComplete="postal-code" value={delivery.postalCode} onChange={(e) => setDelivery({ ...delivery, postalCode: e.target.value })} placeholder="Postcode *" className={inputCls} style={inputStyle} />
                          <input type="text" autoComplete="address-level2" value={delivery.city} onChange={(e) => setDelivery({ ...delivery, city: e.target.value })} placeholder="City *" className={inputCls} style={inputStyle} />
                        </div>
                        <input type="text" autoComplete="street-address" value={delivery.street} onChange={(e) => setDelivery({ ...delivery, street: e.target.value })} placeholder="Street, house number *" className={inputCls} style={inputStyle} />
                      </>
                    )}
                    <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Only sent to the seller you're shipping with. Remembered on this device for next time.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between mb-3 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <span className="text-xs font-bold block" style={{ color: 'var(--text-secondary)' }}>Total</span>
                    <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Direct peer-to-peer payment</span>
                  </div>
                  <span className="text-base font-black text-[var(--positive)]">{formatPrice(total)}</span>
                </div>

                {errorMsg && (
                  <div role="alert" className="mb-3 p-2.5 rounded-lg border text-xs font-semibold" style={{ background: 'var(--negative-muted)', borderColor: 'var(--negative-border)', color: 'var(--negative)' }}>
                    {errorMsg}
                  </div>
                )}

                {/* Multi-currency / Peer-to-peer bank settlement notice */}
                <div
                  className="mb-2.5 p-2.5 rounded-lg border text-[10px] leading-relaxed flex items-start gap-2"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-accent)' }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <div>
                    <strong style={{ color: 'var(--text-secondary)' }}>Currency &amp; Bank Transfers:</strong> Displayed HUF and EUR amounts are reference prices. Because marketplace payments are sent directly to the seller, the actual settlement currency depends on the seller&apos;s bank account (HUF or EUR) — your bank or payment provider may apply its own exchange rate or conversion fees if your account currency differs.
                  </div>
                </div>

                <div
                  className="mb-3 p-2.5 rounded-lg border text-[10px] leading-relaxed"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  <strong style={{ color: 'var(--text-secondary)' }}>Peer-to-peer trade (Magánszemélyek közötti adásvétel):</strong>{' '}
                  Marketplace sellers are private individuals (<em>magánszemélyek</em>) unless they identify themselves as a business seller. Your purchase contract is formed directly with the seller, and statutory EU/Hungarian consumer rights (such as the 14-day right of withdrawal / <em>14 napos elállási jog</em>) do not apply to private sales.{' '}
                  <a href="/legal/terms" className="underline font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    Terms (ÁSZF)
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 rounded-xl font-black text-xs transition cursor-pointer shadow-lg active:scale-95 disabled:opacity-50"
                  style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent)' }}
                >
                  {!profile
                    ? 'Sign in to send your request'
                    : submitting
                      ? 'Sending…'
                      : groups.length > 1
                        ? `Request Holds from ${groups.length} Sellers (${cardCount} Cards)`
                        : `Request Hold on ${cardCount} Card${cardCount === 1 ? '' : 's'}`}
                </button>
                {profile && (
                  <p className="text-[10px] text-center mt-2" style={{ color: 'var(--text-muted)' }}>
                    Sending as {profile.display_name}{profile.email ? ` (${profile.email})` : ''}
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      )}

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
