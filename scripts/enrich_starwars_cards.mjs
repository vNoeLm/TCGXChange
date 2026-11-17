import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');
const supabase = createClient(supabaseUrl, supabaseKey);

const SWU_API_BASE = 'https://admin.starwarsunlimited.com/api/card-list';

function setCodeForOfficialExpansion(code) {
  const c = String(code || '').trim().toUpperCase();
  return `SWU-${c}`;
}

async function fetchPageWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'TCGXChange-Sync/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
}

async function fetchAllCanonicalSwuCards() {
  console.log('Fetching official Star Wars: Unlimited canonical cards from starwarsunlimited.com...');
  const buildUrl = (page) =>
    `${SWU_API_BASE}?locale=en&filters[variantOf][id][$null]=true&pagination[page]=${page}&pagination[pageSize]=100`;

  const first = await fetchPageWithRetry(buildUrl(1));
  const pageCount = first.meta?.pagination?.pageCount || 1;
  const total = first.meta?.pagination?.total || first.data?.length || 0;
  console.log(`API reports ${total} canonical cards across ${pageCount} pages.`);

  const all = [...(first.data || [])];
  const CONC = 3;
  for (let p = 2; p <= pageCount; p += CONC) {
    const batch = [];
    for (let q = p; q < p + CONC && q <= pageCount; q++) batch.push(q);
    const pages = await Promise.all(batch.map((pg) => fetchPageWithRetry(buildUrl(pg))));
    for (const pg of pages) {
      if (pg?.data) all.push(...pg.data);
    }
    if (p % 15 === 2 || p + CONC > pageCount) {
      console.log(`  fetched ${all.length}/${total} cards...`);
    }
  }
  return all;
}

function normalizeNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapSwuPayload(entry, setId, uniqueCardNumber) {
  const a = entry.attributes || {};
  const fullName = a.subtitle ? `${a.title} - ${a.subtitle}` : a.title;

  const primaryType = a.type?.data?.attributes?.name || 'Unit';
  const secondaryType = a.type2?.data?.attributes?.name || null;
  const types = [primaryType, secondaryType].filter(Boolean);

  const primaryAspects = (a.aspects?.data || []).map((x) => x.attributes?.name).filter(Boolean);
  const dupAspects = (a.aspectDuplicates?.data || []).map((x) => x.attributes?.name).filter(Boolean);
  const allAspects = [...primaryAspects, ...dupAspects];
  const domain = allAspects.length > 0 ? allAspects.join(' / ') : 'No Aspect';

  const traits = (a.traits?.data || []).map((x) => x.attributes?.name).filter(Boolean);
  const arenas = (a.arenas?.data || []).map((x) => x.attributes?.name).filter(Boolean);
  const keywords = (a.keywords?.data || []).map((x) => x.attributes?.name).filter(Boolean);
  const rarity = a.rarity?.data?.attributes?.name || 'Common';

  const frontArtUrl =
    a.artFront?.data?.attributes?.formats?.card?.url ||
    a.artFront?.data?.attributes?.url ||
    null;
  const backArtUrl =
    a.artBack?.data?.attributes?.formats?.card?.url ||
    a.artBack?.data?.attributes?.url ||
    null;

  const paddedNum = String(a.cardNumber ?? '').padStart(3, '0');
  const collectorNumber = a.cardCount
    ? `${paddedNum}/${String(a.cardCount).padStart(3, '0')}`
    : paddedNum;

  const frontTextParts = [a.text, a.epicAction].map((x) => String(x || '').trim()).filter(Boolean);
  const combinedFrontText = frontTextParts.join('\n\n') || null;
  const reverseText = a.deployBox ? String(a.deployBox).trim() : null;

  const metadata = {
    official_id: entry.id,
    card_uid: a.cardUid || null,
    subtitle: a.subtitle || null,
    collector_number: collectorNumber,
    types,
    aspects: allAspects,
    arenas,
    traits,
    keywords,
    hp: a.hp ?? null,
    power: a.power ?? null,
    upgrade_hp: a.upgradeHp ?? null,
    upgrade_power: a.upgradePower ?? null,
    front_text: a.text ? String(a.text).trim() : null,
    epic_action: a.epicAction ? String(a.epicAction).trim() : null,
    back_text: reverseText,
    art_back: backArtUrl,
    art_front_horizontal: Boolean(a.artFrontHorizontal),
    unique: Boolean(a.unique),
  };

  return {
    set_id: setId,
    card_number: uniqueCardNumber,
    name: String(fullName || '').slice(0, 150),
    rarity,
    card_type: primaryType,
    cost: typeof a.cost === 'number' ? a.cost : 0,
    energy: null,
    might: a.power !== null && a.power !== undefined ? String(a.power) : null,
    might_bonus: a.hp !== null && a.hp !== undefined ? Number(a.hp) : null,
    domain,
    subtype: traits.length > 0 ? traits.join(', ') : null,
    tags: traits.length > 0 ? traits : null,
    text: combinedFrontText,
    ability: reverseText,
    artist: a.artist || null,
    image_path: frontArtUrl,
    game: 'starwars',
    is_archived: false,
    metadata,
  };
}

