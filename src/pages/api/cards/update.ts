import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse, bannedResponse } from '../../../lib/requestAuth';
import { sanitizePlainText } from '../../../lib/sanitize';
import { CARD_UPDATE_REQUESTS_KEY } from '../../../lib/moderatorRolesServer';
import { applyCardEdits } from '../../../lib/cardUpdateServer';
import type { CardUpdateRequest } from '../../../lib/cardUpdates';

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
    if (!cardId) {
      return jsonResponse({ success: false, error: 'card_id is required.' }, 400);
    }

    const { data: cardRow, error: cardErr } = await supabaseAdmin
      .from('cards')
      .select('id, game')
      .eq('id', cardId)
      .maybeSingle();

    if (cardErr) throw cardErr;
    if (!cardRow) {
      return jsonResponse({ success: false, error: 'Card not found.' }, 404);
    }

    const cardGame = (cardRow.game || 'riftbound').toLowerCase();
    if (!caller.isAdmin && !caller.moderatorGames.includes(cardGame)) {
      return jsonResponse(
        {
          success: false,
          error: `Forbidden — Your moderator permissions do not cover ${cardGame}.`,
        },
        403
      );
    }

    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', caller.user.id)
      .maybeSingle();
    const editorName =
      prof?.display_name ||
      caller.user.user_metadata?.display_name ||
      caller.user.email ||
      'Moderator';

    const updatedCard = await applyCardEdits({
      cardId,
      editorId: caller.user.id,
      editorName,
      errata_entries: Array.isArray(body.errata_entries) ? body.errata_entries : undefined,
      legality: body.legality && typeof body.legality === 'object' ? body.legality : undefined,
      text: body.text !== undefined ? body.text : undefined,
      ability: body.ability !== undefined ? body.ability : undefined,
      effect: body.effect !== undefined ? body.effect : undefined,
    });

    const requestId = typeof body?.request_id === 'string' ? body.request_id.trim() : '';
    if (requestId) {
      try {
        const { data: row } = await supabaseAdmin
          .from('settings')
          .select('value')
          .eq('key', CARD_UPDATE_REQUESTS_KEY)
          .maybeSingle();
        let list: CardUpdateRequest[] = [];
        if (row?.value) {
          const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
          if (Array.isArray(parsed)) list = parsed;
        }
        let changed = false;
        const next = list.map((r) => {
          if (r.id !== requestId) return r;
          changed = true;
          return {
            ...r,
            status: 'approved' as const,
            reviewed_at: new Date().toISOString(),
            reviewed_by_id: caller.user.id,
            reviewed_by_name: sanitizePlainText(editorName, 100),
            reviewer_note: body.reviewer_note ? sanitizePlainText(body.reviewer_note, 500) : r.reviewer_note,
          };
        });
        if (changed) {
          await supabaseAdmin.from('settings').upsert({
            key: CARD_UPDATE_REQUESTS_KEY,
            value: JSON.stringify(next),
            updated_at: new Date().toISOString(),
          });
        }
      } catch {}
    }

    return jsonResponse({ success: true, card: updatedCard });
  } catch (err: any) {
    console.error('Card update error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};
