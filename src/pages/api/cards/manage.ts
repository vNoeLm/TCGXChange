import type { APIRoute } from 'astro';
import { supabaseAdmin } from '../../../lib/supabaseServer';
import { bannedResponse, getRequestUser, jsonResponse } from '../../../lib/requestAuth';
import { sanitizePlainText, sanitizeCardMarkupText, sanitizeUrl } from '../../../lib/sanitize';
import { isOwnHostedImageUrl, stripOwnCdnPrefix } from '../../../lib/supabase';
import { mirrorExternalCardImage } from '../../../lib/serverUpload';
import { bumpCardContentVersion } from '../../../lib/moderatorRolesServer';
import { invalidateCardDataVersionCache } from '../card-data-version';
import {
  canCallerModerateGame,
  loadCustomCardTagsMap,
  registerCustomTagsForGame,
  saveCustomCardTagsMap,
} from '../../../lib/cardUpdateServer';
import { getDefaultTagsForGame, mergeTagsForGame, normalizeTagList } from '../../../lib/cardCatalogTags';
import { GAMES } from '../../../lib/constants';
import { CARDMARKET_GAME_IDS, PRICE_GUIDE_URLS_BY_GAME, lowFromGuideRow, priceFromGuideRow } from '../../../lib/cardmarketPrices';

export const prerender = false;

const ALLOWED_GAME_IDS = new Set(GAMES.map((g) => g.id));

function parsePositiveInt(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseOptionalInt(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseInt(String(val), 10);
  return Number.isFinite(n) ? n : null;
}

function sanitizeImagePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = stripOwnCdnPrefix(raw.trim());
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return sanitizeUrl(trimmed);
  }
  const clean = trimmed.replace(/^\/+/, '').slice(0, 480);
  if (!clean || clean.includes('..')) return null;
  return clean;
}

async function resolveAndHostCardImage(
  raw: unknown,
  game: string,
  slugHint: string
): Promise<{ ok: true; path: string | null } | { ok: false; error: string }> {
  const sanitized = sanitizeImagePath(raw);
  if (!sanitized) return { ok: true, path: null };
  if (isOwnHostedImageUrl(sanitized)) {
    return { ok: true, path: sanitized };
  }
  const mirrored = await mirrorExternalCardImage(sanitized, `custom-cards/${game}`, slugHint);
  if (!mirrored.success) {
    return { ok: false, error: mirrored.error };
  }
  return { ok: true, path: mirrored.url };
}

function sanitizeReleaseDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

