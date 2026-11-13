import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { STORE_GAMES, IMPORT_BATCH_SIZE, buildProductSlug } from '../../../lib/storeConstants';
import { dedupeSingleSku } from '../../../lib/storeProducts';
import { parseStoreProductInput } from '../../../lib/storeProductInput';
import { normalizeCardCondition, type CardConditionInfo } from '../../../lib/collectionDefaults';
import { getCardImageUrl } from '../../../lib/supabase';
import { dispatchBackInStockNotifications } from './stock-alerts';

export const prerender = false;

type CardCondition = CardConditionInfo['id'];

const MAX_ITEMS_PER_REQUEST = IMPORT_BATCH_SIZE;

const COND_CODE: Record<CardCondition, string> = {
  'Pack Fresh': 'PF',
  'Near Mint': 'NM',
  'Excellent': 'EX',
  'Good': 'GD',
  'Played': 'PL',
  'Damaged': 'DM',
};

export interface BulkSingleInput {
  card_id: string;
  is_foil?: boolean;
  condition?: string;
  quantity: number;
  price_huf: number;
}

export interface BulkSingleResultItem {
  card_id: string;
  name: string;
  is_foil: boolean;
  condition: CardCondition;
  action: 'created' | 'updated' | 'error';
  quantity_added: number;
  new_stock?: number;
  sku?: string;
  error?: string;
}

