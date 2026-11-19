import { supabaseAdmin } from './supabaseServer';
import { sanitizePlainText } from './sanitize';
import { bumpCardContentVersion } from './moderatorRolesServer';
import { invalidateCardDataVersionCache } from '../pages/api/card-data-version';
import type { CardErrataEntry } from './cardUpdates';

export async function applyCardEdits(params: {
  cardId: string;
  editorId: string;
  editorName: string;
  errata_entries?: CardErrataEntry[];
  legality?: Record<string, string>;
  text?: string | null;
  ability?: string | null;
  effect?: string | null;
}) {
  const { cardId, editorId, editorName, errata_entries, legality, text, ability, effect } = params;

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('cards')
    .select('id, game, metadata, text, ability, effect')
    .eq('id', cardId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!existing) throw new Error('Card not found.');

  const prevMeta =
    existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? { ...(existing.metadata as Record<string, any>) }
      : {};

  if (Array.isArray(errata_entries)) {
    const cleanedEntries: CardErrataEntry[] = errata_entries
      .filter((e) => e && typeof e.text === 'string' && e.text.trim().length > 0)
      .slice(0, 25)
      .map((e, idx) => ({
        id: sanitizePlainText(e.id || `err_${Date.now()}_${idx}`, 64),
        text: sanitizePlainText(e.text, 2000),
        date: e.date ? sanitizePlainText(e.date, 40) : undefined,
        updated_at: e.updated_at || new Date().toISOString(),
        updated_by_id: e.updated_by_id || editorId,
        updated_by_name: sanitizePlainText(e.updated_by_name || editorName, 100),
      }));
    prevMeta.errata_entries = cleanedEntries;
    if (cleanedEntries.length === 0) {
      delete prevMeta.errata;
    }
  }

  if (legality && typeof legality === 'object' && !Array.isArray(legality)) {
    const cleanedLegality: Record<string, string> = {};
    for (const [rawFmt, rawStatus] of Object.entries(legality)) {
      const fmt = sanitizePlainText(rawFmt, 80).trim();
      const status = sanitizePlainText(String(rawStatus || ''), 40).trim();
      if (fmt && status) {
        cleanedLegality[fmt] = status;
      }
    }
    prevMeta.legality = cleanedLegality;

    if ((existing.game || '').toLowerCase() === 'lorcana') {
      prevMeta.legal_formats = Object.entries(cleanedLegality)
        .filter(([, st]) => ['legal', 'restricted', 'limited'].includes(st.toLowerCase()))
        .map(([fmt]) => fmt);
    }
  }

  const updatePayload: Record<string, any> = {
    metadata: prevMeta,
  };
  if (text !== undefined) {
    updatePayload.text = text === null ? null : sanitizePlainText(text, 4000);
  }
  if (ability !== undefined) {
    updatePayload.ability = ability === null ? null : sanitizePlainText(ability, 4000);
  }
  if (effect !== undefined) {
    updatePayload.effect = effect === null ? null : sanitizePlainText(effect, 4000);
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('cards')
    .update(updatePayload)
    .eq('id', cardId)
    .select('*, sets ( id, name, code, release_date )')
    .single();

  if (updateErr) throw updateErr;

  await bumpCardContentVersion();
  invalidateCardDataVersionCache();

  return updated;
}
