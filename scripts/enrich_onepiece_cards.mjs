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

const PUNK_BASE = 'https://raw.githubusercontent.com/buhbbl/punk-records/main/english';

function normalizeBaseCardNumber(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/\/.*$/, '')
    .replace(/(_P\d+|-P\d+|_R\d+|_[A-Z]+\d*)$/i, '')
    .replace(/\s+/g, '');
}

async function fetchPunkRecords() {
  console.log('Fetching punk-records pack index...');
  const packsRes = await fetch(`${PUNK_BASE}/packs.json`);
  if (!packsRes.ok) throw new Error(`Failed to fetch packs.json: ${packsRes.status}`);
  const packs = await packsRes.json();
  const packIds = Object.keys(packs);
  console.log(`Found ${packIds.length} English packs in punk-records.`);

  const exactMap = new Map();
  const baseMap = new Map();

  const CONCURRENCY = 8;
  for (let i = 0; i < packIds.length; i += CONCURRENCY) {
    const slice = packIds.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (packId) => {
        const res = await fetch(`${PUNK_BASE}/data/${packId}.json`);
        if (!res.ok) {
          console.warn(`Skipped pack ${packId}: HTTP ${res.status}`);
          return;
        }
        const cards = await res.json();
        for (const c of cards) {
          if (!c?.id) continue;
          const exactKey = String(c.id).trim().toUpperCase();
          exactMap.set(exactKey, c);
          const baseKey = normalizeBaseCardNumber(exactKey);
          if (baseKey && (exactKey === baseKey || !baseMap.has(baseKey))) {
            baseMap.set(baseKey, c);
          }
        }
      })
    );
  }

  console.log(`Loaded ${exactMap.size} exact / ${baseMap.size} unique base card entries from punk-records.`);
  return { exactMap, baseMap };
}

async function fetchOptcgFallback() {
  const fallbackMap = new Map();
  for (const endpoint of ['allSetCards', 'allSTCards']) {
    try {
      const res = await fetch(`https://optcgapi.com/api/${endpoint}/`);
      if (!res.ok) continue;
      const rows = await res.json();
      for (const r of rows) {
        const id = r.card_set_id || r.card_id;
        if (!id) continue;
        const baseKey = normalizeBaseCardNumber(id);
        if (baseKey && !fallbackMap.has(baseKey)) {
          fallbackMap.set(baseKey, r);
        }
      }
    } catch (err) {
      console.warn(`optcgapi ${endpoint} fallback warning:`, err.message);
    }
  }
  console.log(`Loaded ${fallbackMap.size} fallback entries from optcgapi.`);
  return fallbackMap;
}

async function fetchExistingOnePieceCards() {
  const rows = [];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, card_number, name, card_type, rarity, domain, cost, might, subtype, text, effect, set_id')
      .eq('game', 'onepiece')
      .range(from, from + CHUNK - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    from += CHUNK;
    if (data.length < CHUNK) break;
  }
  return rows;
}

function cleanNumericPower(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return /^\d+$/.test(str) ? str : null;
}

function normalizeAttribute(attrs) {
  if (Array.isArray(attrs)) {
    const cleaned = attrs
      .map((a) => String(a || '').trim())
      .filter((a) => a && a !== '-' && a !== '?' && a.toUpperCase() !== 'NULL');
    return cleaned.length > 0 ? cleaned.join('/') : null;
  }
  if (typeof attrs === 'string') {
    const str = attrs.trim();
    if (!str || str === '-' || str === '?' || str.toUpperCase() === 'NULL') return null;
    return str;
  }
  return null;
}

