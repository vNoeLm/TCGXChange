import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { STORE_CATEGORIES, STORE_PUBLIC_LAUNCH, STORE_STATUSES, STORE_VARIANT_KINDS, buildProductSlug } from '../../../lib/storeConstants';
import { sanitizePlainText, sanitizeUrl } from '../../../lib/sanitize';
import { dispatchBackInStockNotifications } from './stock-alerts';

export const prerender = false;

const CATEGORY_IDS = new Set<string>(STORE_CATEGORIES.map((c) => c.id));
const STATUS_IDS = new Set<string>(STORE_STATUSES);
const KIND_IDS = new Set<string>(STORE_VARIANT_KINDS.map((k) => k.id));

/** What a shopper may see: live products, including sold-out ones (shown as such), never drafts or archived. */
const PUBLIC_STATUSES = ['active', 'out_of_stock'];

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

interface ParsedInput {
  product: Record<string, any>;
  priv: { supplier?: string | null; cost_price_huf?: number | null };
  error?: string;
}

/**
 * Whitelists and sanitises an admin payload. Anything not listed here (id, slug, created_at,
 * deleted_at...) can never be set from the request body.
 */
function parseProductInput(body: any, mode: 'create' | 'update'): ParsedInput {
  const product: Record<string, any> = {};
  const priv: ParsedInput['priv'] = {};
  const has = (k: string) => body[k] !== undefined;

  if (has('name')) product.name = sanitizePlainText(body.name, 200);
  if (has('brand')) product.brand = sanitizePlainText(body.brand, 100) || 'None';
  if (has('category')) {
    const rawCat = sanitizePlainText(body.category, 60).trim().toLowerCase().replace(/\s+/g, '_');
    if (!rawCat || !/^[a-z0-9_-]{2,60}$/.test(rawCat)) return { product, priv, error: 'Invalid category format.' };
    product.category = rawCat;
  }
  if (has('game')) product.game = body.game && body.game !== 'universal' ? sanitizePlainText(body.game, 50) : null;
  if (has('sku')) product.sku = sanitizePlainText(body.sku, 80) || null;
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
    const a = body.attributes && typeof body.attributes === 'object' ? body.attributes : {};
    const parsedReleaseAt = typeof a.release_at === 'string' && a.release_at.trim() && Number.isFinite(Date.parse(a.release_at.trim()))
      ? new Date(Date.parse(a.release_at.trim())).toISOString()
      : null;
    product.attributes = {
      ...(a.color ? { color: sanitizePlainText(a.color, 60) } : {}),
      ...(a.size ? { size: sanitizePlainText(a.size, 60) } : {}),
      ...(a.subcategory ? { subcategory: sanitizePlainText(a.subcategory, 80) } : {}),
      ...(a.language ? { language: sanitizePlainText(a.language, 60) } : {}),
      ...(toInt(a.max_per_order) ? { max_per_order: toInt(a.max_per_order) } : {}),
      ...(toInt(a.msrp_huf) ? { msrp_huf: toInt(a.msrp_huf) } : {}),
      ...(parsedReleaseAt ? { release_at: parsedReleaseAt } : {}),
    };
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

async function writePrivate(productId: string, priv: ParsedInput['priv']) {
  if (Object.keys(priv).length === 0) return null;
  const { error } = await supabaseAdmin
    .from('store_product_private')
    .upsert({ product_id: productId, ...priv, updated_at: new Date().toISOString() }, { onConflict: 'product_id' });
  return error;
}

async function withPrivate<T extends { id: string }>(products: T[]): Promise<(T & { supplier: string | null; cost_price_huf: number | null })[]> {
  if (products.length === 0) return [];
  const { data } = await supabaseAdmin.from('store_product_private').select('product_id, supplier, cost_price_huf');
  const byId = new Map((data || []).map((r: any) => [r.product_id, r]));
  return products.map((p) => ({
    ...p,
    supplier: (byId.get(p.id) as any)?.supplier ?? null,
    cost_price_huf: (byId.get(p.id) as any)?.cost_price_huf ?? null,
  }));
}

const adminOnly = async (request: Request) => {
  const auth = await getRequestUser(request);
  return auth?.isAdmin ? auth : null;
};

/**
 * GET /api/store/products             -> the catalogue
 * GET /api/store/products?slug=...    -> one product plus its variant siblings (the product page)
 *
 * Until STORE_PUBLIC_LAUNCH is true only admins get an answer. Admins also see drafts and the
 * supplier / cost columns; those are never part of a public response.
 */
export const GET: APIRoute = async ({ request }) => {
  try {
    const auth = await getRequestUser(request);
    const isAdmin = Boolean(auth?.isAdmin);

    if (!isAdmin && !STORE_PUBLIC_LAUNCH) {
      return jsonResponse({ error: 'The store is not open yet.' }, 403);
    }

    const slug = new URL(request.url).searchParams.get('slug');
    const nowMs = Date.now();
    const isScheduledFuture = (p: any) => {
      const rel = p?.attributes?.release_at;
      return typeof rel === 'string' && rel.trim() !== '' && Date.parse(rel) > nowMs;
    };
    const isReleasedDraft = (p: any) => {
      const rel = p?.attributes?.release_at;
      return p?.status === 'draft' && typeof rel === 'string' && rel.trim() !== '' && Date.parse(rel) <= nowMs;
    };

    // Promote any timed-release draft whose release_at has passed
    let query = supabaseAdmin.from('store_products').select('*').is('deleted_at', null);
    if (!isAdmin) query = query.in('status', [...PUBLIC_STATUSES, 'draft']);

    if (slug) {
      const { data: product, error } = await query.eq('slug', slug).maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 500);
      if (!product) return jsonResponse({ error: 'Product not found.' }, 404);
      if (isReleasedDraft(product)) {
        const nextStatus = (product.stock_quantity || 0) > 0 ? 'active' : 'out_of_stock';
        product.status = nextStatus;
        await supabaseAdmin.from('store_products').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', product.id);
      }
      if (!isAdmin && (product.status === 'draft' || isScheduledFuture(product))) {
        return jsonResponse({ error: 'Product not found.' }, 404);
      }

      let siblings: any[] = [];
      if (product.variant_group) {
        let sib = supabaseAdmin
          .from('store_products')
          .select('*')
          .is('deleted_at', null)
          .eq('variant_group', product.variant_group)
          .order('variant_label', { ascending: true });
        if (!isAdmin) sib = sib.in('status', PUBLIC_STATUSES);
        const { data } = await sib;
        siblings = (data || []).filter((s: any) => isAdmin || !isScheduledFuture(s));
      }
      const [withCost] = isAdmin ? await withPrivate([product]) : [product];
      return jsonResponse({ product: withCost, siblings, isAdmin });
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(2000);
    if (error) {
      // 42P01: the migration has not been applied yet. Say so instead of a bare 500.
      if ((error as any).code === '42P01') {
        return jsonResponse({ products: [], isAdmin, warning: 'Run the store_products migrations (20261022000000, 20261022010000).' });
      }
      return jsonResponse({ error: error.message }, 500);
    }

    const rawList = data || [];
    for (const p of rawList) {
      if (isReleasedDraft(p)) {
        const nextStatus = (p.stock_quantity || 0) > 0 ? 'active' : 'out_of_stock';
        p.status = nextStatus;
        await supabaseAdmin.from('store_products').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', p.id);
      }
    }
    const filteredList = isAdmin
      ? rawList
      : rawList.filter((p: any) => PUBLIC_STATUSES.includes(p.status) && !isScheduledFuture(p));

    const products = isAdmin ? await withPrivate(filteredList) : filteredList;
    return jsonResponse({ products, isAdmin });
  } catch (err: any) {
    return jsonResponse({ error: err.message || 'Internal Server Error' }, 500);
  }
};

/** POST: create one product (admin). */
export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(await adminOnly(request))) return jsonResponse({ error: 'Unauthorized: Admin access required' }, 403);

    const body = await request.json().catch(() => null);
    if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);

    const { product, priv, error } = parseProductInput(body, 'create');
    if (error) return jsonResponse({ error }, 400);

    product.slug = buildProductSlug(product.name, product.sku, product.variant_label);

    let { data, error: insertError } = await supabaseAdmin.from('store_products').insert(product).select().single();
    if (insertError && (insertError as any).message?.includes('store_products_variant_kind_check') && product.variant_kind === 'language') {
      product.variant_kind = 'other';
      const retry = await supabaseAdmin.from('store_products').insert(product).select().single();
      data = retry.data;
      insertError = retry.error;
    }
    if (insertError) {
      const dup = (insertError as any).code === '23505';
      return jsonResponse({ error: dup ? 'A product with this SKU already exists.' : insertError.message }, dup ? 409 : 500);
    }

    const privError = await writePrivate(data.id, priv);
    if (privError) return jsonResponse({ error: privError.message }, 500);

    return jsonResponse({ success: true, product: { ...data, ...priv } }, 201);
  } catch (err: any) {
    return jsonResponse({ error: err.message || 'Internal Server Error' }, 500);
  }
};

