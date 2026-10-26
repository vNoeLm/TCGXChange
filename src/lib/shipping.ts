import { HANDOVER_METHODS, buildCustomHandoverId, type HandoverMethodId } from './handover';
import { COUNTRY_MAP } from './countries';

export interface ShippingOption {
  enabled: boolean;
  price_huf: number;
  min_order_huf: number;
}

/** One optional international destination: the seller ships there for this price. */
export interface InternationalDestination {
  country: string;
  price_huf: number;
}

/** Seller-defined custom shipping method (e.g. MPL, Posta Ajánlott, GLS, DPD, etc.). */
export interface CustomShippingMethod {
  id: HandoverMethodId;
  label: string;
  kind: 'address' | 'locker' | 'custom';
  enabled: boolean;
  price_huf: number;
  min_order_huf: number;
}

/** The four built-in methods sold domestically; `international` is priced per destination instead. */
export type DomesticHandoverMethodId = 'personal' | 'foxpost' | 'packeta' | 'other' | 'gls' | 'posta' | 'dhl';

/**
 * A seller's handover options. The domestic methods carry a price and minimum order; the
 * optional `international` list adds destination countries at a per-country price; `custom_methods`
 * lets sellers add any custom courier or postal option without requiring a built-in preset.
 */
export type ShippingSettings = Partial<Record<DomesticHandoverMethodId, ShippingOption>> & {
  in_person_location?: string;
  international?: InternationalDestination[];
  custom_methods?: CustomShippingMethod[];
};

const MAX_HUF = 1_000_000;
const huf = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_HUF, Math.max(0, n)) : 0;
};

/** Cleans whatever was stored (or typed) into a settings object: known methods, whole forint, >= 0. */
export function normalizeShipping(raw: unknown): ShippingSettings {
  const out: ShippingSettings = {};
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, any>;
  if (typeof obj.in_person_location === 'string' && obj.in_person_location.trim()) {
    out.in_person_location = obj.in_person_location.trim().slice(0, 150);
  }
  if (Array.isArray(obj.international)) {
    const seen = new Set<string>();
    out.international = obj.international
      .map((d: any) => ({
        country: String(d?.country || '').toUpperCase(),
        price_huf: huf(d?.price_huf),
      }))
      .filter((d: InternationalDestination) => {
        if (!COUNTRY_MAP.has(d.country) || seen.has(d.country)) return false;
        seen.add(d.country);
        return true;
      });
  }
  if (Array.isArray(obj.custom_methods)) {
    const seenIds = new Set<string>();
    out.custom_methods = obj.custom_methods
      .slice(0, 12)
      .map((cm: any): CustomShippingMethod | null => {
        const label = String(cm?.label || '').trim().slice(0, 60);
        if (!label) return null;
        const kind: 'address' | 'locker' | 'custom' =
          cm?.kind === 'locker' || cm?.kind === 'custom' ? cm.kind : 'address';
        const id = buildCustomHandoverId(kind, label);
        if (seenIds.has(id)) return null;
        seenIds.add(id);
        return {
          id,
          label,
          kind,
          enabled: cm?.enabled !== false,
          price_huf: huf(cm?.price_huf),
          min_order_huf: huf(cm?.min_order_huf),
        };
      })
      .filter((cm): cm is CustomShippingMethod => Boolean(cm));
  }
  for (const m of HANDOVER_METHODS) {
    const o = obj[m.id];
    if (!o || typeof o !== 'object') continue;
    const opt: ShippingOption = {
      enabled: Boolean(o.enabled),
      price_huf: huf(o.price_huf),
      min_order_huf: huf(o.min_order_huf),
    };
    out[m.id as DomesticHandoverMethodId] = opt;
  }
  return out;
}

