import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { jsonResponse } from '../../../lib/requestAuth';
import { LISTING_CONDITIONS, normalizeCardCondition } from '../../../lib/collectionDefaults';
import { isMissingSchemaError, isUuid, requireP2PUser } from '../../../lib/p2pServer';

export const prerender = false;

interface BulkSingleInput {
  card_id?: string;
  is_foil?: boolean;
  condition?: string;
  quantity?: number;
  price_huf?: number;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const auth = await requireP2PUser(request);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    const items: BulkSingleInput[] = Array.isArray(body?.items) ? body.items : [];
    const mergeExisting = body?.mergeExisting !== false;
    const updateExistingPrice = Boolean(body?.updateExistingPrice);

    if (items.length === 0 || items.length > 200) {
      return jsonResponse({ success: false, error: 'Provide between 1 and 200 cards per batch.' }, 400);
    }

    const sellerId = auth.caller.user.id;
    const candidateCardIds = Array.from(
      new Set(items.map((it) => it?.card_id).filter((id): id is string => isUuid(id)))
    );

    const validCardIds = new Set<string>();
    if (candidateCardIds.length > 0) {
      const { data: cards } = await supabaseAdmin.from('cards').select('id').in('id', candidateCardIds);
      for (const c of cards || []) validCardIds.add(c.id);
    }

    // Load seller's existing non-deleted listings for merge matching
    const existingMap = new Map<string, { id: string; quantity: number; price_huf: number; status: string }>();
    if (mergeExisting && candidateCardIds.length > 0) {
      const { data: existingRows, error: exErr } = await supabaseAdmin
        .from('marketplace_listings')
        .select('id, card_id, is_foil, condition, quantity, price_huf, status')
        .eq('seller_id', sellerId)
        .in('card_id', candidateCardIds)
        .is('deleted_at', null);

      if (exErr && isMissingSchemaError(exErr)) {
        return jsonResponse({ success: false, error: 'Marketplace migration required.' }, 503);
      }

      for (const row of existingRows || []) {
        const cond = normalizeCardCondition(row.condition);
        const key = `${row.card_id}::${row.is_foil ? '1' : '0'}::${cond}`;
        if (!existingMap.has(key)) existingMap.set(key, row);
      }
    }

    let created = 0;
    let updated = 0;
    let errors = 0;
    const results: Array<{
      card_id: string;
      is_foil: boolean;
      condition: string;
      action: 'created' | 'updated' | 'error';
      error?: string;
    }> = [];

    for (const raw of items) {
      const cardId = isUuid(raw?.card_id) ? raw.card_id!.trim() : '';
      const isFoil = Boolean(raw?.is_foil);
      const condition = normalizeCardCondition(raw?.condition || 'Near Mint');
      const qty = Math.round(Number(raw?.quantity ?? 1));
      const priceHuf = Math.round(Number(raw?.price_huf ?? 0));

      if (!cardId || !validCardIds.has(cardId)) {
        errors++;
        results.push({ card_id: cardId, is_foil: isFoil, condition, action: 'error', error: 'Invalid card.' });
        continue;
      }
      if (!(LISTING_CONDITIONS as readonly string[]).includes(condition)) {
        errors++;
        results.push({ card_id: cardId, is_foil: isFoil, condition, action: 'error', error: 'Invalid condition.' });
        continue;
      }
      if (!Number.isFinite(qty) || qty < 1 || qty > 500) {
        errors++;
        results.push({ card_id: cardId, is_foil: isFoil, condition, action: 'error', error: 'Invalid quantity.' });
        continue;
      }
      if (!Number.isFinite(priceHuf) || priceHuf < 1 || priceHuf > 50_000_000) {
        errors++;
        results.push({ card_id: cardId, is_foil: isFoil, condition, action: 'error', error: 'Invalid price.' });
        continue;
      }

      const key = `${cardId}::${isFoil ? '1' : '0'}::${condition}`;
      const match = mergeExisting ? existingMap.get(key) : undefined;

      if (match) {
        const nextQty = Math.min(999, match.quantity + qty);
        const nextPrice = updateExistingPrice ? priceHuf : match.price_huf;
        const { error: updErr } = await supabaseAdmin
          .from('marketplace_listings')
          .update({
            quantity: nextQty,
            price_huf: nextPrice,
            status: 'In Stock',
            updated_at: new Date().toISOString(),
          })
          .eq('id', match.id);

        if (updErr) {
          errors++;
          results.push({ card_id: cardId, is_foil: isFoil, condition, action: 'error', error: updErr.message });
        } else {
          match.quantity = nextQty;
          match.price_huf = nextPrice;
          updated++;
          results.push({ card_id: cardId, is_foil: isFoil, condition, action: 'updated' });
        }
      } else {
        const { data: ins, error: insErr } = await supabaseAdmin
          .from('marketplace_listings')
          .insert({
            seller_id: sellerId,
            card_id: cardId,
            is_foil: isFoil,
            condition,
            quantity: qty,
            price_huf: priceHuf,
            status: 'In Stock',
            handover_methods: ['chat'],
            images: [],
          })
          .select('id, quantity, price_huf, status')
          .single();

        if (insErr) {
          errors++;
          results.push({ card_id: cardId, is_foil: isFoil, condition, action: 'error', error: insErr.message });
        } else {
          if (ins) existingMap.set(key, ins);
          created++;
          results.push({ card_id: cardId, is_foil: isFoil, condition, action: 'created' });
        }
      }
    }

    return jsonResponse({ success: true, created, updated, errors, items: results }, 200);
  } catch (err: any) {
    console.error('Marketplace bulk singles POST error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Bulk upload failed.' }, 500);
  }
};