/** PATCH: update one product (admin). The slug is never regenerated, so product links keep working. */
export const PATCH: APIRoute = async ({ request }) => {
  try {
    if (!(await adminOnly(request))) return jsonResponse({ error: 'Unauthorized: Admin access required' }, 403);

    const body = await request.json().catch(() => null);
    if (!body?.id) return jsonResponse({ error: 'Product ID is required for update' }, 400);

    const { product, priv, error } = parseProductInput(body, 'update');
    if (error) return jsonResponse({ error }, 400);

    let data: any = null;
    if (Object.keys(product).length > 0) {
      product.updated_at = new Date().toISOString();
      let res = await supabaseAdmin.from('store_products').update(product).eq('id', body.id).select().single();
      if (res.error && (res.error as any).message?.includes('store_products_variant_kind_check') && product.variant_kind === 'language') {
        product.variant_kind = 'other';
        res = await supabaseAdmin.from('store_products').update(product).eq('id', body.id).select().single();
      }
      if (res.error) {
        const dup = (res.error as any).code === '23505';
        return jsonResponse({ error: dup ? 'A product with this SKU already exists.' : res.error.message }, dup ? 409 : 500);
      }
      data = res.data;
    } else {
      const res = await supabaseAdmin.from('store_products').select('*').eq('id', body.id).single();
      data = res.data;
    }

    const privError = await writePrivate(body.id, priv);
    if (privError) return jsonResponse({ error: privError.message }, 500);

    if (data && (data.stock_quantity || 0) > 0 && data.status === 'active') {
      dispatchBackInStockNotifications(data).catch(() => {});
    }

    return jsonResponse({ success: true, product: { ...data, ...priv } });
  } catch (err: any) {
    return jsonResponse({ error: err.message || 'Internal Server Error' }, 500);
  }
};

/** DELETE: archive (soft delete) a product (admin). */
export const DELETE: APIRoute = async ({ request }) => {
  try {
    if (!(await adminOnly(request))) return jsonResponse({ error: 'Unauthorized: Admin access required' }, 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return jsonResponse({ error: 'Product ID is required' }, 400);

    const { error } = await supabaseAdmin
      .from('store_products')
      .update({ deleted_at: new Date().toISOString(), status: 'archived' })
      .eq('id', id);
    if (error) return jsonResponse({ error: error.message }, 500);

    return jsonResponse({ success: true, id });
  } catch (err: any) {
    return jsonResponse({ error: err.message || 'Internal Server Error' }, 500);
  }
};
