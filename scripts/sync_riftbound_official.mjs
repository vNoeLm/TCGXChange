import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  OFFICIAL_TO_DB_SET_CODE,
  deriveSpecialSetCode,
  isDotggSpecialSetCard,
  mapDotggSpecialCard,
  mapOfficialCard,
  normalizeCardMatchKeys,
} from '../src/lib/riftboundSync.ts';

dotenv.config();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const shouldInsertOfficial = process.argv.includes('--insert-official') || process.argv.includes('--insert-new');
const updateOnly = process.argv.includes('--update-only');
const supabase = createClient(supabaseUrl, supabaseKey);

const OFFICIAL_RIFTBOUND_URL = 'https://playriftbound.com/en-us/card-gallery/';
const DOTGG_RIFTBOUND_URL = 'https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed';

function findOfficialCardsArray(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node) && node.length > 200 && node[0]?.collectorNumber !== undefined && node[0]?.publicCode) {
    return node;
  }
  for (const val of Object.values(node)) {
    const found = findOfficialCardsArray(val);
    if (found) return found;
  }
  return null;
}

async function fetchOfficialRiftboundCards() {
  console.log(`Fetching official Riftbound gallery from ${OFFICIAL_RIFTBOUND_URL}...`);
  const res = await fetch(OFFICIAL_RIFTBOUND_URL, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching playriftbound.com`);
  const html = await res.text();
  const ndMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!ndMatch) throw new Error('__NEXT_DATA__ script not found in playriftbound.com HTML');
  const nextData = JSON.parse(ndMatch[1]);
  const cards = findOfficialCardsArray(nextData.props);
  if (!cards) throw new Error('Official card array not found inside __NEXT_DATA__');
  return cards;
}

async function fetchDotggSpecialSetCards() {
  console.log(`Fetching non-base collector sets from riftbound.gg (${DOTGG_RIFTBOUND_URL})...`);
  const res = await fetch(DOTGG_RIFTBOUND_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching riftbound.gg dotgg API`);
  const json = await res.json();
  const names = Array.isArray(json.names) ? json.names : [];
  const dataRows = Array.isArray(json.data) ? json.data : Object.values(json.data || {});
  const cards = [];
  for (const row of dataRows) {
    const obj = {};
    names.forEach((col, i) => { obj[col] = row[i]; });
    if (isDotggSpecialSetCard(obj)) cards.push(obj);
  }
  return cards;
}

async function ensureSpecialSet(setName, setCards, existingSets) {
  const byName = new Map((existingSets || []).map((s) => [String(s.name).trim().toLowerCase(), s]));
  const byCode = new Map((existingSets || []).map((s) => [String(s.code).trim().toUpperCase(), s]));

  const existingByName = byName.get(setName.trim().toLowerCase());
  const code = existingByName?.code || deriveSpecialSetCode(setName, setCards[0]?.id);
  const matched = existingByName || byCode.get(code);

  if (isDryRun) {
    return matched?.id || `DRY_${code}`;
  }

  if (matched) {
    if ((matched.total_cards || 0) < setCards.length) {
      await supabase.from('sets').update({ total_cards: setCards.length }).eq('id', matched.id);
    }
    return matched.id;
  }

  const { data, error } = await supabase
    .from('sets')
    .upsert(
      { code, name: setName.trim(), game: 'riftbound', total_cards: setCards.length },
      { onConflict: 'code' }
    )
    .select('id, code, name, total_cards')
    .single();
  if (error || !data) throw new Error(`Failed to upsert special set "${setName}": ${error?.message}`);
  existingSets.push(data);
  return data.id;
}

