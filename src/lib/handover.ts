/**
 * How a marketplace card gets from seller to buyer. Sellers pick which of these they offer per
 * listing (ListCardModal) or define their own custom shipping options in Seller Hub; buyers choose
 * one at checkout. Shared by the cart drawer and the hold-request API so both agree on what each
 * method needs.
 */

export type HandoverMethodId =
  | 'personal'
  | 'foxpost'
  | 'packeta'
  | 'gls'
  | 'posta'
  | 'dhl'
  | 'other'
  | 'international'
  | `custom:${string}`;

/** What the buyer has to provide for a method. */
export type HandoverKind = 'personal' | 'locker' | 'address' | 'custom';

export interface HandoverMethod {
  id: HandoverMethodId;
  label: string;
  kind: HandoverKind;
  /** For lockers and pickup points: where the buyer can look theirs up. */
  finderUrl?: string;
}

export const HANDOVER_METHODS: HandoverMethod[] = [
  { id: 'personal', label: 'In person', kind: 'personal' },
  { id: 'foxpost', label: 'Foxpost', kind: 'locker', finderUrl: 'https://foxpost.hu/csomagautomatak' },
  { id: 'packeta', label: 'Packeta', kind: 'locker', finderUrl: 'https://www.packeta.hu/atvevohelyek' },
  { id: 'other', label: 'Other / Custom', kind: 'custom' },
];

export const ALL_HANDOVER_IDS: HandoverMethodId[] = HANDOVER_METHODS.map((m) => m.id);

export function buildCustomHandoverId(kind: 'address' | 'locker' | 'custom', label: string): HandoverMethodId {
  const cleanLabel = label.replace(/:/g, ' - ').trim().slice(0, 60) || 'Custom Shipping';
  return `custom:${kind}:${cleanLabel}`;
}

export function handoverMethod(id: string | null | undefined): HandoverMethod | undefined {
  if (!id || typeof id !== 'string') return undefined;
  // 'pickup' is what older requests stored for in-person.
  const normalized = id === 'pickup' ? 'personal' : id;
  const found = HANDOVER_METHODS.find((m) => m.id === normalized);
  if (found) return found;
  // Cross-border delivery is offered from the seller's per-country rates, not from the
  // domestic method list, but it behaves like an address delivery.
  if (normalized === 'international') return { id: 'international', label: 'International shipping', kind: 'address' };
  // Backward compatibility for legacy listings/requests with legacy couriers:
  if (normalized === 'gls') return { id: 'gls', label: 'GLS Courier', kind: 'address' };
  if (normalized === 'posta') return { id: 'posta', label: 'Posta', kind: 'address' };
  if (normalized === 'dhl') return { id: 'dhl', label: 'DHL Express', kind: 'address' };
  // Seller-defined custom shipping method encoded as `custom:<kind>:<label>`
  if (normalized.startsWith('custom:')) {
    const parts = normalized.split(':');
    const rawKind = parts[1];
    const label = parts.slice(2).join(':').trim() || 'Custom Shipping';
    const kind: HandoverKind =
      rawKind === 'address' || rawKind === 'locker' || rawKind === 'custom' ? rawKind : 'address';
    return { id: normalized as HandoverMethodId, label, kind };
  }
  return undefined;
}

export function handoverLabel(id: string | null | undefined): string {
  return handoverMethod(id)?.label || 'Other';
}

/** A listing's methods, treating a missing or empty list (older listings) as "all of them". */
export function listingHandoverIds(methods: readonly string[] | null | undefined): HandoverMethodId[] {
  const known = (methods || []).map((m) => handoverMethod(m)?.id).filter(Boolean) as HandoverMethodId[];
  return known.length > 0 ? known : ALL_HANDOVER_IDS;
}

/**
 * Methods every one of these listings supports - a request covers all of a seller's cards in the
 * cart, so it can only use a method each of them was listed with.
 */
export function sharedHandoverIds(lists: (readonly string[] | null | undefined)[]): HandoverMethodId[] {
  if (lists.length === 0) return [];
  const allHandoverSets = lists.map((l) => listingHandoverIds(l));
  const first = allHandoverSets[0];
  return first.filter((id) => allHandoverSets.every((set) => set.includes(id)));
}

/** Where a shipped order goes. Kept in one shape so it can be remembered between checkouts. */
export interface DeliveryDetails {
  recipientName: string;
  phone: string;
  country?: string;
  /** Foxpost locker name / ID. */
  foxpostLocker: string;
  /** Packeta pickup point name / ID. */
  packetaPoint: string;
  postalCode: string;
  city: string;
  street: string;
}

export const EMPTY_DELIVERY: DeliveryDetails = {
  recipientName: '',
  phone: '',
  country: 'HU',
  foxpostLocker: '',
  packetaPoint: '',
  postalCode: '',
  city: '',
  street: '',
};

/** The fields a method needs filled in, or null if it needs none from the delivery form. */
export function missingDeliveryFields(methodId: string, d: DeliveryDetails): string[] | null {
  const m = handoverMethod(methodId);
  if (!m || (m.kind !== 'locker' && m.kind !== 'address')) return null;
  const missing: string[] = [];
  if (!d.recipientName.trim()) missing.push('recipient name');
  if (!d.phone.trim()) missing.push('phone number');
  if (m.id === 'foxpost' && !d.foxpostLocker.trim()) missing.push('Foxpost locker');
  if (m.id === 'packeta' && !d.packetaPoint.trim()) missing.push('Packeta pickup point');
  if (m.kind === 'address') {
    if (!d.postalCode.trim()) missing.push('postal code');
    if (!d.city.trim()) missing.push('city');
    if (!d.street.trim()) missing.push('street address');
  }
  return missing;
}

/**
 * The handover details a seller sees on the request (Seller Hub and the chat): only what the
 * chosen method needs, one fact per line. In person has none - that's arranged in the chat.
 */
export function formatHandoverDetails(methodId: string, d: DeliveryDetails, customText = ''): string {
  const m = handoverMethod(methodId);
  if (!m || m.kind === 'personal') return '';
  if (m.kind === 'custom') return customText.trim();
  const lines = [`Recipient: ${d.recipientName.trim()}`, `Phone: ${d.phone.trim()}`];
  if (d.country && (d.country !== 'HU' || m.id === 'international')) lines.push(`Country: ${d.country.trim()}`);
  if (m.id === 'foxpost') lines.push(`Foxpost locker: ${d.foxpostLocker.trim()}`);
  if (m.id === 'packeta') lines.push(`Packeta pickup point: ${d.packetaPoint.trim()}`);
  if (m.id.startsWith('custom:') && m.kind === 'locker' && customText.trim()) {
    lines.push(`${m.label} point/locker: ${customText.trim()}`);
  }
  if (m.kind === 'address') lines.push(`Address: ${d.postalCode.trim()} ${d.city.trim()}, ${d.street.trim()}`);
  return lines.join('\n');
}