async function tryFetchGuidePriceForCard(game: string, cmid: number, rarity: string | null) {
  if (!CARDMARKET_GAME_IDS[game]) return null;
  const guideUrl = PRICE_GUIDE_URLS_BY_GAME[game];
  if (!guideUrl) return null;
  try {
    const res = await fetch(guideUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const rows = Array.isArray(json?.priceGuides) ? json.priceGuides : [];
    const row = rows.find((r: any) => Number(r?.idProduct) === cmid);
    if (!row) return null;
    const { normal, foil } = priceFromGuideRow(rarity, row);
    const { lowEur, lowFoilEur } = lowFromGuideRow(rarity, row);
    return { eur: normal, eurFoil: foil, lowEur, lowFoilEur };
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ request, url }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized — Sign in required.' }, 401);
    if (caller.isBanned) return bannedResponse();
    if (!caller.isAdmin && !caller.isModerator) {
      return jsonResponse({ success: false, error: 'Forbidden — Moderator or Admin access required.' }, 403);
    }

    const requestedGame = (url.searchParams.get('game') || '').trim().toLowerCase();
    const targetGame =
      requestedGame || (caller.isAdmin ? 'riftbound' : caller.moderatorGames[0] || 'riftbound');

    if (!ALLOWED_GAME_IDS.has(targetGame)) {
      return jsonResponse({ success: false, error: 'Unsupported game.' }, 400);
    }
    if (!canCallerModerateGame(caller, targetGame)) {
      return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${targetGame}.` }, 403);
    }

    const [{ data: sets, error: setsErr }, { data: cardTagsRows }, customTagsMap] = await Promise.all([
      supabaseAdmin
        .from('sets')
        .select('id, code, name, release_date, total_cards, game, created_at')
        .eq('game', targetGame)
        .order('release_date', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true }),
      supabaseAdmin
        .from('cards')
        .select('game, tags')
        .eq('game', targetGame)
        .eq('is_archived', false)
        .is('deleted_at', null)
        .limit(3000),
      loadCustomCardTagsMap(),
    ]);

    if (setsErr) throw setsErr;

    const defaultTags = getDefaultTagsForGame(targetGame);
    const customTags = customTagsMap[targetGame] || [];
    const allTags = mergeTagsForGame(targetGame, customTagsMap, cardTagsRows || []);

    return jsonResponse({
      success: true,
      game: targetGame,
      sets: sets || [],
      defaultTags,
      customTags,
      allTags,
    });
  } catch (err: any) {
    console.error('Card manage GET error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const caller = await getRequestUser(request);
    if (!caller) return jsonResponse({ success: false, error: 'Unauthorized — Sign in required.' }, 401);
    if (caller.isBanned) return bannedResponse();
    if (!caller.isAdmin && !caller.isModerator) {
      return jsonResponse({ success: false, error: 'Forbidden — Moderator or Admin access required.' }, 403);
    }

    const body = await request.json().catch(() => null);
    const action = typeof body?.action === 'string' ? body.action.trim() : '';
    if (!action) {
      return jsonResponse({ success: false, error: 'Action is required.' }, 400);
    }

    // ─── CREATE SET ───────────────────────────────────────────────────
    if (action === 'create_set') {
      const game = String(body?.game || '').trim().toLowerCase();
      if (!ALLOWED_GAME_IDS.has(game)) {
        return jsonResponse({ success: false, error: 'Invalid game selected.' }, 400);
      }
      if (!canCallerModerateGame(caller, game)) {
        return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
      }

      const name = sanitizePlainText(body?.name, 120);
      const code = sanitizePlainText(body?.code, 40).toUpperCase().replace(/\s+/g, '');
      const releaseDate = sanitizeReleaseDate(body?.release_date);
      const totalCards = Math.max(0, parseOptionalInt(body?.total_cards) ?? 0);

      if (!name || !code) {
        return jsonResponse({ success: false, error: 'Set name and set code are required.' }, 400);
      }

      const { data: created, error } = await supabaseAdmin
        .from('sets')
        .insert({
          game,
          code,
          name,
          release_date: releaseDate,
          total_cards: totalCards,
        })
        .select('*')
        .single();

      if (error) {
        if ((error as any).code === '23505') {
          return jsonResponse({ success: false, error: `Set code "${code}" already exists.` }, 409);
        }
        throw error;
      }

      await bumpCardContentVersion();
      invalidateCardDataVersionCache();
      return jsonResponse({ success: true, set: created });
    }

    // ─── UPDATE SET ───────────────────────────────────────────────────
    if (action === 'update_set') {
      const setId = String(body?.set_id || '').trim();
      if (!setId) return jsonResponse({ success: false, error: 'set_id is required.' }, 400);

      const { data: existingSet, error: fetchErr } = await supabaseAdmin
        .from('sets')
        .select('*')
        .eq('id', setId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existingSet) return jsonResponse({ success: false, error: 'Set not found.' }, 404);

      const game = (existingSet.game || 'riftbound').toLowerCase();
      if (!canCallerModerateGame(caller, game)) {
        return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
      }

      const name = sanitizePlainText(body?.name ?? existingSet.name, 120);
      const code = sanitizePlainText(body?.code ?? existingSet.code, 40).toUpperCase().replace(/\s+/g, '');
      const releaseDate = body?.release_date !== undefined ? sanitizeReleaseDate(body.release_date) : existingSet.release_date;
      const totalCards =
        body?.total_cards !== undefined ? Math.max(0, parseOptionalInt(body.total_cards) ?? 0) : existingSet.total_cards;

      if (!name || !code) {
        return jsonResponse({ success: false, error: 'Set name and set code are required.' }, 400);
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('sets')
        .update({ name, code, release_date: releaseDate, total_cards: totalCards })
        .eq('id', setId)
        .select('*')
        .single();

      if (updateErr) {
        if ((updateErr as any).code === '23505') {
          return jsonResponse({ success: false, error: `Set code "${code}" already exists.` }, 409);
        }
        throw updateErr;
      }

      await bumpCardContentVersion();
      invalidateCardDataVersionCache();
      return jsonResponse({ success: true, set: updated });
    }

    // ─── TAG ACTIONS ──────────────────────────────────────────────────
    if (action === 'add_tag' || action === 'rename_tag' || action === 'delete_tag') {
      const game = String(body?.game || '').trim().toLowerCase();
      if (!ALLOWED_GAME_IDS.has(game)) {
        return jsonResponse({ success: false, error: 'Invalid game selected.' }, 400);
      }
      if (!canCallerModerateGame(caller, game)) {
        return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
      }

      const map = await loadCustomCardTagsMap();
      const currentCustom = map[game] || [];

      if (action === 'add_tag') {
        const tagName = sanitizePlainText(body?.tag, 60).trim();
        if (!tagName) return jsonResponse({ success: false, error: 'Tag name is required.' }, 400);
        const nextCustom = normalizeTagList([...currentCustom, tagName]);
        map[game] = nextCustom;
        await saveCustomCardTagsMap(map);
        await bumpCardContentVersion();
        invalidateCardDataVersionCache();
        return jsonResponse({ success: true, customTags: nextCustom });
      }

      if (action === 'rename_tag') {
        const oldTag = sanitizePlainText(body?.old_tag, 60).trim();
        const newTag = sanitizePlainText(body?.new_tag, 60).trim();
        if (!oldTag || !newTag) {
          return jsonResponse({ success: false, error: 'Both old_tag and new_tag are required.' }, 400);
        }
        const replaced = currentCustom.map((t) => (t.toLowerCase() === oldTag.toLowerCase() ? newTag : t));
        map[game] = normalizeTagList(replaced.includes(newTag) ? replaced : [...replaced, newTag]);
        await saveCustomCardTagsMap(map);

        const { data: cardsWithTags } = await supabaseAdmin
          .from('cards')
          .select('id, tags')
          .eq('game', game)
          .not('tags', 'is', null);

        let updatedCards = 0;
        for (const c of cardsWithTags || []) {
          if (!Array.isArray(c.tags)) continue;
          if (!c.tags.some((t: any) => typeof t === 'string' && t.toLowerCase() === oldTag.toLowerCase())) continue;
          const nextTags = normalizeTagList(
            c.tags.map((t: any) => (typeof t === 'string' && t.toLowerCase() === oldTag.toLowerCase() ? newTag : t))
          );
          await supabaseAdmin.from('cards').update({ tags: nextTags }).eq('id', c.id);
          updatedCards += 1;
        }

        await bumpCardContentVersion();
        invalidateCardDataVersionCache();
        return jsonResponse({ success: true, customTags: map[game], updatedCards });
      }

      if (action === 'delete_tag') {
        const tagName = sanitizePlainText(body?.tag, 60).trim();
        if (!tagName) return jsonResponse({ success: false, error: 'Tag name is required.' }, 400);
        const nextCustom = currentCustom.filter((t) => t.toLowerCase() !== tagName.toLowerCase());
        map[game] = nextCustom;
        await saveCustomCardTagsMap(map);

        if (body?.remove_from_cards !== false) {
          const { data: cardsWithTags } = await supabaseAdmin
            .from('cards')
            .select('id, tags')
            .eq('game', game)
            .not('tags', 'is', null);
          for (const c of cardsWithTags || []) {
            if (!Array.isArray(c.tags)) continue;
            if (!c.tags.some((t: any) => typeof t === 'string' && t.toLowerCase() === tagName.toLowerCase())) continue;
            const nextTags = normalizeTagList(
              c.tags.filter((t: any) => typeof t === 'string' && t.toLowerCase() !== tagName.toLowerCase())
            );
            await supabaseAdmin.from('cards').update({ tags: nextTags }).eq('id', c.id);
          }
        }

        await bumpCardContentVersion();
        invalidateCardDataVersionCache();
        return jsonResponse({ success: true, customTags: nextCustom });
      }
    }

    // ─── CREATE CARD ──────────────────────────────────────────────────
    if (action === 'create_card') {
      const game = String(body?.game || '').trim().toLowerCase();
      if (!ALLOWED_GAME_IDS.has(game)) {
        return jsonResponse({ success: false, error: 'Invalid game selected.' }, 400);
      }
      if (!canCallerModerateGame(caller, game)) {
        return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
      }

      const setId = String(body?.set_id || '').trim();
      const cardNumber = sanitizePlainText(body?.card_number, 50).trim();
      const name = sanitizePlainText(body?.name, 200).trim();
      const rarity = sanitizePlainText(body?.rarity || 'Common', 50).trim() || 'Common';
      const cardType = sanitizePlainText(body?.card_type || 'Unit', 50).trim() || 'Unit';

      if (!setId || !cardNumber || !name) {
        return jsonResponse({ success: false, error: 'Set, card number, and card name are required.' }, 400);
      }

      const { data: setRow, error: setErr } = await supabaseAdmin
        .from('sets')
        .select('id, game')
        .eq('id', setId)
        .maybeSingle();

      if (setErr) throw setErr;
      if (!setRow) return jsonResponse({ success: false, error: 'Selected set not found.' }, 404);
      if ((setRow.game || 'riftbound').toLowerCase() !== game) {
        return jsonResponse({ success: false, error: 'Selected set belongs to a different game.' }, 400);
      }

      const tags = normalizeTagList(body?.tags);
      const cmid = parsePositiveInt(body?.cardmarket_id);
      const hostedImg = await resolveAndHostCardImage(body?.image_path, game, cardNumber || name);
      if (!hostedImg.ok) {
        return jsonResponse({ success: false, error: hostedImg.error }, 400);
      }
      const imagePath = hostedImg.path;
      const costNum = parseOptionalInt(body?.cost);
      const energyStr = body?.energy !== undefined && body?.energy !== null && String(body.energy).trim() !== ''
        ? sanitizePlainText(String(body.energy), 40)
        : costNum !== null
        ? String(costNum)
        : null;
      const mightStr = body?.might !== undefined && body?.might !== null && String(body.might).trim() !== ''
        ? sanitizePlainText(String(body.might), 40)
        : null;
      const mightBonusNum = parseOptionalInt(body?.might_bonus);

      const metadata: Record<string, any> =
        body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? { ...body.metadata }
          : {};
      if (typeof body?.is_promo === 'boolean') {
        if (body.is_promo) metadata.is_promo = true;
        else delete metadata.is_promo;
      }
      if (cmid) {
        metadata.cardmarket_id = cmid;
      } else {
        delete metadata.cardmarket_id;
      }

      let marketPriceEur: number | null = null;
      let marketPriceFoilEur: number | null = null;
      let lastPriceUpdatedAt: string | null = null;

      if (cmid && body?.sync_price !== false) {
        const synced = await tryFetchGuidePriceForCard(game, cmid, rarity);
        if (synced) {
          marketPriceEur = synced.eur;
          marketPriceFoilEur = synced.eurFoil;
          lastPriceUpdatedAt = new Date().toISOString();
          if (synced.lowEur !== null) metadata.cardmarket_low_eur = synced.lowEur;
          if (synced.lowFoilEur !== null) metadata.cardmarket_low_foil_eur = synced.lowFoilEur;
        }
      }

      const insertPayload: Record<string, any> = {
        set_id: setId,
        game,
        card_number: cardNumber,
        name,
        rarity,
        card_type: cardType,
        cost: costNum,
        energy: energyStr,
        might: mightStr,
        might_bonus: mightBonusNum,
        domain: body?.domain ? sanitizePlainText(body.domain, 120) : null,
        subtype: body?.subtype ? sanitizePlainText(body.subtype, 120) : null,
        text: body?.text ? sanitizeCardMarkupText(body.text, 4000) : null,
        ability: body?.ability ? sanitizeCardMarkupText(body.ability, 4000) : null,
        effect: body?.effect ? sanitizeCardMarkupText(body.effect, 4000) : null,
        tags,
        artist: body?.artist ? sanitizePlainText(body.artist, 180) : null,
        image_path: imagePath,
        metadata,
        market_price_eur: marketPriceEur,
        market_price_foil_eur: marketPriceFoilEur,
        last_price_updated_at: lastPriceUpdatedAt,
        is_archived: false,
      };

      const { data: createdCard, error: insertErr } = await supabaseAdmin
        .from('cards')
        .insert(insertPayload)
        .select('*, sets ( id, name, code, release_date )')
        .single();

      if (insertErr) {
        if ((insertErr as any).code === '23505') {
          return jsonResponse(
            { success: false, error: `Card number "${cardNumber}" already exists in this set.` },
            409
          );
        }
        throw insertErr;
      }

      if (tags.length > 0) {
        await registerCustomTagsForGame(game, tags);
      }

      await bumpCardContentVersion();
      invalidateCardDataVersionCache();
      return jsonResponse({ success: true, card: createdCard });
    }

    // ─── UPDATE CARD ──────────────────────────────────────────────────
    if (action === 'update_card') {
      const cardId = String(body?.card_id || '').trim();
      if (!cardId) return jsonResponse({ success: false, error: 'card_id is required.' }, 400);

      const { data: existing, error: fetchErr } = await supabaseAdmin
        .from('cards')
        .select('*')
        .eq('id', cardId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return jsonResponse({ success: false, error: 'Card not found.' }, 404);

      const game = (existing.game || 'riftbound').toLowerCase();
      if (!canCallerModerateGame(caller, game)) {
        return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
      }

      const nextSetId = typeof body?.set_id === 'string' && body.set_id.trim() ? body.set_id.trim() : existing.set_id;
      if (nextSetId && nextSetId !== existing.set_id) {
        const { data: setRow } = await supabaseAdmin.from('sets').select('id, game').eq('id', nextSetId).maybeSingle();
        if (!setRow) return jsonResponse({ success: false, error: 'Selected set not found.' }, 404);
        if ((setRow.game || 'riftbound').toLowerCase() !== game) {
          return jsonResponse({ success: false, error: 'Selected set belongs to a different game.' }, 400);
        }
      }

      const prevMeta =
        existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
          ? { ...(existing.metadata as Record<string, any>) }
          : {};

      if (body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
        Object.assign(prevMeta, body.metadata);
      }

      if (typeof body?.is_promo === 'boolean') {
        if (body.is_promo) prevMeta.is_promo = true;
        else delete prevMeta.is_promo;
      }

      let cmid = prevMeta.cardmarket_id ? parsePositiveInt(prevMeta.cardmarket_id) : null;
      if (body?.cardmarket_id !== undefined) {
        cmid = parsePositiveInt(body.cardmarket_id);
        if (cmid) prevMeta.cardmarket_id = cmid;
        else delete prevMeta.cardmarket_id;
      }

      const name = body?.name !== undefined ? sanitizePlainText(body.name, 200).trim() : existing.name;
      const cardNumber =
        body?.card_number !== undefined ? sanitizePlainText(body.card_number, 50).trim() : existing.card_number;
      const rarity =
        body?.rarity !== undefined ? sanitizePlainText(body.rarity, 50).trim() || existing.rarity : existing.rarity;
      const cardType =
        body?.card_type !== undefined
          ? sanitizePlainText(body.card_type, 50).trim() || existing.card_type
          : existing.card_type;

      if (!name || !cardNumber) {
        return jsonResponse({ success: false, error: 'Card name and card number cannot be empty.' }, 400);
      }

      const nextTags = body?.tags !== undefined ? normalizeTagList(body.tags) : existing.tags;
      const costNum = body?.cost !== undefined ? parseOptionalInt(body.cost) : existing.cost;

      let nextImagePath = existing.image_path;
      if (body?.image_path !== undefined) {
        const hostedImg = await resolveAndHostCardImage(body.image_path, game, cardNumber || name);
        if (!hostedImg.ok) {
          return jsonResponse({ success: false, error: hostedImg.error }, 400);
        }
        nextImagePath = hostedImg.path;
      }

      const updatePayload: Record<string, any> = {
        set_id: nextSetId,
        name,
        card_number: cardNumber,
        rarity,
        card_type: cardType,
        cost: costNum,
        energy:
          body?.energy !== undefined
            ? body.energy === null || String(body.energy).trim() === ''
              ? null
              : sanitizePlainText(String(body.energy), 40)
            : existing.energy,
        might:
          body?.might !== undefined
            ? body.might === null || String(body.might).trim() === ''
              ? null
              : sanitizePlainText(String(body.might), 40)
            : existing.might,
        might_bonus: body?.might_bonus !== undefined ? parseOptionalInt(body.might_bonus) : existing.might_bonus,
        domain:
          body?.domain !== undefined
            ? body.domain
              ? sanitizePlainText(body.domain, 120)
              : null
            : existing.domain,
        subtype:
          body?.subtype !== undefined
            ? body.subtype
              ? sanitizePlainText(body.subtype, 120)
              : null
            : existing.subtype,
        text:
          body?.text !== undefined
            ? body.text
              ? sanitizeCardMarkupText(body.text, 4000)
              : null
            : existing.text,
        ability:
          body?.ability !== undefined
            ? body.ability
              ? sanitizeCardMarkupText(body.ability, 4000)
              : null
            : existing.ability,
        effect:
          body?.effect !== undefined
            ? body.effect
              ? sanitizeCardMarkupText(body.effect, 4000)
              : null
            : existing.effect,
        artist:
          body?.artist !== undefined
            ? body.artist
              ? sanitizePlainText(body.artist, 180)
              : null
            : existing.artist,
        image_path: nextImagePath,
        tags: nextTags,
        metadata: prevMeta,
      };

      if (typeof body?.is_archived === 'boolean') {
        updatePayload.is_archived = body.is_archived;
      }

      if (cmid && body?.sync_price === true) {
        const synced = await tryFetchGuidePriceForCard(game, cmid, rarity);
        if (synced) {
          updatePayload.market_price_eur = synced.eur;
          updatePayload.market_price_foil_eur = synced.eurFoil;
          updatePayload.last_price_updated_at = new Date().toISOString();
          if (synced.lowEur !== null) prevMeta.cardmarket_low_eur = synced.lowEur;
          else delete prevMeta.cardmarket_low_eur;
          if (synced.lowFoilEur !== null) prevMeta.cardmarket_low_foil_eur = synced.lowFoilEur;
          else delete prevMeta.cardmarket_low_foil_eur;
        }
      }

      const { data: updatedCard, error: updateErr } = await supabaseAdmin
        .from('cards')
        .update(updatePayload)
        .eq('id', cardId)
        .select('*, sets ( id, name, code, release_date )')
        .single();

      if (updateErr) {
        if ((updateErr as any).code === '23505') {
          return jsonResponse(
            { success: false, error: `Card number "${cardNumber}" already exists in this set.` },
            409
          );
        }
        throw updateErr;
      }

      if (Array.isArray(nextTags) && nextTags.length > 0) {
        await registerCustomTagsForGame(game, nextTags);
      }

      await bumpCardContentVersion();
      invalidateCardDataVersionCache();
      return jsonResponse({ success: true, card: updatedCard });
    }

    // ─── ARCHIVE / RESTORE CARD ───────────────────────────────────────
    if (action === 'archive_card') {
      const cardId = String(body?.card_id || '').trim();
      if (!cardId) return jsonResponse({ success: false, error: 'card_id is required.' }, 400);

      const { data: existing, error: fetchErr } = await supabaseAdmin
        .from('cards')
        .select('id, game, is_archived')
        .eq('id', cardId)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existing) return jsonResponse({ success: false, error: 'Card not found.' }, 404);

      const game = (existing.game || 'riftbound').toLowerCase();
      if (!canCallerModerateGame(caller, game)) {
        return jsonResponse({ success: false, error: `Forbidden — Your role does not cover ${game}.` }, 403);
      }

      const nextArchived = typeof body?.archived === 'boolean' ? body.archived : !existing.is_archived;
      const { error: updateErr } = await supabaseAdmin
        .from('cards')
        .update({ is_archived: nextArchived })
        .eq('id', cardId);

      if (updateErr) throw updateErr;

      await bumpCardContentVersion();
      invalidateCardDataVersionCache();
      return jsonResponse({ success: true, is_archived: nextArchived });
    }

    return jsonResponse({ success: false, error: 'Unsupported action.' }, 400);
  } catch (err: any) {
    console.error('Card manage POST error:', err);
    return jsonResponse({ success: false, error: err?.message || 'Server error' }, 500);
  }
};
