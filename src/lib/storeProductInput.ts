import { normalizeCardCondition } from './collectionDefaults';
import { sanitizePlainText, sanitizeUrl } from './sanitize';
import { STORE_STATUSES, STORE_VARIANT_KINDS } from './storeConstants';
import { dedupeSingleSku } from './storeProducts';

const STATUS_IDS = new Set<string>(STORE_STATUSES);
const KIND_IDS = new Set<string>(STORE_VARIANT_KINDS.map((k) => k.id));

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export interface ParsedStoreProductInput {
  product: Record<string, any>;
  priv: { supplier?: string | null; cost_price_huf?: number | null };
  error?: string;
}

/** Sanitizes and normalizes generic + singles-specific store product `attributes`. */
export function sanitizeStoreAttributes(raw: unknown): Record<string, any> {
  const a = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const parsedReleaseAt =
    typeof a.release_at === 'string' && a.release_at.trim() && Number.isFinite(Date.parse(a.release_at.trim()))
      ? new Date(Date.parse(a.release_at.trim())).toISOString()
      : null;
  const customerLimit = toInt(a.max_per_customer) || toInt(a.max_per_order) || 0;
  const limitWindowDays = toInt(a.limit_window_days) || 0;
  const energyVal = a.energy === null || a.energy === undefined || a.energy === '' ? null : toInt(a.energy);
  const rawCondition = typeof a.condition === 'string' && a.condition.trim() ? normalizeCardCondition(a.condition) : null;
  const tags = Array.isArray(a.tags)
    ? a.tags.map((tag: unknown) => sanitizePlainText(tag, 50)).filter(Boolean).slice(0, 24)
    : null;

  return {
    ...(a.color ? { color: sanitizePlainText(a.color, 60) } : {}),
    ...(a.size ? { size: sanitizePlainText(a.size, 60) } : {}),
    ...(a.subcategory ? { subcategory: sanitizePlainText(a.subcategory, 80) } : {}),
    ...(a.language ? { language: sanitizePlainText(a.language, 60) } : {}),
    ...(customerLimit > 0 ? { max_per_customer: customerLimit } : {}),
    ...(customerLimit > 0 && limitWindowDays > 0 ? { limit_window_days: limitWindowDays } : {}),
    ...(toInt(a.msrp_huf) ? { msrp_huf: toInt(a.msrp_huf) } : {}),
    ...(parsedReleaseAt ? { release_at: parsedReleaseAt } : {}),
    // Single-card catalog & collection sync metadata
    ...(a.card_id ? { card_id: sanitizePlainText(a.card_id, 100) } : {}),
    ...(a.card_number ? { card_number: sanitizePlainText(a.card_number, 60) } : {}),
    ...(a.set_name ? { set_name: sanitizePlainText(a.set_name, 100) } : {}),
    ...(a.set_code ? { set_code: sanitizePlainText(a.set_code, 32).toUpperCase() } : {}),
    ...(a.rarity ? { rarity: sanitizePlainText(a.rarity, 60) } : {}),
    ...(a.card_type ? { card_type: sanitizePlainText(a.card_type, 80) } : {}),
    ...(a.domain ? { domain: sanitizePlainText(a.domain, 120) } : {}),
    ...(energyVal !== null ? { energy: energyVal } : {}),
    ...(a.might !== undefined && a.might !== null && a.might !== '' ? { might: toInt(a.might) } : {}),
    ...(a.is_foil !== undefined ? { is_foil: Boolean(a.is_foil) } : {}),
    ...(rawCondition ? { condition: sanitizePlainText(rawCondition, 60) } : {}),
    ...(a.ability ? { ability: sanitizePlainText(a.ability, 1500) } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(a.seller_id ? { seller_id: sanitizePlainText(a.seller_id, 100) } : {}),
    ...(a.collection_id ? { collection_id: sanitizePlainText(a.collection_id, 100) } : {}),
    ...(a.collection_key ? { collection_key: sanitizePlainText(a.collection_key, 120) } : {}),
  };
}

/**
 * Whitelists and sanitises an admin payload. Anything not listed here (id, slug, created_at,
 * deleted_at...) can never be set from the request body.
 */
export function parseStoreProductInput(body: any, mode: 'create' | 'update'): ParsedStoreProductInput {
  const product: Record<string, any> = {};
  const priv: ParsedStoreProductInput['priv'] = {};
  const has = (k: string) => body[k] !== undefined;

  if (has('name')) product.name = sanitizePlainText(body.name, 200);
  if (has('brand')) product.brand = sanitizePlainText(body.brand, 100) || 'None';
  if (has('category')) {
    const rawCat = sanitizePlainText(body.category, 60).trim().toLowerCase().replace(/\s+/g, '_');
    if (!rawCat || !/^[a-z0-9_-]{2,60}$/.test(rawCat)) return { product, priv, error: 'Invalid category format.' };
    product.category = rawCat;
  }
  if (has('game')) product.game = body.game && body.game !== 'universal' ? sanitizePlainText(body.game, 50) : null;
  if (has('sku')) {
    const cleanSku = sanitizePlainText(body.sku, 80) || null;
    product.sku = cleanSku ? dedupeSingleSku(cleanSku) : null;
  }
  if (has('ean')) product.ean = sanitizePlainText(body.ean, 32) || null;
  if (has('description')) product.description = sanitizePlainText(body.description, 4000) || null;
  if (has('is_featured')) product.is_featured = Boolean(body.is_featured);

  if (has('price_huf')) {
    const n = toInt(body.price_huf);
    if (n === null) return { product, priv, error: 'Invalid price.' };
    product.price_huf = n;
  }
  if (has('original_price_huf')) product.original_price_huf = toInt(body.original_price_huf);
  if (has('stock_quantity')) {
    const n = toInt(body.stock_quantity);
    if (n === null) return { product, priv, error: 'Invalid stock quantity.' };
    product.stock_quantity = n;
  }
  if (has('status')) {
    if (!STATUS_IDS.has(body.status)) return { product, priv, error: 'Invalid status.' };
    product.status = body.status === 'draft' ? 'draft' : 'active';
  }

  if (has('images')) {
    const list = Array.isArray(body.images) ? body.images : [];
    const urls = list.map((u: unknown) => sanitizeUrl(u)).filter((u: string | null): u is string => Boolean(u));
    if (urls.length !== list.length) return { product, priv, error: 'An image URL is not a valid http(s) link.' };
    product.images = urls;
  }
  if (has('attributes')) {
    product.attributes = sanitizeStoreAttributes(body.attributes);
  }

  if (has('variant_group')) product.variant_group = sanitizePlainText(body.variant_group, 120) || null;
  if (has('variant_label')) product.variant_label = sanitizePlainText(body.variant_label, 80) || null;
  if (has('variant_kind')) {
    if (body.variant_kind && !KIND_IDS.has(body.variant_kind)) return { product, priv, error: 'Invalid variant kind.' };
    product.variant_kind = body.variant_kind || null;
  }
  if (product.variant_group && has('variant_label') && !product.variant_label) {
    return { product, priv, error: 'A product in a variant group needs a variant label (e.g. "Black").' };
  }

  if (has('supplier')) priv.supplier = sanitizePlainText(body.supplier, 120) || null;
  if (has('cost_price_huf')) priv.cost_price_huf = toInt(body.cost_price_huf);

  if (mode === 'create') {
    for (const k of ['name', 'brand', 'category', 'price_huf']) {
      if (product[k] === undefined || product[k] === '') return { product, priv, error: `Missing required field: ${k}.` };
    }
    product.status = product.status ?? 'draft';
    product.stock_quantity = product.stock_quantity ?? 0;
  }
  return { product, priv };
}