function makeUniqueSingleSku(
  cardId: string,
  cardNumber: string | null | undefined,
  setCode: string | null | undefined,
  condition: CardCondition,
  isFoil: boolean,
  usedSkus: Set<string>
): string {
  const cleanNum = (cardNumber || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cleanSet = (setCode || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  const fallbackNum = cardId.slice(0, 8).toUpperCase();
  const baseRaw = `SGL-${cleanSet ? `${cleanSet}-` : ''}${cleanNum || fallbackNum}`;
  const dedupedBase = dedupeSingleSku(baseRaw) || `SGL-${fallbackNum}`;
  const suffix = `${COND_CODE[condition] || 'NM'}${isFoil ? 'F' : ''}`;
  const stem = `${dedupedBase}-${suffix}`;

  let candidate = stem;
  let counter = 2;
  while (usedSkus.has(candidate.toUpperCase())) {
    candidate = `${stem}-${counter}`;
    counter += 1;
  }
  usedSkus.add(candidate.toUpperCase());
  return candidate;
}

/**
 * POST /api/store/bulk-singles
 *
 * Batch-creates or tops up single-card store listings (`category: 'singles'`).
 * Bounded to IMPORT_BATCH_SIZE items per call so updates stay comfortably under Cloudflare
 * Workers' outbound subrequest limit; larger lists are chunked on the client.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await getRequestUser(request);
    if (!auth?.isAdmin) {
      return jsonResponse({ error: 'Unauthorized: Admin access required' }, 403);
    }

    const body = await request.json().catch(() => null);
    const rawItems: BulkSingleInput[] = Array.isArray(body?.items) ? body.items : [];
    const mergeExisting = body?.mergeExisting !== false;
    const updateExistingPrice = Boolean(body?.updateExistingPrice);
    const targetStatus: 'active' | 'draft' = body?.status === 'draft' ? 'draft' : 'active';

    if (rawItems.length === 0) {
      return jsonResponse({ error: 'No cards selected to save.' }, 400);
    }
    if (rawItems.length > MAX_ITEMS_PER_REQUEST) {
      return jsonResponse({ error: `Send at most ${MAX_ITEMS_PER_REQUEST} cards per batch.` }, 400);
    }

    // Fold duplicate (card_id, is_foil, condition) rows within the same batch before hitting DB.
    const folded = new Map<string, { card_id: string; is_foil: boolean; condition: CardCondition; quantity: number; price_huf: number }>();
    for (const raw of rawItems) {
      const cardId = String(raw?.card_id || '').trim();
      const qty = Math.max(0, Math.round(Number(raw?.quantity || 0)));
      const priceHuf = Math.max(0, Math.round(Number(raw?.price_huf || 0)));
      if (!cardId || qty <= 0) continue;
      const isFoil = Boolean(raw?.is_foil);
      const condition = normalizeCardCondition(raw?.condition || 'Pack Fresh') as CardCondition;
      const key = `${cardId}::${isFoil ? '1' : '0'}::${condition}`;
      const prev = folded.get(key);
      if (prev) {
        prev.quantity += qty;
        if (priceHuf > 0) prev.price_huf = priceHuf;
      } else {
        folded.set(key, { card_id: cardId, is_foil: isFoil, condition, quantity: qty, price_huf: priceHuf });
      }
    }

    const normalizedItems = [...folded.values()];
    if (normalizedItems.length === 0) {
      return jsonResponse({ error: 'All items had zero quantity or invalid card IDs.' }, 400);
    }

    const cardIds = [...new Set(normalizedItems.map((i) => i.card_id))];

    // Load authoritative card metadata + set info in one query.
    const { data: cardRows, error: cardErr } = await supabaseAdmin
      .from('cards')
      .select('id, name, card_number, rarity, card_type, domain, energy, might, tags, ability, image_path, game, sets(id, name, code, game)')
      .in('id', cardIds);

    if (cardErr) {
      return jsonResponse({ error: cardErr.message }, 500);
    }
    const cardById = new Map<string, any>((cardRows || []).map((c: any) => [c.id, c]));

    // Load existing SKUs (to avoid 23505 collisions) and existing single listings (to merge stock).
    const { data: existingProducts, error: existingErr } = await supabaseAdmin
      .from('store_products')
      .select('id, category, sku, name, slug, price_huf, stock_quantity, status, attributes, deleted_at')
      .limit(5000);

    if (existingErr) {
      return jsonResponse({ error: existingErr.message }, 500);
    }

    const usedSkus = new Set<string>();
    const existingBySingleKey = new Map<string, any>();

    for (const p of existingProducts || []) {
      if (p.sku) usedSkus.add(String(p.sku).trim().toUpperCase());
      if (p.deleted_at || p.category !== 'singles' || p.status === 'archived') continue;
      const attrs = p.attributes && typeof p.attributes === 'object' ? (p.attributes as Record<string, any>) : {};
      const cid = typeof attrs.card_id === 'string' ? attrs.card_id : '';
      if (!cid) continue;
      const foil = Boolean(attrs.is_foil);
      const cond = normalizeCardCondition(attrs.condition || 'Pack Fresh') as CardCondition;
      const k = `${cid}::${foil ? '1' : '0'}::${cond}`;
      if (!existingBySingleKey.has(k)) {
        existingBySingleKey.set(k, p);
      }
    }

    const results: BulkSingleResultItem[] = [];
    const inserts: Record<string, any>[] = [];
    const insertMeta: { item: (typeof normalizedItems)[number]; card: any }[] = [];

    for (const item of normalizedItems) {
      const card = cardById.get(item.card_id);
      if (!card) {
        results.push({
          card_id: item.card_id,
          name: item.card_id,
          is_foil: item.is_foil,
          condition: item.condition,
          action: 'error',
          quantity_added: 0,
          error: 'Card not found in catalog',
        });
        continue;
      }

      const key = `${item.card_id}::${item.is_foil ? '1' : '0'}::${item.condition}`;
      const match = mergeExisting ? existingBySingleKey.get(key) : null;

      if (match) {
        const prevStock = Number(match.stock_quantity || 0);
        const nextStock = Math.max(0, prevStock + item.quantity);
        const nextStatus = match.status === 'draft' ? 'draft' : nextStock > 0 ? 'active' : 'out_of_stock';
        const patch: Record<string, any> = {
          stock_quantity: nextStock,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        };
        if (updateExistingPrice && item.price_huf > 0 && item.price_huf !== match.price_huf) {
          patch.price_huf = item.price_huf;
        }

        const { error: updateErr } = await supabaseAdmin
          .from('store_products')
          .update(patch)
          .eq('id', match.id);

        if (updateErr) {
          results.push({
            card_id: item.card_id,
            name: card.name,
            is_foil: item.is_foil,
            condition: item.condition,
            action: 'error',
            quantity_added: 0,
            error: updateErr.message,
          });
          continue;
        }

        if (prevStock <= 0 && nextStock > 0 && nextStatus === 'active') {
          dispatchBackInStockNotifications({
            id: match.id,
            name: match.name || card.name,
            slug: match.slug,
            stock_quantity: nextStock,
          }).catch(() => {});
        }

        results.push({
          card_id: item.card_id,
          name: card.name,
          is_foil: item.is_foil,
          condition: item.condition,
          action: 'updated',
          quantity_added: item.quantity,
          new_stock: nextStock,
          sku: match.sku || undefined,
        });
        continue;
      }

      if (item.price_huf <= 0) {
        results.push({
          card_id: item.card_id,
          name: card.name,
          is_foil: item.is_foil,
          condition: item.condition,
          action: 'error',
          quantity_added: 0,
          error: 'Price must be greater than 0 HUF for new listings',
        });
        continue;
      }

      const setObj = Array.isArray(card.sets) ? card.sets[0] : card.sets;
      const gameId = card.game || setObj?.game || 'riftbound';
      const brandName = STORE_GAMES.find((g) => g.id === gameId)?.name || 'TCGXChange';
      const imageUrl = getCardImageUrl(card.image_path);
      const sku = makeUniqueSingleSku(
        card.id,
        card.card_number,
        setObj?.code,
        item.condition,
        item.is_foil,
        usedSkus
      );
      const variantLabel = `${item.condition}${item.is_foil ? ' · Foil' : ''}`;

      const parsed = parseStoreProductInput(
        {
          name: card.name,
          category: 'singles',
          brand: brandName,
          game: gameId,
          sku,
          price_huf: item.price_huf,
          stock_quantity: item.quantity,
          status: targetStatus,
          images: imageUrl ? [imageUrl] : [],
          variant_group: `single-${card.id}`,
          variant_label: variantLabel,
          variant_kind: 'other',
          attributes: {
            card_id: card.id,
            card_number: card.card_number || '',
            set_name: setObj?.name || '',
            set_code: setObj?.code || '',
            subcategory: setObj?.name || '',
            rarity: card.rarity || '',
            card_type: card.card_type || '',
            domain: card.domain || '',
            energy: card.energy ?? null,
            might: card.might ?? null,
            tags: Array.isArray(card.tags) ? card.tags : [],
            ability: card.ability || '',
            is_foil: item.is_foil,
            condition: item.condition,
          },
        },
        'create'
      );

      if (parsed.error) {
        results.push({
          card_id: item.card_id,
          name: card.name,
          is_foil: item.is_foil,
          condition: item.condition,
          action: 'error',
          quantity_added: 0,
          error: parsed.error,
        });
        continue;
      }

      parsed.product.slug = buildProductSlug(parsed.product.name, parsed.product.sku, parsed.product.variant_label);
      inserts.push(parsed.product);
      insertMeta.push({ item, card });
    }

    if (inserts.length > 0) {
      const { data: insertedRows, error: insertErr } = await supabaseAdmin
        .from('store_products')
        .insert(inserts)
        .select('id, sku, stock_quantity');

      if (insertErr) {
        for (const meta of insertMeta) {
          results.push({
            card_id: meta.item.card_id,
            name: meta.card.name,
            is_foil: meta.item.is_foil,
            condition: meta.item.condition,
            action: 'error',
            quantity_added: 0,
            error: insertErr.message,
          });
        }
      } else {
        for (let i = 0; i < insertMeta.length; i++) {
          const meta = insertMeta[i];
          const inserted = insertedRows?.[i];
          results.push({
            card_id: meta.item.card_id,
            name: meta.card.name,
            is_foil: meta.item.is_foil,
            condition: meta.item.condition,
            action: 'created',
            quantity_added: meta.item.quantity,
            new_stock: inserted?.stock_quantity ?? meta.item.quantity,
            sku: inserted?.sku ?? inserts[i].sku,
          });
        }
      }
    }

    const created = results.filter((r) => r.action === 'created').length;
    const updated = results.filter((r) => r.action === 'updated').length;
    const errors = results.filter((r) => r.action === 'error').length;

    return jsonResponse({
      success: errors === 0,
      created,
      updated,
      errors,
      items: results,
    });
  } catch (err: any) {
    return jsonResponse({ error: err?.message || 'Internal Server Error' }, 500);
  }
};