async function main() {
  console.log(`Starting Star Wars: Unlimited official sync${isDryRun ? ' [DRY RUN]' : ''}...`);

  const officialCards = await fetchAllCanonicalSwuCards();
  console.log(`Loaded ${officialCards.length} official canonical Star Wars cards.`);

  // Collect all official expansions
  const officialExpansions = new Map();
  for (const c of officialCards) {
    const exp = c.attributes?.expansion?.data?.attributes;
    if (exp?.code && exp?.name) {
      officialExpansions.set(setCodeForOfficialExpansion(exp.code), exp.name);
    }
  }
  console.log(`Detected ${officialExpansions.size} official Star Wars sets.`);

  const { data: existingSets } = await supabase
    .from('sets')
    .select('id, code, name')
    .eq('game', 'starwars');

  const setMap = new Map();
  for (const s of existingSets || []) {
    setMap.set(String(s.code).toUpperCase(), s.id);
  }

  if (!isDryRun) {
    for (const [code, name] of officialExpansions.entries()) {
      const { data, error } = await supabase
        .from('sets')
        .upsert({ code, name, game: 'starwars' }, { onConflict: 'code' })
        .select('id, code')
        .single();
      if (error) console.error(`Set upsert failed (${code}): ${error.message}`);
      else if (data) setMap.set(code.toUpperCase(), data.id);
    }
  }

  const existingDbCards = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, set_id, card_number, name, image_path')
      .eq('game', 'starwars')
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    existingDbCards.push(...data);
    if (data.length < 1000) break;
  }

  const dbBySetAndNumber = new Map();
  for (const row of existingDbCards) {
    dbBySetAndNumber.set(`${row.set_id}_${String(row.card_number).toUpperCase()}`, row);
  }

  const usedKeys = new Set();
  const payloadByNameKey = new Map();
  const matchedIds = new Set();
  const toUpdate = [];
  const toInsert = [];

  for (const entry of officialCards) {
    const a = entry.attributes || {};
    const expCode = a.expansion?.data?.attributes?.code;
    if (!expCode) continue;

    const setCode = setCodeForOfficialExpansion(expCode);
    const setId = setMap.get(setCode.toUpperCase()) || `DRY_${setCode}`;
    const baseNum = String(a.cardNumber ?? entry.id).padStart(3, '0');

    let uniqueNum = baseNum;
    let dedupeKey = `${setCode}_${uniqueNum}`;
    let suffixIdx = 2;
    while (usedKeys.has(dedupeKey)) {
      uniqueNum = `${baseNum}-${suffixIdx++}`;
      dedupeKey = `${setCode}_${uniqueNum}`;
    }
    usedKeys.add(dedupeKey);

    const payload = mapSwuPayload(entry, setId, uniqueNum);
    const nk = normalizeNameKey(payload.name);
    if (nk && !payloadByNameKey.has(nk)) payloadByNameKey.set(nk, payload);

    const match = dbBySetAndNumber.get(`${setId}_${uniqueNum.toUpperCase()}`);
    if (match) {
      matchedIds.add(match.id);
      const hasCustomR2 = match.image_path && !String(match.image_path).startsWith('http');
      const img = hasCustomR2 ? match.image_path : (payload.image_path || match.image_path);
      toUpdate.push({ id: match.id, ...payload, image_path: img });
    } else {
      toInsert.push(payload);
    }
  }

  // Enrich any remaining DB variant printings (e.g. Hyperspace / Showcase numbers > cardCount) by card name
  let variantEnriched = 0;
  for (const row of existingDbCards) {
    if (matchedIds.has(row.id)) continue;
    const nk = normalizeNameKey(row.name);
    const proto = payloadByNameKey.get(nk);
    if (!proto) continue;
    variantEnriched++;
    toUpdate.push({
      id: row.id,
      rarity: proto.rarity,
      card_type: proto.card_type,
      cost: proto.cost,
      might: proto.might,
      might_bonus: proto.might_bonus,
      domain: proto.domain,
      subtype: proto.subtype,
      tags: proto.tags,
      text: proto.text,
      ability: proto.ability,
      artist: proto.artist,
      metadata: {
        ...proto.metadata,
        collector_number: `${row.card_number}`,
      },
    });
  }

  console.log('\nPlan Summary:');
  console.log(`  Existing DB rows         : ${existingDbCards.length}`);
  console.log(`  Canonical exact matches  : ${toUpdate.length - variantEnriched}`);
  console.log(`  Variant rows enriched    : ${variantEnriched}`);
  console.log(`  New canonical to insert  : ${toInsert.length}`);

  const reySample = [...toUpdate, ...toInsert].find((c) => c.name === 'Rey - In Balance');
  if (reySample) {
    console.log('\nVerified Rey - In Balance:', JSON.stringify(reySample, null, 2));
  }

  if (isDryRun) {
    console.log('\nDry run complete. No database rows modified.');
    return;
  }

  let updated = 0;
  const UPDATE_BATCH = 25;
  for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
    const slice = toUpdate.slice(i, i + UPDATE_BATCH);
    await Promise.all(
      slice.map(async (item) => {
        const { id, ...fields } = item;
        const { error } = await supabase.from('cards').update(fields).eq('id', id);
        if (error) console.error(`Update failed ${id}: ${error.message}`);
        else updated++;
      })
    );
    if ((i + UPDATE_BATCH) % 500 === 0 || i + UPDATE_BATCH >= toUpdate.length) {
      console.log(`Updates: ${updated}/${toUpdate.length}`);
    }
  }

  let inserted = 0;
  const INSERT_BATCH = 100;
  for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
    const slice = toInsert.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from('cards').insert(slice);
    if (error) console.error(`Insert batch ${i} failed: ${error.message}`);
    else inserted += slice.length;
    if ((i + INSERT_BATCH) % 500 === 0 || i + INSERT_BATCH >= toInsert.length) {
      console.log(`Inserts: ${inserted}/${toInsert.length}`);
    }
  }

  console.log(`\nDone. Updated=${updated}, Inserted=${inserted}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
