import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { bannedResponse, getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { bumpCardContentVersion } from '../../../lib/moderatorRolesServer';
import { invalidateCardDataVersionCache } from '../card-data-version';
import { canCallerModerateGame } from '../../../lib/cardUpdateServer';
import {
  CARDMARKET_GAME_IDS,
  PRICE_GUIDE_URLS_BY_GAME,
  getCardmarketProductId,
  lowFromGuideRow,
  priceFromGuideRow,
  type GuideRow,
} from '../../../lib/cardmarketPrices';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized — Sign in required.' }, 401);
    if (caller.isBanned) return bannedResponse();
    if (!caller.isAdmin && !caller.isModerator) {
      return jsonResponse({ success: false, error: 'Forbidden — Moderator or Admin access required.' }, 403);
    }

    const body = await request.json().catch(() => null);
    const cardId = String(body?.card_id || '').trim();
    if (!cardId) return jsonResponse({ success: false, error: 'card_id is required.' }, 400);

    const { data: card, error: cardErr } = await supabaseAdmin
      .from('cards')
      .select('id, game, name, rarity, metadata')
      .eq('id', cardId)
      .maybeSingle();

    if (cardErr) throw cardErr;
    if (!card) return jsonResponse({ success: false, error: 'Card not found.' }, 404);

    const game = (card.game || 'riftbound').toLowerCase();
    if (!canCallerModerateGame(caller, game)) {
      return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
    }

    if (!CARDMARKET_GAME_IDS[game] || !PRICE_GUIDE_URLS_BY_GAME[game]) {
      return jsonResponse({ success: false, error: `No Cardmarket price guide is available for ${game}.` }, 400);
    }

    const overrideCmidRaw = body?.cardmarket_id;
    const overrideCmid =
      overrideCmidRaw !== undefined && overrideCmidRaw !== null && overrideCmidRaw !== ''
        ? Number(overrideCmidRaw)
        : null;
    const cmid =
      overrideCmid && Number.isInteger(overrideCmid) && overrideCmid > 0
        ? overrideCmid
        : getCardmarketProductId(card);

    if (!cmid) {
      return jsonResponse({ success: false, error: 'Set a valid Cardmarket Product ID first.' }, 400);
    }

    const guideRes = await fetch(PRICE_GUIDE_URLS_BY_GAME[game], { signal: AbortSignal.timeout(15000) });
    if (!guideRes.ok) {
      return jsonResponse({ success: false, error: `Cardmarket price guide returned HTTP ${guideRes.status}` }, 502);
    }

    const guideJson = await guideRes.json();
    const rows: GuideRow[] = Array.isArray(guideJson?.priceGuides) ? guideJson.priceGuides : [];
    const row = rows.find((r) => Number(r?.idProduct) === cmid);

    if (!row) {
      return jsonResponse(
        {
          success: false,
          error: `Product ID ${cmid} was not found in today's Cardmarket price guide (may have zero recent sales/offers).`,
        },
        404
      );
    }

    const { normal, foil, notes } = priceFromGuideRow(card.rarity, row);
    const { lowEur, lowFoilEur } = lowFromGuideRow(card.rarity, row);
    const nowIso = new Date().toISOString();
    const nextMeta: Record<string, any> = {
      ...(card.metadata && typeof card.metadata === 'object' ? card.metadata : {}),
      cardmarket_id: cmid,
    };
    if (lowEur !== null) nextMeta.cardmarket_low_eur = lowEur;
    else delete nextMeta.cardmarket_low_eur;
    if (lowFoilEur !== null) nextMeta.cardmarket_low_foil_eur = lowFoilEur;
    else delete nextMeta.cardmarket_low_foil_eur;

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('cards')
      .update({
        metadata: nextMeta,
        market_price_eur: normal,
        market_price_foil_eur: foil,
        last_price_updated_at: nowIso,
      })
      .eq('id', cardId)
      .select('*, sets ( id, name, code, release_date )')
      .single();

    if (updateErr) throw updateErr;

    if (normal !== null || foil !== null) {
      try {
        await supabaseAdmin.from('card_price_history').insert({
          card_id: cardId,
          market_price_eur: normal,
          market_price_foil_eur: foil,
          recorded_at: nowIso,
        });
      } catch {}
    }

    await bumpCardContentVersion();
    invalidateCardDataVersionCache();

    return jsonResponse({
      success: true,
      card: updated,
      guideRow: row,
      notes,
      syncedPrice: { eur: normal, eurFoil: foil },
    });
  } catch (err: any) {
    console.error('Sync Cardmarket price error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};