function buildUpdatePayload(row, pr, optcg) {
  const sourcePr = pr || null;
  const sourceApi = optcg || null;

  const attribute =
    normalizeAttribute(sourcePr?.attributes) ??
    normalizeAttribute(sourceApi?.attribute);

  let counter = null;
  if (sourcePr && sourcePr.counter !== null && sourcePr.counter !== undefined && sourcePr.counter !== '') {
    const n = Number(sourcePr.counter);
    if (!Number.isNaN(n)) counter = n;
  } else if (sourceApi && sourceApi.counter_amount !== null && sourceApi.counter_amount !== undefined) {
    const n = Number(sourceApi.counter_amount);
    if (!Number.isNaN(n)) counter = n;
  }

  let blockIcon = null;
  if (sourcePr && sourcePr.block_number !== null && sourcePr.block_number !== undefined && /^\d+$/.test(String(sourcePr.block_number))) {
    blockIcon = Number(sourcePr.block_number);
  }

  let cost = row.cost;
  if (sourcePr && sourcePr.cost !== null && sourcePr.cost !== undefined && /^\d+$/.test(String(sourcePr.cost))) {
    cost = Number(sourcePr.cost);
  } else if (sourceApi) {
    if (sourceApi.life !== null && sourceApi.life !== undefined && /^\d+$/.test(String(sourceApi.life))) {
      cost = Number(sourceApi.life);
    } else if (sourceApi.card_cost !== null && sourceApi.card_cost !== undefined && /^\d+$/.test(String(sourceApi.card_cost))) {
      cost = Number(sourceApi.card_cost);
    }
  }

  const might =
    (sourcePr && sourcePr.power !== null && sourcePr.power !== undefined ? cleanNumericPower(sourcePr.power) : null) ??
    (sourceApi ? cleanNumericPower(sourceApi.card_power) : null) ??
    cleanNumericPower(row.might);

  const subtype =
    (sourcePr && Array.isArray(sourcePr.types) && sourcePr.types.length > 0
      ? sourcePr.types.map((t) => String(t).trim()).filter(Boolean).join('/')
      : null) ??
    (sourceApi?.sub_types ? String(sourceApi.sub_types).trim().replace(/\s*\/\s*/g, '/') : null) ??
    row.subtype;

  const domain =
    (sourcePr && Array.isArray(sourcePr.colors) && sourcePr.colors.length > 0
      ? sourcePr.colors.map((c) => String(c).trim()).filter(Boolean).join(' ')
      : null) ??
    (row.domain && row.domain !== 'Character' ? row.domain : null);

  const rawEffect = sourcePr?.effect && sourcePr.effect !== '-' ? String(sourcePr.effect).trim() : null;
  const rawTrigger = sourcePr?.trigger && sourcePr.trigger !== '-' ? String(sourcePr.trigger).trim() : null;
  const effect = rawEffect ?? row.effect ?? null;

  const metadata = {
    ...(attribute ? { attribute } : {}),
    ...(counter !== null ? { counter } : {}),
    ...(blockIcon !== null ? { block_icon: blockIcon } : {}),
    ...(rawTrigger ? { trigger: rawTrigger } : {}),
    ...(sourcePr?.pack_id ? { pack_id: sourcePr.pack_id } : {}),
    ...(sourcePr?.id ? { official_id: sourcePr.id } : {}),
  };

  return {
    attribute,
    counter,
    block_icon: blockIcon,
    cost,
    might,
    subtype,
    domain,
    effect,
    metadata,
  };
}

async function main() {
  console.log(`Starting One Piece enrichment${isDryRun ? ' [DRY RUN]' : ''}...`);

  const { error: schemaError } = await supabase
    .from('cards')
    .select('id, metadata, attribute, counter, block_icon')
    .eq('game', 'onepiece')
    .limit(1);

  if (schemaError) {
    console.warn(`Schema check warning (${schemaError.code}): ${schemaError.message}`);
    if (!isDryRun) {
      console.error('\nRun supabase/migrations/20261117000000_onepiece_card_fields.sql in Supabase SQL Editor first, then re-run this script.');
      process.exit(1);
    }
  }

  const [{ exactMap, baseMap }, fallbackMap, existingRows] = await Promise.all([
    fetchPunkRecords(),
    fetchOptcgFallback(),
    fetchExistingOnePieceCards(),
  ]);

  console.log(`Fetched ${existingRows.length} existing One Piece cards from Supabase.`);

  let matchedExact = 0;
  let matchedBase = 0;
  let matchedFallback = 0;
  let unmatched = 0;
  let dirtyMightFixed = 0;
  const samples = [];
  const updates = [];

  for (const row of existingRows) {
    const rawUpper = String(row.card_number || '').trim().toUpperCase();
    const baseKey = normalizeBaseCardNumber(rawUpper);

    let pr = exactMap.get(rawUpper) || null;
    if (pr) {
      matchedExact++;
    } else {
      pr = baseMap.get(baseKey) || null;
      if (pr) matchedBase++;
    }

    const optcg = !pr ? fallbackMap.get(baseKey) || null : null;
    if (!pr && optcg) matchedFallback++;
    if (!pr && !optcg) unmatched++;

    const payload = buildUpdatePayload(row, pr, optcg);
    if (row.might && !/^\d+$/.test(String(row.might).trim()) && payload.might !== row.might) {
      dirtyMightFixed++;
    }

    updates.push({ id: row.id, card_number: row.card_number, name: row.name, payload });
    if (samples.length < 5 && (payload.attribute || payload.counter !== null || payload.block_icon !== null)) {
      samples.push({ card_number: row.card_number, name: row.name, ...payload });
    }
  }

  console.log('\nMatch Summary:');
  console.log(`  Total DB rows   : ${existingRows.length}`);
  console.log(`  punk-records (exact): ${matchedExact}`);
  console.log(`  punk-records (base) : ${matchedBase}`);
  console.log(`  optcgapi fallback   : ${matchedFallback}`);
  console.log(`  Unmatched           : ${unmatched}`);
  console.log(`  Dirty Power cleaned : ${dirtyMightFixed}`);
  console.log('\nSample enriched payloads:');
  console.log(JSON.stringify(samples, null, 2));

  if (isDryRun) {
    console.log('\nDry run complete. No database rows modified.');
    return;
  }

  const BATCH_SIZE = 25;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (item) => {
        const { error } = await supabase
          .from('cards')
          .update(item.payload)
          .eq('id', item.id);
        if (error) {
          failed++;
          console.error(`Failed ${item.card_number} (${item.id}): ${error.message}`);
        } else {
          updated++;
        }
      })
    );
    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= updates.length) {
      console.log(`Progress: ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length} (updated=${updated}, failed=${failed})`);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
