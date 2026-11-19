import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { getRequestUser, jsonResponse, bannedResponse } from '../../../lib/requestAuth';
import { sanitizePlainText, sanitizeUrl } from '../../../lib/sanitize';
import { CARD_UPDATE_REQUESTS_KEY } from '../../../lib/moderatorRolesServer';
import { getCardErrataEntries, getCardLegalityMap, type CardUpdateRequest, type CardUpdateType } from '../../../lib/cardUpdates';
import { applyCardEdits } from '../../../lib/cardUpdateServer';

export const prerender = false;

const recentSubmitMap = new Map<string, number>();

async function loadRequests(): Promise<CardUpdateRequest[]> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', CARD_UPDATE_REQUESTS_KEY)
    .maybeSingle();
  if (!data?.value) return [];
  try {
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveRequests(list: CardUpdateRequest[]): Promise<void> {
  await supabaseAdmin.from('settings').upsert({
    key: CARD_UPDATE_REQUESTS_KEY,
    value: JSON.stringify(list.slice(0, 500)),
    updated_at: new Date().toISOString(),
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    if (caller.isBanned) return bannedResponse();

    if (!caller.isAdmin && !caller.isModerator) {
      return jsonResponse({ success: false, error: 'Forbidden — Moderator or Admin access required.' }, 403);
    }

    const allRequests = await loadRequests();
    const scopedRequests = caller.isAdmin
      ? allRequests
      : allRequests.filter((r) => caller.moderatorGames.includes((r.game || 'riftbound').toLowerCase()));

    const gameFilter = url.searchParams.get('game')?.trim().toLowerCase();
    const statusFilter = url.searchParams.get('status')?.trim().toLowerCase();

    const filtered = scopedRequests.filter((r) => {
      if (gameFilter && gameFilter !== 'all' && (r.game || '').toLowerCase() !== gameFilter) return false;
      if (statusFilter && statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });

    const pendingCountsByGame: Record<string, number> = {};
    for (const r of scopedRequests) {
      if (r.status === 'pending') {
        const g = (r.game || 'riftbound').toLowerCase();
        pendingCountsByGame[g] = (pendingCountsByGame[g] || 0) + 1;
      }
    }

    return jsonResponse({
      success: true,
      callerScope: {
        role: caller.role,
        isOwner: caller.isOwner,
        isAdmin: caller.isAdmin,
        isModerator: caller.isModerator,
        moderatorGames: caller.moderatorGames,
      },
      pendingCountsByGame,
      requests: filtered,
    });
  } catch (err: any) {
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Sign in required.' }, 401);
    if (caller.isBanned) return bannedResponse();

    const body = await request.json().catch(() => null);
    const action = String(body?.action || 'submit');

    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', caller.user.id)
      .maybeSingle();
    const callerName =
      prof?.display_name ||
      caller.user.user_metadata?.display_name ||
      caller.user.email ||
      'Collector';

    if (action === 'submit') {
      const now = Date.now();
      const prevTime = recentSubmitMap.get(caller.user.id);
      if (prevTime && now - prevTime < 4000) {
        return jsonResponse({ success: false, error: 'Please wait a few seconds before submitting another request.' }, 429);
      }
      recentSubmitMap.set(caller.user.id, now);
      if (recentSubmitMap.size > 1000) {
        for (const [k, v] of recentSubmitMap.entries()) {
          if (now - v > 60_000) recentSubmitMap.delete(k);
        }
      }

      const cardId = String(body?.card_id || '').trim();
      const updateTypeRaw = String(body?.update_type || 'errata');
      const updateType: CardUpdateType =
        updateTypeRaw === 'legality' || updateTypeRaw === 'card_data' ? updateTypeRaw : 'errata';
      const description = sanitizePlainText(body?.description || '', 1500).trim();

      if (!cardId) return jsonResponse({ success: false, error: 'card_id is required.' }, 400);
      if (description.length < 4) {
        return jsonResponse({ success: false, error: 'Please describe what changed (at least 4 characters).' }, 400);
      }

      const { data: cardRow, error: cardErr } = await supabaseAdmin
        .from('cards')
        .select('id, name, card_number, game, image_path, sets ( name )')
        .eq('id', cardId)
        .maybeSingle();

      if (cardErr) throw cardErr;
      if (!cardRow) return jsonResponse({ success: false, error: 'Card not found.' }, 404);

      const proposedErrata = body?.proposed_errata ? sanitizePlainText(body.proposed_errata, 2000).trim() : null;
      let proposedLegality: Record<string, string> | null = null;
      if (body?.proposed_legality && typeof body.proposed_legality === 'object' && !Array.isArray(body.proposed_legality)) {
        const cleaned: Record<string, string> = {};
        for (const [fmt, st] of Object.entries(body.proposed_legality)) {
          const cleanFmt = sanitizePlainText(fmt, 80).trim();
          const cleanSt = sanitizePlainText(String(st || ''), 40).trim();
          if (cleanFmt && cleanSt) cleaned[cleanFmt] = cleanSt;
        }
        if (Object.keys(cleaned).length > 0) proposedLegality = cleaned;
      }
      const sourceUrl = body?.source_url ? sanitizeUrl(body.source_url) : null;

      const reqItem: CardUpdateRequest = {
        id: `cur_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        card_id: cardRow.id,
        card_name: cardRow.name,
        card_number: cardRow.card_number,
        set_name: (cardRow as any)?.sets?.name || null,
        game: (cardRow.game || 'riftbound').toLowerCase(),
        card_image_path: cardRow.image_path || null,
        update_type: updateType,
        description,
        proposed_errata: proposedErrata || null,
        proposed_legality: proposedLegality,
        source_url: sourceUrl,
        requester_id: caller.user.id,
        requester_name: sanitizePlainText(callerName, 100),
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      const existing = await loadRequests();
      existing.unshift(reqItem);
      await saveRequests(existing);

      return jsonResponse({ success: true, request: reqItem }, 201);
    }

    if (action === 'approve' || action === 'reject' || action === 'delete') {
      if (!caller.isAdmin && !caller.isModerator) {
        return jsonResponse({ success: false, error: 'Forbidden — Moderator or Admin access required.' }, 403);
      }

      const requestId = String(body?.request_id || '').trim();
      if (!requestId) return jsonResponse({ success: false, error: 'request_id is required.' }, 400);

      const list = await loadRequests();
      const target = list.find((r) => r.id === requestId);
      if (!target) return jsonResponse({ success: false, error: 'Request not found.' }, 404);

      const reqGame = (target.game || 'riftbound').toLowerCase();
      if (!caller.isAdmin && !caller.moderatorGames.includes(reqGame)) {
        return jsonResponse(
          { success: false, error: `Forbidden — Your moderator permissions do not cover ${reqGame}.` },
          403
        );
      }

      if (action === 'delete') {
        if (!caller.isAdmin) {
          return jsonResponse({ success: false, error: 'Only admins or the owner can delete request logs.' }, 403);
        }
        await saveRequests(list.filter((r) => r.id !== requestId));
        return jsonResponse({ success: true, deleted_id: requestId });
      }

      let updatedCard: any = null;
      if (action === 'approve' && body?.apply_changes !== false) {
        // Apply supplied overrides OR fall back to the requester's proposed errata/legality.
        let nextErrata = Array.isArray(body?.errata_entries) ? body.errata_entries : undefined;
        let nextLegality =
          body?.legality && typeof body.legality === 'object' ? body.legality : undefined;

        if (!nextErrata && target.proposed_errata) {
          const { data: currentCard } = await supabaseAdmin
            .from('cards')
            .select('metadata')
            .eq('id', target.card_id)
            .maybeSingle();
          const currentEntries = getCardErrataEntries(currentCard);
          nextErrata = [
            {
              id: `err_${Date.now()}`,
              text: target.proposed_errata,
              date: new Date().toISOString().slice(0, 10),
              updated_at: new Date().toISOString(),
              updated_by_id: caller.user.id,
              updated_by_name: callerName,
            },
            ...currentEntries,
          ];
        }

        if (!nextLegality && target.proposed_legality) {
          const { data: currentCard } = await supabaseAdmin
            .from('cards')
            .select('game, metadata')
            .eq('id', target.card_id)
            .maybeSingle();
          nextLegality = {
            ...getCardLegalityMap(currentCard),
            ...target.proposed_legality,
          };
        }

        if (nextErrata !== undefined || nextLegality !== undefined || body?.text !== undefined || body?.ability !== undefined || body?.effect !== undefined) {
          updatedCard = await applyCardEdits({
            cardId: target.card_id,
            editorId: caller.user.id,
            editorName: callerName,
            errata_entries: nextErrata,
            legality: nextLegality,
            text: body?.text,
            ability: body?.ability,
            effect: body?.effect,
          });
        }
      }

      const reviewerNote = body?.reviewer_note ? sanitizePlainText(body.reviewer_note, 500).trim() : undefined;
      const nextStatus: CardUpdateRequest['status'] = action === 'approve' ? 'approved' : 'rejected';
      const nextList: CardUpdateRequest[] = list.map((r) =>
        r.id === requestId
          ? {
              ...r,
              status: nextStatus,
              reviewed_at: new Date().toISOString(),
              reviewed_by_id: caller.user.id,
              reviewed_by_name: sanitizePlainText(callerName, 100),
              reviewer_note: reviewerNote || r.reviewer_note,
            }
          : r
      );
      await saveRequests(nextList);

      return jsonResponse({
        success: true,
        request: nextList.find((r) => r.id === requestId),
        card: updatedCard,
      });
    }

    return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error('Card update request error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};