async function main() {
  console.log(`Starting Riftbound catalog sync${isDryRun ? ' [DRY RUN]' : ''}...`);
  console.log('Primary: playriftbound.com (main sets) | Secondary: riftbound.gg (non-base special sets only).');

  const [officialCards, dotggSpecialCards] = await Promise.all([
    fetchOfficialRiftboundCards(),
    fetchDotggSpecialSetCards(),
  ]);
  console.log(`Loaded ${officialCards.length} official cards and ${dotggSpecialCards.length} non-base riftbound.gg special cards.`);

  const { data: existingSetsData } = await supabase
    .from('sets')
    .select('id, code, name, total_cards')
    .eq('game', 'riftbound');
  const existingSets = existingSetsData || [];

  const setByCode = new Map();
  let promoSetId = null;
  for (const s of existingSets) {
    const codeU = String(s.code).toUpperCase();
    setByCode.set(codeU, s.id);
    if (codeU === 'PRM') promoSetId = s.id;
  }

  // Ensure all official sets exist in DB
  const seenOfficialSets = new Map();
  for (const c of officialCards) {
    const sid = c.set?.value?.id;
    const sname = c.set?.value?.label;
    if (sid && sname) seenOfficialSets.set(sid.toUpperCase(), sname);
  }
  if (!isDryRun) {
    for (const [offCode, sname] of seenOfficialSets.entries()) {
      const dbCode = OFFICIAL_TO_DB_SET_CODE[offCode] || offCode;
      if (!setByCode.has(dbCode)) {
        const { data, error } = await supabase
          .from('sets')
          .upsert({ code: dbCode, name: sname, game: 'riftbound' }, { onConflict: 'code' })
          .select('id, code, name, total_cards')
          .single();
        if (!error && data) {
          setByCode.set(dbCode, data.id);
          existingSets.push(data);
        }
      }
    }
  }

  const existingDbCards = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, set_id, card_number, image_path, name, ability, text, metadata')
      .eq('game', 'riftbound')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    existingDbCards.push(...data);
    if (data.length < 1000) break;
  }

  const dbByKey = new Map();
  for (const row of existingDbCards) {
    for (const key of normalizeCardMatchKeys(row.card_number)) {
      if (!dbByKey.has(key)) dbByKey.set(key, row);
    }
  }

  const officialKeys = new Set();
  const toUpdateOfficial = [];
  const toInsertOfficial = [];

  for (const oc of officialCards) {
    if (!oc.publicCode) continue;
    for (const k of normalizeCardMatchKeys(oc.publicCode)) officialKeys.add(k);

    const offSetCode = String(oc.set?.value?.id || oc.publicCode.split('-')[0] || '').toUpperCase();
    const dbSetCode = OFFICIAL_TO_DB_SET_CODE[offSetCode] || offSetCode;
    const setId = setByCode.get(dbSetCode) || `DRY_${dbSetCode}`;

    const existing = normalizeCardMatchKeys(oc.publicCode).map((k) => dbByKey.get(k)).find(Boolean) || null;
    const mapped = mapOfficialCard(oc, existing?.set_id || setId, existing);

    if (existing) {
      // Preserve existing DB card_number formatting when matched by prefix (e.g. RAD-SP1)
      toUpdateOfficial.push({ id: existing.id, ...mapped, card_number: existing.card_number });
    } else {
      toInsertOfficial.push(mapped);
    }
  }

  // Group non-base special-set cards from riftbound.gg by set_name, skipping anything on playriftbound.com
  const specialBySet = new Map();
  for (const dc of dotggSpecialCards) {
    const keys = normalizeCardMatchKeys(dc.id);
    if (keys.some((k) => officialKeys.has(k))) continue;
    const sName = String(dc.set_name).trim();
    if (!specialBySet.has(sName)) specialBySet.set(sName, []);
    specialBySet.get(sName).push(dc);
  }

  const toUpdateSpecial = [];
  const toInsertSpecial = [];
  for (const [sName, sCards] of specialBySet.entries()) {
    const setId = await ensureSpecialSet(sName, sCards, existingSets);
    for (const dc of sCards) {
      const existing = normalizeCardMatchKeys(dc.id).map((k) => dbByKey.get(k)).find(Boolean) || null;
      const targetSetId = (!existing || existing.set_id === promoSetId) ? setId : existing.set_id;
      const mapped = mapDotggSpecialCard(dc, targetSetId, existing);
      if (existing) {
        toUpdateSpecial.push({ id: existing.id, ...mapped });
      } else {
        toInsertSpecial.push(mapped);
      }
    }
  }

  console.log('\nPlan Summary:');
  console.log(`  Existing DB rows               : ${existingDbCards.length}`);
  console.log(`  Official playriftbound matches : ${toUpdateOfficial.length}`);
  console.log(`  New official cards skipped/add : ${toInsertOfficial.length} (${shouldInsertOfficial ? 'WILL INSERT' : 'skipped unless --insert-official'})`);
  console.log(`  Special sets (riftbound.gg)    : ${Array.from(specialBySet.keys()).join(', ')}`);
  console.log(`  Special set updates            : ${toUpdateSpecial.length}`);
  console.log(`  Special set new cards to insert: ${toInsertSpecial.length}`);

  console.log('\nSample special-set payloads:');
  console.log(JSON.stringify([...toUpdateSpecial.slice(0, 1), ...toInsertSpecial.slice(0, 2)], null, 2));

  if (isDryRun) {
    console.log('\nDry run complete. No database rows modified.');
    return;
  }

  const applyUpdates = async (list, label) => {
    let ok = 0;
    const BATCH = 25;
    for (let i = 0; i < list.length; i += BATCH) {
      const slice = list.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (item) => {
          const { id, ...fields } = item;
          const { error } = await supabase.from('cards').update(fields).eq('id', id);
          if (error) console.error(`${label} update failed ${fields.card_number}: ${error.message}`);
          else ok++;
        })
      );
    }
    return ok;
  };

  const applyInserts = async (list, label) => {
    let ok = 0;
    const BATCH = 100;
    for (let i = 0; i < list.length; i += BATCH) {
      const slice = list.slice(i, i + BATCH);
      const { error } = await supabase.from('cards').insert(slice);
      if (error) console.error(`${label} insert batch ${i} failed: ${error.message}`);
      else ok += slice.length;
    }
    return ok;
  };

  const updatedOfficial = await applyUpdates(toUpdateOfficial, 'Official');
  const insertedOfficial = shouldInsertOfficial && !updateOnly ? await applyInserts(toInsertOfficial, 'Official') : 0;
  const updatedSpecial = await applyUpdates(toUpdateSpecial, 'Special');
  const insertedSpecial = !updateOnly ? await applyInserts(toInsertSpecial, 'Special') : 0;

  console.log(
    `\nDone. Official(updated=${updatedOfficial}, inserted=${insertedOfficial}), ` +
    `Special(updated=${updatedSpecial}, inserted=${insertedSpecial})`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
