/**
 * Per-customer store limits.
 *
 * One setting now covers both "per order" and "per customer": the product says how many units one
 * customer may buy and over how many days. A single basket can never exceed it either, because the
 * current basket is part of the count. `max_per_order` is only read as a fallback for products
 * saved before the two fields were merged.
 */

export interface PurchaseBuyer {
  userId?: string | null;
  emails?: (string | null | undefined)[];
  phones?: (string | null | undefined)[];
}

export interface PurchaseOrderLike {
  user_id?: string | null;
  created_at?: string | null;
  status?: string | null;
  payment_status?: string | null;
  customer_info?: { email?: string | null; phone?: string | null } | null;
  notes?: string | null;
  items?: Array<{ inventory_id?: string | null; product_id?: string | null; quantity?: number | null }> | null;
}

export interface CustomerLimit {
  maxPerCustomer: number | null;
  /** 0 means no time limit (lifetime). */
  windowDays: number;
}

/** Lowercase, trimmed email, or null when it is not an email at all. */
export function normalizeEmail(value: unknown): string | null {
  const email = String(value || '').trim().toLowerCase();
  if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) return null;
  return email;
}

/** Digits only, with the Hungarian 06/+36/0036 forms collapsed to the same 36... number. */
export function normalizePhone(value: unknown): string | null {
  let digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('06')) digits = `36${digits.slice(2)}`;
  else if (digits.length === 9) digits = `36${digits}`;
  return digits.length >= 7 ? digits : null;
}

/** The unified purchase limit: units per customer, and the window they apply to. */
export function customerLimitFor(attributes: Record<string, any> | null | undefined): CustomerLimit {
  const max = Number(attributes?.max_per_customer);
  const legacyMax = Number(attributes?.max_per_order);
  const value = Number.isFinite(max) && max > 0 ? max : (Number.isFinite(legacyMax) && legacyMax > 0 ? legacyMax : null);
  const days = Number(attributes?.limit_window_days);
  return {
    maxPerCustomer: value === null ? null : Math.floor(value),
    windowDays: Number.isFinite(days) && days > 0 ? Math.floor(days) : 0,
  };
}

/** The cap a product puts on one basket - the same customer limit, never a second number. */
export function orderCapFor(attributes: Record<string, any> | null | undefined): number | null {
  return customerLimitFor(attributes).maxPerCustomer;
}

const CLOSED_OR_FAILED = new Set(['cancelled', 'canceled', 'refunded', 'failed']);

/** Whether an order still counts towards a limit (pending and paid orders do). */
export function countsTowardsLimit(order: PurchaseOrderLike): boolean {
  const status = String(order.status || '').trim().toLowerCase();
  const payment = String(order.payment_status || '').trim().toLowerCase();
  return !CLOSED_OR_FAILED.has(status) && payment !== 'failed';
}

function notesValue(notes: string, label: 'Email' | 'Phone'): string | null {
  const match = notes.match(new RegExp(`${label}:\\s*([^|\\n]+)`, 'i'));
  return match ? match[1].trim() : null;
}

/** The account/email/phone an order can be tied to. */
export function orderIdentity(order: PurchaseOrderLike): { userId: string | null; emails: Set<string>; phones: Set<string> } {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const notes = String(order.notes || '');

  for (const raw of [order.customer_info?.email, notesValue(notes, 'Email')]) {
    const email = normalizeEmail(raw);
    if (email) emails.add(email);
  }
  for (const raw of [order.customer_info?.phone, notesValue(notes, 'Phone')]) {
    const phone = normalizePhone(raw);
    if (phone) phones.add(phone);
  }

  const userId = order.user_id && order.user_id !== 'guest' ? String(order.user_id) : null;
  return { userId, emails, phones };
}

/** Whether an order was placed by this buyer, by account, email or phone. */
export function orderBelongsToBuyer(order: PurchaseOrderLike, buyer: PurchaseBuyer): boolean {
  const identity = orderIdentity(order);
  if (buyer.userId && identity.userId && buyer.userId === identity.userId) return true;

  for (const raw of buyer.emails || []) {
    const email = normalizeEmail(raw);
    if (email && identity.emails.has(email)) return true;
  }
  for (const raw of buyer.phones || []) {
    const phone = normalizePhone(raw);
    if (phone && identity.phones.has(phone)) return true;
  }
  return false;
}

/** Units of one product this buyer already bought in the window (0 = lifetime). */
export function unitsPurchasedInWindow(
  orders: PurchaseOrderLike[],
  buyer: PurchaseBuyer,
  productId: string,
  windowDays: number,
  now: number = Date.now()
): number {
  const windowStart = windowDays > 0 ? now - windowDays * 24 * 60 * 60 * 1000 : 0;
  let units = 0;

  for (const order of orders) {
    if (!countsTowardsLimit(order)) continue;
    if (windowDays > 0) {
      const createdAt = Date.parse(String(order.created_at || ''));
      if (!Number.isFinite(createdAt) || createdAt < windowStart) continue;
    }
    if (!orderBelongsToBuyer(order, buyer)) continue;

    for (const item of order.items || []) {
      if (String(item.inventory_id || item.product_id || '') !== productId) continue;
      const quantity = Number(item.quantity);
      if (Number.isFinite(quantity) && quantity > 0) units += quantity;
    }
  }
  return units;
}