/** Looks up what a seller charges for one domestic or custom method (defaults: free, no minimum). */
export function shippingOption(settings: ShippingSettings | null | undefined, id: HandoverMethodId): ShippingOption {
  if (!settings || Object.keys(settings).length === 0) {
    if (typeof id === 'string' && id.startsWith('custom:')) {
      return { enabled: false, price_huf: 0, min_order_huf: 0 };
    }
    return { enabled: true, price_huf: 0, min_order_huf: 0 };
  }
  if (typeof id === 'string' && id.startsWith('custom:')) {
    const cm = settings.custom_methods?.find((m) => m.id === id);
    if (!cm) return { enabled: false, price_huf: 0, min_order_huf: 0 };
    return { enabled: cm.enabled, price_huf: cm.price_huf, min_order_huf: cm.min_order_huf };
  }
  return settings[id as DomesticHandoverMethodId] || { enabled: false, price_huf: 0, min_order_huf: 0 };
}

/** The seller's price for delivering to a country abroad, or null if they don't ship there. */
export function internationalRate(settings: ShippingSettings | null | undefined, buyerCountry: string): number | null {
  const code = buyerCountry.toUpperCase();
  const entry = settings?.international?.find((d) => d.country === code);
  return entry ? entry.price_huf : null;
}

/** Whether a listing should be visible in a given country's marketplace. */
export function sellerVisibleToCountry(
  settings: ShippingSettings | null | undefined,
  sellerCountry: string,
  viewerCountry: string
): boolean {
  if (sellerCountry.toUpperCase() === viewerCountry.toUpperCase()) return true;
  return internationalRate(settings, viewerCountry) !== null;
}

export interface MethodAvailability {
  id: HandoverMethodId;
  offered: boolean;
  price: number;
  min: number;
  short: number;
}

/** Works out if an order meets a domestic method's minimum, and if not, by how much. */
export function methodAvailability(
  settings: ShippingSettings | null | undefined,
  id: HandoverMethodId,
  subtotal: number
): MethodAvailability {
  const o = shippingOption(settings, id);
  return { id, offered: o.enabled, price: o.price_huf, min: o.min_order_huf, short: Math.max(0, o.min_order_huf - subtotal) };
}

export interface DynamicHandoverMethod {
  id: HandoverMethodId;
  label: string;
  desc: string;
  price_huf: number;
  min_order_huf: number;
  isCustom?: boolean;
}

/** Returns all domestic and custom shipping methods enabled by the seller in Seller Hub. */
export function getSellerHandoverMethods(settings: ShippingSettings | null | undefined): DynamicHandoverMethod[] {
  const result: DynamicHandoverMethod[] = [];

  // 1. Built-in methods
  for (const m of HANDOVER_METHODS) {
    const opt = shippingOption(settings, m.id);
    const enabled = settings ? opt.enabled : true;
    if (enabled) {
      result.push({
        id: m.id,
        label: m.label,
        desc: m.kind === 'personal' ? 'In person' : m.kind === 'locker' ? 'Parcel locker' : 'Delivery',
        price_huf: opt.price_huf,
        min_order_huf: opt.min_order_huf,
      });
    }
  }

  // 2. Custom shipping methods configured by seller
  if (settings?.custom_methods && Array.isArray(settings.custom_methods)) {
    for (const cm of settings.custom_methods) {
      if (cm.enabled && cm.label?.trim()) {
        result.push({
          id: cm.id,
          label: cm.label.trim(),
          desc: cm.kind === 'locker' ? 'Parcel locker' : cm.kind === 'address' ? 'Courier delivery' : 'Custom shipping',
          price_huf: cm.price_huf,
          min_order_huf: cm.min_order_huf,
          isCustom: true,
        });
      }
    }
  }

  if (result.length === 0) {
    return HANDOVER_METHODS.map((m) => ({
      id: m.id,
      label: m.label,
      desc: m.kind === 'personal' ? 'In person' : 'Delivery',
      price_huf: 0,
      min_order_huf: 0,
    }));
  }

  return result;
}

export const fmtHuf = (n: number) =>
  new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n);

/** "Free", "1 500 Ft", "1 500 Ft · from 5 000 Ft" */
export function describeOption(
  o: { price: number; min: number },
  formatter?: (n: number) => string
): string {
  const fmt = formatter || fmtHuf;
  const price = o.price > 0 ? fmt(o.price) : 'Free';
  return o.min > 0 ? `${price} · from ${fmt(o.min)}` : price;
}
